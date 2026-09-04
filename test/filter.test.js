import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleFixtures, leagueChips, sortFixtures } from '../src/view/filter.js';
import { DEFAULT_LEAGUE_ID_SET } from '../src/core/leagues.js';
import { makeFixture } from './helpers/fixtures.js';

const brasileirao = () => makeFixture({ id: 'b1', leagueId: '71', leagueName: 'Serie A' });
const libertadores = () => makeFixture({ id: 'l1', leagueId: '13', leagueName: 'Libertadores' });
const premier = () => makeFixture({ id: 'p1', leagueId: '39', leagueName: 'Premier League' });
const obscura = () => makeFixture({ id: 'o1', leagueId: '999', leagueName: 'Liga Obscura' });

// === visibleFixtures ========================================================

test('o padrão é o INTERESSE, não o mundo inteiro', () => {
  // `live=all` traz centenas de ligas. Sem filtro padrão a página é
  // inutilizável, e mostrar tudo para depois pedir que o usuário filtre
  // inverte o ônus.
  const vistas = visibleFixtures({ fixtures: [brasileirao(), premier(), obscura()] });
  assert.deepEqual(vistas.map((f) => f.leagueId), ['71']);
});

test('favorita entra no padrão sem precisar de "ver todas"', () => {
  const vistas = visibleFixtures({
    fixtures: [brasileirao(), premier(), obscura()],
    favorites: ['39'],
  });
  assert.deepEqual(vistas.map((f) => f.leagueId).sort(), ['39', '71']);
});

test('"ver todas" é afrouxamento EXPLÍCITO, nunca o padrão', () => {
  const fixtures = [brasileirao(), premier(), obscura()];
  assert.equal(visibleFixtures({ fixtures }).length, 1);
  // Controle positivo: pedido explicitamente, mostra tudo.
  assert.equal(visibleFixtures({ fixtures, showAll: true }).length, 3);
});

test('liga escolhida vence até o "ver todas": o usuário pediu ESTA', () => {
  const fixtures = [brasileirao(), premier(), obscura()];
  const vistas = visibleFixtures({ fixtures, leagueFilter: '999', showAll: true });
  assert.deepEqual(vistas.map((f) => f.leagueId), ['999']);
});

test('visibleFixtures é puro: não muta a entrada nem devolve a mesma lista', () => {
  const fixtures = [brasileirao(), premier()];
  const copia = [...fixtures];
  const vistas = visibleFixtures({ fixtures, showAll: true });
  vistas.push(obscura());

  assert.deepEqual(fixtures, copia);
  assert.equal(fixtures.length, 2);
});

test('entrada ausente ou inválida devolve lista vazia, não quebra a página', () => {
  assert.deepEqual(visibleFixtures({ fixtures: null }), []);
  assert.deepEqual(visibleFixtures({ fixtures: undefined }), []);
});

// === leagueChips ============================================================

test('os chips contam as partidas de cada liga de interesse', () => {
  const chips = leagueChips({
    fixtures: [brasileirao(), makeFixture({ id: 'b2', leagueId: '71', leagueName: 'Serie A' }), libertadores()],
  });

  const serieA = chips.find((c) => c.leagueId === '71');
  assert.equal(serieA.count, 2);
  assert.equal(serieA.leagueName, 'Serie A');
  assert.equal(chips.length, 2);
});

test('liga fora do interesse não vira chip', () => {
  const chips = leagueChips({ fixtures: [brasileirao(), obscura()] });
  assert.deepEqual(chips.map((c) => c.leagueId), ['71']);
});

test('FAVORITA SEM COBERTURA vira chip mesmo com zero jogos', () => {
  // O caso que o aviso existe para explicar. Sem o chip, o usuário favorita a
  // Premier League, não vê nada, e não tem como saber por quê — a ausência não
  // explica, o chip com zero e o aviso explicam.
  const chips = leagueChips({ fixtures: [brasileirao()], favorites: ['39'] });

  const pl = chips.find((c) => c.leagueId === '39');
  assert.ok(pl, 'favorita sem jogo sumiu da barra');
  assert.equal(pl.count, 0);
  assert.equal(pl.uncovered, true);
});

test('liga da SEMENTE nunca é marcada como sem cobertura', () => {
  // Controle positivo do teste acima: se `uncovered` viesse true para tudo, o
  // aviso viraria ruído e ninguém leria nenhum.
  const chips = leagueChips({ fixtures: [brasileirao(), libertadores()], favorites: ['71'] });
  for (const chip of chips) {
    assert.equal(chip.uncovered, false, `${chip.leagueId} é da semente e foi marcada sem cobertura`);
    assert.ok(DEFAULT_LEAGUE_ID_SET.has(chip.leagueId));
  }
});

test('favorita COM cobertura e com jogo aparece sem aviso', () => {
  const chips = leagueChips({ fixtures: [premier()], favorites: ['39'] });
  const pl = chips.find((c) => c.leagueId === '39');
  assert.equal(pl.count, 1);
  assert.equal(pl.uncovered, true, 'a Premier está fora da semente: o aviso continua valendo');
});

test('nome de liga em branco não apaga o nome que outra partida trouxe', () => {
  const chips = leagueChips({
    fixtures: [
      makeFixture({ id: 'a', leagueId: '71', leagueName: '' }),
      makeFixture({ id: 'b', leagueId: '71', leagueName: 'Serie A' }),
    ],
  });
  assert.equal(chips[0].leagueName, 'Serie A');
  assert.equal(chips[0].count, 2);
});

test('a ordem dos chips é estável: a barra não dança a cada poll', () => {
  const fixtures = [libertadores(), brasileirao()];
  const uma = leagueChips({ fixtures }).map((c) => c.leagueId);
  const outra = leagueChips({ fixtures: [...fixtures].reverse() }).map((c) => c.leagueId);
  assert.deepEqual(uma, outra, 'a ordem mudou só porque a entrada veio ao contrário');
});

// === sortFixtures ===========================================================

test('ao vivo vem antes de intervalo, encerrado e cancelado', () => {
  // Quem abre a página quer ver o que está acontecendo, não o que já acabou.
  const fixtures = [
    makeFixture({ id: 'f', status: 'finished' }),
    makeFixture({ id: 'c', status: 'cancelled' }),
    makeFixture({ id: 'v', status: 'live' }),
    makeFixture({ id: 'i', status: 'halftime' }),
    makeFixture({ id: 's', status: 'scheduled' }),
  ];
  assert.deepEqual(sortFixtures(fixtures).map((f) => f.id), ['v', 'i', 's', 'f', 'c']);
});

test('dentro do mesmo estado, ordena por horário de início', () => {
  const cedo = makeFixture({ id: 'cedo', status: 'live', kickoffISO: '2026-09-04T18:00:00+00:00' });
  const tarde = makeFixture({ id: 'tarde', status: 'live', kickoffISO: '2026-09-04T21:00:00+00:00' });
  assert.deepEqual(sortFixtures([tarde, cedo]).map((f) => f.id), ['cedo', 'tarde']);
});

test('A ORDEM É ESTÁVEL — o cartão não troca de lugar entre polls', () => {
  // Se a ordem oscilasse, o usuário perderia a partida que estava lendo no
  // meio de um gol. Duas partidas iguais em estado e horário desempatam pelo
  // id, que não muda.
  const a = makeFixture({ id: 'aaa', status: 'live', kickoffISO: '2026-09-04T18:00:00+00:00' });
  const b = makeFixture({ id: 'bbb', status: 'live', kickoffISO: '2026-09-04T18:00:00+00:00' });

  assert.deepEqual(sortFixtures([a, b]).map((f) => f.id), ['aaa', 'bbb']);
  assert.deepEqual(sortFixtures([b, a]).map((f) => f.id), ['aaa', 'bbb']);
});

test('kickoff inválido vai para o fim do grupo, e não quebra a ordenação', () => {
  const bom = makeFixture({ id: 'bom', status: 'live', kickoffISO: '2026-09-04T18:00:00+00:00' });
  const ruim = makeFixture({ id: 'ruim', status: 'live', kickoffISO: 'não é data' });
  assert.deepEqual(sortFixtures([ruim, bom]).map((f) => f.id), ['bom', 'ruim']);
});

test('status desconhecido não some da grade: vai para o fim', () => {
  // Sumir em silêncio é o modo de falha que este projeto combate. Um status
  // que o mapa não conhece ainda tem partida, times e placar para mostrar.
  const estranho = makeFixture({ id: 'x', status: 'inventado' });
  const vivo = makeFixture({ id: 'v', status: 'live' });
  const ordenadas = sortFixtures([estranho, vivo]);
  assert.deepEqual(ordenadas.map((f) => f.id), ['v', 'x']);
  assert.equal(ordenadas.length, 2, 'a partida com status estranho sumiu');
});

test('sortFixtures é puro: não muta a entrada', () => {
  const fixtures = [makeFixture({ id: 'b', status: 'finished' }), makeFixture({ id: 'a', status: 'live' })];
  const copia = fixtures.map((f) => f.id);
  sortFixtures(fixtures);
  assert.deepEqual(fixtures.map((f) => f.id), copia);
});
