/**
 * O envelope que vive no KV.
 *
 * Superconjunto do `Snapshot` do modelo interno: `applySnapshot` e `isStale`
 * consomem este objeto direto, sem tradução. Se essa compatibilidade quebrar,
 * o cliente passa a precisar de código de conversão e a fronteira vaza para o
 * PR 3 — há teste guardando isso.
 *
 * @module core/snapshot
 */

/**
 * Versão do formato. `parseSnapshot` recusa o que não sabe ler, em vez de
 * interpretar campos às cegas.
 */
export const SNAPSHOT_VERSION = 1;

/**
 * @typedef  {object} StoredSnapshot
 * @property {number} version
 * @property {number} fetchedAtMs
 *   Instante em que o **upstream** respondeu — não o da leitura do KV, que
 *   pode vir de cache. É daqui que sai toda a conta de staleness.
 * @property {import('./types.js').Fixture[]} fixtures
 * @property {number|null} quotaRemaining
 *   Do header `x-ratelimit-requests-remaining`. `null` quando desconhecida —
 *   nunca `0`, que significaria cota esgotada e fecharia o portão o dia todo
 *   por causa de um header ausente.
 * @property {number|null} quotaResetAtMs
 * @property {number} discarded
 *   Partidas que a resposta trouxe e o adaptador não conseguiu converter.
 *   Chega até a UI do PR 3 como sinal visível, não log.
 * @property {number} upstreamCount
 *   Quantas partidas vieram na resposta. É o denominador de `discarded`: sem
 *   ele a UI diz "3 descartadas" sem poder dizer "de 19".
 * @property {boolean} truncated
 * @property {number} intervalMs  Intervalo upstream vigente quando gravado.
 */

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function toFiniteOrNull(value) {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * Monta o envelope a partir do que o handler do cron apurou.
 *
 * @param {object} input
 * @returns {StoredSnapshot}
 */
export function buildSnapshot(input) {
  return {
    version: SNAPSHOT_VERSION,
    fetchedAtMs: input.fetchedAtMs,
    // Cópia rasa: o array não pode continuar apontando para o do chamador,
    // senão uma mutação posterior reescreve o que já foi gravado.
    fixtures: Array.isArray(input.fixtures) ? [...input.fixtures] : [],
    // A conversão de header string acontece aqui, no limite do sistema. Se
    // vazar para `computePollInterval`, `'80'` vira 0 e o poll cala até o
    // reset.
    quotaRemaining: toFiniteOrNull(input.quotaRemaining),
    quotaResetAtMs: toFiniteOrNull(input.quotaResetAtMs),
    discarded: toFiniteOrNull(input.discarded) ?? 0,
    upstreamCount: toFiniteOrNull(input.upstreamCount) ?? 0,
    truncated: Boolean(input.truncated),
    intervalMs: toFiniteOrNull(input.intervalMs) ?? 0,
  };
}

/**
 * Lê o envelope do KV com desconfiança.
 *
 * Devolve `null` em vez de lançar: o fetch handler não pode derrubar a página
 * por causa de um valor estranho no KV. Ele serve o que tem, e o indicador de
 * staleness conta a verdade sobre a idade.
 *
 * @param {unknown} raw  String JSON ou objeto já parseado.
 * @returns {StoredSnapshot|null}
 */
export function parseSnapshot(raw) {
  let value = raw;

  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;

  const snapshot = /** @type {any} */ (value);

  if (snapshot.version !== SNAPSHOT_VERSION) return null;
  if (typeof snapshot.fetchedAtMs !== 'number' || !Number.isFinite(snapshot.fetchedAtMs)) return null;
  if (!Array.isArray(snapshot.fixtures)) return null;

  return snapshot;
}
