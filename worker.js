/**
 * Cloudflare Worker: cron busca, KV guarda, navegador lê.
 *
 * ## A regra que define este arquivo
 *
 * **O fetch handler NUNCA chama o upstream.** Nem em cache miss, nem em erro,
 * nem na primeira visita, nem "só desta vez". A cota da API-Football é de 100
 * requisições/dia **globais da chave** — não por cliente —, então qualquer
 * caminho que ligue uma visita a uma requisição upstream transforma tráfego
 * em custo global. Uma aba pollando a 60s consumiria o dia inteiro em menos
 * de um jogo.
 *
 * A separação é estrutural, não uma promessa: `handleFetch` não importa nada
 * que fale com a rede, e há teste que substitui o `fetch` global por um espião
 * e exige zero chamadas em cache miss, KV corrompido, KV fora do ar, rota
 * inválida e método inválido.
 *
 * ## Chaves do KV, e por que são duas
 *
 * - `snapshot` — o último resultado BOM. Só é sobrescrito quando uma busca
 *   deu certo. Erro upstream nunca toca aqui: o último snapshot válido é
 *   sempre preservado, com a hora explícita dele.
 * - `state` — cota, última busca, falhas consecutivas, backoff. Escrito
 *   sempre que houve uma tentativa real de busca, inclusive fracassada —
 *   porque a tentativa gastou cota e isso precisa ser lembrado.
 * - `agenda` — partidas do dia, que alimentam o portão do cron.
 *
 * **Escrita no KV só acontece quando houve busca real.** Tique que decide não
 * gastar cota não escreve nada. Se escrevesse, o timestamp mentiria sobre o
 * frescor e o `isStale` do cliente ficaria cego — a faixa voltaria ao verde
 * sem dado novo nenhum. O orçamento de escrita do KV free (~1000/dia) também
 * não sobreviveria a um cron por minuto gravando sempre: 1440 escritas.
 *
 * @module worker
 */

import { toFixturesWithReport } from './src/adapters/apiFootball.js';
import { decideCronAction } from './src/core/gate.js';
import { activeLeagueIds } from './src/core/leagues.js';
import { nextBackoffMs } from './src/core/backoff.js';
import { buildSnapshot, parseSnapshot, toPublicCronState } from './src/core/snapshot.js';
import { toAgenda } from './src/adapters/apiFootball.js';
import {
  buildStoredAgenda,
  parseStoredAgenda,
  decideAgendaFetch,
} from './src/core/agenda.js';
import { checkRateLimit, routeRequest } from './src/worker/http.js';

export const KV_SNAPSHOT_KEY = 'snapshot';
export const KV_STATE_KEY = 'state';
export const KV_AGENDA_KEY = 'agenda';

const UPSTREAM_URL = 'https://v3.football.api-sports.io/fixtures?live=all';

/**
 * A agenda do dia. `date=` recebe o dia UTC corrente — o mesmo `dayKeyUTC` que
 * governa o livro-caixa, e não uma segunda noção de "hoje".
 *
 * @param {string} dayKey
 * @returns {string}
 */
const agendaUrl = (dayKey) => `https://v3.football.api-sports.io/fixtures?date=${dayKey}`;

/** Teto diário do plano free. É o denominador do livro-caixa local. */
const DAILY_QUOTA = 100;

/** Quanto esperar por uma resposta upstream antes de desistir. */
const UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * Dia UTC de um instante, no formato `AAAA-MM-DD`.
 *
 * A cota reseta às 00:00 UTC, então é esta chave que diz quando o livro-caixa
 * zera. Função pura da entrada.
 *
 * @param {number} nowMs
 * @returns {string}
 */
function dayKeyUTC(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** Estado do rate limit, por isolate. Ver a limitação em `worker/http.js`. */
const rateLimitState = new Map();

/**
 * Rede de segurança para quando o KV não aceita escrita.
 *
 * Se todo `put` falhar, o `state` nunca existe e cada tique do cron enxerga
 * "nunca buscou" — medido, 181 requisições num dia, quase o dobro da cota
 * inteira. Esta memória vive no isolate: é efêmera, não é compartilhada entre
 * instâncias e **não substitui o KV**. Ela só evita que uma indisponibilidade
 * de escrita vire gasto ilimitado enquanto o isolate durar.
 *
 * O gate usa o MAIOR `lastFetchAtMs` entre o KV e esta memória, e o MAIOR
 * `spentToday`: na dúvida, assume que gastou mais e mais recentemente.
 */
let memoriaIsolate = { lastFetchAtMs: null, spentToday: 0, dayKeyUTC: '', agendaAttemptsToday: 0, agendaLastAttemptMs: null };

/**
 * Zera o estado de módulo — rate limit e memória do isolate.
 *
 * Existe **só para os testes**. Sem ela, um teste que faz o cron buscar deixa
 * `memoriaIsolate.lastFetchAtMs` marcado e o teste seguinte, no mesmo
 * instante simulado, vê "buscou agora há pouco" e não busca — falhando por um
 * motivo que não tem nada a ver com o que ele testa. Em produção não há
 * chamador: o isolate morre e o estado vai junto.
 */
export function __resetIsolateState() {
  rateLimitState.clear();
  memoriaIsolate = { lastFetchAtMs: null, spentToday: 0, dayKeyUTC: '', agendaAttemptsToday: 0, agendaLastAttemptMs: null };
}

/**
 * Milissegundos até o reset da cota, que é às 00:00 UTC.
 *
 * @param {number} nowMs
 * @returns {number}
 */
function msUntilQuotaReset(nowMs) {
  const proximoReset = new Date(nowMs);
  proximoReset.setUTCHours(24, 0, 0, 0);
  return proximoReset.getTime() - nowMs;
}

/**
 * @param {Response} response
 * @returns {{quotaRemaining: number|null}}
 */
function readQuotaHeaders(response) {
  // Headers HTTP são strings. `Number(null)` é 0, que significaria cota
  // esgotada — por isso o `null` explícito quando o header não veio.
  const bruto = response.headers.get('x-ratelimit-requests-remaining');
  const n = bruto === null ? Number.NaN : Number(bruto);
  return { quotaRemaining: Number.isFinite(n) ? n : null };
}

/**
 * @param {any} kv
 * @param {string} key
 * @returns {Promise<any>} Valor parseado, ou `null` se ausente ou ilegível.
 */
async function readJson(kv, key) {
  const bruto = await kv.get(key);
  if (bruto === null || bruto === undefined) return null;
  try {
    return typeof bruto === 'string' ? JSON.parse(bruto) : bruto;
  } catch {
    return null;
  }
}

/**
 * CAMPOS DO `state` QUE NÃO SÃO DE ESCOPO DIÁRIO, com o motivo de cada um.
 *
 * Esta lista é a INVERSA da intuitiva, e a inversão é o ponto. Listar "os
 * campos que zeram na virada" deixaria um campo novo de fora por omissão — e
 * omissão é exatamente como os quatro bugs de 00:00 UTC deste projeto
 * nasceram. Aqui, campo novo que ninguém classificar cai automaticamente no
 * lado "é diário, tem que zerar no `ledger`", e o teste
 * `estado-diario.test.js` fica vermelho até alguém decidir conscientemente.
 *
 * Fail-closed: o silêncio acusa em vez de passar.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const __CAMPOS_NAO_DIARIOS = Object.freeze({
  dayKeyUTC: 'É o próprio discriminador. Não zera: é reescrito para o dia novo.',
  lastFetchAtMs:
    'Instante absoluto, não contador diário. O intervalo entre buscas atravessa '
    + 'a meia-noite como qualquer outro par de instantes; zerar aqui faria o cron '
    + 'buscar duas vezes seguidas às 00:00.',
  consecutiveFailures:
    'Escada de backoff, não gasto. Um upstream que está fora do ar às 23:59 '
    + 'continua fora às 00:01, e zerar reiniciaria a escada no primeiro degrau '
    + 'justamente quando ela é mais necessária.',
  backoffUntilMs:
    'Instante absoluto de quando voltar a tentar. Mesmo motivo de '
    + '`consecutiveFailures`.',
});

const ESTADO_INICIAL = {
  lastFetchAtMs: null,
  quotaRemaining: DAILY_QUOTA,
  spentToday: 0,
  dayKeyUTC: '',
  consecutiveFailures: 0,
  backoffUntilMs: 0,
  // Contabilidade da busca da agenda. INTERNA: nada disto vai para o cliente
  // — o que a página mostra quando falta agenda é o `reason: 'no-agenda'` do
  // snapshot, que já existe. Estes dois campos existem só para a reserva de 10
  // não evaporar em retentativa; ver `AGENDA_MAX_ATTEMPTS_PER_DAY`.
  agendaAttemptsToday: 0,
  agendaLastAttemptMs: null,
};

/**
 * @param {unknown} bruto
 * @returns {typeof ESTADO_INICIAL}
 */
function normalizeState(bruto) {
  if (bruto === null || typeof bruto !== 'object') return { ...ESTADO_INICIAL };
  const s = /** @type {any} */ (bruto);
  const num = (v, padrao) => (typeof v === 'number' && Number.isFinite(v) ? v : padrao);
  return {
    lastFetchAtMs: typeof s.lastFetchAtMs === 'number' && Number.isFinite(s.lastFetchAtMs)
      ? s.lastFetchAtMs
      : null,
    quotaRemaining: num(s.quotaRemaining, ESTADO_INICIAL.quotaRemaining),
    spentToday: num(s.spentToday, 0),
    dayKeyUTC: typeof s.dayKeyUTC === 'string' ? s.dayKeyUTC : '',
    consecutiveFailures: num(s.consecutiveFailures, 0),
    backoffUntilMs: num(s.backoffUntilMs, 0),
    agendaAttemptsToday: num(s.agendaAttemptsToday, 0),
    // Fallback explícito para `null` e não `undefined`, pelo mesmo motivo do
    // `reason` no envelope: `undefined` some no `JSON.stringify` e volta
    // indistinguível de campo que nunca existiu.
    agendaLastAttemptMs: typeof s.agendaLastAttemptMs === 'number'
      && Number.isFinite(s.agendaLastAttemptMs)
      ? s.agendaLastAttemptMs
      : null,
  };
}

/**
 * Funde o estado do KV com a memória do isolate, sempre pelo lado pessimista.
 *
 * @param {typeof ESTADO_INICIAL} estadoKV
 * @param {number} nowMs
 * @returns {typeof ESTADO_INICIAL}
 */
function combinarComMemoria(estadoKV, nowMs) {
  const hoje = dayKeyUTC(nowMs);
  if (memoriaIsolate.dayKeyUTC !== hoje) return estadoKV;

  const gastoKV = estadoKV.dayKeyUTC === hoje ? estadoKV.spentToday : 0;
  const tentativasKV = estadoKV.dayKeyUTC === hoje ? estadoKV.agendaAttemptsToday : 0;
  return {
    ...estadoKV,
    lastFetchAtMs: Math.max(estadoKV.lastFetchAtMs ?? 0, memoriaIsolate.lastFetchAtMs ?? 0) || null,
    spentToday: Math.max(gastoKV, memoriaIsolate.spentToday),
    // As tentativas de agenda entram na memória pelo mesmo motivo que o gasto:
    // com o KV recusando escrita, o contador do estado nunca sobe e o teto de
    // tentativas nunca é atingido — a reserva de 10 iria embora num dia de KV
    // instável, que é exatamente o dia em que ela mais importa.
    agendaAttemptsToday: Math.max(tentativasKV, memoriaIsolate.agendaAttemptsToday),
    agendaLastAttemptMs:
      Math.max(estadoKV.agendaLastAttemptMs ?? 0, memoriaIsolate.agendaLastAttemptMs ?? 0) || null,
    dayKeyUTC: hoje,
  };
}

/**
 * O LIVRO-CAIXA: quanto de cota resta, contando localmente.
 *
 * A reserva de 10 é a invariante mais dura do projeto, e antes disto a única
 * coisa que a sustentava era o header `x-ratelimit-requests-remaining` —
 * lido em quatro lugares do código e **nunca observado em captura nenhuma**.
 * Se ele não vier, `readQuotaHeaders` devolve `null`, e repassar o valor
 * anterior fazia a cota nunca descer: medido, 91 requisições num dia com o
 * estado ainda dizendo 100 restantes.
 *
 * Agora o header é um teto a mais, não a fonte. O gasto é contado aqui, em
 * toda tentativa real — sucesso e falha —, e zera na virada do dia UTC. O
 * pior caso de perder o estado passa a ser recomeçar do zero, não recomeçar
 * de 100.
 *
 * @param {typeof ESTADO_INICIAL} estado
 * @param {number} nowMs
 * @returns {{spentToday: number, quotaRemaining: number}}
 */
export function __ledger(estado, nowMs) {
  return ledger(estado, nowMs);
}

/**
 * Cópia do estado inicial, para o teste da invariante diária enumerar os
 * campos sem que ele possa alterá-los.
 *
 * @returns {typeof ESTADO_INICIAL}
 */
export function __estadoInicial() {
  return { ...ESTADO_INICIAL };
}

function ledger(estado, nowMs) {
  const hoje = dayKeyUTC(nowMs);
  const mesmoDia = estado.dayKeyUTC === hoje;

  const spentToday = mesmoDia ? estado.spentToday : 0;
  const porContagem = DAILY_QUOTA - spentToday;

  // O valor do header vale para o DIA em que foi lido. Depois da virada ele é
  // história: no fim de qualquer dia ele vale a reserva, e deixá-lo limitar o
  // dia seguinte travaria o Worker para sempre — `hasUsableQuota(10)` é
  // `false`, então nunca mais haveria busca. Morte silenciosa no primeiro dia.
  // Estado sem `dayKeyUTC` não é "outro dia", é "dia desconhecido": o valor
  // guardado continua sendo evidência de gasto recente e deve limitar. Só uma
  // virada CONFIRMADA descarta o teto do header.
  const diaDesconhecido = estado.dayKeyUTC === '';
  const porHeader = (mesmoDia || diaDesconhecido) && Number.isFinite(estado.quotaRemaining)
    ? estado.quotaRemaining
    : Number.POSITIVE_INFINITY;

  // As tentativas de agenda zeram no MESMO discriminador de dia que o gasto —
  // uma fonte de verdade para "o que já aconteceu hoje". Um segundo critério
  // de virada seria um segundo orçamento, e é dele que nascem os bugs de
  // 00:00 UTC que este projeto já viu três vezes.
  //
  // Dia DESCONHECIDO não zera, pela mesma razão do teto do header: `''` não é
  // "outro dia", é "não sei", e um estado ilegível não pode destravar
  // tentativas ilimitadas.
  const agendaAttemptsToday = mesmoDia || diaDesconhecido ? estado.agendaAttemptsToday : 0;

  // O HORÁRIO da última tentativa zera JUNTO com o contador, e isto não é
  // simetria decorativa. MEDIDO: com uma tentativa às 23:50 UTC e o tique das
  // 00:01 do dia seguinte, o contador zerava e o timestamp não — o
  // espaçamento de 15 min de ontem bloqueava a agenda de hoje justamente no
  // instante em que ela deve ser buscada, e o cron ficava em fail-open
  // gastando cota até as 00:05.
  //
  // É o terceiro bug de virada de dia UTC deste projeto, e todos tiveram a
  // mesma forma: dois campos que descrevem o mesmo fato zerando por critérios
  // diferentes. Se um dia houver um quarto campo diário, ele zera aqui.
  const agendaLastAttemptMs = mesmoDia || diaDesconhecido ? estado.agendaLastAttemptMs : null;

  // O menor dos dois manda: o header pode mentir alto, a contagem não.
  return {
    spentToday,
    quotaRemaining: Math.min(porHeader, porContagem),
    agendaAttemptsToday,
    agendaLastAttemptMs,
  };
}

/**
 * @param {unknown} corpo
 * @param {number} status
 * @param {Record<string, string>} [headers]
 * @returns {Response}
 */
function json(corpo, status, headers = {}) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // A página é servida pelo GitHub Pages, outra origem. Sem isto o
      // navegador bloqueia a leitura e a grade fica vazia sem erro visível.
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

/**
 * Serve o snapshot do KV. Não fala com a rede, em hipótese nenhuma.
 *
 * @param {Request} request
 * @param {any} env
 * @returns {Promise<Response>}
 */
async function handleFetch(request, env) {
  const url = new URL(request.url);
  const rota = routeRequest(request.method, url.pathname);

  if (!rota.ok) {
    return json(
      { error: rota.status === 405 ? 'método não permitido' : 'não encontrado' },
      rota.status,
      rota.allow ? { allow: rota.allow } : {},
    );
  }

  const ip = request.headers.get('cf-connecting-ip');
  const limite = checkRateLimit(rateLimitState, ip, Date.now());
  if (!limite.allowed) {
    return json({ error: 'requisições demais' }, 429, {
      'retry-after': String(Math.ceil(limite.retryAfterMs / 1000)),
    });
  }

  let snapshot = null;
  try {
    snapshot = parseSnapshot(await env.PLACAR_KV.get(KV_SNAPSHOT_KEY));
  } catch {
    // KV fora do ar. Erro explícito, nunca corpo vazio com 200: o cliente
    // precisa distinguir "não há jogos" de "não sei o que há".
    return json({ error: 'armazenamento indisponível' }, 503);
  }

  if (snapshot === null) {
    // Ainda não há snapshot, ou o que há é ilegível. 200 com lista vazia
    // diria "não há jogos" — mentira, e do tipo que a página exibe com cara
    // de verdade.
    return json({ error: 'sem snapshot ainda' }, 503, { 'retry-after': '60' });
  }

  // SEGUNDA CHAVE, NENHUMA CHAMADA UPSTREAM. `snapshot.fetchedAtMs` diz se o
  // dado é novo; o `state` diz por que não é. O snapshot sozinho não consegue
  // responder isso: ele só é escrito em busca bem-sucedida, então nos tiques
  // em que o cron desiste não há nada nele para contar a história.
  //
  // Falha aqui NÃO derruba a resposta: sem o estado, a página degrada para o
  // que já fazia — mostrar o snapshot com o indicador de staleness. Um erro
  // de diagnóstico não pode custar o dado.
  let cron = null;
  try {
    cron = toPublicCronState(await env.PLACAR_KV.get(KV_STATE_KEY), dayKeyUTC(Date.now()));
  } catch {
    cron = null;
  }

  // Campo NOVO, ao lado do envelope — nunca `{ snapshot, cron }`. O corpo
  // continua sendo superconjunto do `Snapshot` do modelo interno, que é o que
  // deixa `applySnapshot` consumi-lo sem tradução. Há teste guardando isso.
  return json({ ...snapshot, cron }, 200);
}

/**
 * O cron: decide, e só então gasta.
 *
 * @param {any} event
 * @param {any} env
 * @returns {Promise<void>}
 */
async function handleScheduled(event, env) {
  const nowMs = typeof event?.scheduledTime === 'number' ? event.scheduledTime : Date.now();
  const kv = env.PLACAR_KV;

  const estadoKV = normalizeState(await readJson(kv, KV_STATE_KEY));
  const estado = combinarComMemoria(estadoKV, nowMs);
  const caixa = ledger(estado, nowMs);
  const hojeUTC = dayKeyUTC(nowMs);
  // Agenda de OUTRO dia lê como `null`, não como `[]`: ver `parseStoredAgenda`.
  const agenda = parseStoredAgenda(await kv.get(KV_AGENDA_KEY), hojeUTC);

  // A AGENDA VEM ANTES. Se ela for buscada neste tique, a invocação termina
  // aqui: duas requisições upstream no mesmo minuto gastariam o dobro por um
  // dado que só muda uma vez por dia, e o tique seguinte chega em 60s já com a
  // agenda no lugar.
  const decisaoAgenda = decideAgendaFetch({
    nowMs,
    hasAgendaForToday: agenda !== null,
    quotaRemaining: caixa.quotaRemaining,
    attemptsToday: caixa.agendaAttemptsToday,
    // Do livro-caixa, não do estado cru: é o `ledger` que sabe se virou o dia.
    lastAttemptAtMs: caixa.agendaLastAttemptMs,
  });

  if (decisaoAgenda.shouldFetch) {
    await buscarAgenda(kv, env, estado, caixa, nowMs, hojeUTC);
    return;
  }

  const leagueIds = activeLeagueIds(
    agenda === null ? null : agenda.map((f) => f.leagueId),
  );

  const decisao = decideCronAction({
    nowMs,
    agenda,
    leagueIds,
    quotaRemaining: caixa.quotaRemaining,
    msUntilReset: msUntilQuotaReset(nowMs),
    lastFetchAtMs: estado.lastFetchAtMs,
    backoffUntilMs: estado.backoffUntilMs,
  });

  // NADA de escrita aqui. Tique que não busca não deixa rastro no KV.
  if (!decisao.shouldFetch) return;

  if (!env.API_FOOTBALL_KEY) {
    // Sem secret configurado não há o que buscar. Não escreve nada: nenhuma
    // requisição foi gasta, e inventar uma falha aqui acionaria o backoff por
    // um problema de configuração.
    return;
  }

  // Registrado ANTES da chamada: se a invocação morrer no meio — timeout do
  // runtime, subrequisição pendurada —, a tentativa já está contada.
  memoriaIsolate = {
    ...memoriaIsolate,
    lastFetchAtMs: nowMs,
    spentToday: caixa.spentToday + 1,
    dayKeyUTC: dayKeyUTC(nowMs),
  };

  let resposta;
  try {
    resposta = await fetch(UPSTREAM_URL, {
      method: 'GET',
      headers: {
        // A chave vai no header, nunca na URL: URL entra em log de proxy.
        'x-apisports-key': env.API_FOOTBALL_KEY,
        accept: 'application/json',
      },
      // Sem isto, uma subrequisição pendurada mata a invocação do cron antes
      // de `registrarFalha` rodar: a requisição foi gasta, o backoff não
      // existe, e no minuto seguinte tudo se repete.
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    await registrarFalha(kv, estado, caixa, nowMs, { rateLimited: false });
    return;
  }

  if (!resposta.ok) {
    await registrarFalha(kv, estado, caixa, nowMs, { rateLimited: resposta.status === 429 });
    return;
  }

  const { quotaRemaining } = readQuotaHeaders(resposta);

  let relatorio;
  try {
    // `toFixturesWithReport` lança em envelope inválido, em `errors`
    // preenchido (que vem com HTTP 200), em truncamento e quando nenhuma
    // partida é utilizável. Todos esses são falha, não "zero jogos".
    relatorio = toFixturesWithReport(await resposta.json());
  } catch {
    await registrarFalha(kv, estado, caixa, nowMs, { rateLimited: false }, quotaRemaining);
    return;
  }

  const snapshot = buildSnapshot({
    fetchedAtMs: nowMs,
    fixtures: relatorio.fixtures,
    quotaRemaining,
    quotaResetAtMs: nowMs + msUntilQuotaReset(nowMs),
    discarded: relatorio.discarded,
    upstreamCount: relatorio.fixtures.length + relatorio.discarded,
    truncated: relatorio.truncated,
    // `decisao.reason` entra: é o que deixa a página dizer que está buscando
    // sem agenda, em vez de mostrar uma grade curta sem explicação.
    reason: decisao.reason,
    // `decisao.intervalMs` NÃO entra aqui: é interno ao portão (ver
    // `core/gate.js`). Cliente que o lesse pintaria verde por 3h com a cota
    // no fim.
  });

  // ORDEM DELIBERADA: `state` primeiro. As duas escritas não são atômicas, e
  // se a segunda falhar é melhor sobrar "buscou, mas o snapshot é velho" — o
  // cliente vê vermelho no staleness — do que "dado novo e o portão não soube
  // que gastou", que era o caminho para uma requisição por minuto sem freio.
  // Medido no desenho anterior: 181 requisições num dia.
  await kv.put(
    KV_STATE_KEY,
    JSON.stringify({
      lastFetchAtMs: nowMs,
      quotaRemaining: quotaRemaining ?? caixa.quotaRemaining - 1,
      spentToday: caixa.spentToday + 1,
      dayKeyUTC: dayKeyUTC(nowMs),
      consecutiveFailures: 0,
      backoffUntilMs: 0,
    }),
  );
  await kv.put(KV_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

/**
 * Busca a agenda do dia e grava. Uma requisição, tirada da reserva de 10.
 *
 * ## A tentativa é contada ANTES da chamada
 *
 * Mesma disciplina do caminho ao vivo: se a invocação morrer no meio — timeout
 * do runtime, subrequisição pendurada —, a tentativa já está no livro. Sem
 * isso o teto de tentativas nunca sobe e a reserva evapora em minutos.
 *
 * ## Falha não inventa estado
 *
 * Não há `reason` novo, nem campo de erro de agenda no snapshot. Quando a
 * agenda falta, `decideCronAction` já devolve `reason: 'no-agenda'`, o Worker
 * segue em fail-open e a página avisa que está buscando às cegas. O que a
 * falha atualiza é só a contabilidade interna: gasto, tentativa e horário.
 *
 * @param {any} kv
 * @param {typeof ESTADO_INICIAL} estado
 * @param {any} env
 * @param {{spentToday: number, quotaRemaining: number, agendaAttemptsToday: number}} caixa
 * @param {number} nowMs
 * @param {string} hojeUTC
 * @returns {Promise<void>}
 */
async function buscarAgenda(kv, env, estado, caixa, nowMs, hojeUTC) {
  if (!env.API_FOOTBALL_KEY) {
    // Sem secret não há o que buscar, e nenhuma requisição foi gasta. Não
    // conta tentativa: um problema de configuração não pode consumir o teto
    // diário e deixar o dia sem agenda depois que a chave for cadastrada.
    return;
  }

  const estadoBase = {
    ...estado,
    spentToday: caixa.spentToday + 1,
    quotaRemaining: caixa.quotaRemaining - 1,
    dayKeyUTC: hojeUTC,
    agendaAttemptsToday: caixa.agendaAttemptsToday + 1,
    agendaLastAttemptMs: nowMs,
  };

  // Contada ANTES da chamada, mesma disciplina do caminho ao vivo, e também na
  // memória do isolate: se o KV estiver recusando escrita, é ela que segura o
  // teto de tentativas.
  memoriaIsolate = {
    lastFetchAtMs: estado.lastFetchAtMs,
    spentToday: caixa.spentToday + 1,
    dayKeyUTC: hojeUTC,
    agendaAttemptsToday: caixa.agendaAttemptsToday + 1,
    agendaLastAttemptMs: nowMs,
  };

  let entries = null;
  try {
    const resposta = await fetch(agendaUrl(hojeUTC), {
      method: 'GET',
      headers: {
        'x-apisports-key': env.API_FOOTBALL_KEY,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (resposta.ok) {
      const { quotaRemaining } = readQuotaHeaders(resposta);
      if (quotaRemaining !== null) estadoBase.quotaRemaining = quotaRemaining;
      // `toAgenda` lança em envelope inválido, `errors` preenchido, truncamento
      // e payload indecifrável. Agenda vazia por dia já encerrado NÃO lança —
      // é resposta legítima e vira `[]`, que fecha o portão a custo zero.
      entries = toAgenda(await resposta.json());
    }
  } catch {
    entries = null;
  }

  // ORDEM: agenda primeiro, estado depois. Se a segunda escrita falhar, sobra
  // "tenho a agenda de hoje e a tentativa não foi contada" — o portão fecha
  // sozinho no tique seguinte porque a agenda existe. O inverso deixaria a
  // tentativa contada sem agenda nenhuma, gastando o teto à toa.
  if (entries !== null) {
    await kv.put(KV_AGENDA_KEY, JSON.stringify(buildStoredAgenda(hojeUTC, entries)));
  }

  await kv.put(KV_STATE_KEY, JSON.stringify(estadoBase));
}

/**
 * Falha upstream: atualiza só o estado. O snapshot bom fica onde está.
 *
 * A tentativa gastou cota mesmo tendo falhado, então `lastFetchAtMs` avança —
 * senão o cron voltaria no tique seguinte e a escada de backoff nunca sairia
 * do primeiro degrau.
 *
 * @param {any} kv
 * @param {typeof ESTADO_INICIAL} estado
 * @param {{spentToday: number, quotaRemaining: number}} caixa
 * @param {number} nowMs
 * @param {{rateLimited: boolean}} contexto
 * @param {number|null} [quotaRemaining]
 */
async function registrarFalha(kv, estado, caixa, nowMs, contexto, quotaRemaining = null) {
  const falhas = estado.consecutiveFailures + 1;
  await kv.put(
    KV_STATE_KEY,
    JSON.stringify({
      lastFetchAtMs: nowMs,
      quotaRemaining: quotaRemaining ?? Math.max(0, caixa.quotaRemaining - 1),
      // A tentativa gastou cota mesmo tendo falhado. Não contar aqui seria a
      // forma mais rápida de furar a reserva num dia de instabilidade.
      spentToday: caixa.spentToday + 1,
      dayKeyUTC: dayKeyUTC(nowMs),
      consecutiveFailures: falhas,
      backoffUntilMs: nowMs + nextBackoffMs(falhas, contexto),
    }),
  );
}

export default {
  /**
   * @param {Request} request
   * @param {any} env
   * @param {any} ctx
   */
  async fetch(request, env, ctx) {
    void ctx;
    try {
      return await handleFetch(request, env);
    } catch {
      return json({ error: 'erro interno' }, 500);
    }
  },

  /**
   * @param {any} event
   * @param {any} env
   * @param {any} ctx
   */
  async scheduled(event, env, ctx) {
    void ctx;
    try {
      await handleScheduled(event, env);
    } catch {
      // Exceção que escapa daqui é pior que o erro que a causou: sem
      // `state` gravado, o portão não sabe que houve tentativa e o cron volta
      // no minuto seguinte, sem intervalo e sem backoff. Engolir e deixar o
      // próximo tique decidir é o comportamento seguro — o `state` só não
      // avança quando nem o KV está aceitando escrita, e aí não há o que
      // fazer daqui.
    }
  },
};
