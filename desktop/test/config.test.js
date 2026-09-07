'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ler, gravar, VERSAO } = require('../src/config.js');

function tmp(nome) {
  return path.join(os.tmpdir(), `placar-${nome}-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
}

test('ida e volta: o que grava é o que lê', () => {
  // CONTROLE POSITIVO de tudo abaixo. Sem ele, um `ler` que devolvesse
  // `{dados: null}` sempre passaria em todos os casos de corrupção — verde
  // sem ter testado nada.
  const arquivo = tmp('ok');
  try {
    const escrita = gravar(arquivo, { overlay: { x: 10, y: 20, width: 400, height: 200 } });
    assert.equal(escrita.ok, true, escrita.motivo);

    const { dados, motivo } = ler(arquivo);
    assert.equal(motivo, 'ok');
    assert.deepEqual(dados.overlay, { x: 10, y: 20, width: 400, height: 200 });
    assert.equal(dados.versao, VERSAO);
  } finally {
    fs.rmSync(arquivo, { force: true });
  }
});

test('arquivo TRUNCADO no meio lê como ausente, não lança', () => {
  // O caso real: escrita com debounce cortada por encerramento abrupto. Não
  // invento o lixo — gravo um arquivo VÁLIDO e corto, que é a única forma de
  // ter certeza de que o truncamento é o de verdade e não um palpite meu
  // sobre como um arquivo cortado se parece.
  const arquivo = tmp('truncado');
  try {
    gravar(arquivo, { overlay: { x: 10, y: 20, width: 400, height: 200 } });
    const inteiro = fs.readFileSync(arquivo, 'utf8');
    assert.ok(inteiro.length > 40, 'o arquivo base ficou curto demais para o corte valer');

    // Vários pontos de corte: o meio de uma chave, o meio de um número, antes
    // do fecho. Um só ponto poderia calhar de ser parseável.
    for (const fatia of [0.25, 0.5, 0.75, 0.9]) {
      fs.writeFileSync(arquivo, inteiro.slice(0, Math.floor(inteiro.length * fatia)), 'utf8');
      const r = ler(arquivo);
      assert.equal(r.dados, null, `corte em ${fatia} devolveu dados`);
      assert.equal(r.motivo, 'invalido');
    }
  } finally {
    fs.rmSync(arquivo, { force: true });
  }
});

test('arquivo ausente é o caminho NORMAL e tem motivo próprio', () => {
  // Primeira execução do app. Não pode ser reportado como falha, senão o log
  // acusa erro toda vez que alguém instala.
  const r = ler(tmp('nao-existe'));
  assert.equal(r.dados, null);
  assert.equal(r.motivo, 'ausente', 'ENOENT precisa se distinguir de corrupção para quem loga');
});

test('conteúdo com tipo errado não vira geometria', () => {
  const arquivo = tmp('tipo');
  try {
    for (const [conteudo, esperado] of [
      ['null', 'invalido'],
      ['[]', 'invalido'],
      ['"uma string"', 'invalido'],
      ['42', 'invalido'],
      ['{}', 'versao'],
      [JSON.stringify({ versao: 99, overlay: {} }), 'versao'],
      ['', 'invalido'],
      ['   ', 'invalido'],
    ]) {
      fs.writeFileSync(arquivo, conteudo, 'utf8');
      const r = ler(arquivo);
      assert.equal(r.dados, null, `aceitou ${JSON.stringify(conteudo)}`);
      assert.equal(r.motivo, esperado, `motivo errado para ${JSON.stringify(conteudo)}`);
    }
  } finally {
    fs.rmSync(arquivo, { force: true });
  }
});

test('a escrita é ATÔMICA: falha no meio não corrompe o que já existia', () => {
  // É o `rename` que garante isto. Testa-se o efeito observável: depois de uma
  // gravação bem-sucedida não sobra `.tmp`, e o arquivo anterior nunca fica
  // meio-escrito porque nunca é aberto para escrita direta.
  const arquivo = tmp('atomico');
  try {
    gravar(arquivo, { overlay: { x: 1, y: 1, width: 100, height: 100 } });
    gravar(arquivo, { overlay: { x: 2, y: 2, width: 200, height: 200 } });

    assert.equal(fs.existsSync(`${arquivo}.tmp`), false, 'sobrou .tmp: o próximo diagnóstico vai tropeçar nele');
    assert.equal(ler(arquivo).dados.overlay.x, 2, 'a segunda gravação não venceu');
  } finally {
    fs.rmSync(arquivo, { force: true });
    fs.rmSync(`${arquivo}.tmp`, { force: true });
  }
});

test('gravar em caminho impossível NÃO lança', () => {
  // Falhar ao salvar a posição da janela não pode derrubar o app nem
  // interromper o encerramento — `gravar` é chamado no `before-quit`.
  const impossivel = path.join(os.tmpdir(), 'placar-arquivo-como-pasta.json', 'dentro', 'x.json');
  fs.writeFileSync(path.join(os.tmpdir(), 'placar-arquivo-como-pasta.json'), 'sou um arquivo', 'utf8');
  try {
    const r = gravar(impossivel, { overlay: {} });
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'falha-ao-gravar');
  } finally {
    fs.rmSync(path.join(os.tmpdir(), 'placar-arquivo-como-pasta.json'), { force: true });
  }
});
