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
 * @param {ReadonlyArray<import('./types.js').AgendaEntry>} agenda
 *   Partidas do dia, como a agenda as devolve.
 *
 *   `AgendaEntry` e não `Fixture`: esta função lê `leagueId` e `kickoffISO`, e
 *   nada mais. Pedir `Fixture` obrigaria a chave `agenda` do KV a guardar
 *   placar, nome de time e logo que ninguém aqui consulta — 421 KB contra
 *   26,6 KB, medido. Uma `Fixture` continua servindo, porque tem os dois
 *   campos; o contrato é que o mínimo basta.
 *
 *   ATENÇÃO ao que esta função NÃO sabe: ela abre pela janela de kickoff, não
 *   por status. Partida que já terminou dentro da janela de 3h ainda conta
 *   como em andamento. O adaptador da agenda derruba as que já estavam
 *   encerradas na hora da captura, o que ESTREITA o vazamento sem fechá-lo —
 *   uma partida que termina depois da captura permanece. Fechar exigiria
 *   status no momento do portão, e é justamente isso que custaria outra
 *   requisição.
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
 * @property {'due'|'no-agenda'|'no-live-match'|'too-soon'|'backoff'|'quota-exhausted'} reason
 *   Por que buscou ou não.
 *
 *   **Só os dois primeiros chegam ao snapshot, e é estrutural.**
 *   `buildSnapshot` só roda sob `shouldFetch: true`, e os quatro motivos de
 *   NÃO buscar são exatamente os tiques em que o cron não escreve nada no KV
 *   (nada de heartbeat — ver `worker.js`). Então:
 *
 *   - `'due'` — busca normal, agenda conhecida. A página não precisa dizer
 *     nada.
 *   - `'no-agenda'` — buscou SEM a agenda do dia, porque falhar fechado
 *     apagaria a página o dia inteiro. Este é o que a UI do PR 3 renderiza:
 *     "sem a agenda do dia, buscando às cegas" — cobertura reduzida, não
 *     página vazia sem explicação. O nome era `no-agenda-fail-open`;
 *     "fail-open" é jargão de quem escreveu o portão, não de quem lê a
 *     página.
 *   - `'no-live-match'`, `'too-soon'`, `'backoff'`, `'quota-exhausted'` —
 *     diagnóstico interno, para quem lê ESTA decisão. Nunca aparecem em
 *     snapshot nenhum, então não foram renomeados pensando na tela.
 *
 *   **O que este campo NÃO responde:** por que o snapshot está parado. Um
 *   snapshot velho carrega o motivo da última busca BEM-SUCEDIDA, não o
 *   motivo de ter parado. Distinguir "acabou a cota" de "quebrou" precisa da
 *   chave `state` do KV, que não é servida ao cliente hoje.
 * @property {number} intervalMs
 *   Intervalo upstream em uso agora. **Interno ao portão: NÃO exportar ao
 *   cliente.**
 *
 *   Ele codifica duas coisas no mesmo número — o ritmo desejado e o freio da
 *   cota. Com `quotaRemaining: 11` este intervalo vale 3 HORAS, e a busca
 *   acontece assim mesmo, porque `hasUsableQuota(11)` é `true`. Um cliente
 *   que recebesse o número e fizesse "considere fresco até
 *   `fetchedAtMs + intervalMs`" pintaria verde por três horas.
 *
 *   Para frescor existe `isStale`, com `FRESH_MAX_MS` próprio. Foi a mesma
 *   confusão — "a cota acabou" contra "o reset está perto" no mesmo número —
 *   que furou a reserva da agenda no portão do cron. Por isso o campo saiu do
 *   envelope do KV: prosa num typedef não impede ninguém de ler o número, um
 *   campo ausente impede.
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

  // Agenda AUSENTE não é agenda vazia (ver abaixo). Aqui a distinção também
  // muda o RITMO: sem saber se há jogo, o poll usa o ritmo ocioso. Medido, no
  // ritmo ativo um dia sem agenda queima as 90 requisições até o meio-dia e
  // deixa a noite — quando o usuário assiste — descoberta. Incerteza polla
  // devagar; certeza polla rápido.
  const agendaDesconhecida = agenda == null;

  const intervalMs = computePollInterval(
    { quotaRemaining, msUntilReset, hasLiveFavorite: !agendaDesconhecida },
    options,
  );

  if (nowMs < backoffUntilMs) {
    return { shouldFetch: false, reason: 'backoff', intervalMs };
  }

  // `[]` significa "consultei e não há jogo": portão fecha, custo zero.
  // `null` significa "não tenho a agenda" — e fechar aí deixaria o Worker sem
  // nunca buscar, com a página correta e vazia, que é indistinguível de
  // quebrada. Falha aberto, e o motivo (`'no-agenda'`) vai no snapshot para a
  // página poder dizer que está buscando às cegas.
  if (!agendaDesconhecida && !hasMatchInProgress(agenda, nowMs, leagueIds, options)) {
    return { shouldFetch: false, reason: 'no-live-match', intervalMs };
  }

  const motivo = agendaDesconhecida ? 'no-agenda' : 'due';

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
