import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * A TESE DE ZERO DEPENDÊNCIAS, VARRIDA NA ÁRVORE INTEIRA.
 *
 * O projeto tem dois entregáveis: a página web (sem build, sem dependências,
 * GitHub Pages) e a casca desktop em `desktop/` (Electron, com lockfile). A
 * restrição vale para o primeiro.
 *
 * `app-contratos.test.js` (CONTRATO 3) é dono do `package.json` da raiz e dos
 * imports do `app.js`. Este arquivo cobre o que faltava: **todo o resto da
 * árvore**, e a fronteira com `desktop/`. Separados de propósito — duas cópias
 * da mesma asserção divergem.
 *
 * ## O que este teste impede, concretamente
 *
 * Um `import` de pacote que entre em `src/` porque "no desktop funciona". O
 * clone de quem tem `node_modules` continua verde, a página continua abrindo
 * na máquina do dev, e quebra só no GitHub Pages — onde não há `node_modules`
 * nenhum e ninguém está olhando. Falha silenciosa e remota.
 *
 * ## Por que a lista versionada é a dos ISENTOS
 *
 * A lista abaixo é a dos diretórios que NÃO são vigiados, nunca a dos
 * vigiados. Mesma inversão de `__CAMPOS_NAO_DIARIOS` no `worker.js`, pela
 * mesma razão: um diretório novo que ninguém classificar cai no lado vigiado e
 * o teste fica vermelho nomeando o arquivo. Listar os vigiados deixaria o
 * diretório novo de fora por omissão, e o teste passaria calado — que é
 * exatamente como os quatro bugs de virada de dia entraram.
 */

const RAIZ = process.cwd();

/** Diretórios ISENTOS da regra. Lista fechada — ver o cabeçalho. */
const ISENTOS = ['desktop', 'node_modules'];

/**
 * Especificadores que resolvem por `node_modules` — `electron`, `dotenv/config`.
 * Relativo (`./`, `../`, `/`) e embutido (`node:fs`) não contam.
 *
 * @param {string} fonte
 * @returns {string[]}
 */
function importsBare(fonte) {
  const achados = [];

  // ANCORADO NO INÍCIO DA LINHA, e isto é a lição, não um detalhe de regex.
  // A primeira versão casava `import`/`from` em qualquer posição e acusou dois
  // arquivos de teste — que contêm CÓDIGO COMO DADO: `app-contratos.test.js`
  // tem `assert.match(app, /import … from '…'/)`, e este arquivo tem as
  // fixtures do controle abaixo. Nenhum dos dois importa pacote nenhum.
  //
  // Import estático é declaração de topo e começa a linha; código citado
  // dentro de string ou regex está sempre no meio de uma. A âncora `^` com a
  // flag `m` separa os dois casos sem precisar entender JavaScript.
  //
  // LIMITE ASSUMIDO, e escrito para ninguém supor cobertura que não existe:
  // `await import('pacote')` no meio de uma linha NÃO é pego. É o preço da
  // âncora, e vale porque o risco real é `import { app } from 'electron'`
  // caindo em `src/` — estático, no topo, que é 100% do que esta guarda
  // precisa ver. Import dinâmico de pacote não é forma que este código use.
  const estatico = /^[ \t]*(?:import|export)[^'"]{0,200}?from\s*['"]([^'"]+)['"]/gm;
  const efeito = /^[ \t]*import\s*['"]([^'"]+)['"]/gm;

  for (const re of [estatico, efeito]) {
    for (const [, especificador] of fonte.matchAll(re)) {
      if (/^[./]/.test(especificador)) continue;
      if (especificador.startsWith('node:')) continue;
      achados.push(especificador);
    }
  }
  return achados;
}

function varrer(dir, saida = []) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entrada.name.startsWith('.')) continue;
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (ISENTOS.includes(entrada.name)) continue;
      varrer(completo, saida);
    } else if (/\.m?js$/.test(entrada.name)) {
      saida.push(completo);
    }
  }
  return saida;
}

test('nenhum arquivo fora de desktop/ importa pacote', () => {
  const arquivos = varrer(RAIZ);
  const rel = (a) => path.relative(RAIZ, a).split(path.sep).join('/');
  const nomes = arquivos.map(rel);

  // CONTROLE POSITIVO DA VARREDURA. Sem isto, um `varrer` quebrado devolveria
  // zero arquivos e o teste passaria sem ter olhado nada — verde por vacuidade,
  // que é o modo de falha que esta guarda existe justamente para não ter. Os
  // três alvos são nomeados porque "achou 20 arquivos" não prova que achou os
  // que importam.
  assert.ok(arquivos.length > 20, `a varredura achou só ${arquivos.length} arquivos: ela quebrou, não o código`);
  assert.ok(nomes.includes('app.js'), 'a varredura não alcançou o app.js');
  assert.ok(nomes.includes('worker.js'), 'a varredura não alcançou o worker.js');
  assert.ok(nomes.includes('src/core/session.js'), 'a varredura não alcançou o núcleo');

  const vazamentos = [];
  for (const arquivo of arquivos) {
    const pacotes = importsBare(fs.readFileSync(arquivo, 'utf8'));
    if (pacotes.length > 0) vazamentos.push(`${rel(arquivo)} -> ${pacotes.join(', ')}`);
  }

  assert.deepEqual(
    vazamentos, [],
    'import de pacote fora de desktop/:\n  ' + vazamentos.join('\n  ')
    + '\nO entregável web roda sem `npm install`. Código que precisa de pacote mora em desktop/.',
  );
});

test('a varredura ISENTA desktop/, e só ele', () => {
  // CONTROLE do outro lado: sem este teste, `ISENTOS` poderia crescer sem que
  // nada notasse, e a guarda viraria decorativa isentando meio repositório.
  // Verde aqui significa: a isenção continua sendo a que foi decidida.
  assert.deepEqual(ISENTOS, ['desktop', 'node_modules'],
    'a lista de isentos mudou: isentar diretório novo é decisão do dev, não efeito colateral');
});

test('o detector enxerga um import de pacote quando existe', () => {
  // CONTROLE POSITIVO DO DETECTOR, separado do da varredura. Sem ele,
  // `importsBare` poderia devolver `[]` para tudo e os testes acima ficariam
  // verdes para sempre — a varredura certa medindo com régua quebrada.
  assert.deepEqual(importsBare("import { app } from 'electron';"), ['electron']);
  assert.deepEqual(importsBare('import "dotenv/config";'), ['dotenv/config']);
  assert.deepEqual(importsBare('export { y } from "lodash-es";'), ['lodash-es']);
  assert.deepEqual(importsBare('import {\n  a,\n} from "electron";'), ['electron'],
    'import multilinha é a forma normal de import grande e não pode escapar');

  // O LIMITE, prendido por asserção em vez de só descrito no comentário. Se
  // alguém melhorar o detector para pegar import dinâmico, este assert cai e
  // obriga a atualizar o texto junto — comentário que sobrevive à mudança que
  // ele descreve vira mentira documentada.
  assert.deepEqual(importsBare("const x = await import('electron');"), [],
    'import dinâmico no meio da linha não é pego — limite assumido, ver importsBare');

  // E o negativo: o que É permitido não pode virar falso positivo, senão a
  // guarda fica vermelha o tempo todo e alguém a desliga.
  assert.deepEqual(importsBare("import { x } from './local.js';"), []);
  assert.deepEqual(importsBare("import { x } from '../core/types.js';"), []);
  assert.deepEqual(importsBare("import fs from 'node:fs';"), []);
});
