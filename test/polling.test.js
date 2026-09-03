import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePollInterval,
  ACTIVE_INTERVAL_MS,
  IDLE_INTERVAL_MS,
  LIVE_WINDOW_MS,
  AGENDA_RESERVE,
  hasUsableQuota,
  MIN_INTERVAL_MS,
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

test('perto do reset com cota sobrando, não há rajada', () => {
  // 40 requisições utilizáveis e 90s até o reset: a conta de
  // sustentabilidade dá ~2,2s. Sem piso, o cron abriria uma rajada — e a
  // API-Football corta pico anormal de tráfego sem aviso.
  const ms = computePollInterval({
    quotaRemaining: 50,
    msUntilReset: 90_000,
    hasLiveFavorite: true,
  });
  assert.ok(ms >= MIN_INTERVAL_MS, `veio ${ms}ms, abaixo do piso absoluto`);
  assert.ok(ms >= ACTIVE_INTERVAL_MS, `veio ${ms}ms, abaixo do ritmo ativo`);
  assert.ok(
    ms >= 90_000,
    'com 90s até o reset, no máximo uma requisição pode caber antes dele',
  );
});

// O piso é medido contra 30s literais, e não contra MIN_INTERVAL_MS. Assertar
// `ms >= MIN_INTERVAL_MS` seria tautológico: bastaria alguém baixar a
// constante para 1 e a proteção sumiria com a suíte verde.
const PISO_MINIMO_DEFENSAVEL_MS = 30_000;

test('o piso absoluto sobrevive a opções que tentariam furá-lo', () => {
  const ms = computePollInterval(
    { quotaRemaining: 100, msUntilReset: 30_000, hasLiveFavorite: true },
    { activeMs: 1_000, idleMs: 1_000 },
  );
  assert.ok(
    ms >= PISO_MINIMO_DEFENSAVEL_MS,
    `opção activeMs baixa furou o piso: veio ${ms}ms. O piso não pode depender das opções`,
  );
});

test('o piso absoluto vale também quando a cota utilizável acabou', () => {
  // `msUntilReset: 0` e `activeMs` baixo de propósito: é a única combinação
  // em que a margem pós-reset não mascara a ausência do piso duro. A régua
  // tem que ficar acima de RESET_MARGIN_MS, senão a margem sozinha satisfaz
  // o teste e o piso pode ser removido com a suíte verde.
  const ms = computePollInterval(
    { quotaRemaining: 0, msUntilReset: 0, hasLiveFavorite: true },
    { activeMs: 1_000 },
  );
  assert.ok(ms >= 50_000, `veio ${ms}ms, abaixo do piso absoluto`);
});

test('o piso absoluto é um número defensável, não um placebo', () => {
  assert.ok(
    MIN_INTERVAL_MS >= PISO_MINIMO_DEFENSAVEL_MS,
    `MIN_INTERVAL_MS = ${MIN_INTERVAL_MS}ms não protege contra rajada nenhuma`,
  );
  assert.ok(
    MIN_INTERVAL_MS <= ACTIVE_INTERVAL_MS,
    'um piso acima do ritmo ativo tornaria a banda 120–150s inalcançável',
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
  // O teto é o que dá discriminação ao teste. Só com piso, um intervalo MAIOR
  // aumenta a "cobertura" e passa mais folgado — a diluição literal até o
  // reset daria 8min de intervalo, 12h de "cobertura", e passaria.
  assert.ok(
    cobertura <= 4.5 * HOUR,
    `${(cobertura / HOUR).toFixed(1)}h de cobertura significa intervalo de ${(ms / 60_000).toFixed(1)}min; o README promete 3–4h, não uma média diluída`,
  );
});

test('quotaRemaining como string de header silencia o poll — comportamento fixado', () => {
  // Headers HTTP são strings. `'80'` não é 80: cai no saneamento como zero, a
  // cota parece esgotada e o poll ao vivo cala até o reset. A direção é
  // segura, mas o produto morre calado — este teste existe para que a
  // obrigação do PR 2 (fazer Number(header)) não seja descoberta em produção.
  const msUntilReset = 8 * HOUR;
  const ms = computePollInterval({ quotaRemaining: '80', msUntilReset, hasLiveFavorite: true });
  assert.ok(
    ms >= msUntilReset,
    `header string produziu intervalo de ${(ms / 60_000).toFixed(1)}min em vez de silenciar até o reset`,
  );
});

test('o agendamento pós-reset tem folga para não disputar o milissegundo do reset', () => {
  const msUntilReset = 3 * HOUR;
  const ms = computePollInterval({ quotaRemaining: 0, msUntilReset, hasLiveFavorite: true });
  assert.ok(
    ms > msUntilReset,
    'bater no instante exato do reset aposta que o relógio do Worker e o da API concordam; se a API estiver atrás, volta 429',
  );
  assert.ok(ms >= msUntilReset + 30_000, `folga de apenas ${ms - msUntilReset}ms`);
});

test('regra 6 reinterpretada: jogo logo depois do reset não é diluído pelas 24h', () => {
  // 21:30 BRT, meia hora depois do reset das 21:00 — o caso que mata a
  // leitura literal da regra 6. Diluir 80 requisições por 23,5h daria um
  // poll a cada ~18 minutos e o produto não existiria.
  const ms = computePollInterval({
    quotaRemaining: 90,
    msUntilReset: 23.5 * HOUR,
    hasLiveFavorite: true,
  });
  assert.ok(
    ms <= 150_000,
    `partida começando logo após o reset recebeu intervalo de ${(ms / 60_000).toFixed(1)}min; a cota é orçamento de janela de jogo, não média diária`,
  );
  assert.ok(ms <= LIVE_WINDOW_MS, 'a janela de orçamento limita o intervalo, não o tempo até o reset');
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

test('hasUsableQuota responde só sobre a cota, e a reserva não é utilizável', () => {
  // A confusão entre os dois deixava um gap longo desde a última busca furar
  // a reserva da agenda: `agora - ultimaBusca >= intervalo` dava verdadeira
  // porque o intervalo era grande, e não porque havia cota.
  assert.equal(hasUsableQuota(90), true);
  assert.equal(hasUsableQuota(AGENDA_RESERVE + 1), true);
  assert.equal(hasUsableQuota(AGENDA_RESERVE), false, 'a reserva não é utilizável');
  assert.equal(hasUsableQuota(AGENDA_RESERVE - 1), false);
  assert.equal(hasUsableQuota(0), false);
});


test('hasUsableQuota respeita a reserva configurada', () => {
  assert.equal(hasUsableQuota(20, { reserve: 25 }), false);
  assert.equal(hasUsableQuota(20, { reserve: 5 }), true);
});

test('hasUsableQuota trata entrada não numérica como sem cota', () => {
  for (const ruim of ['80', null, undefined, Number.NaN]) {
    assert.equal(hasUsableQuota(ruim), false, `${String(ruim)} deveria ser sem cota`);
  }
});
