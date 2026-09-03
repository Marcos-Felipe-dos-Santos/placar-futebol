/**
 * Regra de dedupe do alerta sonoro.
 *
 * Esta é a única fonte de verdade sobre "esse gol já tocou?". A UI do PR 5
 * consome daqui e não reimplementa nada — duas regras de dedupe divergentes
 * seriam a forma mais fácil de produzir alerta duplo em produção.
 *
 * @module core/alerts
 */

/**
 * Por quanto tempo a memória de um gol já alertado vale.
 *
 * Precisa cobrir uma partida inteira com folga: se expirasse antes do fim do
 * jogo, uma correção do provedor (2 → 1 → 2) poderia realertar o mesmo gol.
 * Cobre prorrogação, pênaltis e atraso de provedor sem risco de supressão
 * indevida, porque a chave inclui o placar resultante e dois gols distintos
 * nunca colidem.
 *
 * ATENÇÃO: este TTL só faz `shouldAlert` IGNORAR entrada velha — ele não
 * remove nada. Não existe poda aqui, então o registro cresce monotonamente.
 * Quem persistir isso (PR 5, localStorage) precisa podar; o lugar certo para
 * a poda é este módulo, como função pura, quando houver um consumidor.
 */
export const ALERT_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Identidade de um gol, estável entre polls.
 *
 * A chave inclui o placar resultante, e não um contador: se o provedor
 * corrigir 2 → 1 e depois voltar para 2, a chave é a mesma e o alerta não
 * repete. Dois gols de verdade produzem chaves diferentes porque o placar
 * resultante avança.
 *
 * @param {import('./types.js').GoalEvent} event
 * @returns {string}
 */
export function eventKey(event) {
  return `${event.fixtureId}:${event.side}:${event.goalsAfter}`;
}

/**
 * Decide se este gol deve produzir som e animação agora.
 *
 * Puro: não escreve no registro de alertados. Quem alerta é que grava a
 * chave, com o instante atual.
 *
 * @param {import('./types.js').GoalEvent} event
 * @param {object} options
 * @param {Record<string, number>} [options.alerted={}]
 *   Chaves já alertadas → epoch em ms de quando tocaram.
 * @param {number} options.nowMs
 * @param {number} [options.ttlMs=ALERT_TTL_MS]
 * @param {boolean} [options.enabled=true]
 *   `false` antes do usuário liberar o áudio (política de autoplay do
 *   navegador). Sem liberação, nada soa — nem se acumula como "pendente".
 * @returns {boolean}
 */
export function shouldAlert(event, options) {
  const {
    alerted = {},
    nowMs,
    ttlMs = ALERT_TTL_MS,
    enabled = true,
  } = options ?? {};

  if (!enabled) return false;

  // Defesa contra um evento malformado chegando de outro caminho: alerta é
  // sobre gol, e gol é aumento de placar.
  if (!(event.goalsAfter > event.goalsBefore)) return false;

  const alertedAtMs = alerted[eventKey(event)];
  if (typeof alertedAtMs !== 'number') return true;

  return nowMs - alertedAtMs > ttlMs;
}
