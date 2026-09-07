'use strict';

/**
 * Resolução de caminho do esquema `placar://` — PURO, sem Electron.
 *
 * Mora fora do `main.js` pela mesma razão que as decisões do `app.js` moram em
 * `src/core/` e `src/view/`: `main.js` faz `require('electron')` no topo, e
 * módulo que importa Electron não é testável com `node --test`.
 *
 * ## LISTA DE PERMITIDOS, e por que aqui a inversão é ao contrário
 *
 * A primeira versão servia qualquer arquivo sob a raiz e barrava só o que
 * escapasse dela com `..`. **Estava errada, e o teste pegou:** `new URL()`
 * normaliza o `..` antes de qualquer guarda ver, então `placar://app/.env`
 * chega como `/.env` e resolve DENTRO da raiz. A casca serviria o `.env` com
 * a `APISPORTS_KEY`, o `live-pico.json` e o `.git/` inteiro para qualquer
 * `fetch` da página. Travessia não era o risco; servir a raiz inteira era.
 *
 * Este projeto normalmente versiona o lado que NÃO deve crescer — é o caso de
 * `__CAMPOS_NAO_DIARIOS` e o de `ISENTOS` na guarda de dependências. **Aqui a
 * inversão é a oposta, e o critério é o mesmo:** qual lado, esquecido, falha
 * em silêncio?
 *
 * - Lista de PROIBIDOS: um segredo novo no repositório passa a ser servido
 *   sem que nada acuse. Falha silenciosa e catastrófica.
 * - Lista de PERMITIDOS: um arquivo novo do entregável web dá 404 até alguém
 *   classificá-lo. Falha barulhenta e inofensiva — a página não carrega e
 *   quem mexeu vê na hora.
 *
 * A regra geral continua sendo "enumere o lado cujo esquecimento é
 * silencioso". Ela só aponta para o outro lado quando o dano muda de sinal.
 *
 * @module desktop/src/protocolo
 */

const path = require('node:path');

/** Raiz do repositório: `index.html`, `app.js`, `src/`, `style.css`. */
const RAIZ_WEB = path.join(__dirname, '..', '..');

/**
 * Arquivos exatos que a casca serve. É o entregável web, nada mais.
 * `mock-api.json` está aqui porque `--mock` existe para ser olhado.
 */
const ARQUIVOS_PERMITIDOS = new Set(['index.html', 'style.css', 'app.js', 'mock-api.json']);

/** Diretórios cujo conteúdo é servido inteiro. `src/` são os módulos ES. */
const DIRETORIOS_PERMITIDOS = ['src/'];

/**
 * Traduz uma URL do esquema para um arquivo do entregável web.
 *
 * @param {string} url  Ex.: `placar://app/index.html`.
 * @param {string} [raiz=RAIZ_WEB]  Injetável para o teste não depender do disco.
 * @returns {string|null} Caminho absoluto, ou `null` se não for permitido.
 */
function resolverArquivo(url, raiz = RAIZ_WEB) {
  let pathname;
  try {
    ({ pathname } = new URL(url));
  } catch {
    // URL inválida não vira caminho. Inventar um default aqui serviria arquivo
    // para uma entrada que ninguém entendeu.
    return null;
  }

  let relativo;
  try {
    relativo = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    // `%` solto quebra o decode. Recusa.
    return null;
  }

  if (relativo === '') relativo = 'index.html';

  // Normaliza separador do Windows para comparar com a lista sempre em `/`.
  const chave = relativo.split(path.sep).join('/');

  const permitido = ARQUIVOS_PERMITIDOS.has(chave)
    || DIRETORIOS_PERMITIDOS.some((dir) => chave.startsWith(dir));
  if (!permitido) return null;

  const alvo = path.resolve(raiz, relativo);

  // Cinto e suspensório. A lista acima já barra o que interessa, mas `src/`
  // é prefixo e `src/../.env` casaria o prefixo antes de o `resolve`
  // normalizar. `path.sep` no fim: sem ele, um irmão `placar futebol-outro`
  // passaria pelo `startsWith`.
  if (!alvo.startsWith(raiz + path.sep)) return null;
  return alvo;
}

module.exports = { resolverArquivo, RAIZ_WEB, ARQUIVOS_PERMITIDOS, DIRETORIOS_PERMITIDOS };
