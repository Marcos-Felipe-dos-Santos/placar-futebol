import test from 'node:test';
import assert from 'node:assert/strict';
import { diffFixtures, keepLatestSnapshot, RESYNC_GAP_MS } from '../src/core/diff.js';
import { WARN_MAX_MS } from '../src/core/staleness.js';
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
  // Controle positivo: a MESMA partida, com o MESMO placar, gera evento
  // quando existe linha de base. Sem isso o caso negativo passaria só porque
  // o id não bate — verde sem testar a regra 1.
  const f = makeFixture({ homeGoals: 4, awayGoals: 1 });
  assert.deepEqual(diffFixtures(makeSnapshot(T0, []), makeSnapshot(T1, [f])), []);

  const comLinhaDeBase = diffFixtures(
    makeSnapshot(T0, [evolve(f, { homeGoals: 3 })]),
    makeSnapshot(T1, [f]),
  );
  assert.equal(comLinhaDeBase.length, 1, 'o caso negativo acima falha pelo motivo certo');
});

test('regra 4: par fora de ordem (réplica atrasada do KV) atualiza em silêncio', () => {
  // O KV tem até 60s de consistência eventual: ler uma réplica atrasada
  // depois de já ter lido a nova é condição de projeto. Se o gap negativo
  // passasse, o placar regrediria em silêncio e o gol seria "redescoberto"
  // no poll seguinte — som para um gol que já estava na tela.
  // O par tem que ser um AUMENTO de placar na leitura atrasada, senão o
  // teste passaria pela regra 2 (queda é silenciosa) e não provaria nada
  // sobre o gap. Cenário real: o provedor publicou 1-0 por erro, corrigiu
  // para 0-0, o cliente leu a réplica corrigida e depois uma réplica
  // atrasada que ainda mostrava o 1-0.
  const corrigido = makeFixture({ id: 'a', homeGoals: 0 });
  const erroAntigo = evolve(corrigido, { homeGoals: 1 });

  const replicaAtrasada = diffFixtures(
    makeSnapshot(T0, [corrigido]),
    makeSnapshot(T0 - 40_000, [erroAntigo]),
  );
  assert.deepEqual(
    replicaAtrasada,
    [],
    'gap negativo não pode ser tratado como intervalo válido: alertaria um gol que nunca existiu',
  );

  // Controle: o MESMO par de placares com o gap na ordem certa alerta.
  // É isso que prova que o caso acima é silenciado pelo gap, e não por acaso.
  assert.equal(
    diffFixtures(
      makeSnapshot(T0, [corrigido]),
      makeSnapshot(T0 + 40_000, [erroAntigo]),
    ).length,
    1,
  );
});

test('regra 4: ressincronizar em silêncio só é aceitável com a UI já vermelha', () => {
  // Invariante cruzada entre módulos: se RESYNC_GAP_MS caísse abaixo de
  // WARN_MAX_MS, existiriam dados pintados de amarelo ("atrasado, mas ok")
  // enquanto gols são descartados sem rastro.
  assert.ok(
    RESYNC_GAP_MS > WARN_MAX_MS,
    `RESYNC_GAP_MS=${RESYNC_GAP_MS} não supera WARN_MAX_MS=${WARN_MAX_MS}`,
  );
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

test('regra 5: placar de partida cancelada também não serve de linha de base', () => {
  // Provedores marcam "abandonado" e revertem para live com alguma
  // frequência. Se o placar do cancelado é lixo, ele não serve de base para
  // delta nenhum — senão o cancelado 1-0 virando live 2-0 produz um gol que
  // ninguém marcou.
  const cancelada = makeFixture({ id: 'a', status: 'cancelled', homeGoals: 1 });
  assert.deepEqual(
    diffOne(cancelada, evolve(cancelada, { status: 'live', homeGoals: 2 })),
    [],
  );

  // Controle: a mesma transição partindo de um estado confiável alerta.
  const live = makeFixture({ id: 'a', status: 'live', homeGoals: 1 });
  assert.equal(diffOne(live, evolve(live, { homeGoals: 2 })).length, 1);
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

test('o pareamento entre snapshots é por id, não por posição', () => {
  // Guarda contra teste vazio: se o pareamento fosse posicional, o primeiro
  // caso viraria um gol de 0 para 1 entre partidas que não têm nada a ver.
  const partidaA = makeFixture({ id: 'a', homeGoals: 0 });
  const outraPartida = makeFixture({ id: 'b', homeGoals: 1 });
  assert.deepEqual(
    diffFixtures(makeSnapshot(T0, [partidaA]), makeSnapshot(T1, [outraPartida])),
    [],
    'partidas distintas na mesma posição não podem ser comparadas entre si',
  );

  assert.equal(
    diffFixtures(
      makeSnapshot(T0, [partidaA]),
      makeSnapshot(T1, [evolve(partidaA, { homeGoals: 1 })]),
    ).length,
    1,
    'e o mesmo id, esse sim, produz o evento — provando que o caso acima falha pelo motivo certo',
  );
});

test('keepLatestSnapshot recusa avançar o estado para uma leitura atrasada', () => {
  const novo = makeSnapshot(T0, [makeFixture({ id: 'a', homeGoals: 1 })]);
  const atrasado = makeSnapshot(T0 - 40_000, [makeFixture({ id: 'a', homeGoals: 0 })]);

  assert.equal(keepLatestSnapshot(novo, atrasado), novo, 'a réplica atrasada é descartada');
  assert.equal(keepLatestSnapshot(atrasado, novo), novo, 'a réplica nova substitui a atrasada');
});

test('keepLatestSnapshot aceita releitura com o mesmo timestamp', () => {
  // O cliente polla mais rápido que o cron: reler o mesmo snapshot é o caso
  // comum, e tem que avançar para o objeto novo sem drama.
  const a = makeSnapshot(T0, [makeFixture({ id: 'a' })]);
  const b = makeSnapshot(T0, [makeFixture({ id: 'a' })]);
  assert.equal(keepLatestSnapshot(a, b), b);
});

test('keepLatestSnapshot lida com estado inicial e timestamp inválido', () => {
  const bom = makeSnapshot(T0, [makeFixture({ id: 'a' })]);
  const ruim = makeSnapshot(Number.NaN, [makeFixture({ id: 'a' })]);

  assert.equal(keepLatestSnapshot(null, bom), bom, 'primeira leitura é aceita');
  assert.equal(keepLatestSnapshot(undefined, bom), bom);
  assert.equal(keepLatestSnapshot(bom, ruim), bom, 'timestamp inválido não substitui estado bom');
  assert.equal(keepLatestSnapshot(null, ruim), ruim, 'sem alternativa, resta a leitura ruim');
});

test('keepLatestSnapshot não muta nem clona: devolve uma das duas referências', () => {
  const a = makeSnapshot(T0, [makeFixture({ id: 'a' })]);
  const b = makeSnapshot(T0 + 1, [makeFixture({ id: 'a' })]);
  const copiaA = structuredClone(a);
  const escolhido = keepLatestSnapshot(a, b);

  assert.ok(escolhido === a || escolhido === b);
  assert.deepEqual(a, copiaA);
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
  // Controle positivo pelo mesmo motivo do teste de estado anterior vazio:
  // sem ele, este passaria porque não há nada para iterar, e não porque a
  // ausência da partida foi tratada.
  const f = makeFixture({ homeGoals: 1 });
  assert.deepEqual(diffFixtures(makeSnapshot(T0, [f]), makeSnapshot(T1, [])), []);
  assert.equal(
    diffFixtures(makeSnapshot(T0, [evolve(f, { homeGoals: 0 })]), makeSnapshot(T1, [f])).length,
    1,
  );
});
