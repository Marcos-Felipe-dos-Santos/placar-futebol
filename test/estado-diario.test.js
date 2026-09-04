import test from 'node:test';
import assert from 'node:assert/strict';
import { __ledger, __estadoInicial, __CAMPOS_NAO_DIARIOS } from '../worker.js';

/**
 * A INVARIANTE DIÁRIA.
 *
 * Quatro bugs deste projeto tiveram a mesma forma: dois campos do `state` que
 * descrevem o mesmo fato — o que aconteceu HOJE — zerando por critérios
 * diferentes na virada do dia UTC. O último foi `agendaAttemptsToday` zerando
 * pelo `ledger` enquanto `agendaLastAttemptMs` não zerava por nada, o que
 * bloqueava a agenda das 00:01 com o espaçamento de ontem.
 *
 * Comentário não segurou: os três anteriores também tinham a lição escrita em
 * algum lugar e o quarto nasceu assim mesmo. Isto aqui é a versão executável.
 *
 * ## Por que a lista é a dos NÃO diários
 *
 * Enumerar "os campos que zeram" deixaria um campo novo de fora por omissão, e
 * o teste passaria — que é precisamente como os quatro nasceram. Invertida, a
 * omissão acusa: campo que ninguém classificou cai no lado "é diário" e tem de
 * aparecer na saída do `ledger`, senão fica vermelho.
 *
 * Fail-closed. O silêncio acusa em vez de passar.
 */

const ONTEM = '2026-09-02';
const HOJE_MS = Date.parse('2026-09-03T00:01:00.000Z');
const HOJE = '2026-09-03';

/** Estado de ONTEM com todo campo diário sujo, para a virada ter o que limpar. */
function estadoDeOntem() {
  return {
    ...__estadoInicial(),
    dayKeyUTC: ONTEM,
    lastFetchAtMs: Date.parse('2026-09-02T23:50:00.000Z'),
    quotaRemaining: 4,
    spentToday: 96,
    consecutiveFailures: 5,
    backoffUntilMs: Date.parse('2026-09-02T23:55:00.000Z'),
    agendaAttemptsToday: 3,
    agendaLastAttemptMs: Date.parse('2026-09-02T23:50:00.000Z'),
  };
}

test('COBERTURA: todo campo do state é classificado — diário ou declarado não diário', () => {
  // A metade que pega o campo NOVO. Se alguém acrescentar
  // `agendaFailuresToday` ao estado e esquecer do `ledger`, ele não estará em
  // `__CAMPOS_NAO_DIARIOS` nem na saída do `ledger`, e este assert nomeia o
  // campo esquecido. Foi assim que os quatro bugs entraram: por omissão.
  const doLedger = new Set(Object.keys(__ledger(estadoDeOntem(), HOJE_MS)));
  const naoDiarios = new Set(Object.keys(__CAMPOS_NAO_DIARIOS));

  const orfaos = Object.keys(__estadoInicial()).filter(
    (campo) => !doLedger.has(campo) && !naoDiarios.has(campo),
  );

  assert.deepEqual(
    orfaos,
    [],
    `campo(s) do state sem classificação diária: ${orfaos.join(', ')}. `
    + 'Ou zere no ledger, ou declare em __CAMPOS_NAO_DIARIOS com o motivo.',
  );
});

test('COBERTURA: a lista de não diários não tem campo inventado', () => {
  // A outra direção. Sem isto, alguém "resolveria" um vermelho declarando um
  // campo que não existe, e o campo de verdade continuaria sem zerar.
  const doEstado = new Set(Object.keys(__estadoInicial()));
  for (const campo of Object.keys(__CAMPOS_NAO_DIARIOS)) {
    assert.ok(doEstado.has(campo), `${campo} está declarado não diário e não existe no state`);
  }
});

test('COBERTURA: todo campo não diário tem motivo escrito, não só um lugar na lista', () => {
  // Mensagem de assert é promessa: a lista existe para registrar a DECISÃO, e
  // uma entrada com string vazia seria alguém calando o teste sem decidir
  // nada.
  for (const [campo, motivo] of Object.entries(__CAMPOS_NAO_DIARIOS)) {
    assert.ok(
      typeof motivo === 'string' && motivo.length > 30,
      `${campo} está na lista sem um motivo escrito`,
    );
  }
});

test('COMPORTAMENTO: na virada CONFIRMADA, todo campo diário volta ao valor inicial', () => {
  // A metade que pega o campo classificado certo e zerado errado — o bug real
  // do `agendaLastAttemptMs`, que estava na saída do `ledger` e mesmo assim
  // carregava o valor de ontem.
  const inicial = __estadoInicial();
  const apos = __ledger(estadoDeOntem(), HOJE_MS);

  for (const [campo, valor] of Object.entries(apos)) {
    assert.deepEqual(
      valor,
      inicial[campo],
      `${campo} não voltou ao valor de dia novo: ${JSON.stringify(valor)} `
      + `em vez de ${JSON.stringify(inicial[campo])}`,
    );
  }

  // Literais defensáveis, não a constante: se alguém trocar ESTADO_INICIAL por
  // valores "de dia sujo", o laço acima passaria comparando lixo com lixo.
  assert.equal(apos.spentToday, 0);
  assert.equal(apos.agendaAttemptsToday, 0);
  assert.equal(apos.agendaLastAttemptMs, null);
  assert.equal(apos.quotaRemaining, 100, 'a cota do dia novo não é a que sobrou de ontem');
});

test('CONTROLE POSITIVO: no MESMO dia nada zera', () => {
  // Sem isto, um `ledger` que zerasse tudo sempre passaria em todos os asserts
  // acima — e o produto perderia a contagem de gasto a cada tique, furando a
  // reserva em silêncio.
  const doDia = { ...estadoDeOntem(), dayKeyUTC: HOJE };
  const apos = __ledger(doDia, HOJE_MS);

  assert.equal(apos.spentToday, 96, 'o gasto de hoje foi esquecido dentro do próprio dia');
  assert.equal(apos.agendaAttemptsToday, 3);
  assert.equal(apos.agendaLastAttemptMs, doDia.agendaLastAttemptMs);
  assert.equal(apos.quotaRemaining, 4, 'a cota voltou a 100 sem virada de dia');
});

test('DIA DESCONHECIDO não é virada: estado ilegível não destrava contador', () => {
  // `''` não é "outro dia", é "não sei". Zerar aqui deixaria um estado
  // corrompido devolver cota e tentativas cheias a cada tique — o caminho mais
  // rápido para furar a reserva sem que nada apareça na tela.
  const semDia = { ...estadoDeOntem(), dayKeyUTC: '' };
  const apos = __ledger(semDia, HOJE_MS);

  assert.equal(apos.agendaAttemptsToday, 3, 'dia desconhecido destravou as tentativas');
  assert.equal(apos.agendaLastAttemptMs, semDia.agendaLastAttemptMs);
  assert.equal(apos.quotaRemaining, 4, 'dia desconhecido devolveu a cota inteira');
});
