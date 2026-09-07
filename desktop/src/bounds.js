'use strict';

/**
 * Geometria de janela contra as telas disponíveis — PURO, sem Electron.
 *
 * Mora fora do `main.js` pelo mesmo motivo de `protocolo.js`: decisão que
 * precisa de teste sai do arquivo que precisa do runtime. Recebe a lista de
 * displays por PARÂMETRO, então o teste monta monitores sintéticos e não
 * depende do hardware de quem roda.
 *
 * ## O bug que este módulo existe para não ter
 *
 * Posição persistida é um clássico: o app salva `{x: 2400}` num monitor
 * secundário, o monitor é desconectado, e na sessão seguinte a janela abre
 * fora da área visível. Ela existe, tem foco, responde a teclado — e não está
 * em lugar nenhum da tela. O usuário conclui que o app não abre.
 *
 * É o mesmo modo de falha que este projeto persegue em outro lugar: **correto
 * e invisível é indistinguível de quebrado.**
 *
 * Não acontece só entre sessões. Monitor some com o cabo, no meio do jogo, que
 * é exatamente quando o overlay importa — por isso `main.js` reexecuta isto em
 * `display-removed` e `display-metrics-changed`, e não só na abertura.
 *
 * @module desktop/src/bounds
 */

/**
 * Quanto da janela precisa estar visível para ela contar como alcançável.
 *
 * Constante nomeada e não literal solto porque o número é uma DECISÃO, não uma
 * conta: é a área mínima que dá para agarrar com o mouse e arrastar de volta.
 * Uma janela com 3 px na tela satisfaz "interseta um display" e continua tão
 * inalcançável quanto uma inteiramente fora — a interseção não-vazia é a régua
 * ingênua, e ela deixa passar exatamente o caso que dói.
 *
 * 80×40 é a barra de título mínima utilizável. Não foi medido com usuário; é
 * escolha defensável, e está aqui para ser discutida em vez de descoberta
 * dentro de um `if`.
 */
const MIN_VISIVEL_X = 80;
const MIN_VISIVEL_Y = 40;

/** Onde a janela nasce quando não há nada salvo, ou o salvo é inútil. */
const PADRAO = Object.freeze({ largura: 420, altura: 220, margem: 24 });

/**
 * Área de interseção entre dois retângulos.
 *
 * @param {{x: number, y: number, width: number, height: number}} a
 * @param {{x: number, y: number, width: number, height: number}} b
 * @returns {{width: number, height: number}} Zeros quando não se tocam.
 */
function intersecao(a, b) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return { width, height };
}

/**
 * `true` se o retângulo tem pedaço AGARRÁVEL em algum display.
 *
 * @param {{x: number, y: number, width: number, height: number}} rect
 * @param {ReadonlyArray<{workArea: {x: number, y: number, width: number, height: number}}>} displays
 * @returns {boolean}
 */
function alcancavel(rect, displays) {
  return displays.some((d) => {
    const { width, height } = intersecao(rect, d.workArea);
    return width >= MIN_VISIVEL_X && height >= MIN_VISIVEL_Y;
  });
}

/**
 * Posição padrão: canto inferior direito da área útil do display primário.
 *
 * @param {{workArea: {x: number, y: number, width: number, height: number}}} display
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function padraoEm(display) {
  const a = display.workArea;
  const width = Math.min(PADRAO.largura, a.width);
  const height = Math.min(PADRAO.altura, a.height);
  return {
    x: a.x + Math.max(0, a.width - width - PADRAO.margem),
    y: a.y + Math.max(0, a.height - height - PADRAO.margem),
    width,
    height,
  };
}

/**
 * Devolve uma geometria utilizável a partir do que foi salvo.
 *
 * @param {unknown} salvo  O que veio do `janelas.json`. Pode ser qualquer coisa.
 * @param {ReadonlyArray<{workArea: {x: number, y: number, width: number, height: number}, primary?: boolean}>} displays
 *   `screen.getAllDisplays()`. Nunca vazio na prática; tratado mesmo assim.
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function ajustarParaTelas(salvo, displays) {
  const telas = Array.isArray(displays) ? displays.filter((d) => d && d.workArea) : [];

  // Sem display legível não há como calcular nada. Devolver o padrão ABSOLUTO
  // é melhor que lançar: o app abre num canto plausível em vez de não abrir.
  if (telas.length === 0) {
    return { x: PADRAO.margem, y: PADRAO.margem, width: PADRAO.largura, height: PADRAO.altura };
  }

  const primario = telas.find((d) => d.primary) ?? telas[0];

  const numeros = salvo !== null && typeof salvo === 'object'
    && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(salvo[k]));
  if (!numeros) return padraoEm(primario);

  // Tamanho antes de posição: um monitor que encolheu pode ter deixado a
  // janela maior que a área útil, e aí nenhuma posição a torna visível
  // inteira. Trava no que cabe, com um piso para não virar uma fresta.
  const anfitriao = telas.find((d) => intersecao(salvo, d.workArea).width > 0) ?? primario;
  const width = Math.max(MIN_VISIVEL_X, Math.min(salvo.width, anfitriao.workArea.width));
  const height = Math.max(MIN_VISIVEL_Y, Math.min(salvo.height, anfitriao.workArea.height));

  const candidato = { x: salvo.x, y: salvo.y, width, height };
  if (alcancavel(candidato, telas)) return candidato;

  // Salvo num monitor que sumiu, ou arrastado para fora. O TAMANHO é
  // preservado — o usuário escolheu aquele — e só a POSIÇÃO volta ao padrão.
  const destino = padraoEm(primario);
  return { x: destino.x, y: destino.y, width: Math.min(width, destino.width || width), height: Math.min(height, destino.height || height) };
}

module.exports = { ajustarParaTelas, alcancavel, MIN_VISIVEL_X, MIN_VISIVEL_Y, PADRAO };
