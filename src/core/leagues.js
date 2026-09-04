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
 * As ligas que ESTE NAVEGADOR quer ver: a semente mais as favoritas dele.
 *
 * ESCOPO DO ARGUMENTO: interface, e só — a função inteira não, porque o
 * portão do cron também chega aqui, via `activeLeagueIds(agenda)`, e nesse
 * caminho `favoriteLeagueIds` é `[]` e o resultado é a semente crua.
 *
 * As favoritas moram no `localStorage` de cada navegador; o portão do cron é
 * global e único para todos os visitantes.
 * Levar favorita ao Worker exigiria estado por usuário no KV e deixaria
 * qualquer visitante abrir o portão e gastar a cota do dono da chave — que é
 * uma chave só, com 100 requisições/dia. Desproporcional para uso pessoal e
 * perigoso num portfólio público, então favorita nunca chega ao Worker.
 *
 * A consequência é visível e precisa ser MOSTRADA, não só documentada: ver
 * `uncoveredFavorites`.
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
 * ## DOIS CHAMADORES, DOIS NÚMEROS DE ARGUMENTOS
 *
 * - **PORTÃO DO CRON — `activeLeagueIds(agendaDeHoje)`, um argumento.** O
 *   Worker chama assim de propósito, não por esquecimento: o portão é global
 *   e opera sobre a SEMENTE ∩ agenda. Sem isso a cota vaza — `live=all`
 *   devolve partidas de 1237 ligas, e numa terça sem jogo brasileiro haveria
 *   centenas de partidas ao vivo no mundo que não interessam a ninguém aqui.
 *   Com o portão, essa terça custa **zero requisições**.
 *
 *   O portão é uma pré-condição, não um modificador de ritmo: quando fecha, o
 *   cron NÃO busca. É a mesma distinção documentada em `hasLiveFavorite` de
 *   `core/polling.js`, e confundi-la faz os jogos da manhã de domingo
 *   consumirem a janela de 3h e deixarem a noite descoberta.
 *
 *   Saber se há jogo ao vivo numa liga de interesse sem gastar requisição vem
 *   da agenda, não de `live=all` — perguntar ao `live=all` se vale a pena
 *   chamar `live=all` já gastou a requisição.
 *
 * - **FILTRO DA UI — `activeLeagueIds(agendaDeHoje, favoritas)`, dois.** A
 *   grade filtra por liga com o conjunto efetivo como padrão, e aí as
 *   favoritas entram. `live=all` pode devolver centenas de fixtures; sem
 *   filtro padrão a página é inutilizável, e mostrar tudo por padrão para
 *   depois pedir que o usuário filtre inverte o ônus. O filtro precisa ser
 *   afrouxável (ver todas as ligas).
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
 *   SÓ o filtro da UI passa este argumento. O portão do cron omite-o — ver o
 *   bloco acima e `leaguesOfInterest` para o motivo.
 * @returns {Set<string>} Conjunto novo. Nunca maior que o de interesse.
 */
export function activeLeagueIds(todaysLeagueIds, favoriteLeagueIds = []) {
  const interesse = leaguesOfInterest(favoriteLeagueIds);

  // Agenda indisponível: falha aberto (ver contrato acima).
  if (todaysLeagueIds == null) return interesse;

  const comJogoHoje = new Set(Array.from(todaysLeagueIds, String));
  return new Set([...interesse].filter((id) => comJogoHoje.has(id)));
}

/**
 * Favoritas que o portão do cron nunca vai abrir.
 *
 * Como o portão opera sobre a SEMENTE, favoritar a Premier League não faz o
 * cron buscar por causa dela. A partida ainda pode aparecer — `live=all`
 * devolve o mundo inteiro, e se uma busca aconteceu por causa do Brasileirão
 * a inglesa vem de carona —, mas nada nela CAUSA uma busca. Cobertura ao vivo
 * não garantida, portanto, e não "não funciona".
 *
 * Isto existe para o PR 3 EXIBIR o aviso na UI, não para o cliente filtrar
 * nada. Página correta e vazia é indistinguível de página quebrada, e é o
 * modo de falha que este projeto mais combate: uma favorita silenciosamente
 * sem jogo nenhum é exatamente ele entrando pela porta da frente.
 *
 * @param {ReadonlyArray<string|number>} [favoriteLeagueIds]
 * @returns {Set<string>} Favoritas fora da semente. Vazio quando todas estão
 *   cobertas — e aí a UI não mostra aviso nenhum.
 */
export function uncoveredFavorites(favoriteLeagueIds = []) {
  return new Set(
    favoriteLeagueIds.map(String).filter((id) => !DEFAULT_LEAGUE_ID_SET.has(id)),
  );
}
