/**
 * Ligas prioritárias do projeto.
 *
 * Dado de configuração, não shape de API: os ids da API-Football são estáveis
 * e independem do formato da resposta de `/fixtures?live=all`, então este
 * arquivo não espera o adaptador sair do stub.
 *
 * Conferido contra `leagues-sample.json` (`GET /leagues?current=true`,
 * 1237 ligas, 934 com `coverage.fixtures.events`) em 2026-09-03: as quatro
 * abaixo têm temporada corrente 2026 e cobertura de eventos.
 *
 * @module core/leagues
 */

/**
 * As quatro ligas que o projeto acompanha por padrão.
 *
 * | id | liga                  | tipo   | país   | temporada corrente        |
 * |----|-----------------------|--------|--------|---------------------------|
 * | 71 | Serie A (Brasileirão) | League | Brazil | 2026, 28/01 a 02/12       |
 * | 13 | CONMEBOL Libertadores | Cup    | World  | 2026, 04/02 a 15/09       |
 * | 11 | CONMEBOL Sudamericana | Cup    | World  | 2026, 03/03 a 16/09       |
 * | 73 | Copa do Brasil        | Cup    | Brazil | 2026, 17/02 a 02/09       |
 *
 * ATENÇÃO ÀS DATAS DE FIM: a Copa do Brasil encerrou em 02/09/2026 e as duas
 * competições da CONMEBOL encerram em meados de setembro. A partir daí este
 * conjunto vira efetivamente só o Brasileirão até dezembro. Isso não quebra
 * nada — o portão do cron simplesmente não dispara —, mas explica por que a
 * cobertura ao vivo cai muito depois de setembro, e é o momento de revisitar
 * esta lista em vez de concluir que o pipeline quebrou.
 *
 * @type {ReadonlyArray<number>}
 */
export const DEFAULT_LEAGUE_IDS = Object.freeze([71, 13, 11, 73]);

/**
 * Os mesmos ids em string, que é como `Fixture.leagueId` os carrega no modelo
 * interno. Evita comparar número com string no caminho quente do filtro.
 *
 * @type {ReadonlySet<string>}
 */
export const DEFAULT_LEAGUE_ID_SET = Object.freeze(
  new Set(DEFAULT_LEAGUE_IDS.map(String)),
);

/**
 * PORTÃO DO CRON — requisito do PR 2.
 *
 * O handler do cron só chama a API upstream se houver partida ao vivo em
 * `DEFAULT_LEAGUE_IDS` **ou** em liga que o usuário favoritou. Sem isso a
 * cota vaza: `live=all` devolve partidas de 1237 ligas, e numa terça-feira
 * sem jogo brasileiro haveria centenas de partidas ao vivo no mundo que não
 * interessam a ninguém aqui. Com o portão, essa terça custa **zero
 * requisições** — e a cota inteira fica disponível para a noite de quarta.
 *
 * O portão é uma pré-condição, não um modificador de ritmo: quando é `false`,
 * o cron NÃO busca. É a mesma distinção documentada em `hasLiveFavorite` de
 * `core/polling.js`, e confundi-la faz os jogos da manhã de domingo
 * consumirem a janela de 3h e deixarem a noite descoberta.
 *
 * Nota de implementação para o PR 2: saber se há jogo ao vivo numa liga de
 * interesse sem gastar requisição vem da agenda (`football-data.org`, ou uma
 * chamada diária a `/fixtures?date=`), não de `live=all` — perguntar ao
 * `live=all` se vale a pena chamar `live=all` já gastou a requisição.
 *
 * FILTRO DA UI — requisito do PR 3.
 *
 * A grade filtra por liga com `DEFAULT_LEAGUE_IDS` como padrão. `live=all`
 * pode devolver centenas de fixtures de 1237 ligas; sem filtro padrão a
 * página é inutilizável, e mostrar tudo por padrão para depois pedir que o
 * usuário filtre inverte o ônus. O filtro precisa ser afrouxável (ver todas
 * as ligas) e as ligas favoritadas entram junto com as quatro padrão.
 *
 * @param {ReadonlyArray<string>} [favoriteLeagueIds]
 *   Ids de liga favoritados pelo usuário, no formato do modelo interno.
 * @returns {ReadonlySet<string>} Ligas de interesse: as padrão mais as favoritas.
 */
export function leaguesOfInterest(favoriteLeagueIds = []) {
  return new Set([...DEFAULT_LEAGUE_ID_SET, ...favoriteLeagueIds.map(String)]);
}
