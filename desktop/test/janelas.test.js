'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * GUARDAS ESTÁTICAS DA CASCA.
 *
 * Provam AUSÊNCIA DE CAMINHO PROIBIDO lendo a fonte — a mesma coisa que
 * `test/app-contratos.test.js` faz com o `app.js`, e com o mesmo limite
 * declarado: **não provam comportamento.** Que `backgroundThrottling: false`
 * está escrito, provam; que o Chromium o respeita, não — isso é o watchdog do
 * 6d, e está no inventário do buraco do CLAUDE.md como item 8.
 *
 * Rodam SEM Electron instalado, de propósito: são leitura de texto. Uma guarda
 * que só roda depois de 200 MB de download é uma guarda que não roda.
 */

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

/**
 * Recorta o corpo de uma função pelo nome, até a linha que a fecha na coluna
 * zero. Regex no arquivo inteiro casaria o bloco de outra função e ficaria
 * verde pelo motivo errado — regra 6 da disciplina de teste.
 *
 * @param {string} fonte
 * @param {string} nome
 * @returns {string}
 */
function recortar(fonte, nome) {
  const inicio = fonte.indexOf(`function ${nome}(`);
  assert.notEqual(inicio, -1, `função \`${nome}\` não existe mais em main.js: o recorte mediria vazio`);
  const resto = fonte.slice(inicio);
  const fim = resto.search(/\n\}/);
  assert.notEqual(fim, -1, `não achei o fim de \`${nome}\``);
  const corpo = resto.slice(0, fim);

  // A guarda mora AQUI, dentro do helper, e não na memória de quem escreve o
  // próximo teste: recorte vazio faz todo `assert.ok(!corpo.includes(...))`
  // passar por vacuidade, e é o modo de falha mais silencioso que existe.
  assert.ok(corpo.length > 120, `recorte de \`${nome}\` veio com ${corpo.length} chars: curto demais para medir`);
  return corpo;
}

test('a janela DONA desliga o backgroundThrottling', () => {
  const corpo = recortar(MAIN, 'criarJanelaPrincipal');

  assert.match(
    corpo, /backgroundThrottling:\s*false/,
    'a janela dona voltou ao default `true`: o poll de 60s degrada para ~1/min '
    + 'com a principal escondida, que é o modo de uso que motivou a casca — e degrada em silêncio',
  );

  // CONTROLE POSITIVO do recorte: se ele estivesse pegando o arquivo inteiro,
  // esta asserção passaria por casar o comentário do topo. Ela exige que o
  // valor esteja DENTRO de webPreferences, na função certa.
  assert.match(corpo, /webPreferences:\s*\{[\s\S]*backgroundThrottling:\s*false/);
});

/**
 * Descarta linhas que são SÓ comentário.
 *
 * Existe porque a primeira versão do teste abaixo ficou vermelha contra o
 * próprio `main.js` correto: o docstring dele explica, em prosa, por que
 * `webSecurity: false` NÃO é usado — e a regex casou a explicação. É a regra 6
 * da disciplina de teste aparecendo de novo: asserção sobre texto-fonte
 * precisa ser recortada no código, não no arquivo.
 *
 * LIMITE ASSUMIDO: comentário no FIM de uma linha de código não é removido, e
 * ali um falso positivo ainda é possível. Não vale um parser: o caso real era
 * bloco de documentação, e este recorte o resolve inteiro.
 *
 * @param {string} fonte
 * @returns {string}
 */
function semComentarios(fonte) {
  return fonte
    .split('\n')
    .filter((linha) => !/^\s*(?:\/\/|\/\*|\*)/.test(linha))
    .join('\n');
}

test('a casca não desliga o webSecurity nem expõe Node ao renderer', () => {
  // Não é higiene genérica: `webSecurity: false` transformaria o `?api=` numa
  // porta para qualquer origem, furando por query string o contrato de que o
  // cliente não fala com a API-Football — a mesma coisa que
  // `src/view/origem.js` protege, contornada por baixo.
  const codigo = semComentarios(MAIN);

  // CONTROLE do recorte: se `semComentarios` devolvesse vazio, os dois
  // `assert.ok(!...)` abaixo passariam por vacuidade. Exige que o código real
  // tenha sobrevivido ao filtro.
  assert.ok(codigo.includes('new BrowserWindow'), 'o filtro de comentários comeu o código');
  assert.ok(codigo.length > 800, `código pós-filtro tem ${codigo.length} chars: curto demais para medir`);

  assert.ok(
    !/webSecurity\s*:\s*false/.test(codigo),
    'webSecurity: false na casca — contorna a validação de origem por baixo',
  );
  assert.ok(
    !/nodeIntegration\s*:\s*true/.test(codigo),
    'nodeIntegration: true expõe Node ao renderer que carrega a página web',
  );
  assert.ok(
    !/contextIsolation\s*:\s*false/.test(codigo),
    'contextIsolation: false derruba a fronteira entre o preload e a página',
  );
});

test('a raiz web é servida por esquema próprio, não por file://', () => {
  // `file://` bloqueia `fetch` relativo no Chromium, e é isso que impediria
  // olhar o mock local dentro da casca. Um caminho de carregamento só: o que
  // se inspeciona é o que roda.
  assert.ok(!/loadFile\s*\(/.test(MAIN), 'voltou a usar loadFile: fetch relativo ao mock quebra');
  assert.match(MAIN, /registerSchemesAsPrivileged/);
  assert.match(MAIN, /supportFetchAPI:\s*true/);
});

test('a casca serve o entregável web e NADA MAIS', () => {
  const { resolverArquivo, RAIZ_WEB } = require('../src/protocolo.js');
  const dentro = (p) => path.join(RAIZ_WEB, ...p.split('/'));

  // NEGATIVO. O `.env` com a APISPORTS_KEY fica na raiz do repositório, que é
  // a mesma raiz que a casca serve — e `new URL()` normaliza o `..` ANTES de
  // qualquer guarda ver, então `placar://app/../.env` chega aqui como
  // `/.env` e uma guarda de travessia sozinha o deixaria passar. Foi assim
  // que a primeira versão deste módulo serviria a chave.
  const proibidos = [
    'placar://app/.env',
    'placar://app/../.env',
    'placar://app/%2e%65nv',
    'placar://app/.dev.vars',
    'placar://app/live-pico.json',
    'placar://app/leagues-sample.json',
    'placar://app/wrangler.toml',
    'placar://app/worker.js',
    'placar://app/package.json',
    'placar://app/.git/config',
    'placar://app/CLAUDE.md',
    'placar://app/src/../.env',
    'placar://app/desktop/main.js',
  ];
  for (const url of proibidos) {
    assert.equal(resolverArquivo(url), null, `a casca serviria: ${url}`);
  }

  // POSITIVO. Sem isto, um `resolverArquivo` que devolvesse `null` sempre
  // passaria em todos os negativos acima e a casca não carregaria nada —
  // verde por vacuidade, e o teste teria removido a desconfiança em vez de
  // criá-la.
  assert.equal(resolverArquivo('placar://app/index.html'), dentro('index.html'));
  assert.equal(resolverArquivo('placar://app/style.css'), dentro('style.css'));
  assert.equal(resolverArquivo('placar://app/app.js'), dentro('app.js'));
  assert.equal(resolverArquivo('placar://app/mock-api.json'), dentro('mock-api.json'));
  assert.equal(resolverArquivo('placar://app/src/core/session.js'), dentro('src/core/session.js'));
  assert.equal(resolverArquivo('placar://app/src/view/origem.js'), dentro('src/view/origem.js'));

  // A raiz sem caminho é a página, não `null`.
  assert.equal(resolverArquivo('placar://app/'), dentro('index.html'));

  // Entrada degenerada não derruba nem serve.
  assert.equal(resolverArquivo('não é url'), null);
  assert.equal(resolverArquivo('placar://app/%'), null);
});

test('a lista de permitidos é a decidida, e crescer é decisão do dev', () => {
  // Sem este teste, a lista poderia ganhar `*.json` ou `.` num commit
  // apressado e nada notaria. Verde aqui significa: o que a casca expõe
  // continua sendo o que foi decidido expor.
  const { ARQUIVOS_PERMITIDOS, DIRETORIOS_PERMITIDOS } = require('../src/protocolo.js');
  assert.deepEqual([...ARQUIVOS_PERMITIDOS].sort(), ['app.js', 'index.html', 'mock-api.json', 'style.css']);
  assert.deepEqual(DIRETORIOS_PERMITIDOS, ['src/']);
});
