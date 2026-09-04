/**
 * O FILTRO DA GRADE — puro, sem DOM.
 *
 * ## De onde sai "o que tem jogo agora"
 *
 * O portão do cron cruza a semente com a AGENDA. O cliente não tem a agenda:
 * `/api/live` serve o snapshot e o estado do cron, e a chave `agenda` do KV
 * nunca sai do Worker. Então aqui o "tem jogo" vem do **próprio snapshot** —
 * as ligas que aparecem nas partidas ao vivo deste instante.
 *
 * É mais estreito que a agenda, e de propósito: numa página de placar AO VIVO,
 * chip de liga que joga só às 21:30 é chip que não mostra nada às 20:00. A
 * agenda responde "há jogo hoje?"; a grade pergunta "há jogo AGORA?", e o
 * snapshot é a resposta exata dessa pergunta.
 *
 * `activeLeagueIds` continua sendo a função do portão, no Worker. Isto aqui
 * não a substitui nem a duplica: é o mesmo desenho — interesse ∩ realidade —
 * com a fonte de realidade que este lado tem.
 *
 * ## O filtro é do LEITOR
 *
 * `live=all` traz partidas de centenas de ligas. Sem filtro padrão a página é
 * inutilizável, e mostrar tudo para depois pedir que o usuário filtre inverte
 * o ônus. Por isso o padrão é o interesse, e "ver todas" é um afrouxamento
 * explícito — nunca o contrário.
 *
 * @module view/filter
 */

import { leaguesOfInterest, uncoveredFavorites } from '../core/leagues.js';

/**
 * Partidas que a grade mostra.
 *
 * @param {object} input
 * @param {ReadonlyArray<import('../core/types.js').Fixture>} input.fixtures
 * @param {ReadonlyArray<string>} [input.favorites]
 * @param {string|null} [input.leagueFilter]
 *   Liga única escolhida pelo usuário, ou `null` para "todas as de interesse".
 * @param {boolean} [input.showAll]
 *   Afrouxamento explícito: mostra o mundo inteiro, fora do interesse.
 * @returns {import('../core/types.js').Fixture[]} Array novo.
 */
export function visibleFixtures(input) {
  const { fixtures, favorites = [], leagueFilter = null, showAll = false } = input;
  const lista = Array.isArray(fixtures) ? fixtures : [];

  // Uma liga escolhida vence tudo, inclusive `showAll`: o usuário pediu ESTA.
  if (leagueFilter !== null) {
    return lista.filter((f) => f?.leagueId === leagueFilter);
  }

  if (showAll) return [...lista];

  const interesse = leaguesOfInterest(favorites);
  return lista.filter((f) => interesse.has(f?.leagueId));
}

/**
 * Os chips de liga, já com o estado de cobertura de cada um.
 *
 * Inclui ligas SEM partida no snapshot quando são favoritas sem cobertura: é
 * justamente aí que o usuário precisa entender por que não vê nada dela. Um
 * chip com zero jogos e o aviso explica; a ausência do chip, não.
 *
 * @param {object} input
 * @param {ReadonlyArray<import('../core/types.js').Fixture>} input.fixtures
 * @param {ReadonlyArray<string>} [input.favorites]
 * @returns {{leagueId: string, leagueName: string, count: number, uncovered: boolean}[]}
 *   Ordenado por nome, para a barra não dançar a cada poll.
 */
export function leagueChips(input) {
  const { fixtures, favorites = [] } = input;
  const lista = Array.isArray(fixtures) ? fixtures : [];
  const interesse = leaguesOfInterest(favorites);
  const semCobertura = uncoveredFavorites(favorites);

  /** @type {Map<string, {leagueId: string, leagueName: string, count: number, uncovered: boolean}>} */
  const porLiga = new Map();

  for (const f of lista) {
    const id = f?.leagueId;
    if (typeof id !== 'string' || !interesse.has(id)) continue;
    const atual = porLiga.get(id);
    if (atual) {
      atual.count += 1;
      // Primeiro nome não vazio vence: uma partida com `leagueName` em branco
      // não pode apagar o nome que outra trouxe. O fallback para o id fica
      // para o fim — aplicá-lo aqui faria o id parecer nome preenchido e o
      // nome de verdade nunca entraria.
      if (!atual.leagueName && f.leagueName) atual.leagueName = f.leagueName;
    } else {
      porLiga.set(id, {
        leagueId: id,
        leagueName: f.leagueName || '',
        count: 1,
        uncovered: semCobertura.has(id),
      });
    }
  }

  // Favorita sem cobertura e sem jogo no snapshot entra assim mesmo, com
  // contagem zero. É o caso que o aviso existe para explicar.
  for (const id of semCobertura) {
    if (!porLiga.has(id)) {
      porLiga.set(id, { leagueId: id, leagueName: id, count: 0, uncovered: true });
    }
  }

  // Fallback do nome só agora, depois de todas as partidas terem tido chance
  // de contribuir com um nome de verdade.
  const chips = [...porLiga.values()].map((c) => ({ ...c, leagueName: c.leagueName || c.leagueId }));
  return chips.sort((a, b) => a.leagueName.localeCompare(b.leagueName, 'pt-BR'));
}

/**
 * Ordem de exibição das partidas.
 *
 * Ao vivo primeiro, depois intervalo, depois o resto — quem abre a página
 * quer ver o que está acontecendo, não o que já acabou. Dentro do mesmo
 * grupo, por horário de início.
 *
 * Função pura e ESTÁVEL: mesma entrada, mesma ordem. Se a ordem dependesse de
 * algo instável, os cartões trocariam de lugar a cada poll e o usuário
 * perderia a partida que estava lendo.
 *
 * @param {ReadonlyArray<import('../core/types.js').Fixture>} fixtures
 * @returns {import('../core/types.js').Fixture[]} Array novo.
 */
export function sortFixtures(fixtures) {
  const peso = { live: 0, halftime: 1, scheduled: 2, finished: 3, cancelled: 4 };
  return [...(Array.isArray(fixtures) ? fixtures : [])].sort((a, b) => {
    const pa = Object.hasOwn(peso, a?.status) ? peso[a.status] : 5;
    const pb = Object.hasOwn(peso, b?.status) ? peso[b.status] : 5;
    if (pa !== pb) return pa - pb;

    const ka = Date.parse(a?.kickoffISO ?? '');
    const kb = Date.parse(b?.kickoffISO ?? '');
    const va = Number.isFinite(ka) ? ka : Number.POSITIVE_INFINITY;
    const vb = Number.isFinite(kb) ? kb : Number.POSITIVE_INFINITY;
    if (va !== vb) return va - vb;

    // Desempate final pelo id: sem ele, duas partidas idênticas em peso e
    // horário poderiam trocar de lugar entre polls.
    return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
  });
}
