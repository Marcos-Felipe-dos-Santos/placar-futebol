/**
 * Cloudflare Worker: cron busca, KV guarda, navegador lê.
 *
 * ## A regra que define este arquivo
 *
 * **O fetch handler NUNCA chama o upstream.** Nem em cache miss, nem em erro,
 * nem na primeira visita, nem "só desta vez". A cota da API-Football é de 100
 * requisições/dia **globais da chave** — não por cliente —, então qualquer
 * caminho que ligue uma visita a uma requisição upstream transforma tráfego
 * em custo global. Uma aba pollando a 60s consumiria o dia inteiro em menos
 * de um jogo.
 *
 * A separação é estrutural, não uma promessa: `handleFetch` não importa nada
 * que fale com a rede, e há teste que substitui o `fetch` global por um espião
 * e exige zero chamadas em cache miss, KV corrompido, KV fora do ar, rota
 * inválida e método inválido.
 *
 * ## Chaves do KV, e por que são duas
 *
 * - `snapshot` — o último resultado BOM. Só é sobrescrito quando uma busca
 *   deu certo. Erro upstream nunca toca aqui: o último snapshot válido é
 *   sempre preservado, com a hora explícita dele.
 * - `state` — cota, última busca, falhas consecutivas, backoff. Escrito
 *   sempre que houve uma tentativa real de busca, inclusive fracassada —
 *   porque a tentativa gastou cota e isso precisa ser lembrado.
 * - `agenda` — partidas do dia, que alimentam o portão do cron.
 *
 * **Escrita no KV só acontece quando houve busca real.** Tique que decide não
 * gastar cota não escreve nada. Se escrevesse, o timestamp mentiria sobre o
 * frescor e o `isStale` do cliente ficaria cego — a faixa voltaria ao verde
 * sem dado novo nenhum. O orçamento de escrita do KV free (~1000/dia) também
 * não sobreviveria a um cron por minuto gravando sempre: 1440 escritas.
 *
 * @module worker
 */

import { toFixturesWithReport } from './src/adapters/apiFootball.js';
import { decideCronAction } from './src/core/gate.js';
import { activeLeagueIds } from './src/core/leagues.js';
import { nextBackoffMs } from './src/core/backoff.js';
import { buildSnapshot, parseSnapshot } from './src/core/snapshot.js';
import { checkRateLimit, routeRequest } from './src/worker/http.js';

export const KV_SNAPSHOT_KEY = 'snapshot';
export const KV_STATE_KEY = 'state';
export const KV_AGENDA_KEY = 'agenda';

const UPSTREAM_URL = 'https://v3.football.api-sports.io/fixtures?live=all';

/** Estado do rate limit, por isolate. Ver a limitação em `worker/http.js`. */
const rateLimitState = new Map();

/**
 * Milissegundos até o reset da cota, que é às 00:00 UTC.
 *
 * @param {number} nowMs
 * @returns {number}
 */
function msUntilQuotaReset(nowMs) {
  const proximoReset = new Date(nowMs);
  proximoReset.setUTCHours(24, 0, 0, 0);
  return proximoReset.getTime() - nowMs;
}

/**
 * @param {Response} response
 * @returns {{quotaRemaining: number|null}}
 */
function readQuotaHeaders(response) {
  // Headers HTTP são strings. `Number(null)` é 0, que significaria cota
  // esgotada — por isso o `null` explícito quando o header não veio.
  const bruto = response.headers.get('x-ratelimit-requests-remaining');
  const n = bruto === null ? Number.NaN : Number(bruto);
  return { quotaRemaining: Number.isFinite(n) ? n : null };
}

/**
 * @param {any} kv
 * @param {string} key
 * @returns {Promise<any>} Valor parseado, ou `null` se ausente ou ilegível.
 */
async function readJson(kv, key) {
  const bruto = await kv.get(key);
  if (bruto === null || bruto === undefined) return null;
  try {
    return typeof bruto === 'string' ? JSON.parse(bruto) : bruto;
  } catch {
    return null;
  }
}

const ESTADO_INICIAL = {
  lastFetchAtMs: null,
  quotaRemaining: 100,
  consecutiveFailures: 0,
  backoffUntilMs: 0,
};

/**
 * @param {unknown} bruto
 * @returns {typeof ESTADO_INICIAL}
 */
function normalizeState(bruto) {
  if (bruto === null || typeof bruto !== 'object') return { ...ESTADO_INICIAL };
  const s = /** @type {any} */ (bruto);
  const num = (v, padrao) => (typeof v === 'number' && Number.isFinite(v) ? v : padrao);
  return {
    lastFetchAtMs: typeof s.lastFetchAtMs === 'number' && Number.isFinite(s.lastFetchAtMs)
      ? s.lastFetchAtMs
      : null,
    quotaRemaining: num(s.quotaRemaining, ESTADO_INICIAL.quotaRemaining),
    consecutiveFailures: num(s.consecutiveFailures, 0),
    backoffUntilMs: num(s.backoffUntilMs, 0),
  };
}

/**
 * @param {unknown} corpo
 * @param {number} status
 * @param {Record<string, string>} [headers]
 * @returns {Response}
 */
function json(corpo, status, headers = {}) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // A página é servida pelo GitHub Pages, outra origem. Sem isto o
      // navegador bloqueia a leitura e a grade fica vazia sem erro visível.
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

/**
 * Serve o snapshot do KV. Não fala com a rede, em hipótese nenhuma.
 *
 * @param {Request} request
 * @param {any} env
 * @returns {Promise<Response>}
 */
async function handleFetch(request, env) {
  const url = new URL(request.url);
  const rota = routeRequest(request.method, url.pathname);

  if (!rota.ok) {
    return json(
      { error: rota.status === 405 ? 'método não permitido' : 'não encontrado' },
      rota.status,
      rota.allow ? { allow: rota.allow } : {},
    );
  }

  const ip = request.headers.get('cf-connecting-ip');
  const limite = checkRateLimit(rateLimitState, ip, Date.now());
  if (!limite.allowed) {
    return json({ error: 'requisições demais' }, 429, {
      'retry-after': String(Math.ceil(limite.retryAfterMs / 1000)),
    });
  }

  let snapshot = null;
  try {
    snapshot = parseSnapshot(await env.PLACAR_KV.get(KV_SNAPSHOT_KEY));
  } catch {
    // KV fora do ar. Erro explícito, nunca corpo vazio com 200: o cliente
    // precisa distinguir "não há jogos" de "não sei o que há".
    return json({ error: 'armazenamento indisponível' }, 503);
  }

  if (snapshot === null) {
    // Ainda não há snapshot, ou o que há é ilegível. 200 com lista vazia
    // diria "não há jogos" — mentira, e do tipo que a página exibe com cara
    // de verdade.
    return json({ error: 'sem snapshot ainda' }, 503, { 'retry-after': '60' });
  }

  return json(snapshot, 200);
}

/**
 * O cron: decide, e só então gasta.
 *
 * @param {any} event
 * @param {any} env
 * @returns {Promise<void>}
 */
async function handleScheduled(event, env) {
  const nowMs = typeof event?.scheduledTime === 'number' ? event.scheduledTime : Date.now();
  const kv = env.PLACAR_KV;

  const estado = normalizeState(await readJson(kv, KV_STATE_KEY));
  const agendaBruta = await readJson(kv, KV_AGENDA_KEY);
  const agenda = Array.isArray(agendaBruta) ? agendaBruta : null;

  const leagueIds = activeLeagueIds(
    agenda === null ? null : agenda.map((f) => f.leagueId),
  );

  const decisao = decideCronAction({
    nowMs,
    agenda,
    leagueIds,
    quotaRemaining: estado.quotaRemaining,
    msUntilReset: msUntilQuotaReset(nowMs),
    lastFetchAtMs: estado.lastFetchAtMs,
    backoffUntilMs: estado.backoffUntilMs,
  });

  // NADA de escrita aqui. Tique que não busca não deixa rastro no KV.
  if (!decisao.shouldFetch) return;

  if (!env.API_FOOTBALL_KEY) {
    // Sem secret configurado não há o que buscar. Não escreve nada: nenhuma
    // requisição foi gasta, e inventar uma falha aqui acionaria o backoff por
    // um problema de configuração.
    return;
  }

  let resposta;
  try {
    resposta = await fetch(UPSTREAM_URL, {
      method: 'GET',
      headers: {
        // A chave vai no header, nunca na URL: URL entra em log de proxy.
        'x-apisports-key': env.API_FOOTBALL_KEY,
        accept: 'application/json',
      },
    });
  } catch {
    await registrarFalha(kv, estado, nowMs, { rateLimited: false });
    return;
  }

  if (!resposta.ok) {
    await registrarFalha(kv, estado, nowMs, { rateLimited: resposta.status === 429 });
    return;
  }

  const { quotaRemaining } = readQuotaHeaders(resposta);

  let relatorio;
  try {
    // `toFixturesWithReport` lança em envelope inválido, em `errors`
    // preenchido (que vem com HTTP 200), em truncamento e quando nenhuma
    // partida é utilizável. Todos esses são falha, não "zero jogos".
    relatorio = toFixturesWithReport(await resposta.json());
  } catch {
    await registrarFalha(kv, estado, nowMs, { rateLimited: false }, quotaRemaining);
    return;
  }

  const snapshot = buildSnapshot({
    fetchedAtMs: nowMs,
    fixtures: relatorio.fixtures,
    quotaRemaining,
    quotaResetAtMs: nowMs + msUntilQuotaReset(nowMs),
    discarded: relatorio.discarded,
    upstreamCount: relatorio.fixtures.length + relatorio.discarded,
    truncated: relatorio.truncated,
    intervalMs: decisao.intervalMs,
  });

  await kv.put(KV_SNAPSHOT_KEY, JSON.stringify(snapshot));
  await kv.put(
    KV_STATE_KEY,
    JSON.stringify({
      lastFetchAtMs: nowMs,
      quotaRemaining: quotaRemaining ?? estado.quotaRemaining,
      consecutiveFailures: 0,
      backoffUntilMs: 0,
    }),
  );
}

/**
 * Falha upstream: atualiza só o estado. O snapshot bom fica onde está.
 *
 * A tentativa gastou cota mesmo tendo falhado, então `lastFetchAtMs` avança —
 * senão o cron voltaria no tique seguinte e a escada de backoff nunca sairia
 * do primeiro degrau.
 *
 * @param {any} kv
 * @param {typeof ESTADO_INICIAL} estado
 * @param {number} nowMs
 * @param {{rateLimited: boolean}} contexto
 * @param {number|null} [quotaRemaining]
 */
async function registrarFalha(kv, estado, nowMs, contexto, quotaRemaining = null) {
  const falhas = estado.consecutiveFailures + 1;
  await kv.put(
    KV_STATE_KEY,
    JSON.stringify({
      lastFetchAtMs: nowMs,
      quotaRemaining: quotaRemaining ?? Math.max(0, estado.quotaRemaining - 1),
      consecutiveFailures: falhas,
      backoffUntilMs: nowMs + nextBackoffMs(falhas, contexto),
    }),
  );
}

export default {
  /**
   * @param {Request} request
   * @param {any} env
   * @param {any} ctx
   */
  async fetch(request, env, ctx) {
    void ctx;
    try {
      return await handleFetch(request, env);
    } catch {
      return json({ error: 'erro interno' }, 500);
    }
  },

  /**
   * @param {any} event
   * @param {any} env
   * @param {any} ctx
   */
  async scheduled(event, env, ctx) {
    void ctx;
    await handleScheduled(event, env);
  },
};
