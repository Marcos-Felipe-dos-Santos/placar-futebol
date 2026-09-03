/**
 * Orçamento de cota: de quanto em quanto tempo o cron pode gastar uma
 * requisição da API-Football.
 *
 * ESCOPO — este é o intervalo UPSTREAM. O navegador bate em `/api/live` num
 * intervalo próprio, constante e sem custo de cota (limitado pelas 100k
 * requisições/dia do Worker, não pela API-Football). Os dois números não se
 * misturam e não saem daqui.
 *
 * INTERPRETAÇÃO DA REGRA "nunca estourar a cota": a garantia implementada é
 * que a reserva da agenda nunca é consumida pelo poll ao vivo, e que o ritmo
 * degrada conforme a cota some. A cota NÃO é diluída uniformemente até o
 * reset — fazer isso destruiria o produto (ver `LIVE_WINDOW_MS`).
 *
 * @module core/polling
 */

const HOUR_MS = 60 * 60 * 1000;

/** Ritmo mais rápido autorizado com jogo ao vivo. Piso da banda 120–150s. */
export const ACTIVE_INTERVAL_MS = 120_000;

/**
 * Piso absoluto, que não deriva de `options`.
 *
 * O ritmo normal já é limitado por `ACTIVE_INTERVAL_MS`, mas aquele piso vem
 * de `options.activeMs` e some se o chamador sobrescrever a opção. Este aqui
 * não sai do caminho: com a cota grande e o reset a segundos de distância, a
 * conta de sustentabilidade tende a zero e sem trava dura o cron dispararia
 * uma rajada. A API-Football corta picos anormais de tráfego sem aviso, e
 * perder a chave custa mais caro do que perder alguns minutos de cobertura.
 */
export const MIN_INTERVAL_MS = 60_000;

/**
 * Ritmo sem nenhum jogo ao vivo de interesse. Serve só para perceber que uma
 * partida começou; é aqui que a cota é preservada para quando importa.
 */
export const IDLE_INTERVAL_MS = 15 * 60_000;

/**
 * Janela sobre a qual a cota utilizável é distribuída.
 *
 * Não é o tempo até o reset, e essa é a decisão de projeto mais importante
 * deste arquivo. Diluir ~80 requisições pelas 24h até o reset dá um poll a
 * cada ~18 minutos — e um jogo que começa 21:30 BRT, logo depois do reset das
 * 21:00, seria acompanhado com latência de 18 minutos. Inútil.
 *
 * A cota é um orçamento para uma janela de jogo, não uma média diária. 3h é a
 * cobertura prometida no README, e 80 requisições em 3h dão 135s — exatamente
 * a banda de 120–150s do projeto.
 */
export const LIVE_WINDOW_MS = 3 * HOUR_MS;

/** Requisições/dia guardadas para a agenda, fora do alcance do poll ao vivo. */
export const AGENDA_RESERVE = 10;

/**
 * Folga somada ao agendamento pós-reset.
 *
 * Bater no milissegundo exato do reset aposta que o relógio do Worker e o da
 * API-Football concordam. Se a API estiver alguns segundos atrás, a
 * requisição cai na janela pré-reset e volta 429 — e a próxima leitura de
 * cota viria de uma resposta de erro.
 */
export const RESET_MARGIN_MS = 30_000;

/**
 * @param {unknown} value
 * @returns {number} O número, ou 0 se não for finito.
 */
function finiteOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Intervalo até a próxima chamada upstream, em ms.
 *
 * @param {object} input
 * @param {number} input.quotaRemaining
 *   Requisições restantes na cota diária, lidas do header
 *   `x-ratelimit-requests-remaining` da última resposta upstream.
 *
 *   OBRIGAÇÃO DO PR 2: headers HTTP são strings. `'80'` não é `80` — cai no
 *   saneamento como zero, a cota parece esgotada e o poll ao vivo silencia
 *   até o reset, potencialmente por 24h. A direção da falha é segura (nunca
 *   gasta demais), mas o produto morre calado. O Worker é obrigado a fazer
 *   `Number(header)` e a tratar header ausente ou não numérico
 *   explicitamente, em vez de repassar o que veio.
 * @param {number} input.msUntilReset  Tempo até o reset da cota (00:00 UTC).
 * @param {boolean} input.hasLiveFavorite
 *   PREMISSA DE PORTÃO, NÃO MODIFICADOR DE RITMO.
 *
 *   O contrato com o PR 2 é: quando `false`, o handler do cron NÃO chama o
 *   upstream. O `IDLE_INTERVAL_MS` devolvido aqui é só o intervalo com que o
 *   portão volta a ser reavaliado — não uma autorização para gastar cota mais
 *   devagar.
 *
 *   Tratar isso como modificador é o jeito mais fácil de arruinar o dia: os
 *   jogos da manhã de domingo consumiriam a janela de 3h e a noite, que é
 *   quando você está assistindo, ficaria descoberta. A cota só se move quando
 *   há partida ao vivo de interesse.
 *
 *   "De interesse" tem definição precisa e ela mora em `core/leagues.js`:
 *   partida ao vivo em `DEFAULT_LEAGUE_IDS` ou em liga favoritada pelo
 *   usuário — não qualquer uma das 1237 ligas que `live=all` devolve. Numa
 *   terça sem jogo brasileiro isso é `false` o dia todo e o custo é zero,
 *   mesmo com centenas de partidas ao vivo no mundo.
 * @param {object} [options]
 * @param {number} [options.reserve=AGENDA_RESERVE]
 * @param {number} [options.activeMs=ACTIVE_INTERVAL_MS]
 * @param {number} [options.idleMs=IDLE_INTERVAL_MS]
 * @param {number} [options.liveWindowMs=LIVE_WINDOW_MS]
 * @returns {number}
 *   Inteiro positivo e finito. Quando a cota utilizável acabou, devolve um
 *   valor que joga a próxima tentativa para depois do reset.
 */
export function computePollInterval(input, options = {}) {
  const {
    reserve = AGENDA_RESERVE,
    activeMs = ACTIVE_INTERVAL_MS,
    idleMs = IDLE_INTERVAL_MS,
    liveWindowMs = LIVE_WINDOW_MS,
  } = options;

  const quotaRemaining = finiteOrZero(input?.quotaRemaining);
  const msUntilReset = Math.max(0, finiteOrZero(input?.msUntilReset));
  const usableQuota = Math.floor(quotaRemaining - reserve);

  // Reserva da agenda intocável: nada de poll ao vivo até o reset, e com
  // folga para não disputar o milissegundo do reset com o relógio da API.
  if (usableQuota <= 0) {
    return Math.max(msUntilReset + RESET_MARGIN_MS, activeMs, MIN_INTERVAL_MS);
  }

  const desiredMs = input?.hasLiveFavorite ? activeMs : idleMs;

  // A cota utilizável é espalhada pela janela de jogo — ou pelo que resta até
  // o reset, o que for menor. Perto do reset a janela encolhe e o ritmo pode
  // acelerar até o piso ativo, porque a cota vira abóbora de qualquer forma.
  const budgetWindowMs = Math.min(msUntilReset, liveWindowMs);
  const sustainableMs = budgetWindowMs / usableQuota;

  return Math.max(desiredMs, Math.ceil(sustainableMs), MIN_INTERVAL_MS);
}
