import test from 'node:test';
import assert from 'node:assert/strict';
import {
  horaLocal,
  idadeCurta,
  statusTexto,
  minutoTexto,
  placarTexto,
  noticeTexto,
  resyncTexto,
  chipCoberturaTexto,
} from '../src/view/copy.js';
import { chooseNotice } from '../src/core/notice.js';
import { makeFixture } from './helpers/fixtures.js';

const T0 = Date.parse('2026-09-04T18:00:00.000Z');

// === A REGRA DO RELÓGIO =====================================================

test('RELÓGIO: nenhuma frase faz contagem regressiva contra o relógio local', () => {
  // O bug previsto pelo dev. `backoffUntilMs` e `quotaResetAtMs` são instantes
  // do relógio do WORKER; subtrair `Date.now()` do navegador é comparar dois
  // relógios diferentes. Cliente adiantado dá número negativo, atrasado dá
  // número inflado — e o erro aparece justamente quando algo já quebrou.
  //
  // O teste que discrimina: com o instante MUITO no futuro e MUITO no passado,
  // o texto tem de ser o mesmo tirando a hora formatada. Se houvesse subtração,
  // um dos dois viraria "em -N min" ou um número absurdo.
  const base = { ageMs: 8 * 60_000, failures: 2 };

  const futuro = noticeTexto({
    code: 'parado-quebrado',
    severity: 'erro',
    data: { ...base, retryAtMs: T0 + 400 * 24 * 3600_000 },
  });
  const passado = noticeTexto({
    code: 'parado-quebrado',
    severity: 'erro',
    data: { ...base, retryAtMs: T0 - 400 * 24 * 3600_000 },
  });

  for (const texto of [futuro.detalhe, passado.detalhe]) {
    assert.ok(!/-\d/.test(texto), `número negativo no texto: ${texto}`);
    assert.ok(!/em \d+ min/.test(texto), `contagem regressiva no texto: ${texto}`);
  }
  // E os dois falam de "por volta das HH:MM", que é hora de parede.
  assert.match(futuro.detalhe, /por volta das \d{2}:\d{2}/);
  assert.match(passado.detalhe, /por volta das \d{2}:\d{2}/);
});

test('RELÓGIO: instante ausente não vira "às null"', () => {
  // A frase tem de saber viver sem a hora. Sem isto, um `backoffUntilMs: 0`
  // — que é o valor normal quando não há backoff — imprimiria lixo na tela.
  const semHora = noticeTexto({
    code: 'parado-quebrado',
    severity: 'erro',
    data: { ageMs: 60_000, failures: 1, retryAtMs: null },
  });
  assert.ok(!semHora.detalhe.includes('null'), semHora.detalhe);
  assert.ok(!semHora.detalhe.includes('undefined'), semHora.detalhe);
  assert.ok(!semHora.detalhe.includes('NaN'), semHora.detalhe);

  // Controle positivo: com instante válido, a hora aparece.
  const comHora = noticeTexto({
    code: 'parado-quebrado',
    severity: 'erro',
    data: { ageMs: 60_000, failures: 1, retryAtMs: T0 },
  });
  assert.match(comHora.detalhe, /\d{2}:\d{2}/);
});

test('horaLocal recusa o que não é instante, em vez de inventar', () => {
  assert.equal(horaLocal(null), null);
  assert.equal(horaLocal(undefined), null);
  assert.equal(horaLocal(Number.NaN), null);
  assert.equal(horaLocal('18:00'), null);
  // Controle positivo, e sem depender do fuso da máquina: só o formato.
  assert.match(horaLocal(T0), /^\d{2}:\d{2}$/);
});

test('idadeCurta cresce de segundos a horas sem virar "há -30s"', () => {
  assert.equal(idadeCurta(0), 'há 0s');
  assert.equal(idadeCurta(45_000), 'há 45s');
  assert.equal(idadeCurta(8 * 60_000), 'há 8 min');
  assert.equal(idadeCurta(2 * 3600_000 + 5 * 60_000), 'há 2h05');
  assert.equal(idadeCurta(Number.POSITIVE_INFINITY), 'idade desconhecida');
});

// === o placar e o minuto ====================================================

test('PLACAR null vira travessão, NUNCA zero', () => {
  // Versão visual do gol fantasma: mostrar 0 onde o dado é desconhecido faz o
  // usuário ler 0-0 e acreditar que a partida começou empatada.
  assert.equal(placarTexto(null), '–');
  assert.equal(placarTexto(undefined), '–');
  // Controle positivo: zero de verdade é zero.
  assert.equal(placarTexto(0), '0');
  assert.equal(placarTexto(3), '3');
});

test('MINUTO travado em 45 com acréscimo correndo é exibido como 45', () => {
  // MEDIDO na captura: `elapsed` satura e o acréscimo vai num campo separado
  // que o modelo interno não carrega. Estimar 48 seria a tela mentindo com
  // mais confiança do que o dado que ela tem.
  assert.equal(minutoTexto(makeFixture({ status: 'live', elapsedMin: 45 })), "45'");
  assert.equal(minutoTexto(makeFixture({ status: 'live', elapsedMin: 90 })), "90'");
  assert.equal(minutoTexto(makeFixture({ status: 'halftime', elapsedMin: 45 })), 'INT');
  assert.equal(minutoTexto(makeFixture({ status: 'scheduled', elapsedMin: null })), '');
});

test('statusTexto cobre o domínio inteiro e não vaza do protótipo', () => {
  // `Object.entries` não vê a cadeia de protótipos: sem `Object.hasOwn`,
  // `statusTexto({status: 'constructor'})` devolveria a função Object. Este
  // projeto já foi mordido por isso no STATUS_MAP.
  for (const status of ['live', 'halftime', 'finished', 'cancelled', 'scheduled']) {
    const texto = statusTexto(makeFixture({ status }));
    assert.ok(texto.length > 0 && texto !== 'estado desconhecido', `${status} sem rótulo`);
  }
  assert.equal(statusTexto(makeFixture({ status: 'constructor' })), 'estado desconhecido');
  assert.equal(statusTexto(makeFixture({ status: 'toString' })), 'estado desconhecido');
  assert.equal(statusTexto({}), 'estado desconhecido');
});

// === a faixa de diagnóstico =================================================

test('TODO código de chooseNotice tem redação — nenhum cai no fallback', () => {
  // O acoplamento que quebra em silêncio: alguém acrescenta um código no
  // núcleo e a view não sabe redigi-lo. Derivado da lista do typedef, não de
  // uma cópia à mão, para crescer junto.
  const codigos = [
    'sem-dado', 'parado-quebrado', 'parado-sem-cota', 'parado-motivo-desconhecido',
    'parado-sem-jogo', 'incompleto', 'as-cegas', 'vazio',
  ];

  for (const code of codigos) {
    const texto = noticeTexto({
      code,
      severity: 'info',
      data: { ageMs: 60_000, failures: 1, discarded: 1, upstreamCount: 9, uncovered: 0 },
    });
    assert.notEqual(texto.titulo, 'Aviso sem texto', `${code} não tem redação`);
    assert.ok(texto.detalhe.length > 20, `${code} tem detalhe curto demais para explicar algo`);
  }
});

test('código desconhecido AVISA em vez de sumir', () => {
  // Sumir é o modo de falha que a faixa inteira existe para combater. Se um
  // código novo aparecer sem redação, a tela diz que é bug dela.
  const texto = noticeTexto({ code: 'inventado', severity: 'info', data: {} });
  assert.equal(texto.titulo, 'Aviso sem texto');
  assert.match(texto.detalhe, /bug da tela/);
});

test('sem aviso, sem texto: a faixa não é mobília', () => {
  assert.equal(noticeTexto(null), null);
  assert.equal(noticeTexto(undefined), null);
});

test('o caminho inteiro: chooseNotice até a frase, sem tradução no meio', () => {
  // A fronteira só vale se o que o núcleo devolve entra na view direto.
  const notice = chooseNotice({
    nowMs: T0 + 8 * 60_000,
    snapshot: {
      version: 1, fetchedAtMs: T0, fixtures: [], quotaRemaining: 1,
      quotaResetAtMs: T0 + 3600_000, discarded: 0, upstreamCount: 0,
      truncated: false, reason: 'due',
    },
    cron: { consecutiveFailures: 0, backoffUntilMs: 0, quotaRemaining: 1 },
    visibleCount: 2,
  });

  assert.equal(notice.code, 'parado-sem-cota');
  const texto = noticeTexto(notice);
  assert.match(texto.titulo, /parados há 8 min/);
  assert.match(texto.detalhe, /cota volta às \d{2}:\d{2}/);
});

test('incompleto diz o denominador, senão "3 descartadas" é de quê?', () => {
  const texto = noticeTexto({
    code: 'incompleto',
    severity: 'alerta',
    data: { discarded: 3, upstreamCount: 19, truncated: false },
  });
  assert.match(texto.detalhe, /3 de 19/);
});

test('vazio com favorita descoberta liga o vazio à causa, numa frase só', () => {
  // A alternativa seria uma segunda faixa empilhada, que é a mobília voltando.
  const com = noticeTexto({ code: 'vazio', severity: 'info', data: { uncovered: 2 } });
  assert.match(com.detalhe, /2 ligas favoritadas/);

  // Controle positivo: sem favorita descoberta, a frase não menciona nada disso.
  const sem = noticeTexto({ code: 'vazio', severity: 'info', data: { uncovered: 0 } });
  assert.ok(!sem.detalhe.includes('favorita'), sem.detalhe);
  assert.match(sem.detalhe, /não porque algo falhou/);
});

// === ressincronização =======================================================

test('RESYNC com gols engolidos avisa que o som não tocou', () => {
  // Requisito explícito do contrato de `applySnapshot`: sem este aviso, um
  // atraso do cron deixa o usuário vendo 2-0 onde deixou 0-0, sem nada que
  // explique.
  const texto = resyncTexto(true, 2);
  assert.match(texto.titulo, /2 gols podem ter passado/);
  assert.match(texto.detalhe, /som/);
});

test('RESYNC sem gols engolidos tem texto PRÓPRIO, não "0 gols"', () => {
  // "0 gols podem ter passado" assustaria à toa. Houve buraco e nada se
  // perdeu — caso diferente, frase diferente.
  const texto = resyncTexto(true, 0);
  assert.ok(!texto.titulo.includes('0'), texto.titulo);
  assert.match(texto.detalhe, /nenhum gol se perdeu/);
});

test('singular e plural do resync', () => {
  assert.match(resyncTexto(true, 1).titulo, /1 gol pode ter passado/);
  assert.match(resyncTexto(true, 5).titulo, /5 gols podem ter passado/);
});

test('sem ressincronização, nenhum texto', () => {
  assert.equal(resyncTexto(false, 0), null);
  assert.equal(resyncTexto(false, 3), null, 'gols engolidos sem resync não é caso real, mas cala');
});

// === chip da liga ===========================================================

test('o chip explica a limitação sem prometer que a liga não funciona', () => {
  // "Sem cobertura garantida" e não "não funciona": a partida PODE aparecer de
  // carona numa busca disparada por outra competição. Prometer menos do que a
  // realidade também é errar.
  const texto = chipCoberturaTexto(true);
  assert.match(texto, /de carona/);
  assert.ok(!/não funciona/.test(texto), texto);

  assert.equal(chipCoberturaTexto(false), null, 'liga coberta não pode ganhar aviso');
});
