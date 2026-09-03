import test from 'node:test';
import assert from 'node:assert/strict';
import { nextBackoffMs, BACKOFF_BASE_MS, BACKOFF_MAX_MS } from '../src/core/backoff.js';

const MIN = 60_000;

test('a escada é exatamente a especificada: 15s, 30s, 60s, 120s', () => {
  assert.equal(nextBackoffMs(1), 15_000);
  assert.equal(nextBackoffMs(2), 30_000);
  assert.equal(nextBackoffMs(3), 60_000);
  assert.equal(nextBackoffMs(4), 120_000);
});

test('continua dobrando depois do quarto degrau', () => {
  assert.equal(nextBackoffMs(5), 240_000);
  assert.equal(nextBackoffMs(6), 480_000);
});

test('o teto é 15 minutos e não é ultrapassado nunca', () => {
  assert.equal(BACKOFF_MAX_MS, 15 * MIN);
  for (const falhas of [7, 8, 20, 100, 10_000]) {
    assert.equal(nextBackoffMs(falhas), 15 * MIN, `${falhas} falhas passou do teto`);
  }
});

test('sem falha não há espera', () => {
  assert.equal(nextBackoffMs(0), 0);
  assert.equal(nextBackoffMs(-1), 0);
});

test('a espera é monotônica: mais falhas nunca esperam menos', () => {
  let anterior = -1;
  for (let f = 0; f <= 12; f += 1) {
    const atual = nextBackoffMs(f);
    assert.ok(atual >= anterior, `${f} falhas deu ${atual}, menos que ${anterior}`);
    anterior = atual;
  }
});

test('429 não entra na escada: vai direto para o teto', () => {
  // A API-Football bloqueia pico anormal de tráfego sem aviso. Um 429 não é
  // "erro transitório, tenta de novo em 15s" — é o provedor dizendo que já
  // estamos batendo demais. Insistir arrisca o acesso, não só a cota.
  for (const falhas of [1, 2, 3, 10]) {
    assert.equal(
      nextBackoffMs(falhas, { rateLimited: true }),
      BACKOFF_MAX_MS,
      `429 com ${falhas} falhas deveria ir ao teto`,
    );
  }
});

test('429 na primeira falha espera muito mais que um erro comum', () => {
  // Controle positivo do teste acima: se rateLimited fosse ignorado, os dois
  // valores seriam iguais e o teste anterior passaria por outro motivo.
  assert.ok(nextBackoffMs(1, { rateLimited: true }) > nextBackoffMs(1) * 50);
});

test('BACKOFF_BASE_MS é o primeiro degrau de fato', () => {
  assert.equal(BACKOFF_BASE_MS, 15_000);
  assert.equal(nextBackoffMs(1), BACKOFF_BASE_MS);
});

test('o resultado é sempre inteiro finito não negativo', () => {
  for (const falhas of [0, 1, 5, 50, Number.NaN, Number.POSITIVE_INFINITY, -3, 2.7]) {
    const ms = nextBackoffMs(falhas);
    assert.ok(Number.isFinite(ms) && ms >= 0 && Number.isInteger(ms), `${falhas} deu ${ms}`);
  }
});
