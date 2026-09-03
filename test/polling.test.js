import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePollInterval,
  ACTIVE_INTERVAL_MS,
  IDLE_INTERVAL_MS,
  LIVE_WINDOW_MS,
  AGENDA_RESERVE,
} from '../src/core/polling.js';

const HOUR = 60 * 60 * 1000;

/**
 * ATENÇÃO AO ESCOPO: este é o intervalo UPSTREAM, o que o gate do cron usa
 * para decidir se gasta cota da API-Football. O intervalo com que o navegador
 * bate em /api/live é outra coisa — constante, sem custo de cota — e não sai
 * daqui.
 */

test('cenário nominal do projeto cai na banda declarada de 120–150s', () => {
  const ms = computePollInterval({
    quotaRemaining: 90,
    msUntilReset: 8 * HOUR,
    hasLiveFavorite: true,
  });
  assert.ok(ms >= 120_000 && ms <= 150_000, `esperado 120–150s, veio ${ms}ms`);
});

test('sem favorito ao vivo, o intervalo cai para a sondagem ociosa', () => {
  const ms = computePollInterval({
    quotaRemaining: 90,
    msUntilReset: 8 * HOUR,
    hasLiveFavorite: false,
  });
  assert.ok(ms >= IDLE_INTERVAL_MS, `ocioso deveria ser >= ${IDLE_INTERVAL_MS}, veio ${ms}`);
});

test('sondagem ociosa é bem mais lenta que a ativa — é aí que a cota é preservada', () => {
  assert.ok(IDLE_INTERVAL_MS > ACTIVE_INTERVAL_MS * 3);
});

test('com favorito ao vivo e cota folgada, nunca desce abaixo do intervalo ativo', () => {
  const ms = computePollInterval({
    quotaRemaining: 100,
    msUntilReset: 5 * 60_000,
    hasLiveFavorite: true,
  });
  assert.ok(
    ms >= ACTIVE_INTERVAL_MS,
    'cota sobrando perto do reset não autoriza queimar requisição a cada segundo',
  );
});

test('regra 6: a reserva da agenda é intocável — sem cota utilizável, não há poll antes do reset', () => {
  for (const quotaRemaining of [AGENDA_RESERVE, AGENDA_RESERVE - 1, 1, 0]) {
    const msUntilReset = 3 * HOUR;
    const ms = computePollInterval({ quotaRemaining, msUntilReset, hasLiveFavorite: true });
    assert.ok(
      ms >= msUntilReset,
      `com quotaRemaining=${quotaRemaining} o próximo poll tem que cair depois do reset, veio ${ms}`,
    );
    assert.ok(Number.isFinite(ms), 'o intervalo tem que continuar finito e agendável');
  }
});

test('regra 6: simulação de um dia inteiro nunca fura a cota', () => {
  const QUOTA_DIARIA = 100;
  let quota = QUOTA_DIARIA;
  let msUntilReset = 24 * HOUR;
  let chamadas = 0;

  // Pior caso possível: há favorito ao vivo o dia inteiro, ou seja, o gate
  // sempre autoriza gastar. Se a função furar a cota, fura aqui.
  while (msUntilReset > 0 && chamadas < 10_000) {
    const intervalo = computePollInterval({
      quotaRemaining: quota,
      msUntilReset,
      hasLiveFavorite: true,
    });
    assert.ok(intervalo > 0, 'intervalo tem que ser positivo, senão o cron entra em loop');
    assert.ok(Number.isFinite(intervalo), 'intervalo tem que ser finito');
    if (intervalo >= msUntilReset) break;
    msUntilReset -= intervalo;
    quota -= 1;
    chamadas += 1;
  }

  assert.ok(chamadas < 10_000, 'a simulação não pode depender do teto de segurança do laço');
  assert.ok(
    quota >= AGENDA_RESERVE,
    `a reserva da agenda foi consumida: sobraram ${quota}, mínimo ${AGENDA_RESERVE}`,
  );
  assert.ok(
    chamadas <= QUOTA_DIARIA - AGENDA_RESERVE,
    `gastou ${chamadas} requisições ao vivo, máximo ${QUOTA_DIARIA - AGENDA_RESERVE}`,
  );
});

test('regra 6: a cota utilizável cobre a janela de cobertura ao vivo prometida', () => {
  const ms = computePollInterval({
    quotaRemaining: 100,
    msUntilReset: 12 * HOUR,
    hasLiveFavorite: true,
  });
  const cobertura = ms * (100 - AGENDA_RESERVE);
  assert.ok(
    cobertura >= 3 * HOUR,
    `no ritmo de ${ms}ms a cota cobre só ${(cobertura / HOUR).toFixed(1)}h ao vivo; o README promete 3–4h`,
  );
});

test('a janela de cobertura ao vivo é a prometida no projeto', () => {
  assert.equal(LIVE_WINDOW_MS, 3 * HOUR);
});

test('conforme a cota some, o intervalo cresce — degradação, não parada seca', () => {
  const cenario = (quotaRemaining) =>
    computePollInterval({ quotaRemaining, msUntilReset: 6 * HOUR, hasLiveFavorite: true });

  const cotas = [90, 70, 50, 30, 20, 15, 11];
  const intervalos = cotas.map(cenario);

  for (let i = 1; i < intervalos.length; i += 1) {
    assert.ok(
      intervalos[i] >= intervalos[i - 1],
      `cota ${cotas[i]} deu intervalo ${intervalos[i]}, menor que o da cota ${cotas[i - 1]} (${intervalos[i - 1]})`,
    );
  }
  assert.ok(
    intervalos.at(-1) > intervalos[0],
    'com a cota quase no fim o intervalo tem que ser estritamente maior que no começo do dia',
  );
});

test('reserva e intervalos são configuráveis por opção', () => {
  const base = { quotaRemaining: 30, msUntilReset: 6 * HOUR, hasLiveFavorite: true };
  const comReservaMaior = computePollInterval(base, { reserve: 25 });
  const comReservaPadrao = computePollInterval(base, { reserve: 0 });
  assert.ok(
    comReservaMaior > comReservaPadrao,
    'reservar mais cota tem que espaçar os polls',
  );
});

test('entradas degeneradas não produzem NaN, zero nem negativo', () => {
  const casos = [
    { quotaRemaining: 50, msUntilReset: 0, hasLiveFavorite: true },
    { quotaRemaining: -5, msUntilReset: 3 * HOUR, hasLiveFavorite: true },
    { quotaRemaining: 50, msUntilReset: -1, hasLiveFavorite: false },
    { quotaRemaining: Number.NaN, msUntilReset: 3 * HOUR, hasLiveFavorite: true },
    { quotaRemaining: 50, msUntilReset: Number.NaN, hasLiveFavorite: true },
  ];
  for (const caso of casos) {
    const ms = computePollInterval(caso);
    assert.ok(
      Number.isFinite(ms) && ms > 0,
      `entrada ${JSON.stringify(caso)} devolveu ${ms}`,
    );
  }
});

test('o resultado é um inteiro de ms — setTimeout/cron não lidam com fração', () => {
  const ms = computePollInterval({
    quotaRemaining: 77,
    msUntilReset: 7 * HOUR + 1234,
    hasLiveFavorite: true,
  });
  assert.equal(ms, Math.trunc(ms));
});
