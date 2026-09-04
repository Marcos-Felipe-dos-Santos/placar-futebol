/**
 * A FAIXA DE DIAGNÓSTICO: qual aviso a página mostra, e quando nenhum.
 *
 * Função pura. Não conhece DOM, não conhece texto: devolve um CÓDIGO e os
 * dados que o código precisa. A redação em português vive na view, pelo mesmo
 * motivo que os rótulos de `reason` não entraram no núcleo — apresentação não
 * é assunto de `src/core/`.
 *
 * ## A decisão de produto que este módulo implementa
 *
 * A faixa aparece **só quando há algo a dizer**. Faixa sempre visível vira
 * mobília, e o dia em que ela importa é o dia em que ninguém repara. Mas
 * quando aparece tem que ser impossível de ignorar — faixa discreta em página
 * vazia reproduz, em escala menor, o modo de falha que este projeto combate.
 *
 * ## UMA FAIXA POR VEZ, e por que não empilhar
 *
 * Três avisos simultâneos são a mobília voltando pela porta dos fundos: o
 * usuário aprende a pular o bloco inteiro e o aviso que importava vai junto.
 * Então esta função devolve **um** aviso, o de maior precedência.
 *
 * ## O CRITÉRIO DE PRECEDÊNCIA
 *
 * **Quanto mais o aviso invalida o que está na tela, mais alto ele fica.**
 * Não é "quanto mais grave o erro no servidor" — é quanto do que o usuário
 * está vendo deixa de ser confiável:
 *
 * 1. `sem-dado` — não há snapshot. NADA na tela é real.
 * 2. `parado-quebrado` — dado velho e o pipeline falhando. Tudo o que está na
 *    tela pode estar errado, e vai continuar.
 * 3. `parado-sem-cota` — dado velho por motivo conhecido e com hora para
 *    voltar. Tudo velho, mas previsível.
 * 4. `parado-motivo-desconhecido` — dado velho e não se sabe por quê. Fica
 *    ACIMA de `parado-sem-jogo` de propósito: "não sei" nunca pode ser
 *    apresentado como "está tudo bem".
 * 5. `parado-sem-jogo` — dado velho porque não havia o que buscar. O caso
 *    benigno, e ainda assim dito.
 * 6. `incompleto` — dado fresco, mas partidas se perderam na conversão ou a
 *    resposta veio truncada. Parte da tela é confiável; uma favorita pode ser
 *    a parte que falta.
 * 7. `as-cegas` — dado fresco e completo, mas buscado sem a agenda do dia. A
 *    tela está certa; a COBERTURA é que está reduzida.
 * 8. `vazio` — nada a criticar e nenhuma partida para mostrar. Existe porque
 *    grade vazia calada é indistinguível de quebrada; aqui a página afirma
 *    que está vazia de propósito.
 *
 * ## O QUE NÃO ENTRA NESTA FAIXA
 *
 * `uncoveredFavorites` fica **fora**, e é isso que impede o empilhamento sem
 * perder o aviso. Ele não é um estado da página: é uma propriedade de UMA
 * liga, permanente, que não muda com o dado deste minuto. O lugar dele é
 * junto do filtro da liga a que se refere. Se estivesse aqui, disputaria
 * precedência todo dia com avisos temporais e ou esconderia um deles ou viria
 * empilhado.
 *
 * A única exceção é a grade vazia: aí a contagem viaja em `data.uncovered`,
 * para a página poder ligar o vazio à causa provável numa frase só.
 *
 * @module core/notice
 */

import { isStale } from './staleness.js';

/**
 * Abaixo disto a cota é considerada no fim para efeito de aviso.
 *
 * Literal e não `AGENDA_RESERVE`: a reserva é a régua do PORTÃO, e reusá-la
 * aqui amarraria o texto da tela a uma decisão de orçamento. Se a reserva
 * subisse para 20, a página passaria a anunciar "sem cota" com 19 requisições
 * disponíveis.
 */
export const QUOTA_BAIXA = 3;

/**
 * @typedef  {object} Notice
 * @property {'sem-dado'|'parado-quebrado'|'parado-sem-cota'|'parado-motivo-desconhecido'
 *   |'parado-sem-jogo'|'incompleto'|'as-cegas'|'vazio'} code
 * @property {'erro'|'alerta'|'info'} severity
 *   Só para a view escolher o peso visual. `erro` e `alerta` são os que têm de
 *   ser impossíveis de ignorar.
 * @property {object} data  O que a redação precisa. Nunca texto.
 */

/**
 * Escolhe o único aviso a exibir.
 *
 * @param {object} input
 * @param {number} input.nowMs
 * @param {import('./snapshot.js').StoredSnapshot|null} input.snapshot
 * @param {{consecutiveFailures: number, backoffUntilMs: number,
 *   quotaRemaining: number|null}|null} input.cron
 *   Estado do cron servido junto do snapshot. `null` é "não sei".
 * @param {number} input.visibleCount  Partidas na grade DEPOIS do filtro.
 * @param {number} [input.uncoveredCount]  Favoritas sem cobertura garantida.
 * @param {object} [options]
 * @param {number} [options.quotaBaixa=QUOTA_BAIXA]
 * @returns {Notice|null} `null` quando não há nada a dizer.
 */
export function chooseNotice(input, options = {}) {
  const { quotaBaixa = QUOTA_BAIXA } = options;
  const { nowMs, snapshot, cron, visibleCount, uncoveredCount = 0 } = input;

  if (snapshot === null || snapshot === undefined) {
    return { code: 'sem-dado', severity: 'erro', data: {} };
  }

  const staleness = isStale(snapshot.fetchedAtMs, nowMs);
  const parado = staleness.level !== 'fresh';

  if (parado) {
    // Só a idade. O `level` do `isStale` NÃO viaja aqui: a faixa de idade da
    // página consome `isStale` direto, e duplicar a classificação criaria dois
    // lugares para decidir a mesma cor — que divergem no dia em que alguém
    // mexe num só. O peso visual desta faixa é `severity`.
    const dadosIdade = { ageMs: staleness.ageMs };

    // Quebrado vem antes de sem-cota: um pipeline falhando não volta na hora
    // do reset, e prometer "volta às 21:00" seria mentira confortável.
    if (cron !== null && cron.consecutiveFailures > 0) {
      return {
        code: 'parado-quebrado',
        severity: 'erro',
        data: { ...dadosIdade, failures: cron.consecutiveFailures, retryAtMs: cron.backoffUntilMs },
      };
    }

    // `quotaRemaining` é `null` quando o estado é de outro dia UTC — "não
    // sei", NUNCA "acabou". Anunciar cota esgotada com o dia inteiro
    // disponível é o erro que a checagem de dia no Worker existe para evitar,
    // e repeti-lo aqui o traria de volta pela view.
    if (cron !== null && cron.quotaRemaining !== null && cron.quotaRemaining <= quotaBaixa) {
      return {
        code: 'parado-sem-cota',
        severity: 'alerta',
        data: { ...dadosIdade, resetAtMs: snapshot.quotaResetAtMs ?? null },
      };
    }

    // Sem estado do cron não dá para dizer por que parou. Acima do caso
    // benigno de propósito.
    if (cron === null) {
      return { code: 'parado-motivo-desconhecido', severity: 'alerta', data: dadosIdade };
    }

    return { code: 'parado-sem-jogo', severity: 'info', data: dadosIdade };
  }

  // Daqui para baixo o dado é fresco: o que resta é sobre COMPLETUDE.
  if (snapshot.truncated || snapshot.discarded > 0) {
    return {
      code: 'incompleto',
      severity: 'alerta',
      data: {
        discarded: snapshot.discarded,
        upstreamCount: snapshot.upstreamCount,
        truncated: Boolean(snapshot.truncated),
      },
    };
  }

  if (snapshot.reason === 'no-agenda') {
    return { code: 'as-cegas', severity: 'alerta', data: {} };
  }

  // Nada a criticar. Mas grade vazia sem uma palavra é indistinguível de
  // quebrada, então o vazio é AFIRMADO.
  if (visibleCount === 0) {
    return { code: 'vazio', severity: 'info', data: { uncovered: uncoveredCount } };
  }

  return null;
}
