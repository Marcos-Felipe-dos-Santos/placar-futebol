/**
 * Decisões de HTTP do Worker, separadas do runtime para poderem ser testadas.
 *
 * @module worker/http
 */

/** Requisições por IP na janela. */
export const RATE_LIMIT_MAX = 60;

/** Tamanho da janela deslizante. */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** A única rota servida. */
const LIVE_PATH = '/api/live';

/**
 * @typedef {{ok: true, route: 'live'}|{ok: false, status: 404|405, allow?: string}} RouteDecision
 */

/**
 * Decide se a requisição é atendida.
 *
 * Superfície mínima de propósito: existe **uma** rota, e nenhuma que um
 * visitante possa chamar para forçar uma busca upstream. Uma rota de
 * "atualizar agora" pareceria conveniente e seria um botão para queimar a
 * cota da chave — que é global — a partir de qualquer navegador do mundo.
 *
 * @param {string} method
 * @param {string} pathname
 * @returns {RouteDecision}
 */
export function routeRequest(method, pathname) {
  if (pathname !== LIVE_PATH) return { ok: false, status: 404 };

  // 405 e não 404: o caminho existe, o método é que não serve. Devolver 404
  // aqui mentiria sobre a superfície da API.
  if (method !== 'GET' && method !== 'HEAD') {
    return { ok: false, status: 405, allow: 'GET, HEAD' };
  }

  return { ok: true, route: 'live' };
}

/**
 * @typedef {{allowed: true}|{allowed: false, retryAfterMs: number}} RateLimitDecision
 */

/**
 * Janela deslizante por IP, em memória.
 *
 * LIMITAÇÃO CONHECIDA, e ela é real: o estado vive no isolate do Worker, que
 * é efêmero e existe em várias instâncias ao mesmo tempo. Isto **não** é um
 * limite global — é uma barreira barata contra o abuso trivial de uma única
 * origem. Um atacante distribuído passa por cima. A proteção que de fato
 * importa contra estouro de cota não é esta: é o fetch handler nunca chamar o
 * upstream, então nenhum volume de requisições ao Worker gasta requisição da
 * API-Football.
 *
 * @param {Map<string, number[]>} state  Mutado no lugar; é o cache do isolate.
 * @param {string|null|undefined} ip
 * @param {number} nowMs
 * @param {object} [options]
 * @param {number} [options.max=RATE_LIMIT_MAX]
 * @param {number} [options.windowMs=RATE_LIMIT_WINDOW_MS]
 * @returns {RateLimitDecision}
 */
export function checkRateLimit(state, ip, nowMs, options = {}) {
  const { max = RATE_LIMIT_MAX, windowMs = RATE_LIMIT_WINDOW_MS } = options;

  // IP ausente cai num bucket próprio em vez de ser liberado: liberar faria
  // do header omitido a forma óbvia de contornar o limite.
  const key = typeof ip === 'string' && ip !== '' ? ip : '(sem-ip)';
  const inicioJanela = nowMs - windowMs;

  // Poda global: sem isto o Map cresce enquanto o isolate viver.
  for (const [outroIp, marcas] of state) {
    if (outroIp === key) continue;
    if (marcas.length === 0 || marcas[marcas.length - 1] <= inicioJanela) state.delete(outroIp);
  }

  const marcas = (state.get(key) ?? []).filter((t) => t > inicioJanela);

  if (marcas.length >= max) {
    state.set(key, marcas);
    return { allowed: false, retryAfterMs: marcas[0] - inicioJanela };
  }

  marcas.push(nowMs);
  state.set(key, marcas);
  return { allowed: true };
}
