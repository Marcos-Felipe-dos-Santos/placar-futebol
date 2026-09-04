import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LEAGUE_IDS,
  DEFAULT_LEAGUE_ID_SET,
  leaguesOfInterest,
  activeLeagueIds,
  uncoveredFavorites,
} from '../src/core/leagues.js';

test('as quatro ligas prioritárias estão registradas com os ids da API-Football', () => {
  // Ids conferidos contra leagues-sample.json: 71 Serie A (Brasil),
  // 13 Libertadores, 11 Sudamericana, 73 Copa do Brasil.
  assert.deepEqual([...DEFAULT_LEAGUE_IDS], [71, 13, 11, 73]);
});

test('a lista padrão é imutável', () => {
  assert.throws(() => DEFAULT_LEAGUE_IDS.push(39), TypeError);
  assert.equal(DEFAULT_LEAGUE_IDS.length, 4);
});

test('o conjunto de ids é string, como o modelo interno carrega leagueId', () => {
  // Comparar número com string no filtro faria a grade vir vazia sem erro.
  for (const id of DEFAULT_LEAGUE_IDS) {
    assert.ok(DEFAULT_LEAGUE_ID_SET.has(String(id)), `${id} ausente como string`);
    assert.ok(!DEFAULT_LEAGUE_ID_SET.has(id), 'o conjunto não deve conter números');
  }
});

test('leaguesOfInterest sem favoritos é exatamente o conjunto padrão', () => {
  const ligas = leaguesOfInterest();
  assert.deepEqual([...ligas].sort(), ['11', '13', '71', '73']);
});

test('leaguesOfInterest soma as favoritas às padrão, sem duplicar', () => {
  const ligas = leaguesOfInterest(['39', '71']);
  assert.ok(ligas.has('39'), 'a liga favoritada entra');
  assert.ok(ligas.has('71'), 'as padrão continuam');
  assert.equal(ligas.size, 5, 'favoritar uma liga que já é padrão não duplica');
});

test('leaguesOfInterest normaliza favoritas numéricas para string', () => {
  const ligas = leaguesOfInterest([/** @type {any} */ (39)]);
  assert.ok(ligas.has('39'), 'id numérico vindo do localStorage não pode escapar do filtro');
});

test('leaguesOfInterest devolve conjunto novo: não contamina o padrão', () => {
  const ligas = leaguesOfInterest(['999']);
  ligas.add('12345');
  assert.ok(!DEFAULT_LEAGUE_ID_SET.has('999'));
  assert.ok(!DEFAULT_LEAGUE_ID_SET.has('12345'));
  assert.equal(DEFAULT_LEAGUE_ID_SET.size, 4);
});

// --- conjunto efetivo, derivado da agenda -----------------------------------
// A semente sozinha não é o filtro: uma liga encerrada continuaria na lista
// para sempre até alguém editar a constante. O conjunto efetivo é a interseção
// do interesse com o que a agenda diz ter jogo hoje.
//
// DOIS CHAMADORES: o portão do cron passa UM argumento (semente ∩ agenda,
// porque o portão é global); o filtro da UI passa DOIS (favoritas do
// navegador incluídas). Os testes abaixo com segundo argumento exercitam o
// caminho da UI, nunca o do cron — quem prende o do cron é
// `worker.test.js`.

test('liga encerrada sai do conjunto sem ninguém editar constante', () => {
  // A Copa do Brasil (73) encerrou em 02/09/2026: não aparece mais na agenda.
  const agendaDeHoje = ['71', '13'];
  const ativas = activeLeagueIds(agendaDeHoje);

  assert.ok(!ativas.has('73'), 'liga sem jogo hoje não pode entrar no conjunto efetivo');
  assert.ok(ativas.has('71'));
  assert.ok(ativas.has('13'));
  assert.equal(ativas.size, 2);
});

test('liga com jogo hoje que não é de interesse fica de fora', () => {
  // A Premier League (39) tem jogo, mas não é semente nem favorita.
  const ativas = activeLeagueIds(['39', '71']);
  assert.ok(!ativas.has('39'), 'live=all traz 1237 ligas; interesse continua sendo filtro');
  assert.deepEqual([...ativas], ['71']);
});

test('favorita com jogo hoje entra mesmo sem ser semente', () => {
  const ativas = activeLeagueIds(['39', '71'], ['39']);
  assert.ok(ativas.has('39'));
  assert.ok(ativas.has('71'));
  assert.equal(ativas.size, 2);
});

test('favorita sem jogo hoje não entra', () => {
  const ativas = activeLeagueIds(['71'], ['39']);
  assert.ok(!ativas.has('39'), 'favoritar não cria jogo');
});

test('agenda vazia zera o conjunto efetivo, favorita ou não', () => {
  // Sem segundo argumento é o caminho do cron: conjunto vazio é o sinal de
  // que não há o que buscar, e a terça sem jogo custa zero requisição.
  assert.equal(activeLeagueIds([]).size, 0, 'agenda vazia deixou liga no efetivo');
  // Com favoritas é o caminho da UI: favoritar não cria jogo onde não há.
  assert.equal(activeLeagueIds([], ['39']).size, 0, 'favorita entrou com agenda vazia');
});

test('agenda DESCONHECIDA falha aberto, não fechado', () => {
  // Distinção que decide se o produto morre calado: `[]` é "a agenda
  // respondeu e não há jogo" (portão fecha, custo zero); `null` é "não
  // consegui a agenda" — e aí assumir que não há jogo apagaria a página o dia
  // inteiro sem erro nenhum na tela. O orçamento de cota continua limitando o
  // gasto, então falhar aberto é limitado; falhar fechado é silencioso.
  // Caminho do cron (um argumento): falha aberto sobre a semente.
  assert.deepEqual([...activeLeagueIds(null)].sort(), ['11', '13', '71', '73']);
  assert.deepEqual([...activeLeagueIds(undefined)].sort(), ['11', '13', '71', '73']);
  // Caminho da UI (dois): falha aberto sobre semente + favoritas.
  const semAgenda = activeLeagueIds(null, ['39']);
  assert.deepEqual([...semAgenda].sort(), ['11', '13', '39', '71', '73']);
});

test('a agenda aceita ids numéricos e normaliza para string', () => {
  const ativas = activeLeagueIds([71, 13], [39]);
  assert.ok(ativas.has('71'));
  assert.ok(ativas.has('13'));
  assert.ok(!ativas.has('39'), 'favorita numérica sem jogo hoje continua fora');
  assert.equal(ativas.size, 2);
});

test('agenda com liga repetida não duplica', () => {
  const ativas = activeLeagueIds(['71', '71', 71]);
  assert.equal(ativas.size, 1);
});

test('activeLeagueIds é puro: não muta entradas nem o conjunto padrão', () => {
  const agenda = ['71', '13'];
  const favoritas = ['39'];
  const copiaAgenda = [...agenda];
  const copiaFavoritas = [...favoritas];

  const ativas = activeLeagueIds(agenda, favoritas);
  ativas.add('99999');

  assert.deepEqual(agenda, copiaAgenda);
  assert.deepEqual(favoritas, copiaFavoritas);
  assert.equal(DEFAULT_LEAGUE_ID_SET.size, 4);
  assert.ok(!DEFAULT_LEAGUE_ID_SET.has('99999'));
});

test('o conjunto efetivo nunca é maior que o de interesse', () => {
  // Invariante: a agenda só pode TIRAR ligas, nunca acrescentar. Se um dia
  // esta função passar a devolver liga que ninguém pediu, o portão do cron
  // começa a gastar cota com jogo que não interessa. Vale nos dois caminhos;
  // aqui está exercitado o da UI, que é o mais folgado dos dois.
  const agenda = ['71', '13', '11', '73', '39', '140', '135'];
  const ativas = activeLeagueIds(agenda, ['39']);
  const interesse = leaguesOfInterest(['39']);

  for (const id of ativas) {
    assert.ok(interesse.has(id), `${id} entrou no efetivo sem estar no interesse`);
  }
  assert.ok(ativas.size <= interesse.size);
});

// === uncoveredFavorites: a limitação que a UI do PR 3 precisa MOSTRAR ======
//
// Favorita fora da semente nunca CAUSA uma busca — o portão do cron é global
// e olha só a semente. A partida pode aparecer de carona numa busca disparada
// pelo Brasileirão, então o aviso correto é "sem cobertura ao vivo
// garantida", não "não funciona".

test('favorita fora da semente é reportada como sem cobertura garantida', () => {
  const semCobertura = uncoveredFavorites(['39', '140']);
  assert.deepEqual([...semCobertura].sort(), ['140', '39']);
});

test('favorita que é da semente não gera aviso', () => {
  // Controle positivo do teste anterior: se `uncoveredFavorites` devolvesse
  // tudo o que recebe, o assert acima passaria e este falharia.
  assert.equal(uncoveredFavorites(['71', '13']).size, 0, 'liga da semente virou aviso');
});

test('sem favoritas não há aviso nenhum', () => {
  assert.equal(uncoveredFavorites().size, 0);
  assert.equal(uncoveredFavorites([]).size, 0);
});

test('uncoveredFavorites normaliza número, como vem do localStorage', () => {
  const semCobertura = uncoveredFavorites([/** @type {any} */ (39), /** @type {any} */ (71)]);
  assert.deepEqual([...semCobertura], ['39'], '71 numérico é da semente e não pode virar aviso');
});

test('uncoveredFavorites é puro: não muta a entrada nem a semente', () => {
  const favoritas = ['39', '71'];
  const copia = [...favoritas];
  const semCobertura = uncoveredFavorites(favoritas);
  semCobertura.add('99999');

  assert.deepEqual(favoritas, copia);
  assert.equal(DEFAULT_LEAGUE_ID_SET.size, 4);
});
