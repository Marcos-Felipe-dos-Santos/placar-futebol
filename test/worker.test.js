import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { KV_SNAPSHOT_KEY, KV_STATE_KEY, KV_AGENDA_KEY, __resetIsolateState } from '../worker.js';
import { buildSnapshot, parseSnapshot } from '../src/core/snapshot.js';
import { BACKOFF_MAX_MS } from '../src/core/backoff.js';
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
      intervalMs: 135_000,
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

/** Agenda com uma partida do Brasileirão em andamento agora. */
function agendaComJogo() {
  return JSON.stringify([
    makeFixture({
      id: 'ag1',
      leagueId: '71',
      kickoffISO: new Date(T0 - 30 * 60_000).toISOString(),
      status: 'scheduled',
      homeGoals: null,
      awayGoals: null,
    }),
  ]);
}

/** Agenda consultada, sem jogo de interesse. */
const agendaVazia = JSON.stringify([]);

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

test('agenda ausente no KV faz o cron falhar aberto, não emudecer', async () => {
  // Sem agenda o portão fecharia para sempre e o produto morreria em
  // silêncio. Falha aberto; a cota continua limitada pelo orçamento.
  const kv = fakeKV({});
  const { chamadas } = await comFetchEspiao(
    async () => respostaUpstream(envelope([primeiroTempo])),
    () => worker.scheduled({ scheduledTime: T0 }, env(kv), {}),
  );
  assert.equal(chamadas.length, 1);
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
