import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, parseSnapshot, SNAPSHOT_VERSION } from '../src/core/snapshot.js';
import { applySnapshot } from '../src/core/session.js';
import { isStale } from '../src/core/staleness.js';
import { makeFixture } from './helpers/fixtures.js';

const T0 = 1_700_000_000_000;

function entradaNominal(overrides = {}) {
  return {
    fetchedAtMs: T0,
    fixtures: [makeFixture({ id: 'a' }), makeFixture({ id: 'b' })],
    quotaRemaining: 87,
    quotaResetAtMs: T0 + 3 * 60 * 60 * 1000,
    discarded: 0,
    truncated: false,
    upstreamCount: 2,
    intervalMs: 135_000,
    ...overrides,
  };
}

test('o snapshot carrega tudo que a UI precisa sem uma segunda chamada', () => {
  const s = buildSnapshot(entradaNominal());

  assert.equal(s.version, SNAPSHOT_VERSION);
  assert.equal(s.fetchedAtMs, T0);
  assert.equal(s.fixtures.length, 2);
  assert.equal(s.quotaRemaining, 87);
  assert.equal(s.discarded, 0);
  assert.equal(s.truncated, false);
  assert.equal(s.upstreamCount, 2);
});

test('o snapshot é aceito por applySnapshot sem adaptação', () => {
  // O envelope do KV é superconjunto do Snapshot do modelo interno. Se essa
  // compatibilidade quebrar, o cliente precisa de código de tradução e a
  // fronteira vaza para o PR 3.
  const s = buildSnapshot(entradaNominal());
  const r = applySnapshot(null, s);

  assert.equal(r.state.snapshot, s);
  assert.deepEqual(r.events, []);
  assert.equal(r.resynced, false);
});

test('o snapshot é aceito por isStale, que só depende de fetchedAtMs', () => {
  const s = buildSnapshot(entradaNominal());
  assert.equal(isStale(s.fetchedAtMs, T0 + 40_000).level, 'fresh');
  assert.equal(isStale(s.fetchedAtMs, T0 + 40_000).ageMs, 40_000);
});

test('discarded > 0 sobrevive até o cliente: é sinal, não log', () => {
  const s = buildSnapshot(entradaNominal({ discarded: 3, upstreamCount: 5 }));
  assert.equal(s.discarded, 3);
  assert.equal(s.upstreamCount, 5, 'a UI precisa do denominador para dizer 3 de 5');
});

test('o snapshot sobrevive a uma ida e volta por JSON — é assim que vive no KV', () => {
  const s = buildSnapshot(entradaNominal({ discarded: 1 }));
  const voltou = parseSnapshot(JSON.stringify(s));
  assert.deepEqual(voltou, s);
});

test('buildSnapshot não referencia o array de fixtures recebido', () => {
  const fixtures = [makeFixture({ id: 'a' })];
  const s = buildSnapshot(entradaNominal({ fixtures }));
  fixtures.push(makeFixture({ id: 'b' }));
  assert.equal(s.fixtures.length, 1);
});

test('quota desconhecida entra como null, não como zero', () => {
  // Zero significaria "cota esgotada" e faria o portão fechar o dia inteiro
  // por causa de um header ausente.
  const s = buildSnapshot(entradaNominal({ quotaRemaining: undefined }));
  assert.equal(s.quotaRemaining, null);

  const comString = buildSnapshot(entradaNominal({ quotaRemaining: '80' }));
  assert.equal(comString.quotaRemaining, 80, 'header string é convertido aqui, no limite do sistema');
});

// --- leitura defensiva do KV ------------------------------------------------

test('parseSnapshot devolve null para lixo em vez de lançar', () => {
  // O fetch handler nunca pode derrubar a página por causa de um valor
  // estranho no KV: ele serve o que tem e deixa o staleness contar a verdade.
  for (const lixo of [null, undefined, '', 'não é json', '{', '[]', '42', '"texto"', '{}']) {
    assert.equal(parseSnapshot(lixo), null, `${JSON.stringify(lixo)} deveria virar null`);
  }
});

test('parseSnapshot rejeita snapshot sem fetchedAtMs utilizável', () => {
  const base = buildSnapshot(entradaNominal());
  for (const ruim of [null, 'agora', Number.NaN]) {
    const s = JSON.stringify({ ...base, fetchedAtMs: ruim });
    assert.equal(parseSnapshot(s), null, `fetchedAtMs=${String(ruim)} passou`);
  }
});

test('parseSnapshot rejeita snapshot sem array de fixtures', () => {
  const base = buildSnapshot(entradaNominal());
  for (const ruim of [null, {}, 'a', 7]) {
    assert.equal(parseSnapshot(JSON.stringify({ ...base, fixtures: ruim })), null);
  }
});

test('parseSnapshot aceita um snapshot legítimo sem partidas', () => {
  // Controle positivo: fixtures: [] é caso normal (sem jogo ao vivo) e não
  // pode ser confundido com lixo.
  const s = buildSnapshot(entradaNominal({ fixtures: [], upstreamCount: 0 }));
  const voltou = parseSnapshot(JSON.stringify(s));
  assert.notEqual(voltou, null);
  assert.deepEqual(voltou.fixtures, []);
});

test('parseSnapshot rejeita versão que não sabe ler', () => {
  const base = buildSnapshot(entradaNominal());
  const futuro = JSON.stringify({ ...base, version: SNAPSHOT_VERSION + 1 });
  assert.equal(parseSnapshot(futuro), null, 'versão desconhecida não pode ser interpretada às cegas');
});

test('parseSnapshot aceita objeto já parseado, não só string', () => {
  const s = buildSnapshot(entradaNominal());
  assert.deepEqual(parseSnapshot(s), s);
});
