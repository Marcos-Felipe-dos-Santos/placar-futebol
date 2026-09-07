'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ajustarParaTelas, alcancavel, MIN_VISIVEL_X, MIN_VISIVEL_Y } = require('../src/bounds.js');

/**
 * Displays sintéticos. `workArea` é o que a doc do Electron expõe e exclui a
 * barra de tarefas — é a área onde uma janela é de fato alcançável.
 */
const PRIMARIO = { primary: true, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
/** Secundário À ESQUERDA, com x negativo: é o arranjo que produz o bug real. */
const SECUNDARIO = { primary: false, workArea: { x: -1280, y: 0, width: 1280, height: 1024 } };

test('CASO 1 — geometria válida no monitor atual é PRESERVADA', () => {
  // CONTROLE POSITIVO dos quatro casos abaixo. Sem ele, um `ajustarParaTelas`
  // que devolvesse o padrão SEMPRE passaria em todos os negativos, e o teste
  // estaria medindo nada. É a regra 2 da disciplina de teste.
  const salvo = { x: 300, y: 200, width: 420, height: 220 };
  assert.deepEqual(ajustarParaTelas(salvo, [PRIMARIO]), salvo);
});

test('CASO 2 — monitor que SUMIU joga a janela de volta ao primário', () => {
  // Salva no secundário à esquerda, reabre só com o primário.
  const salvo = { x: -900, y: 300, width: 420, height: 220 };
  const r = ajustarParaTelas(salvo, [PRIMARIO]);

  assert.ok(alcancavel(r, [PRIMARIO]), 'devolveu geometria que continua fora da tela');
  assert.notEqual(r.x, salvo.x, 'manteve o x do monitor que não existe mais');

  // O TAMANHO escolhido pelo usuário sobrevive; só a posição volta ao padrão.
  assert.equal(r.width, 420);
  assert.equal(r.height, 220);
});

test('CASO 3 — resolução que ENCOLHEU trava o tamanho no que cabe', () => {
  const pequeno = { primary: true, workArea: { x: 0, y: 0, width: 800, height: 600 } };
  const salvo = { x: 0, y: 0, width: 1600, height: 900 };
  const r = ajustarParaTelas(salvo, [pequeno]);

  assert.ok(r.width <= 800, `largura ${r.width} não cabe em 800`);
  assert.ok(r.height <= 600, `altura ${r.height} não cabe em 600`);
  assert.ok(alcancavel(r, [pequeno]));
});

test('CASO 4 — janela quase toda fora conta como INALCANÇÁVEL', () => {
  // A régua ingênua é "interseta algum display", e ela deixa passar
  // exatamente este caso: 10px na tela satisfazem a interseção não-vazia e a
  // janela continua impossível de agarrar com o mouse.
  const salvo = { x: 1910, y: 500, width: 420, height: 220 };
  assert.equal(intersectaMas(salvo), true, 'o caso perdeu o sentido: já não interseta');

  const r = ajustarParaTelas(salvo, [PRIMARIO]);
  assert.notEqual(r.x, salvo.x, 'aceitou uma janela com 10px visíveis');
  assert.ok(alcancavel(r, [PRIMARIO]));

  function intersectaMas(rect) {
    const w = Math.min(rect.x + rect.width, 1920) - Math.max(rect.x, 0);
    return w > 0 && w < MIN_VISIVEL_X;
  }
});

test('CASO 5 — dois monitores: a janela no secundário fica onde está', () => {
  // O par negativo do CASO 2: com o secundário PRESENTE, a mesma geometria
  // que foi rejeitada lá tem de ser aceita aqui. Sem este caso, uma função que
  // ignorasse displays não-primários passaria no 2 pelo motivo errado.
  const salvo = { x: -900, y: 300, width: 420, height: 220 };
  assert.deepEqual(ajustarParaTelas(salvo, [PRIMARIO, SECUNDARIO]), salvo);
});

test('entrada degenerada vira o padrão, nunca exceção', () => {
  // `janelas.json` corrompido chega aqui como qualquer coisa. Uma janela sem
  // posição é um aborrecimento; um app que não abre, não.
  for (const lixo of [null, undefined, {}, [], 'não é objeto', 42,
    { x: 1, y: 2 }, { x: NaN, y: 0, width: 10, height: 10 },
    { x: 0, y: 0, width: Infinity, height: 10 }]) {
    const r = ajustarParaTelas(lixo, [PRIMARIO]);
    assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y), `x/y não finitos para ${JSON.stringify(lixo)}`);
    assert.ok(r.width > 0 && r.height > 0, `tamanho inválido para ${JSON.stringify(lixo)}`);
    assert.ok(alcancavel(r, [PRIMARIO]), `resultado inalcançável para ${JSON.stringify(lixo)}`);
  }
});

test('sem display nenhum ainda devolve algo utilizável', () => {
  // `screen.getAllDisplays()` vazio não deveria acontecer. Lançar aqui faria o
  // app não abrir por causa de um caso que ninguém consegue reproduzir.
  for (const nada of [[], null, undefined, [{}]]) {
    const r = ajustarParaTelas({ x: 10, y: 10, width: 400, height: 200 }, nada);
    assert.ok(Number.isFinite(r.x) && r.width > 0, `não devolveu geometria para ${JSON.stringify(nada)}`);
  }
});

test('o mínimo visível é constante nomeada, e é o que a função usa', () => {
  // Régua para ela mesma NÃO serve (regra 3): se eu asserisse
  // `alcancavel(rect(MIN_VISIVEL_X))`, baixar a constante para 1 manteria o
  // teste verde. Os literais abaixo são a decisão de projeto — barra de título
  // agarrável — e é contra eles que a constante é medida.
  assert.equal(MIN_VISIVEL_X, 80);
  assert.equal(MIN_VISIVEL_Y, 40);

  // 79px de largura visível não bastam; 81 bastam. Prende o limiar de fato.
  assert.equal(alcancavel({ x: 1920 - 79, y: 0, width: 400, height: 200 }, [PRIMARIO]), false);
  assert.equal(alcancavel({ x: 1920 - 81, y: 0, width: 400, height: 200 }, [PRIMARIO]), true);
});
