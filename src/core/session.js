/**
 * O contrato único do núcleo.
 *
 * `diffFixtures`, `shouldAlert` e `keepLatestSnapshot` continuam exportadas e
 * testadas individualmente, mas ninguém precisa sequenciá-las. Sequenciar era
 * o problema: a ordem certa é diffar contra o estado anterior, filtrar pelo
 * dedupe, registrar o que alertou e só então avançar o estado — e trocar
 * qualquer passo de lugar reintroduz o alerta falso da réplica atrasada do
 * KV. Um contrato que depende do chamador acertar a ordem não fecha o furo,
 * só o empurra para a camada seguinte.
 *
 * O PR 3 consome só `applySnapshot`.
 *
 * @module core/session
 */

import { diffFixtures, keepLatestSnapshot, RESYNC_GAP_MS } from './diff.js';
import { shouldAlert, eventKey, ALERT_TTL_MS } from './alerts.js';

/**
 * Estado que o cliente carrega entre leituras. Opaco: veio de
 * `applySnapshot`, volta para `applySnapshot`.
 *
 * @typedef  {object} CoreState
 * @property {import('./types.js').Snapshot|null} snapshot
 *   Último snapshot aceito. Nunca uma leitura mais antiga que a anterior.
 * @property {Record<string, number>} alerted
 *   Gols já alertados → epoch em ms. Mantido aqui, e não pelo chamador, para
 *   que não exista caminho em que o evento é emitido e a chave não é gravada.
 */

/**
 * Resultado de uma leitura.
 *
 * @typedef  {object} ApplyResult
 * @property {CoreState} state
 *   Novo estado. Sempre use este; o anterior não foi modificado.
 * @property {import('./types.js').GoalEvent[]} events
 *   Gols que devem alertar AGORA — já passaram pelo dedupe e pelo bloqueio de
 *   áudio. Emitir som para cada um é a única coisa que o chamador faz.
 * @property {boolean} resynced
 *   Houve ressincronização silenciosa: o gap entre leituras passou do limiar
 *   e os placares avançaram sem alerta.
 * @property {number} swallowedGoals
 *   Quantos GOLS (não partidas) a ressincronização engoliu.
 *
 *   REQUISITO EXPLÍCITO DO PR 3: quando `resynced` é `true`, a UI precisa
 *   dizer algo como "2 gols podem ter sido perdidos" em vez de voltar ao
 *   verde em silêncio. Sem esse aviso, um atraso de 12 minutos do cron do
 *   Cloudflare deixa o usuário vendo 2-0 onde deixou 0-0, sem nada que
 *   explique. `resynced: true` com `swallowedGoals: 0` é o caso "houve
 *   buraco, mas nada se perdeu" e merece texto diferente.
 */

/**
 * Processa uma leitura do Worker e devolve o novo estado mais o que aconteceu.
 *
 * @param {CoreState|null|undefined} prevState
 *   `null` na primeira leitura da sessão.
 * @param {import('./types.js').Snapshot} nextSnapshot
 *   O snapshot recém-lido de `/api/live`.
 * @param {object} [opts]
 * @param {number} [opts.resyncGapMs=RESYNC_GAP_MS]
 * @param {boolean} [opts.soundEnabled=true]
 *   `false` antes do usuário liberar o áudio. Nada é emitido e nada fica
 *   pendente: liberar o som no minuto 80 não dispara os gols do primeiro tempo.
 * @param {number} [opts.ttlMs=ALERT_TTL_MS]
 * @param {number} [opts.nowMs]
 *   Instante para o dedupe. Por padrão o `fetchedAtMs` do snapshot, que é
 *   quando o gol foi de fato observado.
 * @returns {ApplyResult}
 */
export function applySnapshot(prevState, nextSnapshot, opts = {}) {
  const {
    resyncGapMs = RESYNC_GAP_MS,
    soundEnabled = true,
    ttlMs = ALERT_TTL_MS,
    nowMs,
  } = opts;

  const prevSnapshot = prevState?.snapshot ?? null;
  const prevAlerted = prevState?.alerted ?? {};

  // Leitura fora de ordem: descartada por inteiro. Não é ressincronização —
  // nenhuma informação se perdeu, só chegou uma réplica velha do KV. Avisar
  // "gols podem ter sumido" aqui seria alarme falso.
  if (keepLatestSnapshot(prevSnapshot, nextSnapshot) !== nextSnapshot) {
    return {
      state: { snapshot: prevSnapshot, alerted: prevAlerted },
      events: [],
      resynced: false,
      swallowedGoals: 0,
    };
  }

  const state = { snapshot: nextSnapshot, alerted: prevAlerted };
  const gapMs = prevSnapshot ? nextSnapshot.fetchedAtMs - prevSnapshot.fetchedAtMs : Number.NaN;

  if (Number.isFinite(gapMs) && gapMs > resyncGapMs) {
    // Refaz o diff sem o portão de gap só para CONTAR o que foi engolido.
    // Nada disso alerta; serve para a UI poder ser honesta sobre o buraco.
    const engolidos = diffFixtures(prevSnapshot, nextSnapshot, {
      resyncGapMs: Number.POSITIVE_INFINITY,
    });
    const swallowedGoals = engolidos.reduce(
      (total, evento) => total + (evento.goalsAfter - evento.goalsBefore),
      0,
    );
    return { state, events: [], resynced: true, swallowedGoals };
  }

  const detectados = diffFixtures(prevSnapshot, nextSnapshot, { resyncGapMs });
  const detectedAtMs = Number.isFinite(nowMs) ? nowMs : nextSnapshot.fetchedAtMs;

  /** @type {import('./types.js').GoalEvent[]} */
  const events = [];
  const alerted = { ...prevAlerted };

  for (const evento of detectados) {
    // O dedupe consulta o registro que está sendo ACUMULADO, não o anterior.
    // Hoje as chaves são únicas por lote — cada par (partida, lado) gera no
    // máximo um evento — então os dois dariam no mesmo. Mas se o provedor um
    // dia repetir uma partida no mesmo snapshot, isso é a diferença entre um
    // som e dois.
    if (shouldAlert(evento, { alerted, nowMs: detectedAtMs, ttlMs, enabled: soundEnabled })) {
      alerted[eventKey(evento)] = detectedAtMs;
      events.push(evento);
    }
  }

  return { state: { snapshot: nextSnapshot, alerted }, events, resynced: false, swallowedGoals: 0 };
}
