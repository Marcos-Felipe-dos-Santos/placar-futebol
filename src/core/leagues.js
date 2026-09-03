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
 * SEMENTE, não filtro.
 *
 * Estas quatro dizem *quais competições interessam*, nunca *quais estão
 * valendo hoje*. Quem responde a segunda pergunta é `activeLeagueIds`, a
 * partir da agenda. Usar esta lista diretamente como filtro é o bug que o
 * desenho evita: uma competição encerrada ficaria nela para sempre, até
 * alguém lembrar de editar a constante.
 *
 * | id | liga                  | tipo   | país   | temporada corrente        |
 * |----|-----------------------|--------|--------|---------------------------|
 * | 71 | Serie A (Brasileirão) | League | Brazil | 2026, 28/01 a 02/12       |
 * | 13 | CONMEBOL Libertadores | Cup    | World  | 2026, 04/02 a 15/09       |
 * | 11 | CONMEBOL Sudamericana | Cup    | World  | 2026, 03/03 a 16/09       |
 * | 73 | Copa do Brasil        | Cup    | Brazil | 2026, 17/02 a 02/09       |
 *
 * DATAS DE FIM — por que a semente não pode ser o filtro: a Copa do Brasil
 * encerrou em 02/09/2026 e as duas competições da CONMEBOL encerram em
 * meados de setembro. A partir daí sobra só o Brasileirão. Com o conjunto
 * efetivo derivado da agenda isso se resolve sozinho: as três param de
 * aparecer e o portão do cron deixa de disparar por elas, sem edição de
 * código. A queda de cobertura ao vivo depois de setembro é esperada, não é
 * o pipeline quebrado.
 *
 * REVISITAR EM 02/12/2026, quando o Brasileirão encerrar. Nessa data a
 * semente inteira fica sem competição em andamento e o portão passa a nunca
 * abrir — a página fica correta e silenciosa, o que é indistinguível de
 * quebrada. Antes disso, acrescente a temporada seguinte ou as competições
 * de janeiro (estaduais, Supercopa) à semente.
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
 * O handler do cron só chama a API upstream se houver partida ao vivo numa
 * liga do CONJUNTO EFETIVO — `activeLeagueIds(agendaDeHoje, favoritas)`, e
 * nunca a semente crua. Sem isso a cota vaza: `live=all` devolve partidas de
 * 1237 ligas, e numa terça-feira sem jogo brasileiro haveria centenas de
 * partidas ao vivo no mundo que não interessam a ninguém aqui. Com o portão,
 * essa terça custa **zero requisições** — e a cota inteira fica disponível
 * para a noite de quarta.
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
 * A grade filtra por liga com o CONJUNTO EFETIVO como padrão — a mesma
 * `activeLeagueIds` que o portão consulta, e não a semente. `live=all` pode
 * devolver centenas de fixtures de 1237 ligas; sem filtro padrão a página é
 * inutilizável, e mostrar tudo por padrão para depois pedir que o usuário
 * filtre inverte o ônus. Derivar da agenda também evita a lista com abas de
 * competições encerradas, que é o que aconteceria com a semente crua.
 *
 * O filtro precisa ser afrouxável (ver todas as ligas) e as favoritadas
 * entram junto com as da semente.
 *
 * @param {ReadonlyArray<string|number>} [favoriteLeagueIds]
 *   Ids de liga favoritados pelo usuário. Aceita número porque o que volta do
 *   `localStorage` nem sempre preserva o tipo.
 * @returns {Set<string>} Ligas de interesse: as da semente mais as favoritas.
 */
export function leaguesOfInterest(favoriteLeagueIds = []) {
  return new Set([...DEFAULT_LEAGUE_ID_SET, ...favoriteLeagueIds.map(String)]);
}

/**
 * O CONJUNTO EFETIVO: ligas de interesse que têm jogo hoje.
 *
 * Interesse ∩ agenda. É isto que o portão do cron consulta e o que o filtro
 * da grade usa — a semente sozinha nunca é o filtro.
 *
 * Uma competição que encerrou simplesmente para de aparecer na agenda e sai
 * daqui no mesmo dia, sem ninguém editar constante. Foi o que motivou o
 * desenho: a Copa do Brasil encerrou em 02/09/2026 e continuaria na lista
 * para sempre se a lista fosse o filtro.
 *
 * Uma fonte, dois usos: o portão do cron já vai consultar a agenda de
 * qualquer jeito para saber se vale gastar cota, e a mesma resposta define o
 * filtro padrão da UI.
 *
 * @param {ReadonlyArray<string|number>|null|undefined} todaysLeagueIds
 *   Ligas com jogo hoje, segundo a agenda.
 *
 *   `[]` e `null` NÃO são a mesma coisa, e confundi-los é a diferença entre
 *   uma economia e um apagão:
 *   - `[]` — a agenda respondeu e não há jogo nenhum de interesse hoje. O
 *     portão fecha, custo zero. É o caso da terça-feira sem jogo brasileiro.
 *   - `null`/`undefined` — não foi possível obter a agenda. Aqui a função
 *     **falha aberto** e devolve todo o conjunto de interesse. Assumir "não
 *     há jogo" apagaria a página o dia inteiro sem erro nenhum na tela, que é
 *     o pior modo de falha possível. Falhar aberto custa cota, mas o custo é
 *     limitado por `computePollInterval` e a reserva da agenda continua
 *     intocada.
 * @param {ReadonlyArray<string|number>} [favoriteLeagueIds]
 * @returns {Set<string>} Conjunto novo. Nunca maior que o de interesse.
 */
export function activeLeagueIds(todaysLeagueIds, favoriteLeagueIds = []) {
  const interesse = leaguesOfInterest(favoriteLeagueIds);

  // Agenda indisponível: falha aberto (ver contrato acima).
  if (todaysLeagueIds == null) return interesse;

  const comJogoHoje = new Set(Array.from(todaysLeagueIds, String));
  return new Set([...interesse].filter((id) => comJogoHoje.has(id)));
}
