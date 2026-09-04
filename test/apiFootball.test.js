import test from 'node:test';
import assert from 'node:assert/strict';
import { hasMatchInProgress } from '../src/core/gate.js';
import * as amostrasVerbatim from './helpers/apiFootballSamples.js';
import {
  toFixtures,
  toFixturesWithReport,
  toAgenda,
  toAgendaWithReport,
  STATUS_MAP,
} from '../src/adapters/apiFootball.js';
import {
  primeiroTempo,
  primeiroTempoAcrescimo,
  segundoTempo,
  segundoTempoSaturado,
  envelopeVazio,
  agendaNS,
  agendaFT,
  agendaPST,
  agendaPEN,
  agenda1H,
  agendaHT,
  envelopeAgendaVazio,
  picoIntervalo,
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

test('elapsed 90 em 2H passa verbatim e continua live', () => {
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
  assert.deepEqual(envelopeVazio.errors, [], 'premissa do arquivo');
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

test('partida sem id é descartada e a irmã boa sobrevive', () => {
  // A irmã boa é o controle positivo: sem ela o teste seria negativo puro e
  // nao provaria que o descarte e cirurgico. Sozinha, a partida ruim agora
  // dispara o guard de "nenhuma utilizavel", que e outro teste.
  const semId = structuredClone(primeiroTempo);
  semId.fixture.id = null;

  const fixtures = toFixtures(envelope([semId, segundoTempo]));
  assert.deepEqual(fixtures.map((f) => f.id), [String(segundoTempo.fixture.id)]);
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

// --- achados da revisão -----------------------------------------------------

test('C1: resposta com partidas onde nenhuma é utilizável lança', () => {
  // O JSDoc do adaptador declara inaceitável devolver [] e fazer o Worker
  // gravar snapshot vazio por cima de um bom. O guard de envelope cobria só
  // uma forma disso; esta é a outra, e é a silenciosa.
  const semTimes = structuredClone(segundoTempo);
  delete semTimes.teams;

  assert.throws(() => toFixtures(envelope([semTimes, semTimes])), /nenhuma utilizável/i);
});

test('C1: resposta legitimamente sem partidas continua devolvendo lista vazia', () => {
  // Controle positivo: sem jogo ao vivo no mundo, [] é a resposta certa e
  // não pode lançar.
  assert.deepEqual(toFixtures(envelopeVazio), []);
});

test('A6: chave da cadeia de protótipos não vira status', () => {
  // STATUS_MAP é literal congelado, não objeto de protótipo nulo:
  // STATUS_MAP['constructor'] devolve a função Object, que é truthy e
  // escaparia para Fixture.status, fora dos cinco valores do contrato.
  const validos = new Set(['scheduled', 'live', 'halftime', 'finished', 'cancelled']);
  for (const chave of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    const cru = structuredClone(primeiroTempo);
    cru.fixture.status.short = chave;
    const [f] = toFixtures(envelope([cru]));
    assert.ok(validos.has(f.status), `${chave} produziu status inválido: ${String(f.status)}`);
    assert.equal(f.status, 'scheduled');
  }
});

test('A5: nome de time vazio descarta a partida', () => {
  // '' é string e passava o guard de tipo, produzindo card em branco na tela.
  for (const lado of ['home', 'away']) {
    const cru = structuredClone(primeiroTempo);
    cru.teams[lado].name = '';
    assert.deepEqual(toFixtures(envelope([cru, segundoTempo])).map((f) => f.id), [
      String(segundoTempo.fixture.id),
    ], `nome vazio em ${lado} não descartou`);
  }
});

test('A4: partida sem liga é descartada, não entra com leagueId vazio', () => {
  // leagueId '' nunca casa com activeLeagueIds: a partida entraria no
  // snapshot e sumiria da grade filtrada, em silêncio.
  const semLiga = structuredClone(primeiroTempo);
  delete semLiga.league;
  assert.deepEqual(toFixtures(envelope([semLiga, segundoTempo])).map((f) => f.id), [
    String(segundoTempo.fixture.id),
  ]);

  const semLeagueId = structuredClone(primeiroTempo);
  semLeagueId.league.id = null;
  assert.deepEqual(toFixtures(envelope([semLeagueId, segundoTempo])).map((f) => f.id), [
    String(segundoTempo.fixture.id),
  ]);
});

test('A4: campos só de exibição degradam para vazio em vez de descartar', () => {
  // leagueName e kickoffISO não participam de diff nem de filtro: perdê-los
  // piora a tela, não a correção. Descartar a partida por causa deles seria
  // desproporcional.
  const cru = structuredClone(primeiroTempo);
  delete cru.league.name;
  delete cru.fixture.date;

  const [f] = toFixtures(envelope([cru]));
  assert.equal(f.leagueName, '');
  assert.equal(f.kickoffISO, '');
  assert.equal(f.leagueId, '186', 'o que importa para o filtro sobreviveu');
});

test('A3: envelope truncado lança em vez de entregar meia verdade', () => {
  // Se paging.total > 1 ou results discordar de response.length, faltam
  // partidas. Entregar a página 1 em silêncio faria um favorito sumir e
  // reaparecer conforme a contagem global oscila — e para o diff, partida que
  // some e volta é partida sem linha de base: o gol não sai.
  assert.throws(
    () => toFixtures({ ...envelope([primeiroTempo]), paging: { current: 1, total: 3 } }),
    /trunc/i,
  );
  assert.throws(
    () => toFixtures({ ...envelope([primeiroTempo]), results: 250 }),
    /trunc/i,
  );
});

test('A3: envelope íntegro da captura real não lança', () => {
  // Controle positivo: paging {current:1,total:1} e results === length é o
  // que a captura traz, e tem que passar.
  assert.doesNotThrow(() => toFixtures(envelope([primeiroTempo, segundoTempo])));
});

test('S5: id não escalar é descartado, não vira "[object Object]"', () => {
  // Dois ids objeto colidiriam na mesma chave de diff.
  const cru = structuredClone(primeiroTempo);
  cru.fixture.id = { a: 1 };
  assert.deepEqual(toFixtures(envelope([cru, segundoTempo])).map((f) => f.id), [
    String(segundoTempo.fixture.id),
  ]);
});

test('S5: placar negativo ou fracionário entra como null', () => {
  for (const invalido of [-1, 2.5, Number.NaN, '3']) {
    const cru = structuredClone(primeiroTempo);
    cru.goals.home = invalido;
    const [f] = toFixtures(envelope([cru]));
    assert.equal(f.homeGoals, null, `${String(invalido)} deveria virar null`);
  }
});

test('S2: todo status.short das amostras versionadas está no mapa', () => {
  // Derivado do MÓDULO inteiro, não de uma lista escrita à mão: acrescentar
  // uma amostra ao helper faz este teste crescer sozinho de verdade. A versão
  // anterior prometia isso num comentário e enumerava quatro constantes — a
  // mensagem descrevia uma lei que o código não impunha, e as seis amostras
  // novas da agenda teriam entrado sem ninguém conferir.
  const amostras = Object.values(amostrasVerbatim).filter(
    (a) => typeof a?.fixture?.status?.short === 'string',
  );

  assert.ok(amostras.length >= 10, `só ${amostras.length} amostras: o filtro parou de achá-las`);
  for (const amostra of amostras) {
    const short = amostra.fixture.status.short;
    assert.ok(Object.hasOwn(STATUS_MAP, short), `${short} está na captura e não no mapa`);
  }
});

test('S2b: cada status MEDIDO tem amostra verbatim que o sustenta', () => {
  // A marcação ✅ / 📄 no adaptador é uma afirmação sobre evidência, e
  // afirmação sobre evidência tem que ser verificável. Estes sete têm recorte
  // real no helper; os outros doze são inferência da documentação e NÃO
  // aparecem aqui de propósito.
  const medidos = {
    '1H': 'live',
    '2H': 'live',
    HT: 'halftime',
    NS: 'scheduled',
    FT: 'finished',
    PST: 'cancelled',
    PEN: 'finished',
  };
  const observados = new Set(
    Object.values(amostrasVerbatim)
      .map((a) => a?.fixture?.status?.short)
      .filter((x) => typeof x === 'string'),
  );

  for (const [short, interno] of Object.entries(medidos)) {
    assert.ok(observados.has(short), `${short} está marcado como medido e não tem amostra`);
    assert.equal(STATUS_MAP[short], interno, `${short} deveria virar ${interno}`);
  }

  // Controle positivo, DERIVADO e não enumerado: todo status do mapa que não
  // está marcado como medido é inferido, e inferido não pode ter amostra —
  // se ganhar uma, a marcação do adaptador é que está desatualizada.
  //
  // Enumerar aqui foi o primeiro impulso e estava errado: a lista tinha nove
  // dos doze inferidos, e um recorte de `ET` teria entrado sem ninguém
  // conferir. Teste que itera precisa cobrir o domínio inteiro da invariante.
  const inferidos = Object.keys(STATUS_MAP).filter((short) => !(short in medidos));
  assert.equal(inferidos.length, 12, 'a conta de medidos/inferidos mudou sem o teste mudar');
  for (const inferido of inferidos) {
    assert.ok(
      !observados.has(inferido),
      `${inferido} tem amostra verbatim: promova-o a medido no STATUS_MAP`,
    );
  }
});

test('S2c: o HT medido no caminho AO VIVO vem de live=all, não da agenda', () => {
  // A marcação do adaptador credita `HT` ao `live=all`, e é `live=all` que
  // alimenta o diff e dispara alerta de gol. Se a única amostra de `HT` fosse
  // do endpoint `date=`, a marcação estaria mentindo e este teste passaria por
  // cima da distinção que o próprio adaptador enuncia.
  assert.equal(picoIntervalo.fixture.status.short, 'HT');
  assert.ok('events' in picoIntervalo, 'não é recorte de live=all: falta a chave events');
  assert.ok(!('events' in agendaHT), 'a captura da agenda mudou: passou a trazer events');
  // E o recorte ao vivo confirma a saturação do minuto também no intervalo:
  // 45 com `extra: 1`, o mesmo padrão do primeiro tempo em live-sample.
  assert.equal(picoIntervalo.fixture.status.elapsed, 45);
  assert.equal(picoIntervalo.fixture.status.extra, 1);
});

test('S1: o mapa não tem chave a mais nem a menos que o conjunto documentado', () => {
  // A versão anterior só checava uma direção: uma chave inventada passaria.
  const documentados = [
    'TBD', 'NS', '1H', '2H', 'HT', 'ET', 'BT', 'P', 'SUSP', 'INT',
    'FT', 'AET', 'PEN', 'PST', 'CANC', 'ABD', 'AWD', 'WO', 'LIVE',
  ];
  assert.deepEqual(Object.keys(STATUS_MAP).sort(), [...documentados].sort());
});

test('S1: nenhum código de partida encerrada ou cancelada mapeia para live', () => {
  // Afirmação sobre o domínio, e não sobre o literal: é isto que impede um
  // alerta de gol numa partida que já acabou.
  for (const short of ['FT', 'AET', 'PEN', 'PST', 'CANC', 'ABD', 'AWD', 'WO']) {
    assert.notEqual(STATUS_MAP[short], 'live', `${short} não pode ser live`);
  }
  for (const short of ['1H', '2H', 'ET', 'P']) {
    assert.equal(STATUS_MAP[short], 'live', `${short} tem que ser live`);
  }
});

// --- relatório --------------------------------------------------------------

test('relatório: resposta limpa não descarta nada', () => {
  const r = toFixturesWithReport(envelope([primeiroTempo, segundoTempo]));
  assert.equal(r.fixtures.length, 2);
  assert.equal(r.discarded, 0);
  assert.equal(r.truncated, false);
});

test('relatório: conta quantas partidas caíram, não só que caíram', () => {
  // "3 de 19 sumiram porque uma liga mudou um campo" tem que virar sinal
  // visível na UI, e uma delas pode ser a favorita.
  const semTimes = structuredClone(primeiroTempo);
  delete semTimes.teams;
  const semLiga = structuredClone(primeiroTempoAcrescimo);
  delete semLiga.league;

  const r = toFixturesWithReport(envelope([semTimes, segundoTempo, semLiga, segundoTempoSaturado]));
  assert.equal(r.fixtures.length, 2);
  assert.equal(r.discarded, 2);
});

test('relatório: descarte parcial não lança — quem decide é o chamador', () => {
  const semTimes = structuredClone(primeiroTempo);
  delete semTimes.teams;
  assert.doesNotThrow(() => toFixturesWithReport(envelope([semTimes, segundoTempo])));
});

test('relatório: nenhuma utilizável continua lançando', () => {
  const semTimes = structuredClone(primeiroTempo);
  delete semTimes.teams;
  assert.throws(() => toFixturesWithReport(envelope([semTimes])), /nenhuma utilizável/i);
});

test('relatório: envelope inválido lança igual à versão simples', () => {
  assert.throws(() => toFixturesWithReport({ ...envelopeVazio, errors: { token: 'x' } }), /api-football/i);
  assert.throws(() => toFixturesWithReport(null), /api-football/i);
});

test('toFixtures é wrapper fino: mesma lista que o relatório', () => {
  const entrada = envelope([primeiroTempo, segundoTempo, segundoTempoSaturado]);
  assert.deepEqual(toFixtures(entrada), toFixturesWithReport(entrada).fixtures);
});

test('toFixtures descarta o relatório mas não muda o comportamento de descarte', () => {
  const semTimes = structuredClone(primeiroTempo);
  delete semTimes.teams;
  const entrada = envelope([semTimes, segundoTempo]);

  assert.equal(toFixtures(entrada).length, 1);
  assert.equal(toFixturesWithReport(entrada).discarded, 1);
});

test('truncated é campo de costura: hoje inalcançável porque truncamento lança', () => {
  // Se algum dia truncamento parar de lançar (o gatilho de reversão está no
  // JSDoc), este teste é o que muda — e a assinatura consumida pelos PR 2 e
  // PR 3 não muda junto. É essa a razão de o campo existir agora.
  assert.throws(
    () => toFixturesWithReport({ ...envelope([primeiroTempo]), paging: { current: 1, total: 3 } }),
    /trunc/i,
  );
  assert.throws(
    () => toFixturesWithReport({ ...envelope([primeiroTempo]), results: 250 }),
    /trunc/i,
  );

  // Controle positivo: envelope íntegro reporta truncated: false.
  assert.equal(toFixturesWithReport(envelope([primeiroTempo])).truncated, false);
});

// === adaptador da AGENDA (GET /fixtures?date=) ==============================
//
// Escrito contra `agenda-sample.json`: 454 partidas de 2026-09-04, 209 ligas.
// Os recortes abaixo são verbatim do arquivo. O shape de item é IDÊNTICO ao de
// `live=all` — medido, única diferença é `events`, que o adaptador não lê —,
// então o que muda aqui é o formato de SAÍDA, não o de entrada.

/** Envelope real da agenda em volta de uma lista de fixtures crus. */
function envelopeAgenda(response) {
  return { ...envelopeAgendaVazio, results: response.length, response };
}

test('agenda: reduz a partida ao que o portão lê, e nada mais', () => {
  const [entrada] = toAgenda(envelopeAgenda([agendaNS]));

  // Verbatim da captura: liga 278, kickoff 12:15 UTC com offset explícito.
  assert.deepEqual(entrada, {
    leagueId: '278',
    kickoffISO: '2026-09-04T12:15:00+00:00',
  });
  // A lista de chaves é o contrato: campo a mais aqui é peso numa chave do KV
  // que só responde "há jogo de interesse hoje?".
  assert.deepEqual(Object.keys(entrada).sort(), ['kickoffISO', 'leagueId']);
});

test('agenda: leagueId vira string, como Fixture.leagueId', () => {
  // Na captura `league.id` é number. Se vazasse number, o cruzamento com
  // `activeLeagueIds` — que guarda string — nunca casaria, e o portão ficaria
  // fechado o dia inteiro sem erro nenhum aparecendo.
  const [entrada] = toAgenda(envelopeAgenda([agendaNS]));
  assert.equal(typeof entrada.leagueId, 'string');
  assert.equal(typeof agendaNS.league.id, 'number', 'a captura mudou: league.id não é mais number');
});

test('agenda: kickoffISO é verbatim, não reescrito', () => {
  // O provedor manda offset `+00:00`, não sufixo `Z`. Normalizar introduziria
  // uma conversão que pode falhar e não acrescenta nada: `Date.parse` lê as
  // duas formas, e é `Date.parse` que `hasMatchInProgress` usa.
  const [entrada] = toAgenda(envelopeAgenda([agendaNS]));
  assert.equal(entrada.kickoffISO, agendaNS.fixture.date);
  assert.match(entrada.kickoffISO, /\+00:00$/);
});

test('agenda: partida encerrada na captura não entra e é contada', () => {
  // `hasMatchInProgress` abre pela janela de kickoff, não por status: uma
  // partida que começou há 2h e já acabou continuaria dentro da janela de 3h
  // e faria o cron gastar requisição em jogo nenhum.
  const r = toAgendaWithReport(envelopeAgenda([agendaFT, agendaPST, agendaPEN]));

  assert.deepEqual(r.entries, [], 'FT, PST e PEN não podem abrir o portão');
  assert.equal(r.terminal, 3);
  assert.equal(r.discarded, 0, 'terminal é economia, não perda: não pode contar como descarte');
});

test('agenda: partida em andamento ou por vir ENTRA', () => {
  // Controle positivo do teste acima: sem isto, um adaptador que descartasse
  // tudo passaria naquele assert.
  const r = toAgendaWithReport(envelopeAgenda([agendaNS, agenda1H, agendaHT]));

  assert.equal(r.entries.length, 3);
  assert.equal(r.terminal, 0);
  assert.deepEqual(r.entries.map((e) => e.leagueId), ['278', '887', '371']);
});

test('agenda: dia inteiro já encerrado devolve [], não lança', () => {
  // ASSIMETRIA DELIBERADA com `toFixturesWithReport`, que lança quando nenhuma
  // partida é utilizável. Aqui `[]` é resposta legítima — "hoje não há mais
  // jogo" —, o portão fecha e o custo é zero. Lançar faria o Worker cair no
  // fail-open e gastar cota justamente na noite em que não há nada.
  const r = toAgendaWithReport(envelopeAgenda([agendaFT, agendaFT]));
  assert.deepEqual(r.entries, []);
  assert.equal(r.terminal, 2);
});

test('agenda: payload indecifrável LANÇA, e não vira agenda vazia', () => {
  // O outro lado da assimetria. Agenda vazia por engano fecharia o portão o
  // dia inteiro com a página correta e vazia — indistinguível de quebrada. Um
  // item sem liga nem data não é "não há jogo", é "não sei".
  assert.throws(
    () => toAgendaWithReport(envelopeAgenda([{ fixture: {}, league: {} }])),
    /nenhuma decifrável/,
  );
});

test('agenda: item sem liga ou sem data é descartado e CONTADO', () => {
  const semLiga = { ...agendaNS, league: { ...agendaNS.league, id: null } };
  const semData = { ...agendaNS, fixture: { ...agendaNS.fixture, date: null } };
  const r = toAgendaWithReport(envelopeAgenda([agendaNS, semLiga, semData]));

  assert.equal(r.entries.length, 1, 'a partida boa tem que sobreviver aos vizinhos ruins');
  assert.equal(r.discarded, 2, 'perda tem que ser contada, nunca silenciosa');
  assert.equal(r.terminal, 0, 'descarte por payload não pode ser contado como terminal');
});

test('agenda: terminal + indecifrável não lança — o terminal prova que a resposta era real', () => {
  // A terceira ramificação do guard, que os dois testes vizinhos não cobrem:
  // um deles é só terminal, o outro é só lixo. Aqui há dos dois e nada
  // utilizável. NÃO lança, e é deliberado — uma partida terminal é evidência
  // de que a resposta veio de verdade, então `[]` significa mesmo "não há mais
  // jogo hoje". Lançar aqui jogaria o Worker em fail-open num dia que ele
  // conseguiu ler.
  const r = toAgendaWithReport(envelopeAgenda([agendaFT, { fixture: {}, league: {} }]));

  assert.deepEqual(r.entries, []);
  assert.equal(r.terminal, 1);
  assert.equal(r.discarded, 1, 'o item indecifrável tem que continuar contado como perda');
});

test('agenda: envelope inválido lança pelas mesmas regras do ao vivo', () => {
  // Mesma validação compartilhada: `errors` preenchido chega com HTTP 200, e
  // checar só o status code não pega.
  assert.throws(() => toAgenda(null), /envelope de objeto/);
  assert.throws(() => toAgenda({ ...envelopeAgendaVazio, errors: ['plano não cobre'] }), /errors/);
  assert.throws(() => toAgenda({ ...envelopeAgendaVazio, response: 'não é array' }), /array/);
  assert.throws(
    () => toAgenda({ ...envelopeAgendaVazio, results: 9, response: [agendaNS] }),
    /truncada/,
  );
});

test('agenda: resposta legitimamente vazia devolve [] sem lançar', () => {
  // Controle positivo dos throws acima: nem toda lista vazia é erro.
  const r = toAgendaWithReport(envelopeAgendaVazio);
  assert.deepEqual(r.entries, []);
  assert.equal(r.discarded, 0);
});

test('agenda: a saída é consumível por hasMatchInProgress sem tradução', () => {
  // A fronteira só vale se o que o adaptador produz entra no núcleo direto. Se
  // precisasse de conversão, a redução teria trocado peso por acoplamento.
  const entries = toAgenda(envelopeAgenda([agendaNS]));
  const kickoff = Date.parse(entries[0].kickoffISO);

  assert.ok(Number.isFinite(kickoff), 'kickoffISO não é parseável: o portão não abriria nunca');
  assert.equal(hasMatchInProgress(entries, kickoff + 60_000, new Set(['278'])), true);
  // Controle positivo: liga fora do conjunto não abre o portão.
  assert.equal(hasMatchInProgress(entries, kickoff + 60_000, new Set(['71'])), false);
});
