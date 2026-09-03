/**
 * Detecção de gols entre dois snapshots.
 *
 * A regra central é conservadora por desenho: na dúvida, atualiza o estado em
 * silêncio. Um gol perdido é um incômodo; um alerta falso — ou seis alertas
 * de uma vez ao voltar para uma aba suspensa — destrói a confiança na página.
 *
 * @module core/diff
 */

/**
 * Acima deste intervalo entre snapshots, a diferença é tratada como
 * ressincronização: o estado avança, nenhum evento sai.
 *
 * O piso é o pior caso honesto do pipeline — até 150s de intervalo upstream
 * mais até 60s de propagação eventual do KV, ou seja 210s. O valor escolhido
 * dá quase 3x de folga sobre isso, e ainda assim fica muito abaixo de uma aba
 * dormindo por horas, que é o caso que precisa ser silenciado.
 */
export const RESYNC_GAP_MS = 10 * 60 * 1000;

/** Status cujo placar não merece confiança para gerar alerta. */
const UNTRUSTED_STATUS = new Set(['cancelled']);

/**
 * Um placar só é comparável quando os dois lados são números finitos.
 * `null` significa "desconhecido", nunca zero — é o que impede que o
 * `null → 0` do apito inicial vire um gol fantasma.
 *
 * @param {unknown} value
 * @returns {value is number}
 */
function isKnownScore(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Compara dois snapshots e devolve os gols observados no intervalo.
 *
 * @param {import('./types.js').Snapshot|null|undefined} prevSnapshot
 *   Estado anterior. Ausente ou vazio significa "primeira leitura": nenhuma
 *   partida tem linha de base, então nada é evento.
 * @param {import('./types.js').Snapshot} nextSnapshot  Estado novo.
 * @param {object} [options]
 * @param {number} [options.resyncGapMs=RESYNC_GAP_MS]
 *   Acima deste gap entre `fetchedAtMs`, atualiza em silêncio.
 * @returns {import('./types.js').GoalEvent[]}
 *   Eventos na ordem: partidas na ordem do snapshot novo, casa antes de
 *   visitante. Lista vazia é o caso normal.
 */
export function diffFixtures(prevSnapshot, nextSnapshot, options = {}) {
  const { resyncGapMs = RESYNC_GAP_MS } = options;

  const prevFixtures = prevSnapshot?.fixtures;
  const nextFixtures = nextSnapshot?.fixtures;
  if (!Array.isArray(prevFixtures) || !Array.isArray(nextFixtures)) return [];
  if (prevFixtures.length === 0 || nextFixtures.length === 0) return [];

  const gapMs = nextSnapshot.fetchedAtMs - prevSnapshot.fetchedAtMs;
  if (!Number.isFinite(gapMs) || gapMs > resyncGapMs) return [];

  const previousById = new Map(prevFixtures.map((fixture) => [fixture.id, fixture]));

  /** @type {import('./types.js').GoalEvent[]} */
  const events = [];

  for (const fixture of nextFixtures) {
    // Partida nunca vista antes não tem linha de base — o placar dela, seja
    // qual for, é o ponto de partida e não um acontecimento.
    const before = previousById.get(fixture.id);
    if (before === undefined) continue;

    if (UNTRUSTED_STATUS.has(fixture.status)) continue;

    for (const side of /** @type {const} */ (['home', 'away'])) {
      const field = side === 'home' ? 'homeGoals' : 'awayGoals';
      const goalsBefore = before[field];
      const goalsAfter = fixture[field];

      if (!isKnownScore(goalsBefore) || !isKnownScore(goalsAfter)) continue;
      // Só aumento é gol. Queda é correção do provedor: o estado avança
      // porque o chamador guarda o snapshot novo, mas nada soa.
      if (goalsAfter <= goalsBefore) continue;

      events.push({
        fixtureId: fixture.id,
        side,
        goalsBefore,
        goalsAfter,
        detectedAtMs: nextSnapshot.fetchedAtMs,
        fixture,
      });
    }
  }

  return events;
}
