/**
 * Adaptador API-Football v3 → modelo interno.
 *
 * Escrito contra `live-sample.json`: uma resposta real de
 * `GET /fixtures?live=all` com 19 partidas ao vivo, capturada em 2026-09-03
 * sem reserialização. **Onde o arquivo e a documentação divergirem, o arquivo
 * vence.** Recortes verbatim vivem em `test/helpers/apiFootballSamples.js`,
 * porque a captura de 58 KB não é versionada.
 *
 * Esta é a única camada que conhece formato de provedor. O núcleo em
 * `src/core/` nunca vê um payload destes.
 *
 * ## O que a captura provou
 *
 * - Envelope: `{ get, parameters, errors, results, paging, response }`.
 *   `errors` vem `[]` (array) na resposta boa.
 * - Os 19 itens têm shape idêntico — um único perfil estrutural, sem campo
 *   opcional faltando em uns e presente em outros.
 * - `fixture.id` e `league.id` são **number**; o modelo interno quer string.
 * - `fixture.date` vem como `2026-09-03T20:00:00+00:00` — ISO 8601 com
 *   offset explícito, não com sufixo `Z`.
 * - `goals.home`/`goals.away` vieram todos number nesta captura. O tratamento
 *   de `null` é defensivo e obrigatório mesmo assim: é a regra que impede o
 *   gol fantasma no apito inicial.
 * - `fixture.status.short` apareceu só como `1H` e `2H`.
 *
 * ## `status.elapsed` satura, e `status.extra` existe
 *
 * MEDIDO na captura: `elapsed` trava em 45 no primeiro tempo com acréscimo
 * correndo. Duas das 19 partidas trazem `elapsed: 45` com `status.extra`
 * valendo 3 e 1 — ou seja, **a API expõe o acréscimo, só que num campo
 * separado**.
 *
 * NÃO MEDIDO: que o mesmo ocorra no segundo tempo. É a observação do dev, e é
 * plausível, mas a captura não a sustenta — a única partida com `elapsed: 90`
 * aqui tem `extra: null`, o que é igualmente compatível com "minuto 90
 * exato". Um segundo snapshot em horário de pico resolveria.
 *
 * O modelo interno não tem onde guardar isso, e mudá-lo é decisão do dev, não
 * deste adaptador. Então `extra` é **descartado** por ora e `elapsedMin`
 * recebe o `elapsed` cru. Consequências registradas:
 *
 * - A UI do PR 3 mostra `45'` numa partida que está em 45+3 — este caso está
 *   na captura. Se a saturação em `2H` se confirmar, o mesmo valeria para
 *   `90'`; até lá é hipótese, não observação.
 *   Isso é o que a fonte diz. **Não é bug e não deve ser "consertado"**
 *   inventando o minuto; a informação existe em `status.extra` e o caminho
 *   certo é levá-la ao modelo interno, não estimá-la.
 * - `isStale` **nunca** pode usar `elapsed` como sinal de frescor. Um dado
 *   pode estar fresquíssimo com `elapsed` parado em 90 por seis minutos. O
 *   frescor vem do timestamp do snapshot, e só dele.
 *
 * @module adapters/apiFootball
 */

/**
 * `fixture.status.short` → status do modelo interno.
 *
 * Marcação de evidência:
 * - ✅ **verificado contra a captura**: `1H`, `2H`. São os únicos que
 *   aparecem nas 19 partidas.
 * - 📄 **da documentação, sem exemplo real**: todos os demais. Um segundo
 *   snapshot noturno deve trazer `HT` e `FT`; até lá, esses mapeamentos são
 *   inferência e não medição.
 *
 * Escolhas que merecem revisão do dev:
 *
 * - `SUSP` e `INT` (suspensa / interrompida) viram `'live'`, não
 *   `'cancelled'`. A partida não acabou nem foi cancelada, e o placar fica
 *   congelado — congelado não gera alerta falso. Mostrar "cancelado" numa
 *   paragem de dez minutos por chuva seria pior. Se depois for abandonada, o
 *   provedor manda `ABD` e aí sim vira `'cancelled'`.
 *
 *   Há um argumento a mais, do lado do núcleo: se virassem `'cancelled'`,
 *   `diff.js` tiraria a confiança do placar **nos dois estados** e o gol
 *   marcado logo após a retomada seria engolido em silêncio, porque o estado
 *   anterior era não confiável. `'live'` mantém a linha de base viva.
 *
 *   CUSTO NÃO ÓBVIO, do outro eixo: `hasLiveFavorite` é pré-condição de
 *   portão do cron. Uma partida parada por chuva que fique `SUSP` por uma
 *   hora conta como ao vivo e mantém o cron gastando requisição a cada 120s
 *   em jogo nenhum — com 100/dia e reserva de 10, são ~30 requisições de uma
 *   janela de 3h queimadas. Não há como distinguir sem acrescentar um status
 *   ao modelo interno, o que é decisão do dev; fica registrado o preço.
 * - `BT` (intervalo da prorrogação) vira `'halftime'`, não `'live'`: é uma
 *   pausa, e é assim que a UI deve pintá-la.
 * - `AWD` e `WO` (vitória técnica, W.O.) viram `'cancelled'`, seguindo o
 *   typedef do modelo, que já descreve `cancelled` como "cancelada, adiada,
 *   abandonada ou W.O.".
 *
 * @type {Readonly<Record<string, import('../core/types.js').FixtureStatus>>}
 */
export const STATUS_MAP = Object.freeze({
  // ✅ verificados contra live-sample.json
  '1H': 'live',
  '2H': 'live',

  // 📄 documentação, sem exemplo real na captura
  TBD: 'scheduled',
  NS: 'scheduled',
  ET: 'live',
  P: 'live',
  LIVE: 'live',
  SUSP: 'live',
  INT: 'live',
  HT: 'halftime',
  BT: 'halftime',
  FT: 'finished',
  AET: 'finished',
  PEN: 'finished',
  PST: 'cancelled',
  CANC: 'cancelled',
  ABD: 'cancelled',
  AWD: 'cancelled',
  WO: 'cancelled',
});

/**
 * Destino de qualquer `status.short` fora do mapa.
 *
 * `'scheduled'` e nunca `'live'`: um código novo da API não pode fazer a
 * página tocar alerta de gol numa partida que talvez nem esteja acontecendo.
 * Erra para o lado silencioso.
 */
const UNKNOWN_STATUS = 'scheduled';

/**
 * Placar do provedor → placar do modelo.
 *
 * `null` significa desconhecido e continua `null`. Converter para `0` aqui
 * criaria o gol fantasma no apito inicial: o núcleo veria `null → 0` como
 * placar estável e depois `0 → 1` como gol, ou pior, veria `0` onde não há
 * informação nenhuma.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function toGoals(value) {
  // Inteiro não negativo ou nada. `-1` e `2.5` não são placar, e deixá-los
  // passar colocaria lixo no caminho que decide se um som toca.
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function toElapsed(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Aceita só string não vazia ou número finito. É o que pode virar chave de
 * diff ou de filtro sem colidir: um objeto viraria `'[object Object]'` e duas
 * partidas assim ocupariam a mesma chave.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function toId(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value !== '') return value;
  return null;
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function toName(value) {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * `errors` é `[]` na resposta boa e vem preenchido quando o plano não cobre o
 * endpoint — **com HTTP 200**. Checar só o status code não pega.
 *
 * @param {unknown} errors
 * @returns {boolean}
 */
function hasErrors(errors) {
  if (errors == null) return false;
  if (Array.isArray(errors)) return errors.length > 0;
  if (typeof errors === 'object') return Object.keys(errors).length > 0;
  return Boolean(errors);
}

/**
 * Converte uma partida crua. Devolve `null` quando o item não tem o mínimo
 * para virar uma `Fixture` utilizável.
 *
 * @param {any} raw
 * @returns {import('../core/types.js').Fixture|null}
 */
function toFixture(raw) {
  // CAMPOS EXIGIDOS. Sem `id` não há como diffar entre snapshots; sem nome de
  // time não há o que mostrar; sem `leagueId` a partida nunca casa com
  // `activeLeagueIds` e some da grade filtrada em silêncio, que é pior do que
  // não estar lá. Partida sem um destes é inútil, e derrubar o snapshot
  // inteiro por causa dela seria desproporcional — o guard de "nenhuma
  // utilizável" em `toFixtures` cobre o caso extremo.
  const id = toId(raw?.fixture?.id);
  const homeName = toName(raw?.teams?.home?.name);
  const awayName = toName(raw?.teams?.away?.name);
  const leagueId = toId(raw?.league?.id);

  if (id === null || homeName === null || awayName === null || leagueId === null) return null;

  const short = raw?.fixture?.status?.short;

  return {
    id,
    homeName,
    awayName,
    homeGoals: toGoals(raw?.goals?.home),
    awayGoals: toGoals(raw?.goals?.away),
    // `Object.hasOwn` e não `STATUS_MAP[short]`: o mapa é um literal
    // congelado, não um objeto de protótipo nulo, então `'constructor'`,
    // `'toString'` e `'__proto__'` devolvem valores truthy da cadeia de
    // protótipos e escapariam para `Fixture.status`, fora dos cinco valores
    // do contrato.
    status: typeof short === 'string' && Object.hasOwn(STATUS_MAP, short)
      ? STATUS_MAP[short]
      : UNKNOWN_STATUS,
    elapsedMin: toElapsed(raw?.fixture?.status?.elapsed),
    // CAMPOS SÓ DE EXIBIÇÃO, que degradam para vazio em vez de descartar a
    // partida: não participam de diff nem de filtro, então perdê-los piora a
    // tela e não a correção.
    //
    // `kickoffISO` é verbatim: já é ISO 8601 com offset, que é o que o modelo
    // pede. Não normalizo para `Z` porque reescrever a data introduziria uma
    // conversão que pode falhar e não acrescenta nada — `Intl.DateTimeFormat`
    // lê as duas formas.
    kickoffISO: typeof raw?.fixture?.date === 'string' ? raw.fixture.date : '',
    leagueId,
    leagueName: typeof raw?.league?.name === 'string' ? raw.league.name : '',
  };
}

/**
 * Resultado de uma conversão, com o que se perdeu no caminho.
 *
 * @typedef  {object} ToFixturesReport
 * @property {import('../core/types.js').Fixture[]} fixtures
 *   Objetos novos, sem referência compartilhada com o payload.
 * @property {number} discarded
 *   Quantas partidas da resposta não viraram `Fixture`.
 *
 *   REQUISITOS: o Worker do PR 2 consome esta versão, e a UI do PR 3 mostra
 *   `discarded > 0` como sinal visível — não como log. O motivo é o de sempre
 *   neste projeto: se 3 de 19 partidas somem porque uma liga mudou um campo,
 *   ninguém fica sabendo, e uma delas pode ser a favorita. Perder partida em
 *   silêncio é o modo de falha que este projeto mais rejeita.
 * @property {boolean} truncated
 *   Se a resposta declarou ter mais partidas do que entregou.
 *
 *   HOJE É SEMPRE `false`, porque truncamento lança antes de chegar aqui. O
 *   campo existe como **costura para a reversão documentada** abaixo: se a
 *   decisão de lançar se inverter, muda uma linha neste arquivo e a
 *   assinatura consumida pelo PR 2 e pelo PR 3 continua a mesma. Sem o campo,
 *   a reversão viraria mudança de contrato atravessando três PRs.
 */

/**
 * Converte uma resposta crua da API-Football em partidas do modelo interno,
 * com relatório do que se perdeu.
 *
 * @param {unknown} rawResponse  Corpo JSON já parseado de `/fixtures?live=all`.
 * @returns {ToFixturesReport}
 * @throws {Error}
 *   Se o envelope não for o esperado, se `errors` vier preenchido, se a
 *   resposta estiver truncada, ou se nenhuma das partidas for utilizável.
 *   Lançar é deliberado: devolver `[]` faria o Worker gravar um snapshot
 *   vazio por cima de um bom, e a página ficaria correta e vazia —
 *   indistinguível de quebrada.
 */
export function toFixturesWithReport(rawResponse) {
  if (rawResponse == null || typeof rawResponse !== 'object' || Array.isArray(rawResponse)) {
    throw new Error('api-football: resposta não é um envelope de objeto');
  }

  const envelope = /** @type {any} */ (rawResponse);

  if (hasErrors(envelope.errors)) {
    throw new Error(`api-football: resposta traz errors: ${JSON.stringify(envelope.errors)}`);
  }

  if (!Array.isArray(envelope.response)) {
    throw new Error('api-football: envelope sem array `response`');
  }

  // Truncamento. Se `paging.total` passa de 1, ou se `results` discorda do
  // tamanho de `response`, faltam partidas. Entregar a página 1 em silêncio
  // faria um favorito sumir e reaparecer conforme a contagem global oscila —
  // e para `diffFixtures` partida que some e volta é partida sem linha de
  // base, então o gol simplesmente não sai.
  //
  // Lançar é escolha deliberada de falhar visível: o Worker preserva o último
  // snapshot bom e a faixa de staleness fica vermelha, em vez de entregar
  // meia verdade com cara de verdade inteira. A captura de 2026-09-03 traz
  // `paging: {current:1, total:1}` e `results` igual ao tamanho, então este
  // caminho não dispara com o que já foi observado.
  //
  // RISCO ASSUMIDO: 19 resultados com `total: 1` é compatível com qualquer
  // tamanho de página >= 19. Não dá para concluir da captura que `live=all`
  // nunca pagina. Se paginar num volume que ainda não observamos, este
  // adaptador passa a lançar sempre e o produto para de atualizar.
  //
  // GATILHO DE REVERSÃO, explícito: **se a medição em horário de pico
  // (sábado, ~16:00 UTC) mostrar paginação real em `live=all` — `paging.total`
  // maior que 1 ou `results` maior que `response.length` —, esta decisão se
  // inverte.** Nesse caso: não lançar, devolver as partidas da página
  // recebida e marcar `truncated: true` no relatório, deixando o Worker e a
  // UI tratarem a perda como sinal visível. É por isso que o campo existe.
  //
  // Até essa medição, lançar é o certo: perder partida em silêncio é pior que
  // parar alto, e parar alto preserva o último snapshot bom.
  const total = envelope.paging?.total;
  if (typeof total === 'number' && total > 1) {
    throw new Error(`api-football: resposta truncada, paging.total = ${total}`);
  }
  if (typeof envelope.results === 'number' && envelope.results !== envelope.response.length) {
    throw new Error(
      `api-football: resposta truncada, results = ${envelope.results} e response tem ${envelope.response.length}`,
    );
  }

  /** @type {import('../core/types.js').Fixture[]} */
  const fixtures = [];
  let discarded = 0;
  for (const raw of envelope.response) {
    const fixture = toFixture(raw);
    if (fixture === null) discarded += 1;
    else fixtures.push(fixture);
  }

  // A outra metade do guard de silêncio. O envelope lança para não fazer o
  // Worker gravar snapshot vazio por cima de um bom; sem isto, a mesma coisa
  // acontecia pelo caminho por item — bastava todo item ser descartado e a
  // função sinalizava sucesso com lista vazia.
  //
  // `response.length > 0 &&` é essencial: resposta legitimamente sem partidas
  // ao vivo é caso normal e continua devolvendo `[]`.
  if (envelope.response.length > 0 && fixtures.length === 0) {
    throw new Error(
      `api-football: ${envelope.response.length} partidas na resposta e nenhuma utilizável`,
    );
  }

  // `truncated` é sempre false aqui: o guard acima lança antes. Ver o
  // contrato do typedef para por que o campo existe mesmo assim.
  return { fixtures, discarded, truncated: false };
}


/**
 * Versão sem relatório, para quem só quer a lista.
 *
 * Wrapper fino: mesma validação, mesmos lançamentos, mesmo descarte. A
 * diferença é só o que se perde — quantas partidas caíram. Use
 * `toFixturesWithReport` quando essa contagem puder virar sinal para o
 * usuário; use esta quando não puder.
 *
 * @param {unknown} rawResponse
 * @returns {import('../core/types.js').Fixture[]}
 * @throws {Error} Nas mesmas condições de `toFixturesWithReport`.
 */
export function toFixtures(rawResponse) {
  return toFixturesWithReport(rawResponse).fixtures;
}
