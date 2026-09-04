import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSnapshot,
  parseSnapshot,
  toPublicCronState,
  SNAPSHOT_VERSION,
} from '../src/core/snapshot.js';
import { applySnapshot } from '../src/core/session.js';
import { isStale } from '../src/core/staleness.js';
import { makeFixture } from './helpers/fixtures.js';

const T0 = 1_700_000_000_000;

function entradaNominal(overrides = {}) {
  return {
    fetchedAtMs: T0,
    fixtures: [makeFixture({ id: 'a' }), makeFixture({ id: 'b' })],
    quotaRemaining: 87,
    quotaResetAtMs: T0 + 3 * 60 * 60 * 1000,
    discarded: 0,
    truncated: false,
    upstreamCount: 2,
    reason: 'due',
    ...overrides,
  };
}

test('o snapshot carrega tudo que a UI precisa sem uma segunda chamada', () => {
  const s = buildSnapshot(entradaNominal());

  assert.equal(s.version, SNAPSHOT_VERSION);
  assert.equal(s.fetchedAtMs, T0);
  assert.equal(s.fixtures.length, 2);
  assert.equal(s.quotaRemaining, 87);
  assert.equal(s.discarded, 0);
  assert.equal(s.truncated, false);
  assert.equal(s.upstreamCount, 2);
});

test('o motivo da busca sobrevive ao envelope: é o que desfaz a ambiguidade', () => {
  // "Não atualizou porque não havia o que buscar" e "não atualizou porque
  // quebrou" não podem ser indistinguíveis — mesma decisão que separou `[]`
  // de `null` na agenda. `'no-agenda'` é o caso que a página tem de mostrar:
  // buscou às cegas, cobertura reduzida.
  assert.equal(buildSnapshot(entradaNominal({ reason: 'no-agenda' })).reason, 'no-agenda');
  assert.equal(buildSnapshot(entradaNominal()).reason, 'due');
});

test('motivo ausente vira null, não undefined: undefined some no JSON', () => {
  // `undefined` desaparece no `JSON.stringify` e volta do KV indistinguível
  // de um campo que nunca existiu — é o mesmo modo de falha silenciosa que o
  // campo existe para combater. Todo campo do envelope tem fallback
  // explícito; este não é exceção.
  const s = buildSnapshot(entradaNominal({ reason: undefined }));
  assert.equal(s.reason, null);
  assert.ok('reason' in s, 'o campo sumiu do envelope em vez de valer null');
  assert.equal(JSON.parse(JSON.stringify(s)).reason, null, 'não sobreviveu à ida e volta pelo KV');
  // Controle positivo: um motivo de verdade não é engolido por este caminho.
  assert.equal(buildSnapshot(entradaNominal({ reason: 'no-agenda' })).reason, 'no-agenda');
});

test('o envelope NÃO carrega o intervalo do portão — nem por sobra da entrada', () => {
  // Prosa num typedef não é barreira; este teste é. `intervalMs` mistura
  // ritmo desejado com freio de cota: com `quotaRemaining: 11` ele vale 3
  // HORAS e a busca acontece mesmo assim, então um cliente que fizesse
  // "fresco até fetchedAtMs + intervalMs" pintaria verde por três horas.
  // Frescor é `isStale`, com régua própria.
  const s = buildSnapshot(entradaNominal({ intervalMs: 10_800_000 }));

  assert.ok(!('intervalMs' in s), 'o intervalo do portão vazou para o envelope do KV');
  // Controle positivo: buildSnapshot não está simplesmente ignorando a
  // entrada inteira — o que faria o assert acima passar por vacuidade.
  assert.equal(s.upstreamCount, 2);
});

test('o snapshot é aceito por applySnapshot sem adaptação', () => {
  // O envelope do KV é superconjunto do Snapshot do modelo interno. Se essa
  // compatibilidade quebrar, o cliente precisa de código de tradução e a
  // fronteira vaza para o PR 3.
  const s = buildSnapshot(entradaNominal());
  const r = applySnapshot(null, s);

  assert.equal(r.state.snapshot, s);
  assert.deepEqual(r.events, []);
  assert.equal(r.resynced, false);
});

test('o snapshot é aceito por isStale, que só depende de fetchedAtMs', () => {
  const s = buildSnapshot(entradaNominal());
  assert.equal(isStale(s.fetchedAtMs, T0 + 40_000).level, 'fresh');
  assert.equal(isStale(s.fetchedAtMs, T0 + 40_000).ageMs, 40_000);
});

test('discarded > 0 sobrevive até o cliente: é sinal, não log', () => {
  const s = buildSnapshot(entradaNominal({ discarded: 3, upstreamCount: 5 }));
  assert.equal(s.discarded, 3);
  assert.equal(s.upstreamCount, 5, 'a UI precisa do denominador para dizer 3 de 5');
});

test('o snapshot sobrevive a uma ida e volta por JSON — é assim que vive no KV', () => {
  const s = buildSnapshot(entradaNominal({ discarded: 1 }));
  const voltou = parseSnapshot(JSON.stringify(s));
  assert.deepEqual(voltou, s);
});

test('buildSnapshot não referencia o array de fixtures recebido', () => {
  const fixtures = [makeFixture({ id: 'a' })];
  const s = buildSnapshot(entradaNominal({ fixtures }));
  fixtures.push(makeFixture({ id: 'b' }));
  assert.equal(s.fixtures.length, 1);
});

test('quota desconhecida entra como null, não como zero', () => {
  // Zero significaria "cota esgotada" e faria o portão fechar o dia inteiro
  // por causa de um header ausente.
  const s = buildSnapshot(entradaNominal({ quotaRemaining: undefined }));
  assert.equal(s.quotaRemaining, null);

  const comString = buildSnapshot(entradaNominal({ quotaRemaining: '80' }));
  assert.equal(comString.quotaRemaining, 80, 'header string é convertido aqui, no limite do sistema');
});

// --- leitura defensiva do KV ------------------------------------------------

test('parseSnapshot devolve null para lixo em vez de lançar', () => {
  // O fetch handler nunca pode derrubar a página por causa de um valor
  // estranho no KV: ele serve o que tem e deixa o staleness contar a verdade.
  for (const lixo of [null, undefined, '', 'não é json', '{', '[]', '42', '"texto"', '{}']) {
    assert.equal(parseSnapshot(lixo), null, `${JSON.stringify(lixo)} deveria virar null`);
  }
});

test('parseSnapshot rejeita snapshot sem fetchedAtMs utilizável', () => {
  const base = buildSnapshot(entradaNominal());
  for (const ruim of [null, 'agora', Number.NaN]) {
    const s = JSON.stringify({ ...base, fetchedAtMs: ruim });
    assert.equal(parseSnapshot(s), null, `fetchedAtMs=${String(ruim)} passou`);
  }
});

test('parseSnapshot rejeita snapshot sem array de fixtures', () => {
  const base = buildSnapshot(entradaNominal());
  for (const ruim of [null, {}, 'a', 7]) {
    assert.equal(parseSnapshot(JSON.stringify({ ...base, fixtures: ruim })), null);
  }
});

test('parseSnapshot aceita um snapshot legítimo sem partidas', () => {
  // Controle positivo: fixtures: [] é caso normal (sem jogo ao vivo) e não
  // pode ser confundido com lixo.
  const s = buildSnapshot(entradaNominal({ fixtures: [], upstreamCount: 0 }));
  const voltou = parseSnapshot(JSON.stringify(s));
  assert.notEqual(voltou, null);
  assert.deepEqual(voltou.fixtures, []);
});

test('parseSnapshot rejeita versão que não sabe ler', () => {
  const base = buildSnapshot(entradaNominal());
  const futuro = JSON.stringify({ ...base, version: SNAPSHOT_VERSION + 1 });
  assert.equal(parseSnapshot(futuro), null, 'versão desconhecida não pode ser interpretada às cegas');
});

test('parseSnapshot aceita objeto já parseado, não só string', () => {
  const s = buildSnapshot(entradaNominal());
  assert.deepEqual(parseSnapshot(s), s);
});

// === toPublicCronState: a resposta para "por que o dado não é novo?" ========
//
// O snapshot responde "o dado é novo?" e não consegue responder a outra: ele
// só é escrito em busca bem-sucedida, então nos tiques em que o cron desiste
// não há nada nele para contar a história. O `state` é escrito em toda
// tentativa real — inclusive fracassada — e é dele que sai a distinção.

const HOJE = '2026-09-04';

test('estado ausente vira null, nunca um estado saudável inventado', () => {
  // Devolver `{consecutiveFailures: 0, quotaRemaining: 100}` para "não sei"
  // afirmaria como fato o que não se sabe, e a página diria "tudo bem" sobre
  // um pipeline morto. É o erro de confundir agenda `[]` com agenda `null`.
  assert.equal(toPublicCronState(null, HOJE), null);
  assert.equal(toPublicCronState(undefined, HOJE), null);
  assert.equal(toPublicCronState('não é json {{{', HOJE), null);
  assert.equal(toPublicCronState('[1,2,3]', HOJE), null, 'array não é estado');
  assert.equal(toPublicCronState(42, HOJE), null);
});

test('estado legível vira os três campos que a página renderiza', () => {
  // Controle positivo dos asserts acima: se a função devolvesse `null` para
  // tudo, eles passariam por vacuidade.
  const cron = toPublicCronState(
    JSON.stringify({
      consecutiveFailures: 3,
      backoffUntilMs: 1_700_000_500_000,
      quotaRemaining: 41,
      spentToday: 59,
      lastFetchAtMs: 1_700_000_000_000,
      dayKeyUTC: HOJE,
    }),
    HOJE,
  );

  assert.deepEqual(cron, {
    consecutiveFailures: 3,
    backoffUntilMs: 1_700_000_500_000,
    quotaRemaining: 41,
  });
});

test('spentToday e lastFetchAtMs NÃO são expostos: ninguém os renderiza', () => {
  // Campo que ninguém lê vira o próximo `intervalMs` — entra "porque pode ser
  // útil" e sai depois como régua de algo que ele não é. Os três de cima
  // bastam para separar quebrou / acabou a cota / não havia o que buscar.
  const cron = toPublicCronState(
    JSON.stringify({ spentToday: 59, lastFetchAtMs: 123, dayKeyUTC: HOJE }),
    HOJE,
  );

  assert.ok(!('spentToday' in cron), 'spentToday vazou para o cliente');
  assert.ok(!('lastFetchAtMs' in cron), 'lastFetchAtMs vazou para o cliente');
  assert.deepEqual(Object.keys(cron).sort(), [
    'backoffUntilMs',
    'consecutiveFailures',
    'quotaRemaining',
  ]);
});

test('cota de outro dia UTC vira null, e as falhas sobrevivem', () => {
  // O livro-caixa vale para o dia em que foi escrito. Depois do reset o cron
  // só reescreve quando busca, e numa noite sem jogo isso leva horas: servir
  // a cota de ontem anunciaria "esgotada" com o dia inteiro disponível.
  const ontem = toPublicCronState(
    JSON.stringify({ consecutiveFailures: 4, quotaRemaining: 2, dayKeyUTC: '2026-09-03' }),
    HOJE,
  );

  assert.equal(ontem.quotaRemaining, null, 'cota de ontem servida como de hoje');
  // Não-zero de propósito: `0` é o fallback de campo ausente, então asserir
  // zero aqui passaria mesmo com o estado inteiro descartado.
  assert.equal(ontem.consecutiveFailures, 4, 'a virada do dia apagou as falhas');
  // Controle positivo: no dia corrente a MESMA cota é servida.
  const hoje = toPublicCronState(
    JSON.stringify({ consecutiveFailures: 4, quotaRemaining: 2, dayKeyUTC: HOJE }),
    HOJE,
  );
  assert.equal(hoje.quotaRemaining, 2);
});

test('estado sem dayKeyUTC não inventa cota', () => {
  const cron = toPublicCronState(JSON.stringify({ quotaRemaining: 2 }), HOJE);
  assert.equal(cron.quotaRemaining, null, 'cota sem dia associado foi servida como de hoje');
});
