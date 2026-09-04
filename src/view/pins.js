/**
 * PARTIDAS FIXADAS NO OVERLAY — persistência com prazo de validade.
 *
 * ## Por que isto não é só um array de ids
 *
 * Favoritar uma LIGA é permanente: o Brasileirão continua sendo o Brasileirão
 * no mês que vem. Fixar uma PARTIDA é efêmero por natureza — o jogo acaba, e
 * um id fixado na terça não quer dizer nada no sábado. Guardar os dois com a
 * mesma regra faria o overlay carregar jogos da semana passada, e o usuário
 * teria de limpar a lista à mão para a página voltar a ser útil.
 *
 * Então a validade é imposta em DOIS pontos, porque um só não cobre:
 *
 * 1. **Na leitura** (`parsePins`) — descarta o que foi fixado em outro dia.
 *    É o único filtro possível no carregamento, quando ainda não há snapshot
 *    nenhum e não se sabe o estado de partida alguma.
 * 2. **A cada snapshot** (`prunePins`) — descarta o que já terminou ou foi
 *    cancelado. É aqui que o jogo que acabou às 22h some do overlay às 22h05,
 *    sem esperar a virada do dia.
 *
 * Um ponto só deixaria buraco nos dois sentidos: só a leitura mantém no
 * overlay um jogo encerrado a tarde inteira; só o snapshot mantém para sempre
 * um id que nunca mais aparece em `live=all`, porque o que não vem na resposta
 * não pode ser podado por ela.
 *
 * Funções puras. O dia corrente entra por parâmetro.
 *
 * @module view/pins
 */

/**
 * Estados em que a partida não volta a acontecer.
 *
 * Derivado do contrato de `FixtureStatus`, não uma segunda lista solta: se um
 * estado terminal novo entrar no modelo interno, é aqui que ele entra também.
 *
 * @type {ReadonlySet<string>}
 */
export const STATUS_TERMINAIS_UI = Object.freeze(new Set(['finished', 'cancelled']));

/**
 * Dia local em `AAAA-MM-DD`.
 *
 * LOCAL e não UTC de propósito: aqui a pergunta é "isto foi fixado hoje, do
 * ponto de vista de quem está olhando a tela", e não tem relação com o reset
 * da cota. Usar UTC faria um jogo fixado às 22h de Brasília nascer marcado
 * como do dia seguinte.
 *
 * @param {number} nowMs
 * @returns {string}
 */
export function diaLocal(nowMs) {
  const d = new Date(nowMs);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * O que vai para o `localStorage`.
 *
 * O dia viaja JUNTO dos ids, como na agenda do KV: separá-los criaria o
 * instante em que um foi gravado e o outro não, e aí os ids de ontem se
 * apresentariam como os de hoje.
 *
 * @param {ReadonlyArray<string>} ids
 * @param {number} nowMs
 * @returns {{dia: string, ids: string[]}}
 */
export function serializePins(ids, nowMs) {
  return { dia: diaLocal(nowMs), ids: [...ids] };
}

/**
 * Lê os fixados, descartando o que não é de hoje.
 *
 * @param {unknown} raw  Valor cru do `localStorage`.
 * @param {number} nowMs
 * @returns {string[]} Sempre um array — `localStorage` corrompido não pode
 *   derrubar a página, e overlay vazio é degradação aceitável.
 */
export function parsePins(raw, nowMs) {
  let value = raw;

  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];

  const guardado = /** @type {any} */ (value);
  if (guardado.dia !== diaLocal(nowMs)) return [];
  if (!Array.isArray(guardado.ids)) return [];

  return guardado.ids.filter((id) => typeof id === 'string' && id !== '');
}

/**
 * Descarta os fixados cuja partida já terminou.
 *
 * Id AUSENTE do snapshot é MANTIDO, e a distinção importa: `live=all` só traz
 * partidas ao vivo, então um jogo no intervalo longo, uma partida que o
 * adaptador descartou naquele minuto ou uma oscilação da resposta fariam o
 * pin sumir e não voltar. Ausência é "não sei agora", não "acabou" — a mesma
 * regra de `[]` contra `null` na agenda. Quem limpa o que ficou órfão é o
 * corte por dia, na leitura.
 *
 * @param {ReadonlyArray<string>} ids
 * @param {ReadonlyArray<import('../core/types.js').Fixture>} fixtures
 * @returns {string[]} Array novo.
 */
export function prunePins(ids, fixtures) {
  const lista = Array.isArray(fixtures) ? fixtures : [];
  const terminais = new Set(
    lista.filter((f) => STATUS_TERMINAIS_UI.has(f?.status)).map((f) => f?.id),
  );
  return [...(Array.isArray(ids) ? ids : [])].filter((id) => !terminais.has(id));
}
