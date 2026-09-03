import test from 'node:test';
import assert from 'node:assert/strict';
import { diffFixtures, RESYNC_GAP_MS } from '../src/core/diff.js';
import { makeFixture, makeSnapshot, evolve } from './helpers/fixtures.js';

const T0 = 1_700_000_000_000;
const T1 = T0 + 120_000; // um intervalo normal de poll

/** Encurta o caso comum: um jogo, dois estados, gap normal. */
function diffOne(before, after, { gapMs = 120_000 } = {}) {
  return diffFixtures(
    makeSnapshot(T0, [before]),
    makeSnapshot(T0 + gapMs, [after]),
  );
}

test('regra 1: primeiro snapshot nunca gera evento — estado anterior ausente', () => {
  const f = makeFixture({ homeGoals: 3, awayGoals: 2 });
  assert.deepEqual(diffFixtures(null, makeSnapshot(T0, [f])), []);
  assert.deepEqual(diffFixtures(undefined, makeSnapshot(T0, [f])), []);
});

test('regra 1: estado anterior vazio não gera evento mesmo com placar alto', () => {
  const f = makeFixture({ homeGoals: 4, awayGoals: 1 });
  assert.deepEqual(diffFixtures(makeSnapshot(T0, []), makeSnapshot(T1, [f])), []);
});

test('regra 1: partida vista pela primeira vez não gera evento, mesmo ao lado de uma já conhecida', () => {
  const conhecida = makeFixture({ id: 'conhecida', homeGoals: 0 });
  const nova = makeFixture({ id: 'nova', homeGoals: 2, awayGoals: 1 });
  const eventos = diffFixtures(
    makeSnapshot(T0, [conhecida]),
    makeSnapshot(T1, [evolve(conhecida, {}), nova]),
  );
  assert.deepEqual(eventos, []);
});

test('regra 2: gol da casa gera exatamente um evento com os campos corretos', () => {
  const antes = makeFixture({ homeGoals: 0, awayGoals: 0 });
  const depois = evolve(antes, { homeGoals: 1, elapsedMin: 23 });
  const eventos = diffFixtures(makeSnapshot(T0, [antes]), makeSnapshot(T1, [depois]));

  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].fixtureId, antes.id);
  assert.equal(eventos[0].side, 'home');
  assert.equal(eventos[0].goalsBefore, 0);
  assert.equal(eventos[0].goalsAfter, 1);
  assert.equal(eventos[0].detectedAtMs, T1, 'detectedAtMs vem do snapshot novo');
  assert.equal(eventos[0].fixture.elapsedMin, 23, 'o evento carrega a partida NOVA');
});

test('regra 2: gol do visitante é atribuído ao lado away', () => {
  const antes = makeFixture({ homeGoals: 1, awayGoals: 1 });
  const eventos = diffOne(antes, evolve(antes, { awayGoals: 2 }));
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].side, 'away');
  assert.equal(eventos[0].goalsBefore, 1);
  assert.equal(eventos[0].goalsAfter, 2);
});

test('regra 2: dois gols no mesmo intervalo geram dois eventos, casa antes de visitante', () => {
  const antes = makeFixture({ homeGoals: 0, awayGoals: 0 });
  const eventos = diffOne(antes, evolve(antes, { homeGoals: 1, awayGoals: 1 }));
  assert.equal(eventos.length, 2);
  assert.deepEqual(eventos.map((e) => e.side), ['home', 'away']);
});

test('regra 2: salto de dois gols num intervalo vira um evento só, com o delta real', () => {
  const antes = makeFixture({ homeGoals: 0 });
  const eventos = diffOne(antes, evolve(antes, { homeGoals: 2 }));
  assert.equal(eventos.length, 1, 'não inventa um evento por gol; reporta a transição observada');
  assert.equal(eventos[0].goalsBefore, 0);
  assert.equal(eventos[0].goalsAfter, 2);
});

test('regra 2: queda de placar (correção do provedor) não gera evento', () => {
  const antes = makeFixture({ homeGoals: 2, awayGoals: 1 });
  assert.deepEqual(diffOne(antes, evolve(antes, { homeGoals: 1 })), []);
  assert.deepEqual(diffOne(antes, evolve(antes, { awayGoals: 0 })), []);
});

test('regra 2: queda de um lado e alta do outro no mesmo intervalo gera só o gol', () => {
  const antes = makeFixture({ homeGoals: 2, awayGoals: 0 });
  const eventos = diffOne(antes, evolve(antes, { homeGoals: 1, awayGoals: 1 }));
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].side, 'away');
});

test('regra 3: o mesmo gol não dispara em polls consecutivos', () => {
  const s0 = makeSnapshot(T0, [makeFixture({ id: 'x', homeGoals: 0 })]);
  const s1 = makeSnapshot(T0 + 120_000, [makeFixture({ id: 'x', homeGoals: 1 })]);
  const s2 = makeSnapshot(T0 + 240_000, [makeFixture({ id: 'x', homeGoals: 1 })]);

  assert.equal(diffFixtures(s0, s1).length, 1, 'o gol é detectado uma vez');
  assert.deepEqual(diffFixtures(s1, s2), [], 'e não se repete no poll seguinte');
});

test('regra 4: gap acima do limiar de ressincronização atualiza em silêncio', () => {
  const antes = makeFixture({ homeGoals: 0, awayGoals: 0 });
  const depois = evolve(antes, { homeGoals: 3, awayGoals: 3 });
  const eventos = diffOne(antes, depois, { gapMs: RESYNC_GAP_MS + 1 });
  assert.deepEqual(eventos, [], 'aba suspensa por horas não pode despejar alertas acumulados');
});

test('regra 4: gap exatamente no limiar ainda alerta (o limiar é inclusivo)', () => {
  const antes = makeFixture({ homeGoals: 0 });
  const eventos = diffOne(antes, evolve(antes, { homeGoals: 1 }), { gapMs: RESYNC_GAP_MS });
  assert.equal(eventos.length, 1);
});

test('regra 4: o limiar de ressincronização cobre o pior caso do pipeline', () => {
  assert.ok(
    RESYNC_GAP_MS > 210_000,
    'precisa superar 150s de intervalo upstream + 60s de propagação do KV, senão o pior caso normal seria tratado como ressincronização e o gol sumiria',
  );
});

test('regra 4: o limiar é configurável por opção', () => {
  const antes = makeFixture({ homeGoals: 0 });
  const depois = evolve(antes, { homeGoals: 1 });
  const eventos = diffFixtures(
    makeSnapshot(T0, [antes]),
    makeSnapshot(T0 + 60_000, [depois]),
    { resyncGapMs: 30_000 },
  );
  assert.deepEqual(eventos, []);
});

test('regra 5: transições de status sem mudança de placar não geram gol', () => {
  const antes = makeFixture({ homeGoals: 1, awayGoals: 0, status: 'live' });
  for (const status of ['halftime', 'finished', 'cancelled', 'live', 'scheduled']) {
    assert.deepEqual(
      diffOne(antes, evolve(antes, { status })),
      [],
      `transição live → ${status} não pode virar gol`,
    );
  }
});

test('regra 5: gol marcado no mesmo intervalo em que a partida encerra ainda alerta', () => {
  const antes = makeFixture({ homeGoals: 0, status: 'live' });
  const eventos = diffOne(antes, evolve(antes, { homeGoals: 1, status: 'finished' }));
  assert.equal(eventos.length, 1, 'gol aos 90+ não pode ser engolido pela transição para FT');
});

test('regra 5: partida cancelada nunca gera gol, mesmo com placar subindo', () => {
  const antes = makeFixture({ homeGoals: 0, status: 'live' });
  assert.deepEqual(
    diffOne(antes, evolve(antes, { homeGoals: 1, status: 'cancelled' })),
    [],
    'placar de jogo cancelado/abandonado é lixo do provedor, não gol',
  );
});

test('regra 5: prorrogação é live e continua alertando', () => {
  const antes = makeFixture({ homeGoals: 1, status: 'live', elapsedMin: 90 });
  const eventos = diffOne(antes, evolve(antes, { homeGoals: 2, elapsedMin: 105 }));
  assert.equal(eventos.length, 1);
});

test('regra 5: placar desconhecido (null) não é tratado como zero', () => {
  const agendado = makeFixture({ status: 'scheduled', homeGoals: null, awayGoals: null });
  assert.deepEqual(
    diffOne(agendado, evolve(agendado, { status: 'live', homeGoals: 0, awayGoals: 0 })),
    [],
    'null → 0 no apito inicial não é gol',
  );

  const live = makeFixture({ homeGoals: 1 });
  assert.deepEqual(
    diffOne(live, evolve(live, { homeGoals: null })),
    [],
    'perder o placar não é gol nem evento',
  );
  assert.deepEqual(
    diffOne(evolve(live, { homeGoals: null }), evolve(live, { homeGoals: 2 })),
    [],
    'sem linha de base conhecida não há delta confiável',
  );
});

test('partida que some do snapshot novo não atrapalha o diff das demais', () => {
  const a = makeFixture({ id: 'a', homeGoals: 0 });
  const b = makeFixture({ id: 'b', homeGoals: 0 });
  const eventos = diffFixtures(
    makeSnapshot(T0, [a, b]),
    makeSnapshot(T1, [evolve(b, { homeGoals: 1 })]),
  );
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].fixtureId, 'b');
});

test('diffFixtures é puro: não muta os snapshots recebidos', () => {
  const antes = makeFixture({ homeGoals: 0 });
  const depois = evolve(antes, { homeGoals: 1 });
  const prev = makeSnapshot(T0, [antes]);
  const next = makeSnapshot(T1, [depois]);
  const copiaPrev = structuredClone(prev);
  const copiaNext = structuredClone(next);

  diffFixtures(prev, next);

  assert.deepEqual(prev, copiaPrev);
  assert.deepEqual(next, copiaNext);
});

test('snapshot novo vazio não gera evento nem quebra', () => {
  const f = makeFixture({ homeGoals: 1 });
  assert.deepEqual(diffFixtures(makeSnapshot(T0, [f]), makeSnapshot(T1, [])), []);
});
