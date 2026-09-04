/**
 * De onde a página lê o dado — puro, sem DOM.
 *
 * ## Por que existe um override
 *
 * `index.html?api=./mock-api.json` aponta a página para um arquivo local
 * gerado por `tools/make-mock.mjs`. É o que permite olhar a faixa de
 * diagnóstico nos oito estados dela sem Worker, sem KV e sem gastar uma
 * requisição da cota — estados que, por definição, são difíceis de produzir de
 * propósito em produção (a cota acabar, o upstream cair).
 *
 * ## Por que SÓ caminho relativo
 *
 * Um override que aceitasse URL absoluta transformaria o link numa forma de
 * fazer a página buscar qualquer origem que alguém pusesse na query string. E
 * neste projeto o dano tem nome: `?api=https://v3.football.api-sports.io/...`
 * furaria o contrato de que **o navegador nunca fala com a API-Football**,
 * justamente o contrato que protege uma cota global de 100 requisições/dia.
 *
 * Aceitar só `./` e `/` prende tudo na mesma origem. Não é sanitização
 * genérica de URL — é uma lista de duas formas permitidas, que é o que dá para
 * defender.
 *
 * @module view/origem
 */

/**
 * Resolve a origem do dado a partir da query string.
 *
 * @param {string} search  `location.search`, ex.: `?api=./mock-api.json`.
 * @param {string} padrao  A URL do Worker.
 * @returns {string} O caminho relativo pedido, ou `padrao`.
 */
export function resolveApiUrl(search, padrao) {
  let pedido = null;
  try {
    pedido = new URLSearchParams(typeof search === 'string' ? search : '').get('api');
  } catch {
    return padrao;
  }

  if (typeof pedido !== 'string' || pedido === '') return padrao;

  // `//evil.com` é URL absoluta protocol-relative e começa com `/`: a checagem
  // ingênua de "começa com barra" deixaria passar. É o caso que faz esta
  // função existir em vez de um `startsWith` solto no `app.js`.
  if (pedido.startsWith('//')) return padrao;

  // `./` e `/` e nada mais. `../` sai do diretório e não tem uso legítimo aqui.
  if (pedido.startsWith('./') || pedido.startsWith('/')) return pedido;

  return padrao;
}
