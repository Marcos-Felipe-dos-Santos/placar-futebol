/**
 * O envelope que vive no KV.
 *
 * Superconjunto do `Snapshot` do modelo interno: `applySnapshot` e `isStale`
 * consomem este objeto direto, sem tradução. Se essa compatibilidade quebrar,
 * o cliente passa a precisar de código de conversão e a fronteira vaza para o
 * PR 3 — há teste guardando isso.
 *
 * ## O que o envelope deliberadamente NÃO carrega
 *
 * O intervalo upstream vigente (`intervalMs` de `decideCronAction`). Ele é
 * interno ao portão — o motivo está em `core/gate.js` — e há teste exigindo
 * que não volte, porque prosa num typedef não impede ninguém de ler o número.
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
 * @property {string|null} reason
 *   Por que esta busca aconteceu — `'due'` (agenda conhecida) ou
 *   `'no-agenda'` (falhou aberto, buscando às cegas). `null` quando não foi
 *   registrado; segue a convenção de `quotaRemaining`, em que `null` é
 *   "desconhecido" e nunca um valor plausível.
 *
 *   CUIDADO com a união acima: snapshot gravado ANTES deste campo existir
 *   ainda está no KV e volta com `reason` **`undefined`**, não `null` —
 *   `parseSnapshot` não normaliza campo nenhum, e `SNAPSHOT_VERSION` não subiu
 *   porque nada consome isto ainda. A janela fecha na primeira gravação do
 *   cron. Quem ler o campo compara com o valor que espera; não confie em
 *   `=== null` para "não registrado".
 *
 *   Existe para a página avisar que a cobertura está reduzida quando o cron
 *   buscou sem agenda, em vez de mostrar uma grade curta e calada.
 *
 *   **Alcance real, para não prometer o que não entrega:** só motivos de
 *   busca BEM-SUCEDIDA chegam aqui, porque o cron não escreve nos tiques em
 *   que decide não buscar. Um snapshot parado carrega o motivo da última
 *   busca que deu certo, não o motivo de ter parado — para ESSA pergunta
 *   existe `toPublicCronState`, servido no campo `cron`. Ver `core/gate.js`.
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
    // Fallback explícito, como todo campo aqui: `undefined` no envelope some
    // no `JSON.stringify` e volta do KV indistinguível de campo que nunca
    // existiu. `null` diz "não registrado" e sobrevive à ida e volta.
    reason: typeof input.reason === 'string' && input.reason !== '' ? input.reason : null,
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

/**
 * O ESTADO DO CRON servido junto com o snapshot — a resposta para "por que o
 * dado não é novo?".
 *
 * ## Por que são duas fontes
 *
 * `snapshot.fetchedAtMs` responde "o dado é novo?". Este objeto responde "por
 * que não é?". Duas perguntas, dois relógios, duas chaves do KV — e é a
 * separação que torna a resposta possível: o snapshot só é escrito em busca
 * bem-sucedida, então ele **não pode** falar sobre o que impediu a próxima.
 * O `state` é escrito em toda tentativa real, inclusive fracassada.
 *
 * Expor isto NÃO cria escrita nova e não viola "nada de heartbeat": o dado já
 * está no KV; só não estava sendo servido.
 *
 * ## Os três casos parados que isto distingue
 *
 * - `consecutiveFailures > 0` → **quebrou**. O upstream está recusando.
 *   Sobrevive ao backoff: `registrarFalha` grava o contador junto com
 *   `backoffUntilMs`, e os tiques em que o cron desiste não escrevem nada.
 *   Zera no primeiro sucesso, que é o que se quer — o aviso some quando o
 *   pipeline volta.
 * - `quotaRemaining` baixo → **acabou a cota**. Com `quotaResetAtMs` do
 *   snapshot, a página diz a que horas volta.
 *
 *   **`null` aqui é "não sei", NUNCA "acabou"** — vem de estado escrito em
 *   outro dia UTC, e nesse caso a cota provavelmente já resetou. Quem
 *   renderizar tem de tratar o `null` como caso próprio; confundi-lo com
 *   número baixo anuncia cota esgotada com o dia inteiro disponível, que é
 *   exatamente o erro que a checagem de dia existe para evitar.
 * - nenhum dos dois → **não havia o que buscar**. O portão fechou porque não
 *   há jogo de interesse agora, e a página vazia está CERTA.
 *
 * ## O que NÃO é exposto, e por quê
 *
 * `spentToday` e `lastFetchAtMs` ficaram de fora: não distinguem nenhum dos
 * três casos acima e nada no PR 3 os renderiza. Campo que ninguém lê vira o
 * próximo `intervalMs` — entra "porque pode ser útil" e sai três meses depois
 * como régua de alguma coisa que ele não é.
 *
 * @param {unknown} raw  Valor cru da chave `state` do KV.
 * @param {string} todayKeyUTC
 *   Dia UTC de agora, `AAAA-MM-DD`. Entra por parâmetro porque o núcleo não
 *   lê relógio.
 * @returns {{consecutiveFailures: number, backoffUntilMs: number, quotaRemaining: number|null}|null}
 *   `null` quando não há estado legível — e `null` é obrigatório aqui, não
 *   uma conveniência: devolver um estado saudável inventado (zero falhas,
 *   cota cheia) afirmaria como fato algo que não se sabe. É o mesmo erro de
 *   confundir agenda `[]` com agenda `null`, e a página exibiria "tudo bem"
 *   sobre um pipeline morto.
 */
export function toPublicCronState(raw, todayKeyUTC) {
  let value = raw;

  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;

  const state = /** @type {any} */ (value);
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  // O livro-caixa vale para o dia UTC em que foi escrito. Depois do reset das
  // 21:00 BRT o `state` continua com o gasto de ontem até o cron buscar de
  // novo — e como ele só escreve quando busca, isso pode levar horas numa
  // noite sem jogo. Servir aquele número faria a página anunciar "cota
  // esgotada" com a cota inteira disponível: correta e vazia outra vez.
  const doDiaCorrente = typeof state.dayKeyUTC === 'string' && state.dayKeyUTC === todayKeyUTC;

  return {
    consecutiveFailures: num(state.consecutiveFailures),
    backoffUntilMs: num(state.backoffUntilMs),
    quotaRemaining: doDiaCorrente && typeof state.quotaRemaining === 'number'
      && Number.isFinite(state.quotaRemaining)
      ? state.quotaRemaining
      : null,
  };
}
