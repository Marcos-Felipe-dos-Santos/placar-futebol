/**
 * A agenda do dia no KV: como se guarda, como se lê, e quando vale gastar uma
 * requisição para renová-la.
 *
 * Funções puras. Tempo entra por parâmetro — o dia UTC corrente sempre vem de
 * fora, porque o núcleo não lê relógio.
 *
 * ## Por que a agenda existe
 *
 * O portão do cron precisa saber se há jogo de interesse hoje SEM gastar uma
 * requisição para descobrir. Perguntar ao `live=all` se vale a pena chamar
 * `live=all` já gastou a requisição. A agenda responde isso por uma
 * requisição por dia, tirada da reserva de 10.
 *
 * @module core/agenda
 */

/**
 * Teto de tentativas de buscar a agenda por dia UTC.
 *
 * A ARITMÉTICA, para o próximo leitor não achar que 3 é arbitrário: a reserva
 * é de 10 requisições/dia e a agenda precisa de UMA quando dá certo. Se o
 * upstream estiver fora do ar às 00:00 UTC, sem teto o portão "não tenho
 * agenda de hoje" continua aberto e o cron tenta a cada tique — 10 tentativas
 * em 10 minutos, reserva zerada, e aí `hasUsableQuota` fica `false` o dia
 * inteiro e o poll ao vivo morre junto. Com 3, o pior caso gasta 3 e deixa 7
 * intocadas.
 *
 * Não é 10 porque a reserva não existe para ser queimada em retentativa: ela
 * existe para a agenda de amanhã também caber num dia ruim.
 */
export const AGENDA_MAX_ATTEMPTS_PER_DAY = 3;

/**
 * Espaçamento mínimo entre tentativas de agenda no mesmo dia.
 *
 * Três tentativas coladas num minuto testam o mesmo instante de indisponi-
 * bilidade três vezes. Espaçadas, cobrem 30 minutos de instabilidade.
 */
export const AGENDA_RETRY_SPACING_MS = 15 * 60_000;

/**
 * Monta o que vai para a chave `agenda` do KV.
 *
 * O dia viaja JUNTO com as entradas, e não numa segunda chave: separá-los
 * criaria o instante em que uma foi gravada e a outra não, e aí a agenda de
 * ontem se apresentaria como a de hoje.
 *
 * @param {string} dayKeyUTC  Dia UTC que estas entradas cobrem, `AAAA-MM-DD`.
 * @param {ReadonlyArray<import('./types.js').AgendaEntry>} entries
 * @returns {{dayKeyUTC: string, entries: import('./types.js').AgendaEntry[]}}
 */
export function buildStoredAgenda(dayKeyUTC, entries) {
  return { dayKeyUTC, entries: [...entries] };
}

/**
 * Lê a agenda do KV, com desconfiança e com a data em conta.
 *
 * ## `null` e `[]` não são a mesma coisa, e aqui a diferença é o produto
 *
 * - `[]` — a agenda de HOJE foi consultada e não há jogo. O portão fecha e o
 *   custo é zero. É a terça sem jogo brasileiro.
 * - `null` — não se sabe. O sistema **falha aberto**: `activeLeagueIds(null)`
 *   devolve o interesse inteiro e o cron volta a poder buscar.
 *
 * ## AGENDA DE ONTEM É `null`, NUNCA `[]`
 *
 * É o caso que mais importa desta função. Os kickoffs de ontem estão 24h no
 * passado, muito fora da janela de 3h de `hasMatchInProgress`, então usar a
 * agenda de ontem como se fosse a de hoje faria o portão responder "não há
 * jogo agora" **o dia inteiro** — página correta e vazia, sem um erro sequer
 * na tela, que é o pior modo de falha deste projeto. Dia diferente é
 * desconhecimento, e desconhecimento falha aberto.
 *
 * Um array cru — o formato que a chave teve antes de carregar o dia — cai na
 * mesma regra: sem dia associado não dá para afirmar que é de hoje.
 *
 * @param {unknown} raw  Valor cru da chave `agenda` do KV.
 * @param {string} todayKeyUTC
 * @returns {import('./types.js').AgendaEntry[]|null}
 */
export function parseStoredAgenda(raw, todayKeyUTC) {
  let value = raw;

  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;

  const guardado = /** @type {any} */ (value);

  if (typeof guardado.dayKeyUTC !== 'string' || guardado.dayKeyUTC !== todayKeyUTC) return null;
  if (!Array.isArray(guardado.entries)) return null;

  return guardado.entries;
}

/**
 * @typedef  {object} AgendaDecision
 * @property {boolean} shouldFetch
 * @property {'due'|'agenda-current'|'no-quota'|'attempts-exhausted'|'too-soon'} reason
 *   Diagnóstico deste portão. NÃO vai para o cliente: o que a página mostra
 *   quando falta agenda é o `reason: 'no-agenda'` do snapshot, que já existe e
 *   já é servido.
 */

/**
 * Vale gastar uma requisição da reserva para renovar a agenda?
 *
 * ## O portão é a virada do dia, sem segundo relógio
 *
 * A condição é "não tenho agenda para o dia UTC corrente". Ela passa a valer
 * sozinha às 00:00 UTC — 21:00 BRT, o reset da cota —, que é exatamente o
 * momento desejado: a agenda cobre o dia UTC corrente, então buscá-la no
 * começo dele dá cobertura máxima por uma requisição. Não há checagem de
 * horário aqui, e não deve haver: um segundo relógio divergiria do
 * `dayKeyUTC` que já governa o livro-caixa.
 *
 * ## A cota é perguntada com régua PRÓPRIA
 *
 * `quotaRemaining > 0`, e **nunca** `hasUsableQuota` — que subtrai a reserva.
 * A reserva existe justamente para que a agenda possa gastar quando o poll ao
 * vivo já não pode; medi-la com a régua do poll faria a agenda nunca ser
 * buscada dentro da própria reserva, e o cron ficaria em fail-open para
 * sempre gastando mais do que a agenda custaria.
 *
 * @param {object} input
 * @param {number} input.nowMs
 * @param {boolean} input.hasAgendaForToday
 * @param {number} input.quotaRemaining  Do livro-caixa, não do header cru.
 * @param {number} input.attemptsToday   Tentativas já feitas no dia UTC corrente.
 * @param {number|null} input.lastAttemptAtMs
 * @param {object} [options]
 * @param {number} [options.maxAttempts=AGENDA_MAX_ATTEMPTS_PER_DAY]
 * @param {number} [options.spacingMs=AGENDA_RETRY_SPACING_MS]
 * @returns {AgendaDecision}
 */
export function decideAgendaFetch(input, options = {}) {
  const {
    maxAttempts = AGENDA_MAX_ATTEMPTS_PER_DAY,
    spacingMs = AGENDA_RETRY_SPACING_MS,
  } = options;
  const { nowMs, hasAgendaForToday, quotaRemaining, attemptsToday, lastAttemptAtMs } = input;

  if (hasAgendaForToday) return { shouldFetch: false, reason: 'agenda-current' };

  // Sem cota NENHUMA não há o que gastar. Note que a comparação é com zero, e
  // não com a reserva: ver o contrato acima.
  if (!Number.isFinite(quotaRemaining) || quotaRemaining <= 0) {
    return { shouldFetch: false, reason: 'no-quota' };
  }

  if (attemptsToday >= maxAttempts) {
    return { shouldFetch: false, reason: 'attempts-exhausted' };
  }

  if (
    typeof lastAttemptAtMs === 'number'
    && Number.isFinite(lastAttemptAtMs)
    && nowMs - lastAttemptAtMs < spacingMs
  ) {
    return { shouldFetch: false, reason: 'too-soon' };
  }

  return { shouldFetch: true, reason: 'due' };
}
