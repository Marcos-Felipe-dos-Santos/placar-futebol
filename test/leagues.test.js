import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LEAGUE_IDS,
  DEFAULT_LEAGUE_ID_SET,
  leaguesOfInterest,
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
