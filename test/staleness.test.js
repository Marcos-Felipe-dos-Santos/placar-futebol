import test from 'node:test';
import assert from 'node:assert/strict';
import { isStale, FRESH_MAX_MS, WARN_MAX_MS } from '../src/core/staleness.js';

const NOW = 1_700_000_000_000;

test('dado recém-buscado é fresco e tem idade zero', () => {
  assert.deepEqual(isStale(NOW, NOW), { level: 'fresh', ageMs: 0 });
});

test('a idade crua volta em ms, para a UI escrever "dados de há 40s"', () => {
  const { ageMs, level } = isStale(NOW - 40_000, NOW);
  assert.equal(ageMs, 40_000);
  assert.equal(level, 'fresh', '40s está dentro da janela normal do pipeline');
});

test('as três faixas mudam exatamente nos limiares', () => {
  assert.equal(isStale(NOW - FRESH_MAX_MS, NOW).level, 'fresh', 'limiar fresco é inclusivo');
  assert.equal(isStale(NOW - FRESH_MAX_MS - 1, NOW).level, 'warn');
  assert.equal(isStale(NOW - WARN_MAX_MS, NOW).level, 'warn', 'limiar de aviso é inclusivo');
  assert.equal(isStale(NOW - WARN_MAX_MS - 1, NOW).level, 'stale');
});

test('a faixa verde cobre o pior caso honesto do pipeline (150s upstream + 60s de KV)', () => {
  assert.ok(
    FRESH_MAX_MS >= 210_000,
    'faixa verde curta demais pinta de amarelo um dado que está funcionando como projetado',
  );
});

test('a faixa amarela é estritamente maior que a verde', () => {
  assert.ok(WARN_MAX_MS > FRESH_MAX_MS);
});

test('timestamp no futuro (relógio do cliente atrasado) vira idade zero, não negativa', () => {
  const resultado = isStale(NOW + 90_000, NOW);
  assert.equal(resultado.ageMs, 0, 'idade negativa quebraria a formatação "há Xs"');
  assert.equal(resultado.level, 'fresh');
});

test('dado muito antigo é stale e reporta a idade real', () => {
  const duasHoras = 2 * 60 * 60 * 1000;
  assert.deepEqual(isStale(NOW - duasHoras, NOW), { level: 'stale', ageMs: duasHoras });
});

test('sem snapshot nenhum, o estado é stale — nunca fresco por omissão', () => {
  for (const invalido of [null, undefined, Number.NaN, 'ontem']) {
    const resultado = isStale(invalido, NOW);
    assert.equal(
      resultado.level,
      'stale',
      `timestamp ${String(invalido)} não pode ser exibido como dado bom`,
    );
    assert.equal(resultado.ageMs, Number.POSITIVE_INFINITY);
  }
});

test('os limiares são configuráveis por opção', () => {
  assert.equal(isStale(NOW - 5_000, NOW, { freshMaxMs: 1_000, warnMaxMs: 2_000 }).level, 'stale');
  assert.equal(isStale(NOW - 1_500, NOW, { freshMaxMs: 1_000, warnMaxMs: 2_000 }).level, 'warn');
  assert.equal(isStale(NOW - 500, NOW, { freshMaxMs: 1_000, warnMaxMs: 2_000 }).level, 'fresh');
});
