import test from 'node:test';
import assert from 'node:assert/strict';
import { diffFixtures } from '../src/core/diff.js';
import { shouldAlert } from '../src/core/alerts.js';
import { applySnapshot } from '../src/core/session.js';
import { makeFixture, makeSnapshot, evolve } from './helpers/fixtures.js';

/**
 * Regra 3 ponta a ponta: `diffFixtures` → `shouldAlert`, com o registro de
 * alertados carregado através de uma sequência de snapshots.
 *
 * As duas metades já são testadas separadamente, e é justamente isso que
 * deixa passar bug de sequência: o dedupe só grava a chave quando um alerta
 * DISPARA, então um gol cuja primeira observação foi a linha de base nunca
 * grava chave e não fica protegido por ele. Este arquivo existe para provar
 * que a proteção real está no diff, não no dedupe.
 */

const T0 = 1_700_000_000_000;

/**
 * Roda uma sequência de snapshots como o cliente rodaria: diffa contra o
 * anterior, consulta `shouldAlert` para cada evento, grava as chaves que
 * dispararam e segue.
 *
 * @param {import('../src/core/types.js').Snapshot[]} snapshots
 * @returns {{sons: string[], alerted: Record<string, number>}}
 */
function reproduzirSessao(snapshots) {
  /** @type {string[]} */
  const sons = [];
  /** @type {number[]} */
  const ressincronizacoes = [];
  let state = null;

  for (const atual of snapshots) {
    const r = applySnapshot(state, atual);
    state = r.state;
    if (r.resynced) ressincronizacoes.push(r.swallowedGoals);
    sons.push(...r.events.map((e) => `${e.fixtureId} ${e.goalsBefore}->${e.goalsAfter}`));
  }

  return { sons, ressincronizacoes, state };
}

test('réplica atrasada do KV no meio da sessão não produz som duplicado', () => {
  const comGol = makeFixture({ id: 'a', homeGoals: 1 });
  const semGol = evolve(comGol, { homeGoals: 0 });

  // A partida já estava 1-0 quando a página abriu, então o 1-0 é linha de
  // base e nunca gravou chave no registro de alertados. Depois vem uma
  // leitura de réplica 40s atrasada, dentro da janela documentada do KV, e
  // depois a réplica nova de volta.
  const { sons } = reproduzirSessao([
    makeSnapshot(T0, [comGol]),
    makeSnapshot(T0 - 40_000, [semGol]),
    makeSnapshot(T0 + 20_000, [comGol]),
  ]);

  assert.deepEqual(
    sons,
    [],
    'o 1-0 já estava na tela desde a abertura; nenhum som pode tocar por ele',
  );
});

test('correção do provedor (0→1→0→1) toca uma vez só', () => {
  const base = makeFixture({ id: 'a', homeGoals: 0 });
  const { sons } = reproduzirSessao([
    makeSnapshot(T0, [base]),
    makeSnapshot(T0 + 120_000, [evolve(base, { homeGoals: 1 })]),
    makeSnapshot(T0 + 240_000, [evolve(base, { homeGoals: 0 })]),
    makeSnapshot(T0 + 360_000, [evolve(base, { homeGoals: 1 })]),
  ]);

  assert.deepEqual(sons, ['a 0->1'], 'o mesmo gol voltando não é gol novo');
});

test('uma partida real de três gols toca exatamente três vezes', () => {
  // Controle positivo do arquivo: se `reproduzirSessao` estivesse engolindo
  // tudo, todos os testes acima passariam por vacuidade.
  const base = makeFixture({ id: 'a', homeGoals: 0, awayGoals: 0 });
  const { sons } = reproduzirSessao([
    makeSnapshot(T0, [base]),
    makeSnapshot(T0 + 120_000, [evolve(base, { homeGoals: 1 })]),
    makeSnapshot(T0 + 240_000, [evolve(base, { homeGoals: 1, awayGoals: 1 })]),
    makeSnapshot(T0 + 360_000, [evolve(base, { homeGoals: 2, awayGoals: 1 })]),
    makeSnapshot(T0 + 480_000, [evolve(base, { homeGoals: 2, awayGoals: 1, status: 'finished' })]),
  ]);

  assert.deepEqual(sons, ['a 0->1', 'a 0->1', 'a 1->2']);
});

test('aba suspensa por duas horas não despeja alertas acumulados ao voltar', () => {
  const base = makeFixture({ id: 'a', homeGoals: 0, awayGoals: 0 });
  const { sons, ressincronizacoes } = reproduzirSessao([
    makeSnapshot(T0, [base]),
    makeSnapshot(T0 + 2 * 60 * 60 * 1000, [evolve(base, { homeGoals: 3, awayGoals: 2 })]),
  ]);

  assert.deepEqual(sons, [], 'ressincronização é silenciosa');
  assert.deepEqual(
    ressincronizacoes,
    [5],
    'mas não muda: a UI recebe a contagem para avisar que 5 gols podem ter sido perdidos',
  );
});

test('gol que chega junto com a transição para encerrado ainda toca', () => {
  const base = makeFixture({ id: 'a', homeGoals: 0, status: 'live' });
  const { sons } = reproduzirSessao([
    makeSnapshot(T0, [base]),
    makeSnapshot(T0 + 120_000, [evolve(base, { homeGoals: 1, status: 'finished' })]),
  ]);

  assert.deepEqual(sons, ['a 0->1']);
});

test('som bloqueado não acumula pendência: o gol não toca depois', () => {
  const base = makeFixture({ id: 'a', homeGoals: 0 });
  /** @type {Record<string, number>} */
  const alerted = {};
  const s0 = makeSnapshot(T0, [base]);
  const s1 = makeSnapshot(T0 + 120_000, [evolve(base, { homeGoals: 1 })]);
  const s2 = makeSnapshot(T0 + 240_000, [evolve(base, { homeGoals: 1 })]);

  const eventos = diffFixtures(s0, s1);
  assert.equal(eventos.length, 1);
  assert.equal(
    shouldAlert(eventos[0], { alerted, nowMs: s1.fetchedAtMs, enabled: false }),
    false,
    'antes do unlock, nada soa',
  );

  // O gol não volta no poll seguinte, mesmo sem ter tocado — o estado já
  // avançou. É o comportamento correto: liberar o som no minuto 80 não deve
  // disparar os gols do primeiro tempo.
  assert.deepEqual(diffFixtures(s1, s2), []);
});
