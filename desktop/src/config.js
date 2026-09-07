'use strict';

/**
 * Leitura e escrita do `janelas.json` — geometria persistida da casca.
 *
 * ## Por que ler NUNCA lança
 *
 * O arquivo é escrito com debounce, e debounce mais encerramento abrupto
 * (queda de energia, Gerenciador de Tarefas, atualização do Windows) produzem
 * um JSON cortado no meio. Se `JSON.parse` lançar na subida, **o app não
 * abre** — e o usuário não tem nem como suspeitar de um arquivo de geometria
 * de janela num diretório que ele nunca visitou.
 *
 * O dano de perder a posição salva é o usuário rearrastar a janela uma vez. O
 * dano de lançar é o app não abrir mais, para sempre, até alguém achar o
 * arquivo. Assimetria enorme, e por isso `ler` degrada para o padrão em TODA
 * falha: arquivo ausente, truncado, corrompido, sem permissão, com o tipo
 * errado dentro.
 *
 * **Isto não é mascarar erro** — o que a regra de qualidade proíbe. Não é um
 * `catch` genérico em cima de lógica de negócio: é a política declarada de um
 * cache descartável, com o motivo escrito, e ela reporta o que aconteceu em
 * `motivo` para quem quiser logar. O que não se faz é deixar a falha decidir
 * se o programa roda.
 *
 * ## Por que a escrita é atômica
 *
 * Escrever direto no destino é o que CRIA o arquivo truncado. `write` num
 * temporário e depois `rename` — que é atômico no mesmo volume — faz com que
 * um encerramento no meio deixe o arquivo ANTERIOR intacto em vez de um
 * híbrido. Não elimina a leitura defensiva acima: é cinto e suspensório, e o
 * arquivo pode estar corrompido por motivo que não é o nosso.
 *
 * @module desktop/src/config
 */

const fs = require('node:fs');
const path = require('node:path');

/** Versão do formato. Formato desconhecido lê como ausente, nunca como dado. */
const VERSAO = 1;

/**
 * Lê a geometria persistida.
 *
 * @param {string} arquivo  Caminho absoluto do `janelas.json`.
 * @returns {{dados: object|null, motivo: string}}
 *   `dados` é `null` sempre que não houver conteúdo confiável. `motivo` diz
 *   por quê — `'ok'`, `'ausente'`, `'ilegivel'`, `'invalido'`, `'versao'`.
 */
function ler(arquivo) {
  let cru;
  try {
    cru = fs.readFileSync(arquivo, 'utf8');
  } catch (erro) {
    // ENOENT na primeira execução é o caminho NORMAL, não uma falha; os outros
    // (permissão, disco) são falha e têm motivo diferente para quem loga.
    return { dados: null, motivo: erro && erro.code === 'ENOENT' ? 'ausente' : 'ilegivel' };
  }

  let corpo;
  try {
    corpo = JSON.parse(cru);
  } catch {
    // AQUI mora o caso do encerramento abrupto: JSON cortado no meio.
    return { dados: null, motivo: 'invalido' };
  }

  if (corpo === null || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return { dados: null, motivo: 'invalido' };
  }
  if (corpo.versao !== VERSAO) {
    // Formato de outra versão não é "quase certo": é dado que este código não
    // sabe interpretar. Lê como ausente, e a próxima escrita o substitui.
    return { dados: null, motivo: 'versao' };
  }

  return { dados: corpo, motivo: 'ok' };
}

/**
 * Grava a geometria, atomicamente.
 *
 * @param {string} arquivo
 * @param {object} dados  Sem `versao`; ela é acrescentada aqui.
 * @returns {{ok: boolean, motivo: string}}
 *   Nunca lança: falhar ao salvar a posição da janela não pode derrubar o app
 *   nem interromper o encerramento.
 */
function gravar(arquivo, dados) {
  const temporario = `${arquivo}.tmp`;
  try {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    fs.writeFileSync(temporario, JSON.stringify({ versao: VERSAO, ...dados }, null, 2), 'utf8');
    fs.renameSync(temporario, arquivo);
    return { ok: true, motivo: 'ok' };
  } catch {
    // Deixar o `.tmp` para trás confundiria o próximo diagnóstico.
    try { fs.rmSync(temporario, { force: true }); } catch { /* nada a fazer */ }
    return { ok: false, motivo: 'falha-ao-gravar' };
  }
}

module.exports = { ler, gravar, VERSAO };
