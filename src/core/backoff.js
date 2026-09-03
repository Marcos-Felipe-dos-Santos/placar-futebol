/**
 * Espera após erro do upstream.
 *
 * Escada exponencial com teto, e um caso especial para 429 que não é
 * exponencial de propósito.
 *
 * @module core/backoff
 */

/** Primeiro degrau. 15s → 30s → 60s → 120s → … */
export const BACKOFF_BASE_MS = 15_000;

/** Teto da escada. Acima disso a espera não cresce mais. */
export const BACKOFF_MAX_MS = 15 * 60_000;

/**
 * Quanto esperar antes da próxima tentativa upstream.
 *
 * @param {number} failures  Falhas consecutivas. `0` significa "nenhuma".
 * @param {object} [options]
 * @param {boolean} [options.rateLimited=false]
 *   A última resposta foi 429. Aqui a escada é ignorada e a espera vai direto
 *   ao teto.
 *
 *   O motivo não é a cota, é o acesso: a API-Football corta pico anormal de
 *   tráfego **sem aviso prévio**. Um 429 não é "erro transitório, tenta em
 *   15s" — é o provedor dizendo que já estamos batendo demais. Voltar em 15
 *   segundos é a forma mais rápida de perder a chave, e uma chave perdida não
 *   se recupera esperando.
 * @returns {number} Inteiro em ms, nunca negativo.
 */
export function nextBackoffMs(failures, options = {}) {
  const n = typeof failures === 'number' && Number.isFinite(failures) ? Math.floor(failures) : 0;
  if (n <= 0) return 0;

  if (options.rateLimited) return BACKOFF_MAX_MS;

  const ms = BACKOFF_BASE_MS * 2 ** (n - 1);
  return Math.min(ms, BACKOFF_MAX_MS);
}
