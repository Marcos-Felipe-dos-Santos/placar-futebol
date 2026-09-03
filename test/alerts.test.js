import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAlert, eventKey, ALERT_TTL_MS } from '../src/core/alerts.js';
import { makeFixture, makeGoalEvent } from './helpers/fixtures.js';

const NOW = 1_700_000_000_000;

/** Opções mínimas: som liberado, nada alertado ainda. */
function opts(overrides = {}) {
  return { alerted: {}, nowMs: NOW, enabled: true, ...overrides };
}

test('evento inédito com som liberado dispara', () => {
  assert.equal(shouldAlert(makeGoalEvent(), opts()), true);
});

test('regra 3: o mesmo gol não dispara duas vezes', () => {
  const evento = makeGoalEvent();
  const chave = eventKey(evento);
  assert.equal(shouldAlert(evento, opts({ alerted: { [chave]: NOW - 1_000 } })), false);
});

test('regra 3: o gol seguinte da mesma partida e do mesmo lado dispara', () => {
  const fixture = makeFixture({ id: 'jogo', homeGoals: 2 });
  const primeiro = makeGoalEvent({ fixture, fixtureId: 'jogo', goalsBefore: 0, goalsAfter: 1 });
  const segundo = makeGoalEvent({ fixture, fixtureId: 'jogo', goalsBefore: 1, goalsAfter: 2 });

  assert.notEqual(eventKey(primeiro), eventKey(segundo), 'gols distintos precisam de chaves distintas');
  assert.equal(
    shouldAlert(segundo, opts({ alerted: { [eventKey(primeiro)]: NOW - 60_000 } })),
    true,
  );
});

test('regra 3: gols simultâneos dos dois lados têm chaves distintas', () => {
  const fixture = makeFixture({ id: 'jogo', homeGoals: 1, awayGoals: 1 });
  const casa = makeGoalEvent({ fixture, fixtureId: 'jogo', side: 'home', goalsBefore: 0, goalsAfter: 1 });
  const fora = makeGoalEvent({ fixture, fixtureId: 'jogo', side: 'away', goalsBefore: 0, goalsAfter: 1 });

  assert.notEqual(eventKey(casa), eventKey(fora));
  assert.equal(shouldAlert(fora, opts({ alerted: { [eventKey(casa)]: NOW } })), true);
});

test('regra 3: partidas diferentes com o mesmo placar têm chaves distintas', () => {
  const a = makeGoalEvent({ fixture: makeFixture({ id: 'a', homeGoals: 1 }), fixtureId: 'a' });
  const b = makeGoalEvent({ fixture: makeFixture({ id: 'b', homeGoals: 1 }), fixtureId: 'b' });
  assert.notEqual(eventKey(a), eventKey(b));
  assert.equal(shouldAlert(b, opts({ alerted: { [eventKey(a)]: NOW } })), true);
});

test('regra 3: o dedupe não é eterno — expira depois do TTL', () => {
  const evento = makeGoalEvent();
  const chave = eventKey(evento);
  assert.equal(
    shouldAlert(evento, opts({ alerted: { [chave]: NOW - ALERT_TTL_MS - 1 } })),
    true,
    'entrada expirada não pode silenciar um alerta para sempre',
  );
  assert.equal(
    shouldAlert(evento, opts({ alerted: { [chave]: NOW - ALERT_TTL_MS + 1 } })),
    false,
    'dentro do TTL continua silenciado',
  );
});

test('o TTL cobre a duração de uma partida com folga', () => {
  assert.ok(
    ALERT_TTL_MS >= 3 * 60 * 60 * 1000,
    'menor que isso e um jogo longo poderia realertar o mesmo placar depois de uma correção do provedor',
  );
});

test('som não liberado silencia tudo (política de autoplay)', () => {
  assert.equal(shouldAlert(makeGoalEvent(), opts({ enabled: false })), false);
});

test('evento sem aumento de placar nunca alerta', () => {
  assert.equal(
    shouldAlert(makeGoalEvent({ goalsBefore: 2, goalsAfter: 2 }), opts()),
    false,
  );
  assert.equal(
    shouldAlert(makeGoalEvent({ goalsBefore: 2, goalsAfter: 1 }), opts()),
    false,
  );
});

test('shouldAlert é puro: não muta o registro de alertados', () => {
  const evento = makeGoalEvent();
  const alerted = { [eventKey(evento)]: NOW - 1_000 };
  const copia = { ...alerted };
  shouldAlert(evento, opts({ alerted }));
  assert.deepEqual(alerted, copia);
});

test('registro de alertados ausente é tratado como vazio', () => {
  assert.equal(shouldAlert(makeGoalEvent(), { nowMs: NOW, enabled: true }), true);
});

test('eventKey é estável entre chamadas', () => {
  const evento = makeGoalEvent();
  assert.equal(eventKey(evento), eventKey({ ...evento }));
});
