/** @module core/alerts */
/** @param {import('./types.js').GoalEvent} event @returns {string} */
export function eventKey(event) {
  throw new Error('not implemented');
}
/** @param {import('./types.js').GoalEvent} event @param {object} [options] @returns {boolean} */
export function shouldAlert(event, options) {
  throw new Error('not implemented');
}
export const ALERT_TTL_MS = 0;
