import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePins, prunePins, serializePins, diaLocal } from '../src/view/pins.js';
import { makeFixture } from './helpers/fixtures.js';

const HOJE_MS = Date.parse('2026-09-04T18:00:00.000Z');
// Sete dias antes: a "terça passada" do problema real.
const SEMANA_PASSADA_MS = HOJE_MS - 7 * 24 * 3600_000;

// === o caso que o dev pediu explicitamente ==================================

test('FIXTURE FT SALVA: o overlay fica vazio depois do reload', () => {
  // O caminho inteiro do reload: o que estava no localStorage é lido, o
  // snapshot chega dizendo que a partida terminou, e o pin cai. Sem isto, o
  // overlay carrega o jogo de ontem para sempre e o usuário precisa limpar a
  // lista à mão para a página voltar a servir.
  const guardado = JSON.stringify(serializePins(['jogo-que-acabou'], HOJE_MS));

  const lidos = parsePins(guardado, HOJE_MS);
  assert.deepEqual(lidos, ['jogo-que-acabou'], 'o pin do dia nem chegou a ser lido');

  const snapshot = [makeFixture({ id: 'jogo-que-acabou', status: 'finished' })];
  assert.deepEqual(prunePins(lidos, snapshot), [], 'partida encerrada continuou fixada');
});

test('CONTROLE POSITIVO: partida ao vivo salva SOBREVIVE ao reload', () => {
  // Sem este par, um `prunePins` que descartasse tudo passaria no teste acima
  // e o overlay nunca funcionaria — verde com o recurso quebrado.
  const guardado = JSON.stringify(serializePins(['jogo-rolando'], HOJE_MS));
  const lidos = parsePins(guardado, HOJE_MS);
  const snapshot = [makeFixture({ id: 'jogo-rolando', status: 'live' })];

  assert.deepEqual(prunePins(lidos, snapshot), ['jogo-rolando']);
});

// === o corte por dia, na leitura ============================================

test('pin de OUTRO DIA não é lido: o overlay não carrega a terça passada', () => {
  const antigo = JSON.stringify(serializePins(['jogo-de-terca'], SEMANA_PASSADA_MS));
  assert.deepEqual(parsePins(antigo, HOJE_MS), [], 'pin da semana passada sobreviveu');

  // Controle positivo: o MESMO valor, lido no dia dele, é válido.
  assert.deepEqual(parsePins(antigo, SEMANA_PASSADA_MS), ['jogo-de-terca']);
});

test('o dia é LOCAL, não UTC: jogo fixado às 22h de Brasília é de hoje', () => {
  // UTC faria um pin das 22h nascer marcado como do dia seguinte e ser
  // descartado na leitura seguinte, minutos depois. Aqui a pergunta é "foi
  // fixado hoje, para quem olha a tela?", que não tem relação com o reset da
  // cota da API.
  const noite = new Date(2026, 8, 4, 22, 30).getTime();
  const madrugadaMesmoDia = new Date(2026, 8, 4, 23, 59).getTime();
  const diaSeguinte = new Date(2026, 8, 5, 0, 1).getTime();

  const guardado = JSON.stringify(serializePins(['x'], noite));
  assert.deepEqual(parsePins(guardado, madrugadaMesmoDia), ['x'], 'o pin morreu antes da meia-noite');
  assert.deepEqual(parsePins(guardado, diaSeguinte), [], 'o pin sobreviveu à virada do dia');
});

test('diaLocal formata AAAA-MM-DD e recusa instante inválido', () => {
  assert.match(diaLocal(HOJE_MS), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(diaLocal(Number.NaN), '');
});

// === AUSENTE não é ENCERRADO ================================================

test('id ausente do snapshot é MANTIDO: ausência é "não sei", não "acabou"', () => {
  // `live=all` só traz partidas ao vivo. Um jogo no intervalo longo, uma
  // partida que o adaptador descartou naquele minuto ou uma oscilação da
  // resposta fariam o pin sumir e não voltar. Mesma regra de [] contra null na
  // agenda. Quem limpa o órfão é o corte por dia, na leitura.
  const snapshot = [makeFixture({ id: 'outro', status: 'live' })];
  assert.deepEqual(prunePins(['sumiu-desta-vez'], snapshot), ['sumiu-desta-vez']);

  // Controle positivo: presente e encerrado, cai.
  const comFim = [makeFixture({ id: 'sumiu-desta-vez', status: 'finished' })];
  assert.deepEqual(prunePins(['sumiu-desta-vez'], comFim), []);
});

test('cancelada e adiada também caem, não só encerrada', () => {
  const snapshot = [
    makeFixture({ id: 'a', status: 'cancelled' }),
    makeFixture({ id: 'b', status: 'finished' }),
    makeFixture({ id: 'c', status: 'halftime' }),
    makeFixture({ id: 'd', status: 'scheduled' }),
  ];
  assert.deepEqual(prunePins(['a', 'b', 'c', 'd'], snapshot), ['c', 'd']);
});

test('intervalo NÃO é terminal: o jogo volta do vestiário', () => {
  // Se `halftime` caísse aqui, o overlay perderia a partida justamente na
  // pausa e ela não voltaria sozinha no segundo tempo.
  const snapshot = [makeFixture({ id: 'no-intervalo', status: 'halftime' })];
  assert.deepEqual(prunePins(['no-intervalo'], snapshot), ['no-intervalo']);
});

// === robustez ===============================================================

test('localStorage corrompido devolve lista vazia, não derruba a página', () => {
  assert.deepEqual(parsePins('não é json {{{', HOJE_MS), []);
  assert.deepEqual(parsePins(null, HOJE_MS), []);
  assert.deepEqual(parsePins(undefined, HOJE_MS), []);
  assert.deepEqual(parsePins('[1,2,3]', HOJE_MS), [], 'array cru não tem dia associado');
  assert.deepEqual(parsePins(JSON.stringify({ dia: diaLocal(HOJE_MS) }), HOJE_MS), []);
  assert.deepEqual(
    parsePins(JSON.stringify({ dia: diaLocal(HOJE_MS), ids: ['bom', 42, '', null] }), HOJE_MS),
    ['bom'],
    'id que não é string não pode virar seletor de DOM',
  );
});

test('as funções são puras: não mutam a entrada', () => {
  const ids = ['a', 'b'];
  const copia = [...ids];
  const fixtures = [makeFixture({ id: 'a', status: 'finished' })];

  prunePins(ids, fixtures);
  serializePins(ids, HOJE_MS).ids.push('c');

  assert.deepEqual(ids, copia);
});

test('prunePins aceita entrada inválida sem quebrar', () => {
  assert.deepEqual(prunePins(null, []), []);
  assert.deepEqual(prunePins(['a'], null), ['a'], 'sem snapshot não há como saber que acabou');
});
