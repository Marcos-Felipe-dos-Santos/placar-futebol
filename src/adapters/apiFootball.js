/**
 * Adaptador API-Football v3 → modelo interno.
 *
 * ESTE É O ÚNICO ARQUIVO QUE MUDA QUANDO A CHAVE CHEGAR.
 *
 * O mapeamento está deliberadamente não implementado. O shape real da resposta
 * de `GET /fixtures?live=all` ainda não foi observado contra a API — só contra
 * a documentação, que não é evidência suficiente. Escrever o mapeamento agora
 * seria inventar um contrato e depois descobrir que ele está errado no lugar
 * mais caro possível (dentro do Worker, contra uma cota de 100 req/dia).
 *
 * Pendências que a sonda do PASSO 0 precisa responder antes de implementar:
 *  - o shape efetivo de `response[]` e onde vivem gols, status e minuto;
 *  - o vocabulário real de `fixture.status.short` (quais códigos existem de
 *    fato), para preencher o mapa de `FixtureStatus` sem adivinhação;
 *  - se `goals.home`/`goals.away` vêm `null` antes do apito inicial;
 *  - quantas ligas/fixtures voltam, o que decide o filtro padrão da UI.
 *
 * @module adapters/apiFootball
 */

/**
 * Converte uma resposta crua da API-Football em partidas do modelo interno.
 *
 * @param {unknown} rawResponse  Corpo JSON já parseado de `/fixtures?live=all`.
 * @returns {import('../core/types.js').Fixture[]}
 * @throws {Error} Sempre, enquanto o shape real não tiver sido observado.
 */
export function toFixtures(rawResponse) {
  void rawResponse;
  throw new Error('not implemented: awaiting real API shape');
}

/** @type {Record<string, import('../core/types.js').FixtureStatus>} */
export const STATUS_MAP = {};
