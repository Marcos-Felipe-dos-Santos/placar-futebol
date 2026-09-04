import test from 'node:test';
import assert from 'node:assert/strict';
import { hasMatchInProgress, decideCronAction, MATCH_WINDOW_MS } from '../src/core/gate.js';
import { DEFAULT_LEAGUE_ID_SET } from '../src/core/leagues.js';
import { AGENDA_RESERVE, ACTIVE_INTERVAL_MS } from '../src/core/polling.js';
import { makeFixture } from './helpers/fixtures.js';

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse('2026-09-03T21:30:00.000Z');

/** Partida da agenda: só kickoff e liga importam para o portão. */
function agendado(leagueId, kickoffMs, extra = {}) {
  return makeFixture({
    leagueId,
    kickoffISO: new Date(kickoffMs).toISOString(),
    status: 'scheduled',
    homeGoals: null,
    awayGoals: null,
    ...extra,
  });
}

// --- o portão vem da agenda -------------------------------------------------

test('partida de interesse dentro da janela abre o portão', () => {
  const agenda = [agendado('71', T0)];
  assert.equal(hasMatchInProgress(agenda, T0 + 30 * 60_000, DEFAULT_LEAGUE_ID_SET), true);
});

test('partida de liga que não interessa mantém o portão fechado', () => {
  // live=all traz 1237 ligas. Numa terça sem jogo brasileiro, centenas de
  // partidas ao vivo no mundo têm que custar zero requisição.
  const agenda = [agendado('39', T0), agendado('140', T0), agendado('135', T0)];
  assert.equal(hasMatchInProgress(agenda, T0 + 30 * 60_000, DEFAULT_LEAGUE_ID_SET), false);
});

test('agenda vazia mantém o portão fechado', () => {
  assert.equal(hasMatchInProgress([], T0, DEFAULT_LEAGUE_ID_SET), false);
});

test('antes do apito inicial o portão está fechado', () => {
  const agenda = [agendado('71', T0)];
  assert.equal(hasMatchInProgress(agenda, T0 - 60_000, DEFAULT_LEAGUE_ID_SET), false);
  assert.equal(hasMatchInProgress(agenda, T0, DEFAULT_LEAGUE_ID_SET), true, 'no apito, abre');
});

test('depois da janela da partida o portão fecha de novo', () => {
  const agenda = [agendado('71', T0)];
  assert.equal(hasMatchInProgress(agenda, T0 + MATCH_WINDOW_MS, DEFAULT_LEAGUE_ID_SET), true);
  assert.equal(hasMatchInProgress(agenda, T0 + MATCH_WINDOW_MS + 1, DEFAULT_LEAGUE_ID_SET), false);
});

test('a janela cobre prorrogação e pênaltis com folga', () => {
  // 90 minutos + intervalo + acréscimos dá ~1h50. Prorrogação e pênaltis
  // levam a ~2h40. Janela curta demais faria o alerta morrer justamente na
  // decisão de um mata-mata da Libertadores.
  assert.ok(
    MATCH_WINDOW_MS >= 2.5 * HOUR,
    `janela de ${(MATCH_WINDOW_MS / HOUR).toFixed(1)}h não cobre prorrogação + pênaltis`,
  );
});

test('uma partida de interesse basta, no meio de muitas que não interessam', () => {
  const agenda = [
    agendado('39', T0),
    agendado('140', T0),
    agendado('13', T0), // Libertadores
    agendado('135', T0),
  ];
  assert.equal(hasMatchInProgress(agenda, T0 + HOUR, DEFAULT_LEAGUE_ID_SET), true);
});

test('kickoff inválido não abre o portão nem quebra', () => {
  const agenda = [
    makeFixture({ leagueId: '71', kickoffISO: '', status: 'scheduled' }),
    makeFixture({ leagueId: '71', kickoffISO: 'ontem à noite', status: 'scheduled' }),
  ];
  assert.equal(hasMatchInProgress(agenda, T0, DEFAULT_LEAGUE_ID_SET), false);
});

test('a janela é configurável por opção', () => {
  const agenda = [agendado('71', T0)];
  const opcoes = { windowMs: 60_000 };
  assert.equal(hasMatchInProgress(agenda, T0 + 30_000, DEFAULT_LEAGUE_ID_SET, opcoes), true);
  assert.equal(hasMatchInProgress(agenda, T0 + 90_000, DEFAULT_LEAGUE_ID_SET, opcoes), false);
});

// --- a decisão do cron ------------------------------------------------------

/** Estado nominal: jogo rolando, cota cheia, nada falhando. */
function estado(overrides = {}) {
  return {
    nowMs: T0 + HOUR,
    agenda: [agendado('71', T0)],
    leagueIds: DEFAULT_LEAGUE_ID_SET,
    quotaRemaining: 90,
    msUntilReset: 2 * HOUR,
    lastFetchAtMs: null,
    backoffUntilMs: 0,
    ...overrides,
  };
}

test('cenário nominal: portão aberto e nunca buscado antes -> busca', () => {
  const d = decideCronAction(estado());
  assert.equal(d.shouldFetch, true);
  assert.equal(d.reason, 'due');
});

test('sem jogo de interesse ao vivo -> não gasta cota', () => {
  const d = decideCronAction(estado({ agenda: [agendado('39', T0)] }));
  assert.equal(d.shouldFetch, false);
  assert.equal(d.reason, 'no-live-match');
});

test('buscou agora há pouco -> espera o intervalo', () => {
  const s = estado({ lastFetchAtMs: T0 + HOUR - 10_000 });
  const d = decideCronAction(s);
  assert.equal(d.shouldFetch, false);
  assert.equal(d.reason, 'too-soon');
});

test('passado o intervalo, volta a buscar', () => {
  const s = estado({ lastFetchAtMs: T0 + HOUR - ACTIVE_INTERVAL_MS * 3 });
  assert.equal(decideCronAction(s).shouldFetch, true);
});

test('a reserva da agenda é inviolável: cota no limite não busca', () => {
  for (const quotaRemaining of [AGENDA_RESERVE, AGENDA_RESERVE - 1, 0]) {
    const d = decideCronAction(estado({ quotaRemaining, lastFetchAtMs: T0 }));
    assert.equal(d.shouldFetch, false, `quotaRemaining=${quotaRemaining} gastou a reserva`);
    assert.equal(d.reason, 'quota-exhausted');
  }
});

test('a reserva é inviolável mesmo na primeira busca do dia', () => {
  // Sem lastFetchAtMs o caminho de "nunca buscou" poderia furar o orçamento.
  const d = decideCronAction(estado({ quotaRemaining: 5, lastFetchAtMs: null }));
  assert.equal(d.shouldFetch, false, 'primeira busca não pode ignorar a cota');
  assert.equal(d.reason, 'quota-exhausted');
});

test('backoff ativo impede a busca mesmo com portão aberto', () => {
  const s = estado({ backoffUntilMs: T0 + HOUR + 30_000 });
  const d = decideCronAction(s);
  assert.equal(d.shouldFetch, false);
  assert.equal(d.reason, 'backoff');
});

test('backoff vencido libera a busca', () => {
  const s = estado({ backoffUntilMs: T0 + HOUR - 1 });
  assert.equal(decideCronAction(s).shouldFetch, true);
});

test('o backoff é checado antes do portão: erro não vira busca por outro caminho', () => {
  const s = estado({ agenda: [agendado('39', T0)], backoffUntilMs: T0 + HOUR + 30_000 });
  assert.equal(decideCronAction(s).shouldFetch, false);
});

test('a decisão devolve o intervalo em uso, para o snapshot e a UI', () => {
  const d = decideCronAction(estado());
  assert.ok(d.intervalMs >= ACTIVE_INTERVAL_MS, `intervalo ${d.intervalMs} abaixo do ritmo ativo`);
  assert.ok(Number.isFinite(d.intervalMs));
});

test('a decisão nunca busca sem motivo declarado', () => {
  const casos = [
    estado(),
    estado({ agenda: [] }),
    estado({ quotaRemaining: 0 }),
    estado({ backoffUntilMs: T0 + 10 * HOUR }),
    estado({ lastFetchAtMs: T0 + HOUR }),
  ];
  for (const s of casos) {
    const d = decideCronAction(s);
    assert.ok(typeof d.reason === 'string' && d.reason.length > 0, 'reason vazio');
    assert.equal(typeof d.shouldFetch, 'boolean');
  }
});

test('decideCronAction é puro: não muta a entrada', () => {
  const s = estado();
  const copia = structuredClone(s);
  // structuredClone não copia Set, então compara o tamanho separadamente.
  const tamanhoAntes = s.leagueIds.size;
  decideCronAction(s);
  assert.deepEqual({ ...s, leagueIds: null }, { ...copia, leagueIds: null });
  assert.equal(s.leagueIds.size, tamanhoAntes);
});

// --- agenda ausente vs. agenda vazia ---------------------------------------

test('agenda AUSENTE falha aberto, com motivo declarado', () => {
  // `[]` é "a agenda respondeu e não há jogo": portão fecha, custo zero.
  // `null` é "não tenho a agenda" — e fechar aí deixaria o Worker sem nunca
  // buscar, com a página correta e vazia. O gasto continua limitado pelo
  // orçamento de cota; o silêncio é que não pode existir.
  const d = decideCronAction(estado({ agenda: null }));
  assert.equal(d.shouldFetch, true);
  assert.equal(d.reason, 'no-agenda');
});

test('agenda vazia continua fechando o portão', () => {
  // Controle positivo: se os dois casos fossem iguais, o teste acima passaria
  // sem provar a distinção.
  const d = decideCronAction(estado({ agenda: [] }));
  assert.equal(d.shouldFetch, false);
  assert.equal(d.reason, 'no-live-match');
});

test('falhar aberto não fura a cota nem ignora o backoff', () => {
  assert.equal(decideCronAction(estado({ agenda: null, quotaRemaining: 3 })).shouldFetch, false);
  assert.equal(
    decideCronAction(estado({ agenda: null, backoffUntilMs: T0 + 10 * HOUR })).reason,
    'backoff',
  );
});

test('regressão: reserva no limite e muito tempo sem buscar NÃO autoriza busca', () => {
  // O bug literal que motivou `hasUsableQuota`. Com a cota exatamente na
  // reserva e um decorrido MAIOR que o intervalo, a comparação
  // `agora - ultimaBusca >= intervalMs` dava verdadeira — porque o intervalo
  // era grande, não porque havia cota — e a reserva ia embora.
  //
  // O decorrido tem que superar o intervalo, senão o resultado seria
  // `too-soon` e apagar o guard de cota não mudaria `shouldFetch`: o teste
  // passaria sem testar nada.
  const nowMs = T0 + 20 * HOUR;
  const d = decideCronAction({
    nowMs,
    agenda: [agendado('71', nowMs - HOUR)],
    leagueIds: DEFAULT_LEAGUE_ID_SET,
    quotaRemaining: AGENDA_RESERVE,
    msUntilReset: 30 * 60_000,
    lastFetchAtMs: nowMs - 12 * HOUR,
    backoffUntilMs: 0,
  });

  assert.ok(
    nowMs - (nowMs - 12 * HOUR) > d.intervalMs,
    'premissa do teste: o decorrido tem que superar o intervalo',
  );
  assert.equal(d.shouldFetch, false, 'a reserva foi consumida');
  assert.equal(d.reason, 'quota-exhausted');
});

test('controle positivo: uma requisição acima da reserva autoriza a busca', () => {
  // Sem isto o teste acima passaria mesmo se o portão nunca buscasse nada.
  const nowMs = T0 + 20 * HOUR;
  const d = decideCronAction({
    nowMs,
    agenda: [agendado('71', nowMs - HOUR)],
    leagueIds: DEFAULT_LEAGUE_ID_SET,
    quotaRemaining: AGENDA_RESERVE + 1,
    msUntilReset: 30 * 60_000,
    lastFetchAtMs: nowMs - 12 * HOUR,
    backoffUntilMs: 0,
  });
  assert.equal(d.shouldFetch, true);
});

test('fail-open polla no ritmo OCIOSO: incerteza não é certeza de jogo', () => {
  // Medido: no ritmo ativo, um dia com agenda ausente queima as 90
  // requisições até 12h BRT e o jogo da noite fica descoberto. Tratar "não
  // sei se há jogo" como "há jogo com certeza" é o erro — a mesma família da
  // confusão entre agenda vazia e agenda ausente.
  const comAgenda = decideCronAction(estado());
  const semAgenda = decideCronAction(estado({ agenda: null }));

  assert.equal(semAgenda.shouldFetch, true, 'continua falhando aberto');
  assert.ok(
    semAgenda.intervalMs > comAgenda.intervalMs * 3,
    `fail-open a ${semAgenda.intervalMs}ms contra ${comAgenda.intervalMs}ms com agenda: rápido demais para incerteza`,
  );
});
