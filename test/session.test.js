import test from 'node:test';
import assert from 'node:assert/strict';
import { applySnapshot } from '../src/core/session.js';
import { RESYNC_GAP_MS } from '../src/core/diff.js';
import { eventKey } from '../src/core/alerts.js';
import { makeFixture, makeSnapshot, evolve } from './helpers/fixtures.js';

/**
 * `applySnapshot` é o único ponto de entrada que o PR 3 consome. As quatro
 * funções internas seguem exportadas e testadas, mas o cliente não sequencia
 * nada: existe um caminho que é impossível de usar errado.
 */

const T0 = 1_700_000_000_000;

test('primeira leitura: sem evento, sem ressincronização, estado adotado', () => {
  const snap = makeSnapshot(T0, [makeFixture({ id: 'a', homeGoals: 2, awayGoals: 1 })]);
  const r = applySnapshot(null, snap);

  assert.deepEqual(r.events, []);
  assert.equal(r.resynced, false);
  assert.equal(r.swallowedGoals, 0);
  assert.equal(r.state.snapshot, snap, 'a primeira leitura vira linha de base');
});

test('operação normal devolve resynced: false e swallowedGoals: 0', () => {
  const base = makeFixture({ id: 'a', homeGoals: 0 });
  const s0 = makeSnapshot(T0, [base]);
  const s1 = makeSnapshot(T0 + 120_000, [evolve(base, { homeGoals: 1 })]);

  const primeiro = applySnapshot(null, s0);
  const segundo = applySnapshot(primeiro.state, s1);

  assert.equal(segundo.events.length, 1, 'o gol é emitido');
  assert.equal(segundo.events[0].goalsAfter, 1);
  assert.equal(segundo.resynced, false);
  assert.equal(segundo.swallowedGoals, 0);
  assert.equal(segundo.state.snapshot, s1);
  assert.ok(
    eventKey(segundo.events[0]) in segundo.state.alerted,
    'o estado devolvido já registrou o alerta: o chamador não precisa lembrar',
  );
});

test('leitura fora de ordem: o estado NÃO regride e o poll seguinte fica calado', () => {
  // O cenário completo t=0 / t=30s / t=60s. É o bug que a correção de uma
  // linha no portão do diff não fechava, porque o chamador guardava a
  // réplica atrasada e o gol era redescoberto contra a linha de base
  // regredida.
  const comGol = makeFixture({ id: 'a', homeGoals: 1 });
  const semGol = evolve(comGol, { homeGoals: 0 });

  const nova = makeSnapshot(T0, [comGol]);
  const atrasada = makeSnapshot(T0 - 40_000, [semGol]);
  const novaDeVolta = makeSnapshot(T0 + 20_000, [comGol]);

  const r0 = applySnapshot(null, nova);
  assert.deepEqual(r0.events, []);

  const r1 = applySnapshot(r0.state, atrasada);
  assert.deepEqual(r1.events, []);
  assert.equal(
    r1.state.snapshot,
    nova,
    'o estado tem que continuar sendo a leitura NOVA, não a atrasada',
  );
  assert.equal(r1.state.snapshot.fetchedAtMs, T0);

  const r2 = applySnapshot(r1.state, novaDeVolta);
  assert.deepEqual(
    r2.events,
    [],
    'o 1-0 já estava na tela desde t=0; nenhum som pode tocar por ele',
  );
});

test('leitura fora de ordem não é ressincronização: nada foi perdido', () => {
  const base = makeFixture({ id: 'a', homeGoals: 1 });
  const r0 = applySnapshot(null, makeSnapshot(T0, [base]));
  const r1 = applySnapshot(r0.state, makeSnapshot(T0 - 40_000, [evolve(base, { homeGoals: 0 })]));

  assert.equal(r1.resynced, false, 'a réplica atrasada é descartada, não engolida');
  assert.equal(r1.swallowedGoals, 0);
});

test('ressincronização por gap longo devolve resynced: true e a contagem de gols', () => {
  const a = makeFixture({ id: 'a', homeGoals: 0, awayGoals: 0 });
  const b = makeFixture({ id: 'b', homeGoals: 1, awayGoals: 1 });

  const s0 = makeSnapshot(T0, [a, b]);
  const s1 = makeSnapshot(T0 + RESYNC_GAP_MS + 1, [
    evolve(a, { homeGoals: 2, awayGoals: 1 }), // +2 casa, +1 fora = 3
    evolve(b, { homeGoals: 1, awayGoals: 3 }), // +0 casa, +2 fora = 2
  ]);

  const r = applySnapshot(applySnapshot(null, s0).state, s1);

  assert.deepEqual(r.events, [], 'ressincronização é silenciosa');
  assert.equal(r.resynced, true);
  assert.equal(
    r.swallowedGoals,
    5,
    'conta GOLS, não partidas: 3 na partida a + 2 na partida b',
  );
  assert.equal(r.state.snapshot, s1, 'o estado avança mesmo em silêncio');
});

test('ressincronização sem gol nenhum devolve resynced: true e swallowedGoals: 0', () => {
  // Distinção que a UI precisa: "houve buraco, mas nada se perdeu" é
  // diferente de "houve buraco e 2 gols podem ter sumido".
  const base = makeFixture({ id: 'a', homeGoals: 1 });
  const s0 = makeSnapshot(T0, [base]);
  const s1 = makeSnapshot(T0 + RESYNC_GAP_MS + 1, [evolve(base, { status: 'finished' })]);

  const r = applySnapshot(applySnapshot(null, s0).state, s1);
  assert.equal(r.resynced, true);
  assert.equal(r.swallowedGoals, 0);
});

test('queda de placar na ressincronização não conta como gol engolido', () => {
  const base = makeFixture({ id: 'a', homeGoals: 3 });
  const s0 = makeSnapshot(T0, [base]);
  const s1 = makeSnapshot(T0 + RESYNC_GAP_MS + 1, [evolve(base, { homeGoals: 1 })]);

  const r = applySnapshot(applySnapshot(null, s0).state, s1);
  assert.equal(r.resynced, true);
  assert.equal(r.swallowedGoals, 0, 'correção do provedor não é gol perdido');
});

test('regra 3 através do contrato único: o mesmo gol não toca duas vezes', () => {
  const base = makeFixture({ id: 'a', homeGoals: 0 });
  let state = applySnapshot(null, makeSnapshot(T0, [base])).state;
  const sons = [];

  for (const [t, goals] of [[120_000, 1], [240_000, 1], [360_000, 0], [480_000, 1]]) {
    const r = applySnapshot(state, makeSnapshot(T0 + t, [evolve(base, { homeGoals: goals })]));
    state = r.state;
    sons.push(...r.events.map((e) => `${e.goalsBefore}->${e.goalsAfter}`));
  }

  assert.deepEqual(sons, ['0->1'], 'gol, repetição, correção e volta = um som só');
});

test('som bloqueado: nada é emitido e nada fica pendente', () => {
  const base = makeFixture({ id: 'a', homeGoals: 0 });
  const s0 = makeSnapshot(T0, [base]);
  const s1 = makeSnapshot(T0 + 120_000, [evolve(base, { homeGoals: 1 })]);
  const s2 = makeSnapshot(T0 + 240_000, [evolve(base, { homeGoals: 1 })]);

  const r0 = applySnapshot(null, s0, { soundEnabled: false });
  const r1 = applySnapshot(r0.state, s1, { soundEnabled: false });
  assert.deepEqual(r1.events, [], 'antes do unlock, nada soa');
  assert.deepEqual(r1.state.alerted, {}, 'e nada é registrado como alertado');

  // Liberar o som no minuto 80 não pode disparar os gols do primeiro tempo.
  const r2 = applySnapshot(r1.state, s2, { soundEnabled: true });
  assert.deepEqual(r2.events, []);
});

test('applySnapshot é puro: não muta o estado anterior nem os snapshots', () => {
  const base = makeFixture({ id: 'a', homeGoals: 0 });
  const s0 = makeSnapshot(T0, [base]);
  const s1 = makeSnapshot(T0 + 120_000, [evolve(base, { homeGoals: 1 })]);

  const estadoAnterior = applySnapshot(null, s0).state;
  const copiaEstado = structuredClone(estadoAnterior);
  const copiaS1 = structuredClone(s1);

  applySnapshot(estadoAnterior, s1);

  assert.deepEqual(estadoAnterior, copiaEstado, 'o estado anterior é imutável');
  assert.deepEqual(s1, copiaS1);
});

test('o limiar de ressincronização é configurável pelo contrato único', () => {
  const base = makeFixture({ id: 'a', homeGoals: 0 });
  const s0 = makeSnapshot(T0, [base]);
  const s1 = makeSnapshot(T0 + 60_000, [evolve(base, { homeGoals: 1 })]);

  const r = applySnapshot(applySnapshot(null, s0).state, s1, { resyncGapMs: 30_000 });
  assert.deepEqual(r.events, []);
  assert.equal(r.resynced, true);
  assert.equal(r.swallowedGoals, 1);
});
