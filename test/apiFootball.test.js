import test from 'node:test';
import assert from 'node:assert/strict';
import { toFixtures, STATUS_MAP } from '../src/adapters/apiFootball.js';
import {
  primeiroTempo,
  primeiroTempoAcrescimo,
  segundoTempo,
  segundoTempoSaturado,
  envelopeVazio,
} from './helpers/apiFootballSamples.js';

/** Envelope real em volta de uma lista de fixtures crus. */
function envelope(response) {
  return { ...envelopeVazio, results: response.length, response };
}

// --- shape real -------------------------------------------------------------

test('mapeia uma partida real de primeiro tempo para o modelo interno', () => {
  const [f] = toFixtures(envelope([primeiroTempo]));

  assert.deepEqual(f, {
    id: '1611381',
    homeName: 'JS El Biar',
    awayName: 'Olympique Akbou',
    homeGoals: 0,
    awayGoals: 0,
    status: 'live',
    elapsedMin: 15,
    kickoffISO: '2026-09-03T20:00:00+00:00',
    leagueId: '186',
    leagueName: 'Ligue 1',
  });
});

test('mapeia uma partida real de segundo tempo com placar aberto', () => {
  const [f] = toFixtures(envelope([segundoTempo]));

  assert.equal(f.status, 'live');
  assert.equal(f.homeGoals, 1);
  assert.equal(f.awayGoals, 0);
  assert.equal(f.elapsedMin, 49);
  assert.equal(f.leagueName, 'Liga Pro');
});

test('converte fixture.id e league.id de número para string', () => {
  // O arquivo real traz os dois como number; o modelo interno exige string.
  // Sem a conversão o diff compara chaves de tipos diferentes e o filtro de
  // liga vem vazio — as duas falhas silenciosas.
  assert.equal(typeof primeiroTempo.fixture.id, 'number', 'premissa: o arquivo traz number');
  assert.equal(typeof primeiroTempo.league.id, 'number', 'premissa: o arquivo traz number');

  const [f] = toFixtures(envelope([primeiroTempo]));
  assert.equal(typeof f.id, 'string');
  assert.equal(typeof f.leagueId, 'string');
  assert.equal(f.id, '1611381');
  assert.equal(f.leagueId, '186');
});

test('preserva a data de início verbatim, com o offset que o arquivo traz', () => {
  const [f] = toFixtures(envelope([primeiroTempo]));
  assert.equal(f.kickoffISO, primeiroTempo.fixture.date);
  assert.match(f.kickoffISO, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
});

test('processa as quatro amostras reais sem perder nenhuma', () => {
  const amostras = [primeiroTempo, primeiroTempoAcrescimo, segundoTempo, segundoTempoSaturado];
  const fixtures = toFixtures(envelope(amostras));

  assert.equal(fixtures.length, 4);
  assert.equal(new Set(fixtures.map((f) => f.id)).size, 4, 'ids continuam únicos');
  for (const f of fixtures) {
    assert.equal(typeof f.id, 'string');
    assert.equal(typeof f.leagueId, 'string');
    assert.ok(f.homeName && f.awayName, 'nome de time nunca vazio');
  }
});

// --- elapsed satura, e isso é da fonte --------------------------------------

test('elapsed satura em 45 no primeiro tempo com acréscimo correndo', () => {
  // A partida está em 45+3, e a API reporta elapsed: 45. O adaptador NÃO
  // corrige isso: 45' travado é o que a fonte diz, e inventar 48 seria dado
  // fabricado. A UI mostrar 45' aqui é correto, não bug.
  assert.equal(primeiroTempoAcrescimo.fixture.status.elapsed, 45, 'premissa do arquivo');
  assert.equal(primeiroTempoAcrescimo.fixture.status.extra, 3, 'premissa do arquivo');

  const [f] = toFixtures(envelope([primeiroTempoAcrescimo]));
  assert.equal(f.elapsedMin, 45);
});

test('elapsed satura em 90 no segundo tempo', () => {
  assert.equal(segundoTempoSaturado.fixture.status.elapsed, 90, 'premissa do arquivo');
  const [f] = toFixtures(envelope([segundoTempoSaturado]));
  assert.equal(f.elapsedMin, 90);
  assert.equal(f.status, 'live', 'saturado em 90 continua ao vivo, não encerrado');
});

test('elapsed nulo entra como null, não como zero', () => {
  const cru = structuredClone(primeiroTempo);
  cru.fixture.status.elapsed = null;
  const [f] = toFixtures(envelope([cru]));
  assert.equal(f.elapsedMin, null, "0' seria um minuto de jogo; null é ausência de informação");
});

// --- goals nulos ------------------------------------------------------------

test('goals nulos entram como null, nunca como zero', () => {
  // É a regra que evita o gol fantasma: null → 0 no apito inicial não pode
  // parecer um gol para o diff.
  const cru = structuredClone(primeiroTempo);
  cru.goals = { home: null, away: null };
  const [f] = toFixtures(envelope([cru]));

  assert.equal(f.homeGoals, null);
  assert.equal(f.awayGoals, null);
});

test('zero real continua zero — null e 0 não se confundem nos dois sentidos', () => {
  // Controle positivo do teste acima: se o adaptador transformasse tudo em
  // null, aquele teste passaria sem provar nada.
  const [f] = toFixtures(envelope([primeiroTempo]));
  assert.equal(f.homeGoals, 0);
  assert.equal(f.awayGoals, 0);
  assert.notEqual(f.homeGoals, null);
});

test('um lado nulo não contamina o outro', () => {
  const cru = structuredClone(segundoTempo);
  cru.goals = { home: 1, away: null };
  const [f] = toFixtures(envelope([cru]));
  assert.equal(f.homeGoals, 1);
  assert.equal(f.awayGoals, null);
});

// --- status -----------------------------------------------------------------

test('todo status.short do arquivo real está mapeado explicitamente', () => {
  // O arquivo só tem 1H e 2H. Se um snapshot futuro trouxer outro código,
  // este teste não pega — por isso o mapa cobre a documentação inteira e o
  // desconhecido tem destino definido.
  for (const short of ['1H', '2H']) {
    assert.ok(short in STATUS_MAP, `${short} não está no mapa de status`);
    assert.equal(STATUS_MAP[short], 'live');
  }
});

test('o mapa cobre os códigos documentados sem exemplo no arquivo', () => {
  const esperado = {
    TBD: 'scheduled',
    NS: 'scheduled',
    '1H': 'live',
    '2H': 'live',
    ET: 'live',
    P: 'live',
    LIVE: 'live',
    SUSP: 'live',
    INT: 'live',
    HT: 'halftime',
    BT: 'halftime',
    FT: 'finished',
    AET: 'finished',
    PEN: 'finished',
    PST: 'cancelled',
    CANC: 'cancelled',
    ABD: 'cancelled',
    AWD: 'cancelled',
    WO: 'cancelled',
  };
  for (const [short, interno] of Object.entries(esperado)) {
    assert.equal(STATUS_MAP[short], interno, `${short} deveria virar ${interno}`);
  }
});

test('status desconhecido NUNCA vira live', () => {
  // A regra que impede um código novo da API de fazer a página alertar gol
  // numa partida que não está acontecendo.
  for (const desconhecido of ['XYZ', '', 'live', '3H', 'FT_PEN', null, undefined, 42]) {
    const cru = structuredClone(primeiroTempo);
    cru.fixture.status.short = desconhecido;
    const [f] = toFixtures(envelope([cru]));
    assert.notEqual(f.status, 'live', `${String(desconhecido)} virou live`);
    assert.equal(f.status, 'scheduled', `${String(desconhecido)} deveria cair em scheduled`);
  }
});

test('nenhum valor do mapa está fora dos cinco status do modelo interno', () => {
  const validos = new Set(['scheduled', 'live', 'halftime', 'finished', 'cancelled']);
  for (const [short, interno] of Object.entries(STATUS_MAP)) {
    assert.ok(validos.has(interno), `${short} mapeia para ${interno}, que não é status do modelo`);
  }
});

// --- envelope e erros -------------------------------------------------------

test('resposta sem partidas devolve lista vazia, não erro', () => {
  assert.deepEqual(toFixtures(envelopeVazio), []);
});

test('errors preenchido lança, mesmo com HTTP 200', () => {
  // A API-Football devolve 200 com errors populado quando o plano não cobre
  // o endpoint. Tratar isso como "zero partidas" apagaria a página em
  // silêncio e o Worker gravaria um snapshot vazio por cima de um bom.
  assert.throws(
    () => toFixtures({ ...envelopeVazio, errors: { token: 'invalid' } }),
    /api-football/i,
  );
  assert.throws(() => toFixtures({ ...envelopeVazio, errors: ['plan limit'] }), /api-football/i);
});

test('errors como array vazio é sucesso, não erro', () => {
  // Controle positivo: o arquivo real traz errors: [] em resposta boa.
  assert.deepEqual(primeiroTempo && envelopeVazio.errors, []);
  assert.doesNotThrow(() => toFixtures(envelopeVazio));
});

test('envelope malformado lança em vez de devolver lista vazia', () => {
  for (const ruim of [null, undefined, {}, { response: null }, { response: 'x' }, 42, []]) {
    assert.throws(() => toFixtures(ruim), /api-football/i, `${JSON.stringify(ruim)} não lançou`);
  }
});

test('partida individual malformada é descartada sem derrubar as demais', () => {
  const semTimes = structuredClone(segundoTempo);
  delete semTimes.teams;

  const fixtures = toFixtures(envelope([primeiroTempo, semTimes, segundoTempoSaturado]));
  assert.equal(fixtures.length, 2, 'uma partida quebrada não pode custar o snapshot inteiro');
  assert.deepEqual(fixtures.map((f) => f.id), ['1611381', String(segundoTempoSaturado.fixture.id)]);
});

test('partida sem id é descartada', () => {
  const semId = structuredClone(primeiroTempo);
  semId.fixture.id = null;
  assert.deepEqual(toFixtures(envelope([semId])), []);
});

// --- pureza -----------------------------------------------------------------

test('toFixtures não muta a resposta recebida', () => {
  const entrada = envelope([primeiroTempo, segundoTempo]);
  const copia = structuredClone(entrada);
  toFixtures(entrada);
  assert.deepEqual(entrada, copia);
});

test('o resultado não compartilha referência com o payload cru', () => {
  const entrada = envelope([primeiroTempo]);
  const [f] = toFixtures(entrada);
  f.homeName = 'MUTADO';
  assert.equal(entrada.response[0].teams.home.name, 'JS El Biar');
});
