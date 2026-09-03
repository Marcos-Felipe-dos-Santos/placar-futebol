/**
 * Quão velho é o dado que está na tela.
 *
 * A página inteira é alimentada por um snapshot que pode ter minutos de
 * idade. Esconder isso seria mentir para o usuário; o indicador de staleness
 * é o que torna a latência honesta visível em vez de escondida.
 *
 * @module core/staleness
 */

/**
 * Até aqui o dado está dentro do que o pipeline promete: até 150s de
 * intervalo upstream mais até 60s de propagação eventual do KV. Pintar de
 * amarelo abaixo disso seria alarmar sobre o funcionamento normal.
 */
export const FRESH_MAX_MS = 210_000;

/** Acima daqui, provavelmente algo quebrou — faixa vermelha. */
export const WARN_MAX_MS = 7 * 60_000;

/**
 * Classifica a idade de um snapshot.
 *
 * @param {number} timestampMs
 *   `fetchedAtMs` do snapshot — o instante da busca upstream, não o da
 *   leitura do KV, que pode vir de cache.
 * @param {number} nowMs
 * @param {object} [options]
 * @param {number} [options.freshMaxMs=FRESH_MAX_MS]
 * @param {number} [options.warnMaxMs=WARN_MAX_MS]
 * @returns {import('./types.js').Staleness}
 */
export function isStale(timestampMs, nowMs, options = {}) {
  const { freshMaxMs = FRESH_MAX_MS, warnMaxMs = WARN_MAX_MS } = options;

  // Sem timestamp utilizável não há dado bom: vermelho, nunca verde por omissão.
  if (typeof timestampMs !== 'number' || !Number.isFinite(timestampMs)) {
    return { level: 'stale', ageMs: Number.POSITIVE_INFINITY };
  }

  // Relógio do cliente adiantado em relação ao Worker produziria idade
  // negativa e um "há -30s" na tela. Trava no zero.
  const ageMs = Math.max(0, nowMs - timestampMs);

  if (ageMs <= freshMaxMs) return { level: 'fresh', ageMs };
  if (ageMs <= warnMaxMs) return { level: 'warn', ageMs };
  return { level: 'stale', ageMs };
}
