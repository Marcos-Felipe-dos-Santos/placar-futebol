/**
 * O portão do cron: decide se vale gastar uma requisição da cota.
 *
 * ## De onde vem a informação, e por que importa
 *
 * A pergunta "há jogo de interesse ao vivo agora?" é respondida pela
 * **AGENDA**, nunca por `live=all`. Perguntar ao `live=all` se vale a pena
 * chamar o `live=all` já gastou a requisição — o portão existiria mas não
 * economizaria nada, e ninguém notaria, porque tudo continuaria funcionando.
 * É o ponto do Worker mais fácil de implementar errado em silêncio.
 *
 * Por isso esta função recebe `agenda` — partidas com horário marcado, no
 * modelo interno — e deduz quem está em andamento comparando o `kickoffISO`
 * com o relógio. Nada aqui toca em rede.
 *
 * @module core/gate
 */

import { computePollInterval, hasUsableQuota } from './polling.js';

/**
 * Quanto tempo depois do apito inicial uma partida ainda pode estar rolando.
 *
 * 90 minutos mais intervalo e acréscimos dá cerca de 1h50. Prorrogação e
 * pênaltis levam a ~2h40. A janela cobre o mata-mata inteiro com folga:
 * encurtá-la mataria o alerta justamente na decisão de uma Libertadores.
 *
 * O custo de errar para mais é pequeno — no fim da janela o portão fecha
 * sozinho e, enquanto isso, `computePollInterval` continua limitando o gasto.
 */
export const MATCH_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * Há partida de interesse provavelmente em andamento?
 *
 * @param {ReadonlyArray<import('./types.js').Fixture>} agenda
 *   Partidas do dia, como a agenda as devolve.
 * @param {number} nowMs
 * @param {ReadonlySet<string>} leagueIds
 *   Ligas de interesse — normalmente `activeLeagueIds(...)` de `leagues.js`.
 * @param {object} [options]
 * @param {number} [options.windowMs=MATCH_WINDOW_MS]
 * @returns {boolean}
 */
export function hasMatchInProgress(agenda, nowMs, leagueIds, options = {}) {
  const { windowMs = MATCH_WINDOW_MS } = options;
  if (!Array.isArray(agenda) || !leagueIds) return false;

  for (const fixture of agenda) {
    if (!leagueIds.has(fixture?.leagueId)) continue;

    // `Date.parse` é função pura da string; o relógio entra por `nowMs`.
    const kickoffMs = Date.parse(fixture?.kickoffISO);
    if (!Number.isFinite(kickoffMs)) continue;

    if (nowMs >= kickoffMs && nowMs <= kickoffMs + windowMs) return true;
  }

  return false;
}

/**
 * @typedef  {object} CronDecision
 * @property {boolean} shouldFetch
 * @property {'due'|'no-live-match'|'too-soon'|'backoff'|'quota-exhausted'|'no-agenda-fail-open'} reason
 *   Por que buscou ou não. Vai para o snapshot: sem isto, "o cron não gastou
 *   cota hoje" é indistinguível de "o cron está quebrado".
 * @property {number} intervalMs  Intervalo upstream em uso agora.
 */

/**
 * Decide se o cron gasta uma requisição neste tique.
 *
 * A ordem das checagens é deliberada: backoff primeiro, porque erro upstream
 * tem que segurar a mão mesmo com o portão aberto; depois o portão; e a cota
 * por último, via `computePollInterval`, que é quem já sabe respeitar a
 * reserva da agenda, o piso mínimo e a margem do reset.
 *
 * @param {object} input
 * @param {number} input.nowMs
 * @param {ReadonlyArray<import('./types.js').Fixture>} input.agenda
 * @param {ReadonlySet<string>} input.leagueIds
 * @param {number} input.quotaRemaining
 * @param {number} input.msUntilReset
 * @param {number|null} input.lastFetchAtMs  `null` se nunca buscou.
 * @param {number} [input.backoffUntilMs]
 * @param {object} [options]  Repassadas a `computePollInterval`.
 * @returns {CronDecision}
 */
export function decideCronAction(input, options = {}) {
  const {
    nowMs,
    agenda,
    leagueIds,
    quotaRemaining,
    msUntilReset,
    lastFetchAtMs,
    backoffUntilMs = 0,
  } = input;

  const intervalMs = computePollInterval(
    { quotaRemaining, msUntilReset, hasLiveFavorite: true },
    options,
  );

  if (nowMs < backoffUntilMs) {
    return { shouldFetch: false, reason: 'backoff', intervalMs };
  }

  // Agenda AUSENTE não é agenda vazia, e confundi-las é a diferença entre uma
  // economia e um apagão. `[]` significa "consultei e não há jogo": portão
  // fecha, custo zero. `null` significa "não tenho a agenda" — e fechar aí
  // deixaria o Worker sem nunca buscar, com a página correta e vazia, que é
  // indistinguível de quebrada. Falha aberto, com o motivo no snapshot, e o
  // gasto continua limitado pelo orçamento de cota logo abaixo.
  const agendaDesconhecida = agenda == null;

  if (!agendaDesconhecida && !hasMatchInProgress(agenda, nowMs, leagueIds, options)) {
    return { shouldFetch: false, reason: 'no-live-match', intervalMs };
  }

  const motivo = agendaDesconhecida ? 'no-agenda-fail-open' : 'due';

  // A cota é perguntada, não inferida do intervalo. Inferir conflava "a cota
  // acabou" com "o reset está perto", e deixava um gap longo desde a última
  // busca furar a reserva da agenda.
  if (!hasUsableQuota(quotaRemaining, options)) {
    return { shouldFetch: false, reason: 'quota-exhausted', intervalMs };
  }

  // Nunca buscou: com cota disponível e portão aberto, busca agora.
  if (lastFetchAtMs === null || !Number.isFinite(lastFetchAtMs)) {
    return { shouldFetch: true, reason: motivo, intervalMs };
  }

  if (nowMs - lastFetchAtMs < intervalMs) {
    return { shouldFetch: false, reason: 'too-soon', intervalMs };
  }

  return { shouldFetch: true, reason: motivo, intervalMs };
}
