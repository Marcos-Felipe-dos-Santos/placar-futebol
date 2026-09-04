import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { KV_SNAPSHOT_KEY, KV_STATE_KEY, KV_AGENDA_KEY, __resetIsolateState } from '../worker.js';
import { buildSnapshot, parseSnapshot } from '../src/core/snapshot.js';
import { BACKOFF_MAX_MS } from '../src/core/backoff.js';
import { applySnapshot } from '../src/core/session.js';
import { makeFixture } from './helpers/fixtures.js';
import { primeiroTempo, segundoTempo, envelopeVazio } from './helpers/apiFootballSamples.js';

const T0 = Date.parse('2026-09-03T22:00:00.000Z');

// O Worker guarda estado no módulo (rate limit e memória do isolate). Sem
// isto, o teste de 429 deixa ~60 marcas para 1.2.3.4 e qualquer teste
// posterior com esse IP colhe um 429 espúrio que parece bug do Worker.
test.beforeEach(() => __resetIsolateState());

/** KV falso que registra tudo — é como se vê o que foi escrito e o que não. */
function fakeKV(inicial = {}) {
  const store = new Map(Object.entries(inicial));
  const puts = [];
  return {
    store,
    puts,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      puts.push({ key, value });
      store.set(key, value);
    },
  };
}

/**
 * Substitui o fetch global por um espião durante uma chamada.
 * É assim que se prova que o fetch handler não toca no upstream: se ele
 * tocar, o espião registra — e lança, então o caminho ilegal quebra o teste
 * em vez de só contar zero.
 *
 * PRESSUPÕE que nenhum handler use `ctx.waitUntil`. A garantia vem disso, não
 * do `finally`: com trabalho em voo depois do `await`, o espião é restaurado
 * antes de a chamada acontecer e o assert vira corrida. Hoje `ctx` é ignorado
 * nos dois handlers; se o PR 3 introduzir `waitUntil`, este helper precisa
 * esperar o trabalho pendente antes de restaurar.
 */
async function comFetchEspiao(impl, corpo) {
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (...args) => {
    chamadas.push(args);
    if (typeof impl === 'function') return impl(...args);
    throw new Error('UPSTREAM CHAMADO INDEVIDAMENTE');
  };
  try {
    return { resultado: await corpo(), chamadas };
  } finally {
    globalThis.fetch = original;
  }
}

function envelope(response) {
  return { ...envelopeVazio, results: response.length, response };
}

/** Resposta upstream de sucesso, com headers de cota. */
function respostaUpstream(body, { status = 200, quota = '87' } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'x-ratelimit-requests-remaining': quota,
      'x-ratelimit-requests-limit': '100',
    },
  });
}

function snapshotGravado(overrides = {}) {
  return JSON.stringify(
    buildSnapshot({
      fetchedAtMs: T0 - 60_000,
      fixtures: [makeFixture({ id: 'a' })],
      quotaRemaining: 90,
      discarded: 0,
      upstreamCount: 1,
      ...overrides,
    }),
  );
}

function env(kv, extra = {}) {
  return { PLACAR_KV: kv, API_FOOTBALL_KEY: 'chave-de-teste', ...extra };
}

function pedido(url = 'https://w.dev/api/live', init = {}) {
  return new Request(url, { headers: { 'cf-connecting-ip': '1.2.3.4' }, ...init });
}

// === REGRA 1: o fetch handler NUNCA chama upstream ==========================

test('regra 1: fetch handler não chama upstream com snapshot em cache', async () => {
  const kv = fakeKV({ [KV_SNAPSHOT_KEY]: snapshotGravado() });
  const { chamadas } = await comFetchEspiao(null, () => worker.fetch(pedido(), env(kv), {}));
  assert.deepEqual(chamadas, [], 'houve chamada upstream no caminho de leitura');
});

test('regra 1: fetch handler não chama upstream em cache MISS', async () => {
  // O caso mais tentador: não tem dado, "só desta vez busca". É por aqui que
  // a cota do dia inteiro evapora numa primeira visita concorrida.
  const kv = fakeKV({});
  const { chamadas } = await comFetchEspiao(null, () => worker.fetch(pedido(), env(kv), {}));
  assert.deepEqual(chamadas, [], 'cache miss virou busca upstream');
});

test('regra 1: fetch handler não chama upstream com snapshot corrompido', async () => {
  const kv = fakeKV({ [KV_SNAPSHOT_KEY]: 'não é json {{{' });
  const { chamadas } = await comFetchEspiao(null, () => worker.fetch(pedido(), env(kv), {}));
  assert.deepEqual(chamadas, []);
});

test('regra 1: fetch handler não chama upstream quando o KV falha', async () => {
  const kv = {
    async get() { throw new Error('KV indisponível'); },
    async put() { throw new Error('KV indisponível'); },
  };
  const { chamadas, resultado } = await comFetchEspiao(null, () =>
    worker.fetch(pedido(), env(kv), {}),
  );
  assert.deepEqual(chamadas, [], 'erro de KV virou busca upstream');
  assert.ok(resultado.status >= 500, 'a falha tem que aparecer como erro, não como vazio');
});

test('regra 1: nem rota inválida nem método inválido chamam upstream', async () => {
  const kv = fakeKV({ [KV_SNAPSHOT_KEY]: snapshotGravado() });
  const { chamadas } = await comFetchEspiao(null, async () => {
    await worker.fetch(pedido('https://w.dev/api/refresh'), env(kv), {});
    await worker.fetch(pedido('https://w.dev/api/live', { method: 'POST' }), env(kv), {});
    await worker.fetch(pedido('https://w.dev/'), env(kv), {});
  });
  assert.deepEqual(chamadas, []);
});

test('regra 1: o fetch handler também não escreve no KV', async () => {
  // Escrever na leitura estouraria o limite de escrita do KV free com
  // qualquer visita, e faria o timestamp mentir sobre o frescor.
  const kv = fakeKV({ [KV_SNAPSHOT_KEY]: snapshotGravado() });
  await comFetchEspiao(null, () => worker.fetch(pedido(), env(kv), {}));
  assert.deepEqual(kv.puts, []);
});

// === o que o fetch handler devolve ==========================================

test('GET /api/live devolve o snapshot do KV', async () => {
  const kv = fakeKV({ [KV_SNAPSHOT_KEY]: snapshotGravado() });
  const { resultado } = await comFetchEspiao(null, () => worker.fetch(pedido(), env(kv), {}));

  assert.equal(resultado.status, 200);
  const corpo = await resultado.json();
  assert.equal(corpo.fixtures.length, 1);
  assert.equal(corpo.fetchedAtMs, T0 - 60_000);
  assert.equal(corpo.quotaRemaining, 90, 'a cota é global e vem do snapshot, não do cliente');
});

/** Dia UTC de agora — o mesmo que o fetch handler calcula de `Date.now()`. */
function hojeUTC() {
  return new Date().toISOString().slice(0, 10);
}

test('a resposta serve o estado do cron: é ele que diz POR QUE o dado é velho', async () => {
  // O objetivo desde o começo: "acabou a cota" e "quebrou" não podem ser
  // indistinguíveis. O snapshot não consegue responder isso — só é escrito em
  // busca bem-sucedida —, então a resposta carrega também a chave `state`,
  // que é escrita em toda tentativa real. Nenhuma escrita nova, nenhuma
  // chamada upstream: dado que já existia, agora servido.
  const kv = fakeKV({
    [KV_SNAPSHOT_KEY]: snapshotGravado(),
    [KV_STATE_KEY]: JSON.stringify({
      consecutiveFailures: 3,
      backoffUntilMs: T0 + 300_000,
      quotaRemaining: 41,
      spentToday: 59,
      dayKeyUTC: hojeUTC(),
    }),
  });
  const { chamadas, resultado } = await comFetchEspiao(null, () =>
    worker.fetch(pedido(), env(kv), {}),
  );

  assert.deepEqual(chamadas, [], 'servir o estado virou chamada upstream');
  const corpo = await resultado.json();
  assert.equal(corpo.cron.consecutiveFailures, 3, 'sem isto, quebrado é indistinguível de parado');
  assert.equal(corpo.cron.backoffUntilMs, T0 + 300_000);
  assert.equal(corpo.cron.quotaRemaining, 41);
});

test('o corpo continua sendo superconjunto do Snapshot interno', async () => {
  // `cron` entra AO LADO dos campos do envelope, nunca envolvendo-o num
  // `{ snapshot, cron }`. Se envolvesse, `applySnapshot` deixaria de consumir
  // a resposta direto e o cliente precisaria de código de tradução — a
  // fronteira vazaria para o PR 3.
  const kv = fakeKV({ [KV_SNAPSHOT_KEY]: snapshotGravado(), [KV_STATE_KEY]: '{}' });
  const { resultado } = await comFetchEspiao(null, () => worker.fetch(pedido(), env(kv), {}));

  const corpo = await resultado.json();
  const r = applySnapshot(null, corpo);
  assert.equal(r.state.snapshot, corpo, 'applySnapshot não aceitou a resposta sem tradução');
  assert.equal(corpo.fixtures.length, 1);
});

test('estado ausente degrada: 200 com o snapshot, cron null, nunca erro', async () => {
  // Diagnóstico que falha não pode custar o dado. E `null` é obrigatório:
  // devolver estado saudável inventado — zero falhas, cota cheia — afirmaria
  // como fato o que não se sabe, que é o erro de confundir agenda [] com
  // agenda null.
  const kv = fakeKV({ [KV_SNAPSHOT_KEY]: snapshotGravado() });
  const { resultado } = await comFetchEspiao(null, () => worker.fetch(pedido(), env(kv), {}));

  assert.equal(resultado.status, 200, 'falta de estado derrubou a resposta');
  const corpo = await resultado.json();
  assert.equal(corpo.cron, null);
  assert.equal(corpo.fixtures.length, 1, 'o dado continua servido');
});

test('estado ilegível degrada igual, sem derrubar a resposta', async () => {
  const kv = fakeKV({ [KV_SNAPSHOT_KEY]: snapshotGravado(), [KV_STATE_KEY]: 'não é json {{{' });
  const { resultado } = await comFetchEspiao(null, () => worker.fetch(pedido(), env(kv), {}));

  assert.equal(resultado.status, 200);
  assert.equal((await resultado.json()).cron, null);
});

test('KV que falha SÓ na leitura do estado não derruba a resposta', async () => {
  // O caso que o teste de "KV fora do ar" não cobre: lá o `get` falha para
  // tudo e a resposta já é 503 antes de chegar ao estado. Aqui o dado está
  // são e só o diagnóstico quebrou — e diagnóstico que falha não pode custar
  // o dado. Sem este teste, tirar o `catch` da segunda leitura passa
  // despercebido e uma falha parcial de KV apaga a grade inteira.
  const kv = {
    async get(key) {
      if (key === KV_STATE_KEY) throw new Error('KV indisponível');
      return snapshotGravado();
    },
    async put() {},
  };
  const { chamadas, resultado } = await comFetchEspiao(null, () =>
    worker.fetch(pedido(), env(kv), {}),
  );

  assert.deepEqual(chamadas, [], 'erro ao ler o estado virou busca upstream');
  assert.equal(resultado.status, 200, 'falha no diagnóstico derrubou o dado');
  const corpo = await resultado.json();
  assert.equal(corpo.cron, null);
  assert.equal(corpo.fixtures.length, 1, 'o snapshot continua servido');
});

test('cota de ONTEM não é servida como cota de hoje', async () => {
  // O livro-caixa vale para o dia UTC em que foi escrito, e o cron só escreve
  // quando busca. Numa noite sem jogo depois do reset das 21:00 BRT, o
  // `state` fica horas com o gasto de ontem. Servir aquele número faria a
  // página anunciar "cota esgotada" com as 100 requisições disponíveis.
  const kv = fakeKV({
    [KV_SNAPSHOT_KEY]: snapshotGravado(),
    [KV_STATE_KEY]: JSON.stringify({
      consecutiveFailures: 4,
      backoffUntilMs: 0,
      quotaRemaining: 2,
      dayKeyUTC: '2020-01-01',
    }),
  });
  const { resultado } = await comFetchEspiao(null, () => worker.fetch(pedido(), env(kv), {}));

  const corpo = await resultado.json();
  assert.equal(corpo.cron.quotaRemaining, null, 'cota de outro dia UTC vazou como cota de hoje');
  // Controle positivo, e com valor diferente de zero de propósito: `0` é
  // também o fallback de campo ausente, então asserir zero aqui passaria
  // mesmo que a função tivesse descartado o estado inteiro. As falhas NÃO são
  // zeradas pela virada do dia — não têm nada a ver com o livro-caixa, e
  // apagá-las esconderia um pipeline quebrado justamente depois do reset.
  assert.equal(corpo.cron.consecutiveFailures, 4, 'a virada do dia apagou as falhas');
});

test('sem snapshot ainda, responde 503 e não 200 vazio', async () => {
  // 200 com lista vazia diria "não há jogos", que é mentira quando a verdade
  // é "ainda não busquei nada". Página correta e vazia é o pior modo de
  // falha deste projeto.
  const kv = fakeKV({});
  const { resultado } = await comFetchEspiao(null, () => worker.fetch(pedido(), env(kv), {}));
  assert.equal(resultado.status, 503);
});

test('a resposta permite leitura pelo GitHub Pages', async () => {
  const kv = fakeKV({ [KV_SNAPSHOT_KEY]: snapshotGravado() });
  const { resultado } = await comFetchEspiao(null, () => worker.fetch(pedido(), env(kv), {}));
  assert.ok(resultado.headers.get('access-control-allow-origin'), 'sem CORS a página não lê nada');
  assert.match(resultado.headers.get('content-type') ?? '', /application\/json/);
});

test('método não autorizado devolve 405 com Allow', async () => {
  const kv = fakeKV({ [KV_SNAPSHOT_KEY]: snapshotGravado() });
  const { resultado } = await comFetchEspiao(null, () =>
    worker.fetch(pedido('https://w.dev/api/live', { method: 'DELETE' }), env(kv), {}),
  );
  assert.equal(resultado.status, 405);
  assert.equal(resultado.headers.get('allow'), 'GET, HEAD');
});

test('caminho desconhecido devolve 404', async () => {
  const kv = fakeKV({ [KV_SNAPSHOT_KEY]: snapshotGravado() });
  const { resultado } = await comFetchEspiao(null, () =>
    worker.fetch(pedido('https://w.dev/qualquer'), env(kv), {}),
  );
  assert.equal(resultado.status, 404);
});

test('excesso de requisições do mesmo IP vira 429 com Retry-After', async () => {
  const kv = fakeKV({ [KV_SNAPSHOT_KEY]: snapshotGravado() });
  let ultima;
  await comFetchEspiao(null, async () => {
    for (let i = 0; i < 200; i += 1) {
      ultima = await worker.fetch(pedido(), env(kv), {});
    }
  });
  assert.equal(ultima.status, 429);
  assert.ok(ultima.headers.get('retry-after'), 'quem é barrado precisa saber quando voltar');
});

// === o cron =================================================================

/** Dia UTC de T0 — o mesmo que o cron calcula de `scheduledTime`. */
const DIA_T0 = new Date(T0).toISOString().slice(0, 10);

/**
 * Agenda guardada no KV: entradas MAIS o dia que elas cobrem.
 *
 * O dia viaja junto de propósito. Agenda de outro dia lê como `null` e o
 * Worker falha aberto, em vez de usar os kickoffs de ontem — que estão 24h
 * fora da janela de 3h e fariam o portão dizer "não há jogo" o dia inteiro.
 */
function agendaGuardada(entries, dia = DIA_T0) {
  return JSON.stringify({ dayKeyUTC: dia, entries });
}

/** Agenda com uma partida do Brasileirão em andamento agora. */
function agendaComJogo() {
  return agendaGuardada([
    { leagueId: '71', kickoffISO: new Date(T0 - 30 * 60_000).toISOString() },
  ]);
}

/** Agenda consultada, sem jogo de interesse. */
const agendaVazia = agendaGuardada([]);

test('cron: sem jogo de interesse, não chama upstream E não escreve no KV', async () => {
  // Regra 3. Se escrevesse, o timestamp mentiria sobre o frescor e o isStale
  // ficaria cego — a faixa voltaria a verde sem dado novo nenhum.
  const kv = fakeKV({ [KV_AGENDA_KEY]: agendaVazia, [KV_SNAPSHOT_KEY]: snapshotGravado() });
  const { chamadas } = await comFetchEspiao(null, () =>
    worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );

  assert.deepEqual(chamadas, [], 'gastou cota sem jogo de interesse');
  assert.deepEqual(kv.puts, [], 'escreveu no KV sem ter buscado');
});

/** Agenda com jogo ao vivo SÓ numa liga fora da semente (Premier League). */
function agendaSoLigaNaoSemente() {
  return agendaGuardada([
    { leagueId: '39', kickoffISO: new Date(T0 - 30 * 60_000).toISOString() },
  ]);
}

test('cron: o portão é da SEMENTE — favorita de navegador não o abre', async () => {
  // O portão é global; favoritas moram no localStorage de cada navegador.
  // Se `activeLeagueIds` fosse chamada com favoritas aqui, qualquer visitante
  // abriria o portão e gastaria a cota do dono da chave — 100 req/dia para a
  // chave inteira. O Worker chama com UM argumento de propósito, e é isto que
  // este teste prende: prosa no doc não impede ninguém de passar o segundo.
  const kv = fakeKV({ [KV_AGENDA_KEY]: agendaSoLigaNaoSemente() });
  const { chamadas } = await comFetchEspiao(null, () =>
    worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );

  assert.deepEqual(chamadas, [], 'liga fora da semente abriu o portão do cron');
  assert.deepEqual(kv.puts, [], 'escreveu no KV sem ter buscado');
  // Controle positivo desta asserção negativa: o teste seguinte usa a MESMA
  // agenda com `leagueId: '71'` e exige exatamente uma chamada. Sem ele, este
  // aqui passaria mesmo com o cron quebrado e nunca buscando nada.
});

test('cron: com jogo de interesse, chama upstream exatamente uma vez', async () => {
  const kv = fakeKV({ [KV_AGENDA_KEY]: agendaComJogo() });
  const { chamadas } = await comFetchEspiao(
    async () => respostaUpstream(envelope([primeiroTempo, segundoTempo])),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );

  assert.equal(chamadas.length, 1);
  assert.match(String(chamadas[0][0]), /fixtures\?live=all/);
});

test('cron: a chave vai no header e nunca na URL', async () => {
  const kv = fakeKV({ [KV_AGENDA_KEY]: agendaComJogo() });
  const { chamadas } = await comFetchEspiao(
    async () => respostaUpstream(envelope([primeiroTempo])),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );

  const [url, init] = chamadas[0];
  assert.ok(!String(url).includes('chave-de-teste'), 'chave vazou na URL');
  assert.equal(init.headers['x-apisports-key'], 'chave-de-teste');
});

test('cron: grava o snapshot com timestamp, cota e descartes', async () => {
  const kv = fakeKV({ [KV_AGENDA_KEY]: agendaComJogo() });
  await comFetchEspiao(
    async () => respostaUpstream(envelope([primeiroTempo, segundoTempo]), { quota: '84' }),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );

  const s = parseSnapshot(kv.store.get(KV_SNAPSHOT_KEY));
  assert.notEqual(s, null, 'snapshot gravado é ilegível');
  assert.equal(s.fetchedAtMs, T0);
  assert.equal(s.fixtures.length, 2);
  assert.equal(s.quotaRemaining, 84, 'a cota vem do header, convertida de string');
  assert.equal(s.discarded, 0);
  assert.equal(s.upstreamCount, 2);
});

test('cron: discarded chega ao snapshot para o PR 3 mostrar', async () => {
  const semTimes = structuredClone(primeiroTempo);
  delete semTimes.teams;
  const kv = fakeKV({ [KV_AGENDA_KEY]: agendaComJogo() });

  await comFetchEspiao(
    async () => respostaUpstream(envelope([semTimes, segundoTempo])),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );

  const s = parseSnapshot(kv.store.get(KV_SNAPSHOT_KEY));
  assert.equal(s.discarded, 1);
  assert.equal(s.upstreamCount, 2, 'o denominador tem que ir junto');
  assert.equal(s.fixtures.length, 1);
});

test('cron: buscou agora há pouco, não busca de novo', async () => {
  const kv = fakeKV({
    [KV_AGENDA_KEY]: agendaComJogo(),
    [KV_STATE_KEY]: JSON.stringify({ lastFetchAtMs: T0 - 5_000, quotaRemaining: 90, consecutiveFailures: 0, backoffUntilMs: 0 }),
  });
  const { chamadas } = await comFetchEspiao(null, () =>
    worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );
  assert.deepEqual(chamadas, []);
  assert.deepEqual(kv.puts, []);
});

test('cron: a reserva de 10 é inviolável', async () => {
  const kv = fakeKV({
    [KV_AGENDA_KEY]: agendaComJogo(),
    [KV_STATE_KEY]: JSON.stringify({ lastFetchAtMs: T0 - 3 * 60 * 60 * 1000, quotaRemaining: 10, consecutiveFailures: 0, backoffUntilMs: 0 }),
  });
  const { chamadas } = await comFetchEspiao(null, () =>
    worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );
  assert.deepEqual(chamadas, [], 'consumiu a reserva da agenda');
});

// === erro upstream ==========================================================

test('cron: erro upstream preserva o último snapshot bom', async () => {
  const bom = snapshotGravado();
  const kv = fakeKV({ [KV_AGENDA_KEY]: agendaComJogo(), [KV_SNAPSHOT_KEY]: bom });

  await comFetchEspiao(
    async () => new Response('boom', { status: 500 }),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );

  assert.equal(kv.store.get(KV_SNAPSHOT_KEY), bom, 'snapshot bom foi sobrescrito por um erro');
});

test('cron: erro upstream registra backoff no estado, não no snapshot', async () => {
  const kv = fakeKV({ [KV_AGENDA_KEY]: agendaComJogo(), [KV_SNAPSHOT_KEY]: snapshotGravado() });

  await comFetchEspiao(
    async () => new Response('boom', { status: 500 }),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );

  const estado = JSON.parse(kv.store.get(KV_STATE_KEY));
  assert.equal(estado.consecutiveFailures, 1);
  assert.equal(estado.backoffUntilMs, T0 + 15_000, 'primeiro degrau da escada');
  assert.ok(kv.puts.every((p) => p.key !== KV_SNAPSHOT_KEY));
});

test('cron: 429 vai direto ao teto do backoff', async () => {
  const kv = fakeKV({ [KV_AGENDA_KEY]: agendaComJogo() });

  await comFetchEspiao(
    async () => new Response('slow down', { status: 429 }),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );

  const estado = JSON.parse(kv.store.get(KV_STATE_KEY));
  assert.equal(estado.backoffUntilMs, T0 + BACKOFF_MAX_MS, '429 não pode voltar em 15s');
});

test('cron: durante o backoff não há nova chamada', async () => {
  const kv = fakeKV({
    [KV_AGENDA_KEY]: agendaComJogo(),
    [KV_STATE_KEY]: JSON.stringify({ lastFetchAtMs: T0 - 3 * 60 * 60 * 1000, quotaRemaining: 90, consecutiveFailures: 3, backoffUntilMs: T0 + 60_000 }),
  });
  const { chamadas } = await comFetchEspiao(null, () =>
    worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );
  assert.deepEqual(chamadas, []);
  assert.deepEqual(kv.puts, [], 'tique em backoff não escreve');
});

test('cron: sucesso zera as falhas acumuladas', async () => {
  const kv = fakeKV({
    [KV_AGENDA_KEY]: agendaComJogo(),
    [KV_STATE_KEY]: JSON.stringify({ lastFetchAtMs: T0 - 3 * 60 * 60 * 1000, quotaRemaining: 90, consecutiveFailures: 3, backoffUntilMs: T0 - 1 }),
  });

  await comFetchEspiao(
    async () => respostaUpstream(envelope([primeiroTempo])),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );

  const estado = JSON.parse(kv.store.get(KV_STATE_KEY));
  assert.equal(estado.consecutiveFailures, 0);
  assert.equal(estado.backoffUntilMs, 0);
});

test('cron: resposta 200 com errors é tratada como falha, não como zero jogos', async () => {
  const bom = snapshotGravado();
  const kv = fakeKV({ [KV_AGENDA_KEY]: agendaComJogo(), [KV_SNAPSHOT_KEY]: bom });

  await comFetchEspiao(
    async () => respostaUpstream({ ...envelopeVazio, errors: { plan: 'não coberto' } }),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );

  assert.equal(kv.store.get(KV_SNAPSHOT_KEY), bom, 'errors virou snapshot vazio');
  assert.equal(JSON.parse(kv.store.get(KV_STATE_KEY)).consecutiveFailures, 1);
});

test('cron sem chave configurada não chama upstream nem quebra o Worker', async () => {
  const kv = fakeKV({ [KV_AGENDA_KEY]: agendaComJogo() });
  const { chamadas } = await comFetchEspiao(null, () =>
    worker.scheduled({ scheduledTime: T0 }, { PLACAR_KV: kv }, {}),
  );
  assert.deepEqual(chamadas, [], 'tentou buscar sem chave');
});

test('agenda ausente: o tique busca a AGENDA, não o ao vivo', async () => {
  // A agenda vem antes no mesmo tique, e a invocação termina aí: duas
  // requisições upstream no mesmo minuto gastariam o dobro por um dado que só
  // muda uma vez por dia.
  const kv = fakeKV({});
  const { chamadas } = await comFetchEspiao(
    async () => respostaUpstream({ ...envelopeVazio, results: 0, response: [] }),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );

  assert.equal(chamadas.length, 1);
  assert.match(String(chamadas[0][0]), /fixtures\?date=2026-09-03/, 'não buscou a agenda do dia UTC');
  assert.ok(!kv.store.has(KV_SNAPSHOT_KEY), 'gastou também no ao vivo no mesmo tique');
});

test('agenda que falhou faz o cron falhar ABERTO, não emudecer', async () => {
  // O caso que mata o produto em silêncio: sem agenda o portão fecharia para
  // sempre e a página ficaria correta e vazia. Aqui a busca da agenda falha, e
  // no tique seguinte — já fora do espaçamento entre tentativas — o cron
  // precisa buscar o ao vivo assim mesmo.
  const kv = fakeKV({});
  // Um minuto depois: DENTRO do espaçamento entre tentativas de agenda, então
  // este tique não retenta a agenda — e é justamente aí que o ao vivo tem de
  // continuar acontecendo. Se o fail-open só valesse depois das três
  // tentativas, o produto ficaria 30 minutos mudo por um erro de agenda.
  const umMinutoDepois = T0 + 60_000;

  const { chamadas } = await comFetchEspiao(
    async (url) => (String(url).includes('date=')
      ? new Response('boom', { status: 500 })
      : respostaUpstream(envelope([primeiroTempo]))),
    async () => {
      await worker.scheduled({ scheduledTime: T0 }, env(kv), {});
      await worker.scheduled({ scheduledTime: umMinutoDepois }, env(kv), {});
    },
  );

  assert.equal(chamadas.length, 2);
  assert.match(String(chamadas[0][0]), /date=/, 'o primeiro tique não tentou a agenda');
  assert.match(String(chamadas[1][0]), /live=all/, 'o segundo tique não caiu no fail-open');

  // E o snapshot tem de DIZER que buscou às cegas. Sem isto a página mostra
  // uma grade curta sem explicação, que é "correta e vazia" — o modo de falha
  // que este projeto mais combate. Literal de propósito: a constante não pode
  // servir de régua para ela mesma.
  const s = parseSnapshot(kv.store.get(KV_SNAPSHOT_KEY));
  assert.equal(s.reason, 'no-agenda', 'o snapshot não registrou que faltava agenda');
});

test('com agenda, o snapshot registra busca normal — não "às cegas"', async () => {
  // Controle positivo do teste acima: se `reason` estivesse preso em
  // 'no-agenda', a página avisaria cobertura reduzida todo santo dia e o
  // aviso viraria ruído que ninguém lê.
  const kv = fakeKV({ [KV_AGENDA_KEY]: agendaComJogo() });
  await comFetchEspiao(
    async () => respostaUpstream(envelope([primeiroTempo])),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );

  assert.equal(parseSnapshot(kv.store.get(KV_SNAPSHOT_KEY)).reason, 'due');
});

// === a busca da agenda ======================================================

/** Envelope de agenda vindo do upstream, com uma partida do Brasileirão. */
function respostaAgenda(entries = [{ liga: 71, data: '2026-09-03T21:30:00+00:00' }]) {
  return respostaUpstream({
    get: 'fixtures',
    parameters: { date: DIA_T0 },
    errors: [],
    results: entries.length,
    paging: { current: 1, total: 1 },
    response: entries.map((e, i) => ({
      fixture: { id: 9000 + i, date: e.data, status: { short: 'NS', elapsed: null } },
      league: { id: e.liga, name: 'Liga' },
      teams: { home: { name: 'A' }, away: { name: 'B' } },
      goals: { home: null, away: null },
    })),
  });
}

test('agenda: grava reduzida e COM o dia que ela cobre', async () => {
  const kv = fakeKV({});
  await comFetchEspiao(
    async () => respostaAgenda(),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );

  const guardado = JSON.parse(kv.store.get(KV_AGENDA_KEY));
  assert.equal(guardado.dayKeyUTC, DIA_T0, 'sem o dia, a agenda de ontem se passa pela de hoje');
  assert.deepEqual(guardado.entries, [
    { leagueId: '71', kickoffISO: '2026-09-03T21:30:00+00:00' },
  ], 'gravou mais que leagueId e kickoffISO');
});

test('agenda: gravada, o tique seguinte usa o portão de verdade e busca ao vivo', async () => {
  // O caminho inteiro: sem agenda -> busca agenda -> portão abre pelo
  // Brasileirão -> busca ao vivo com reason 'due', não mais 'no-agenda'.
  const kv = fakeKV({});
  const { chamadas } = await comFetchEspiao(
    async (url) => (String(url).includes('date=')
      ? respostaAgenda()
      : respostaUpstream(envelope([primeiroTempo]))),
    async () => {
      await worker.scheduled({ scheduledTime: T0 }, env(kv), {});
      await worker.scheduled({ scheduledTime: T0 + 60_000 }, env(kv), {});
    },
  );

  assert.equal(chamadas.length, 2);
  assert.match(String(chamadas[1][0]), /live=all/);
  assert.equal(
    parseSnapshot(kv.store.get(KV_SNAPSHOT_KEY)).reason,
    'due',
    'com agenda em mãos o cron ainda se diz às cegas',
  );
});

test('agenda: dia sem jogo de interesse fecha o portão a custo zero', async () => {
  // Controle positivo do teste acima. A agenda respondeu, não há liga da
  // semente, e o cron NÃO gasta mais nada — é a terça-feira que custa zero.
  const kv = fakeKV({});
  const { chamadas } = await comFetchEspiao(
    async () => respostaAgenda([{ liga: 39, data: '2026-09-03T21:30:00+00:00' }]),
    async () => {
      await worker.scheduled({ scheduledTime: T0 }, env(kv), {});
      await worker.scheduled({ scheduledTime: T0 + 60_000 }, env(kv), {});
    },
  );

  assert.equal(chamadas.length, 1, 'gastou no ao vivo com a agenda dizendo que não há jogo');
  assert.ok(!kv.store.has(KV_SNAPSHOT_KEY));
});

test('agenda: com a de ontem no KV, busca a de hoje em vez de usá-la', async () => {
  // Usar a de ontem faria o portão dizer "não há jogo" o dia inteiro, com a
  // página correta e vazia. O dia guardado junto é o que impede isso.
  const kv = fakeKV({
    [KV_AGENDA_KEY]: agendaGuardada(
      [{ leagueId: '71', kickoffISO: '2026-09-02T21:30:00+00:00' }],
      '2026-09-02',
    ),
  });
  const { chamadas } = await comFetchEspiao(
    async () => respostaAgenda(),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );

  assert.match(String(chamadas[0][0]), /date=/, 'usou a agenda de ontem como se fosse a de hoje');
  assert.equal(JSON.parse(kv.store.get(KV_AGENDA_KEY)).dayKeyUTC, DIA_T0);
});

test('agenda: a chave vai no header e nunca na URL', async () => {
  const kv = fakeKV({});
  const { chamadas } = await comFetchEspiao(
    async () => respostaAgenda(),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );

  const [url, init] = chamadas[0];
  assert.ok(!String(url).includes('chave-de-teste'), 'chave vazou na URL');
  assert.equal(init.headers['x-apisports-key'], 'chave-de-teste');
});

test('agenda: A RESERVA é dela — busca com cota que barra o poll ao vivo', async () => {
  // 5 restantes: `hasUsableQuota` é falso e o ao vivo está barrado. A agenda
  // tem de conseguir gastar assim mesmo, senão a reserva guarda cota para uma
  // busca que nunca acontece e o Worker fica em fail-open para sempre.
  const kv = fakeKV({
    [KV_STATE_KEY]: JSON.stringify({
      lastFetchAtMs: T0 - 10 * 60_000,
      quotaRemaining: 5,
      spentToday: 95,
      dayKeyUTC: DIA_T0,
      consecutiveFailures: 0,
      backoffUntilMs: 0,
    }),
  });
  const { chamadas } = await comFetchEspiao(
    async () => respostaAgenda(),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );

  assert.equal(chamadas.length, 1, 'a agenda não conseguiu gastar a reserva que é dela');
  assert.match(String(chamadas[0][0]), /date=/);
});

test('agenda: upstream fora do ar não queima a reserva — para no teto', async () => {
  // Sem teto isto seriam 10 tentativas em 10 minutos e a reserva iria embora,
  // levando o poll ao vivo junto. Literais 3 e 4: se o teto mudar, este teste
  // tem de ser reavaliado à mão, não seguir a constante.
  const kv = fakeKV({});
  const { chamadas } = await comFetchEspiao(
    async () => new Response('boom', { status: 500 }),
    async () => {
      // Quatro tentativas espaçadas de 16 min, uma a mais que o teto de 3.
      for (let i = 0; i < 4; i += 1) {
        await worker.scheduled({ scheduledTime: T0 + i * 16 * 60_000 }, env(kv), {});
      }
    },
  );

  const daAgenda = chamadas.filter(([url]) => String(url).includes('date='));
  assert.equal(daAgenda.length, 3, 'o teto de tentativas de agenda não segurou');
});

test('agenda: a virada do dia UTC zera contador E horário da última tentativa', async () => {
  // BUG REAL, encontrado antes de existir consumidor. Com uma tentativa às
  // 23:50 UTC e o tique das 00:01 do dia seguinte, o contador zerava pelo
  // livro-caixa e o timestamp NÃO — o espaçamento de 15 min de ontem bloqueava
  // a agenda de hoje justamente no instante em que ela deve ser buscada, e o
  // cron ficava em fail-open gastando cota até as 00:05.
  //
  // Terceiro bug de virada de dia deste projeto, e todos com a mesma forma:
  // dois campos que descrevem o mesmo fato zerando por critérios diferentes.
  const ontem2350 = Date.parse('2026-09-02T23:50:00.000Z');
  const hoje0001 = Date.parse('2026-09-03T00:01:00.000Z');
  const kv = fakeKV({
    [KV_STATE_KEY]: JSON.stringify({
      lastFetchAtMs: ontem2350,
      quotaRemaining: 4,
      spentToday: 96,
      dayKeyUTC: '2026-09-02',
      consecutiveFailures: 0,
      backoffUntilMs: 0,
      agendaAttemptsToday: 3,
      agendaLastAttemptMs: ontem2350,
    }),
  });

  const { chamadas } = await comFetchEspiao(
    async () => respostaAgenda([{ liga: 71, data: '2026-09-03T21:30:00+00:00' }]),
    () => worker.scheduled({ scheduledTime: hoje0001 }, env(kv), {}),
  );

  assert.equal(chamadas.length, 1, 'o espaçamento de ontem bloqueou a agenda de hoje');
  assert.match(String(chamadas[0][0]), /date=2026-09-03/);

  const estado = JSON.parse(kv.store.get(KV_STATE_KEY));
  assert.equal(estado.agendaAttemptsToday, 1, 'o contador não zerou na virada');
  assert.equal(estado.spentToday, 1, 'o gasto de ontem não zerou na virada');
});

test('agenda: DENTRO do mesmo dia o espaçamento continua valendo', async () => {
  // Controle positivo do teste acima: se a virada de dia fosse "zerar sempre",
  // o espaçamento nunca seguraria nada e três tentativas cairiam no mesmo
  // minuto — que é o que o espaçamento existe para impedir.
  const kv = fakeKV({
    [KV_STATE_KEY]: JSON.stringify({
      lastFetchAtMs: T0 - 60_000,
      quotaRemaining: 90,
      spentToday: 10,
      dayKeyUTC: DIA_T0,
      consecutiveFailures: 0,
      backoffUntilMs: 0,
      agendaAttemptsToday: 1,
      agendaLastAttemptMs: T0 - 60_000,
    }),
  });

  const { chamadas } = await comFetchEspiao(
    async () => respostaUpstream(envelope([primeiroTempo])),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );

  const daAgenda = chamadas.filter(([url]) => String(url).includes('date='));
  assert.deepEqual(daAgenda, [], 'tentou a agenda 1 minuto depois da anterior');
});

test('agenda: sem chave configurada não conta tentativa', async () => {
  // Problema de configuração não pode consumir o teto diário e deixar o dia
  // sem agenda depois que a chave for cadastrada.
  const kv = fakeKV({});
  const semChave = { PLACAR_KV: kv };
  const { chamadas } = await comFetchEspiao(null, () =>
    worker.scheduled({ scheduledTime: T0 }, semChave, {}),
  );

  assert.deepEqual(chamadas, []);
  assert.deepEqual(kv.puts, [], 'contou tentativa sem ter gasto requisição nenhuma');
});

test('agenda: resposta com errors não vira agenda vazia', async () => {
  // `errors` preenchido chega com HTTP 200. Gravar uma lista vazia a partir
  // dele fecharia o portão o dia inteiro dizendo "não há jogo", que é mentira.
  const kv = fakeKV({});
  await comFetchEspiao(
    async () => respostaUpstream({
      ...envelopeVazio,
      errors: { plan: 'não cobre o endpoint' },
      results: 0,
      response: [],
    }),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );

  assert.ok(!kv.store.has(KV_AGENDA_KEY), 'gravou agenda a partir de resposta com errors');
  // Mas a tentativa foi gasta e tem de estar contada.
  const estado = JSON.parse(kv.store.get(KV_STATE_KEY));
  assert.equal(estado.agendaAttemptsToday, 1);
  assert.equal(estado.spentToday, 1, 'a requisição foi gasta e não foi contabilizada');
});

test('agenda: a tentativa é contada ANTES da chamada', async () => {
  // Se a invocação morrer no meio, a requisição já foi gasta e precisa estar
  // contada — senão o teto nunca sobe e a reserva evapora.
  const kv = {
    async get() { return null; },
    async put() { throw new Error('KV recusando escrita'); },
  };
  const { chamadas } = await comFetchEspiao(
    async () => { throw new Error('conexão morreu no meio'); },
    async () => {
      for (let i = 0; i < 4; i += 1) {
        await worker.scheduled({ scheduledTime: T0 + i * 16 * 60_000 }, env(kv), {});
      }
    },
  );

  const daAgenda = chamadas.filter(([url]) => String(url).includes('date='));
  assert.equal(daAgenda.length, 3, 'sem KV gravável a memória do isolate não segurou o teto');
  // E o quarto tique não fica mudo: esgotadas as tentativas, o cron cai no
  // fail-open e busca o ao vivo. Teto de agenda não pode virar apagão.
  assert.match(String(chamadas[3][0]), /live=all/, 'esgotar a agenda emudeceu o produto');
});

// === o livro-caixa da cota ==================================================

test('gasto é contabilizado localmente, não só pelo header', async () => {
  // Sem header de cota, `quotaRemaining` ficava preso no valor antigo para
  // sempre: a reserva nunca fechava, o intervalo ficava cravado em 120s e o
  // dia inteiro rodava com centenas de requisições. Medido: 91 num dia, com
  // o state ainda dizendo 100 restantes.
  const kv = fakeKV({ [KV_AGENDA_KEY]: agendaComJogo() });

  await comFetchEspiao(
    async () =>
      new Response(JSON.stringify(envelope([primeiroTempo])), {
        status: 200,
        headers: { 'content-type': 'application/json' }, // sem x-ratelimit-*
      }),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );

  const estado = JSON.parse(kv.store.get(KV_STATE_KEY));
  assert.equal(estado.spentToday, 1, 'a tentativa tem que entrar no livro-caixa');
  assert.ok(
    estado.quotaRemaining < 100,
    `sem header, a cota tem que cair pela contagem local; veio ${estado.quotaRemaining}`,
  );
});

test('tentativa que falhou também gasta e é contabilizada', async () => {
  const kv = fakeKV({ [KV_AGENDA_KEY]: agendaComJogo() });
  await comFetchEspiao(
    async () => new Response('boom', { status: 500 }),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );
  assert.equal(JSON.parse(kv.store.get(KV_STATE_KEY)).spentToday, 1);
});

test('o livro-caixa zera na virada do dia UTC', async () => {
  const ontem = Date.parse('2026-09-03T23:59:00.000Z');
  const hoje = Date.parse('2026-09-04T00:01:00.000Z');
  const kv = fakeKV({
    [KV_AGENDA_KEY]: JSON.stringify([
      makeFixture({ id: 'ag1', leagueId: '71', kickoffISO: new Date(hoje - 60_000).toISOString(), status: 'scheduled', homeGoals: null, awayGoals: null }),
    ]),
    [KV_STATE_KEY]: JSON.stringify({ lastFetchAtMs: ontem, quotaRemaining: 2, spentToday: 98, dayKeyUTC: '2026-09-03', consecutiveFailures: 0, backoffUntilMs: 0 }),
  });

  const { chamadas } = await comFetchEspiao(
    async () => respostaUpstream(envelope([primeiroTempo]), { quota: '99' }),
    () => worker.scheduled({ scheduledTime: hoje }, env(kv), {}),
  );

  assert.equal(chamadas.length, 1, 'depois do reset a cota volta a existir');
  const estado = JSON.parse(kv.store.get(KV_STATE_KEY));
  assert.equal(estado.dayKeyUTC, '2026-09-04');
  assert.equal(estado.spentToday, 1, 'o gasto de ontem não conta contra hoje');
});

test('a contagem local segura a reserva mesmo com o header mentindo alto', async () => {
  // Se o header dissesse 100 para sempre, só a contagem local impede o
  // estouro. Este é o teste que prova que ela manda.
  const kv = fakeKV({
    [KV_AGENDA_KEY]: agendaComJogo(),
    [KV_STATE_KEY]: JSON.stringify({ lastFetchAtMs: T0 - 3 * 60 * 60 * 1000, quotaRemaining: 100, spentToday: 90, dayKeyUTC: '2026-09-03', consecutiveFailures: 0, backoffUntilMs: 0 }),
  });

  const { chamadas } = await comFetchEspiao(
    async () => respostaUpstream(envelope([primeiroTempo]), { quota: '100' }),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );

  assert.deepEqual(chamadas, [], '90 gastas hoje: o que resta é a reserva, e ela não se toca');
});

// === falha de escrita no KV ================================================

test('falha ao gravar não deixa o cron buscar a cada minuto', async () => {
  // Medido no desenho anterior: 181 requisições num dia, quase o dobro da
  // cota, porque a exceção subia e nada registrava a tentativa.
  const store = new Map([[KV_AGENDA_KEY, agendaComJogo()]]);
  const kv = {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k) { throw new Error(`KV put falhou para ${k}`); },
  };

  await comFetchEspiao(
    async () => respostaUpstream(envelope([primeiroTempo])),
    async () => {
      // Não pode lançar para fora: exceção no scheduled perde o backoff.
      await worker.scheduled({ scheduledTime: T0 }, env(kv), {});
    },
  );
});

test('o state é gravado antes do snapshot', async () => {
  // A ordem é a proteção: se a segunda escrita falhar, sobra "buscou mas o
  // snapshot é velho" — o cliente vê vermelho no staleness. A ordem
  // invertida sobrava "dado novo e o portão não soube que gastou".
  const kv = fakeKV({ [KV_AGENDA_KEY]: agendaComJogo() });
  await comFetchEspiao(
    async () => respostaUpstream(envelope([primeiroTempo])),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );

  const ordem = kv.puts.map((p) => p.key);
  assert.deepEqual(ordem, [KV_STATE_KEY, KV_SNAPSHOT_KEY]);
});

test('a chamada upstream tem timeout', async () => {
  // Subrequisição pendurada mata a invocação do cron antes de registrar a
  // falha: a requisição foi gasta, o backoff não existe, e no minuto
  // seguinte tudo se repete.
  const kv = fakeKV({ [KV_AGENDA_KEY]: agendaComJogo() });
  const { chamadas } = await comFetchEspiao(
    async () => respostaUpstream(envelope([primeiroTempo])),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );
  const init = chamadas[0][1];
  assert.ok(init.signal, 'sem AbortSignal a chamada pode pendurar indefinidamente');
});

// === a memória do isolate ===================================================

test('com o KV recusando escrita, a memória do isolate evita busca por minuto', async () => {
  // Sem ela, cada tique lê "nunca buscou" e busca de novo: medido, 181
  // requisições num dia. É a única coisa que segura o gasto quando o KV não
  // aceita `put`.
  const store = new Map([[KV_AGENDA_KEY, agendaComJogo()]]);
  const kv = {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put() { throw new Error('KV recusando escrita'); },
  };

  const { chamadas } = await comFetchEspiao(
    async () => respostaUpstream(envelope([primeiroTempo])),
    async () => {
      // Três tiques DENTRO de um intervalo: só o primeiro pode gastar. O
      // espaçamento é de 30s porque perto do reset a janela de orçamento
      // encolhe e o intervalo cai ao piso ativo de 120s — a 60s, o terceiro
      // tique cairia exatamente no limite e buscaria com razão.
      await worker.scheduled({ scheduledTime: T0 }, env(kv), {});
      await worker.scheduled({ scheduledTime: T0 + 30_000 }, env(kv), {});
      await worker.scheduled({ scheduledTime: T0 + 60_000 }, env(kv), {});
    },
  );

  assert.equal(chamadas.length, 1, `${chamadas.length} buscas em 3 tiques sem KV gravável`);
});

test('a memória do isolate conta a tentativa ANTES da chamada', async () => {
  // Se a invocação morrer no meio — timeout do runtime, subrequisição
  // pendurada —, a requisição já foi gasta e precisa estar contada.
  const store = new Map([[KV_AGENDA_KEY, agendaComJogo()]]);
  const kv = {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put() { throw new Error('KV recusando escrita'); },
  };

  const { chamadas } = await comFetchEspiao(
    async () => { throw new Error('conexão morreu no meio'); },
    async () => {
      await worker.scheduled({ scheduledTime: T0 }, env(kv), {});
      await worker.scheduled({ scheduledTime: T0 + 60_000 }, env(kv), {});
    },
  );

  assert.equal(chamadas.length, 1, 'a tentativa que falhou não foi contada');
});

test('a memória do isolate não substitui o KV quando ele funciona', async () => {
  // Controle positivo: com KV gravável e o intervalo já vencido, a busca
  // acontece normalmente. Se a memória fosse pessimista demais, ela mataria o
  // caminho feliz e os testes acima passariam por vacuidade.
  const kv = fakeKV({ [KV_AGENDA_KEY]: agendaComJogo() });
  const { chamadas } = await comFetchEspiao(
    async () => respostaUpstream(envelope([primeiroTempo])),
    async () => {
      await worker.scheduled({ scheduledTime: T0 }, env(kv), {});
      // 2h depois: intervalo vencido com folga, e ainda DENTRO da janela da
      // partida (kickoff em T0-30min, janela de 3h). Mais tarde que isso o
      // portão fecharia e o teste passaria pelo motivo errado.
      await worker.scheduled({ scheduledTime: T0 + 2 * 60 * 60 * 1000 }, env(kv), {});
    },
  );
  assert.equal(chamadas.length, 2);
});

test('tentativa que falhou decrementa a cota no estado', async () => {
  const kv = fakeKV({
    [KV_AGENDA_KEY]: agendaComJogo(),
    [KV_STATE_KEY]: JSON.stringify({ lastFetchAtMs: T0 - 3 * 60 * 60 * 1000, quotaRemaining: 50, spentToday: 50, dayKeyUTC: '2026-09-03', consecutiveFailures: 0, backoffUntilMs: 0 }),
  });

  await comFetchEspiao(
    async () => new Response('boom', { status: 500 }),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );

  const estado = JSON.parse(kv.store.get(KV_STATE_KEY));
  assert.ok(estado.quotaRemaining < 50, `cota não caiu: ${estado.quotaRemaining}`);
  assert.equal(estado.spentToday, 51);
});

test('sem KV gravável, a contagem local ainda esgota a cota e para', async () => {
  // O contador de gasto da memória do isolate só se manifesta ao longo de
  // muitos tiques: com poucos, `spentToday` nunca chega perto da reserva e um
  // erro nele passa despercebido. Aqui o dia inteiro roda com o KV recusando
  // escrita e o portão sempre aberto (fail-open), então a ÚNICA coisa entre o
  // Worker e o gasto ilimitado é a contagem em memória.
  const store = new Map(); // sem agenda: fail-open, portão nunca fecha
  const kv = {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put() { throw new Error('KV recusando escrita'); },
  };

  const inicioDia = Date.parse('2026-09-03T00:00:00.000Z');
  const { chamadas } = await comFetchEspiao(
    async () =>
      new Response(JSON.stringify(envelope([primeiroTempo])), {
        status: 200,
        headers: { 'content-type': 'application/json' }, // sem header de cota
      }),
    async () => {
      for (let t = 0; t < 24 * 60 * 60 * 1000; t += 60_000) {
        await worker.scheduled({ scheduledTime: inicioDia + t }, env(kv), {});
      }
    },
  );

  assert.ok(
    chamadas.length <= 90,
    `${chamadas.length} requisições num dia: a reserva de 10 foi consumida`,
  );
  assert.ok(chamadas.length > 0, 'controle: o fail-open tem que buscar alguma coisa');
});
