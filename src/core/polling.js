/**
 * Orçamento de cota: de quanto em quanto tempo o cron pode gastar uma
 * requisição da API-Football.
 *
 * ESCOPO — este é o intervalo UPSTREAM. O navegador bate em `/api/live` num
 * intervalo próprio, constante e sem custo de cota (limitado pelas 100k
 * requisições/dia do Worker, não pela API-Football). Os dois números não se
 * misturam e não saem daqui.
 *
 * INTERPRETAÇÃO DA REGRA "nunca estourar a cota": a garantia implementada é
 * que a reserva da agenda nunca é consumida pelo poll ao vivo, e que o ritmo
 * degrada conforme a cota some. A cota NÃO é diluída uniformemente até o
 * reset — fazer isso destruiria o produto (ver `LIVE_WINDOW_MS`).
 *
 * @module core/polling
 */

const HOUR_MS = 60 * 60 * 1000;

/** Ritmo mais rápido autorizado com jogo ao vivo. Piso da banda 120–150s. */
export const ACTIVE_INTERVAL_MS = 120_000;

/**
 * Ritmo sem nenhum jogo ao vivo de interesse. Serve só para perceber que uma
 * partida começou; é aqui que a cota é preservada para quando importa.
 */
export const IDLE_INTERVAL_MS = 15 * 60_000;

/**
 * Janela sobre a qual a cota utilizável é distribuída.
 *
 * Não é o tempo até o reset, e essa é a decisão de projeto mais importante
 * deste arquivo. Diluir ~80 requisições pelas 24h até o reset dá um poll a
 * cada ~18 minutos — e um jogo que começa 21:30 BRT, logo depois do reset das
 * 21:00, seria acompanhado com latência de 18 minutos. Inútil.
 *
 * A cota é um orçamento para uma janela de jogo, não uma média diária. 3h é a
 * cobertura prometida no README, e 80 requisições em 3h dão 135s — exatamente
 * a banda de 120–150s do projeto.
 */
export const LIVE_WINDOW_MS = 3 * HOUR_MS;

/** Requisições/dia guardadas para a agenda, fora do alcance do poll ao vivo. */
export const AGENDA_RESERVE = 10;

/**
 * @param {unknown} value
 * @returns {number} O número, ou 0 se não for finito.
 */
function finiteOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Intervalo até a próxima chamada upstream, em ms.
 *
 * @param {object} input
 * @param {number} input.quotaRemaining
 *   Requisições restantes na cota diária, lidas do header
 *   `x-ratelimit-requests-remaining` da última resposta upstream.
 * @param {number} input.msUntilReset  Tempo até o reset da cota (00:00 UTC).
 * @param {boolean} input.hasLiveFavorite
 *   Se há partida ao vivo que justifica gastar cota agora. É o gate: sem
 *   isso, o cron não deveria estar queimando o orçamento.
 * @param {object} [options]
 * @param {number} [options.reserve=AGENDA_RESERVE]
 * @param {number} [options.activeMs=ACTIVE_INTERVAL_MS]
 * @param {number} [options.idleMs=IDLE_INTERVAL_MS]
 * @param {number} [options.liveWindowMs=LIVE_WINDOW_MS]
 * @returns {number}
 *   Inteiro positivo e finito. Quando a cota utilizável acabou, devolve um
 *   valor que joga a próxima tentativa para depois do reset.
 */
export function computePollInterval(input, options = {}) {
  const {
    reserve = AGENDA_RESERVE,
    activeMs = ACTIVE_INTERVAL_MS,
    idleMs = IDLE_INTERVAL_MS,
    liveWindowMs = LIVE_WINDOW_MS,
  } = options;

  const quotaRemaining = finiteOrZero(input?.quotaRemaining);
  const msUntilReset = Math.max(0, finiteOrZero(input?.msUntilReset));
  const usableQuota = Math.floor(quotaRemaining - reserve);

  // Reserva da agenda intocável: nada de poll ao vivo até o reset.
  if (usableQuota <= 0) {
    return Math.max(msUntilReset, activeMs);
  }

  const desiredMs = input?.hasLiveFavorite ? activeMs : idleMs;

  // A cota utilizável é espalhada pela janela de jogo — ou pelo que resta até
  // o reset, o que for menor. Perto do reset a janela encolhe e o ritmo pode
  // acelerar até o piso ativo, porque a cota vira abóbora de qualquer forma.
  const budgetWindowMs = Math.min(msUntilReset, liveWindowMs);
  const sustainableMs = budgetWindowMs / usableQuota;

  return Math.max(desiredMs, Math.ceil(sustainableMs));
}
