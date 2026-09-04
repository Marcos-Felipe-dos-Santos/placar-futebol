import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStoredAgenda,
  parseStoredAgenda,
  decideAgendaFetch,
  AGENDA_MAX_ATTEMPTS_PER_DAY,
  AGENDA_RETRY_SPACING_MS,
} from '../src/core/agenda.js';
import { hasUsableQuota, AGENDA_RESERVE } from '../src/core/polling.js';

const HOJE = '2026-09-04';
const ONTEM = '2026-09-03';
const T0 = Date.parse('2026-09-04T00:01:00.000Z');
const entrada = { leagueId: '71', kickoffISO: '2026-09-04T21:30:00+00:00' };

// === parseStoredAgenda ======================================================

test('agenda de hoje é lida, e a lista sai como está', () => {
  const guardada = JSON.stringify(buildStoredAgenda(HOJE, [entrada]));
  assert.deepEqual(parseStoredAgenda(guardada, HOJE), [entrada]);
});

test('AGENDA DE ONTEM É null, e nunca lista vazia', () => {
  // O caso mais perigoso desta função. Os kickoffs de ontem estão 24h fora da
  // janela de 3h, então usá-los como se fossem de hoje faria o portão
  // responder "não há jogo" o dia inteiro — página correta e vazia, sem um
  // erro sequer na tela. `null` faz o sistema falhar ABERTO.
  const ontem = JSON.stringify(buildStoredAgenda(ONTEM, [entrada]));
  assert.equal(parseStoredAgenda(ontem, HOJE), null, 'a agenda de ontem passou por hoje');
  // Controle positivo: a MESMA agenda, lida no dia dela, é válida.
  assert.deepEqual(parseStoredAgenda(ontem, ONTEM), [entrada]);
});

test('agenda de hoje legitimamente vazia é [], não null', () => {
  // `[]` e `null` decidem coisas opostas: `[]` fecha o portão a custo zero,
  // `null` faz falhar aberto. Confundi-los é a diferença entre uma economia e
  // um dia inteiro de cota queimada — ou entre isso e um apagão.
  assert.deepEqual(parseStoredAgenda(JSON.stringify(buildStoredAgenda(HOJE, [])), HOJE), []);
});

test('valor ilegível, sem dia ou array cru viram null', () => {
  assert.equal(parseStoredAgenda(null, HOJE), null);
  assert.equal(parseStoredAgenda('não é json {{{', HOJE), null);
  assert.equal(parseStoredAgenda(JSON.stringify({ entries: [entrada] }), HOJE), null);
  assert.equal(parseStoredAgenda(JSON.stringify({ dayKeyUTC: HOJE }), HOJE), null);
  // Array cru é o formato que a chave teve antes de carregar o dia. Sem dia
  // associado não dá para afirmar que é de hoje, então também é null.
  assert.equal(parseStoredAgenda(JSON.stringify([entrada]), HOJE), null);
});

test('buildStoredAgenda copia a lista: mutar depois não reescreve o gravado', () => {
  const lista = [entrada];
  const guardada = buildStoredAgenda(HOJE, lista);
  lista.push({ leagueId: '99', kickoffISO: 'x' });
  assert.equal(guardada.entries.length, 1);
});

// === decideAgendaFetch ======================================================

function estado(overrides = {}) {
  return {
    nowMs: T0,
    hasAgendaForToday: false,
    quotaRemaining: 100,
    attemptsToday: 0,
    lastAttemptAtMs: null,
    ...overrides,
  };
}

test('sem agenda do dia e com cota, busca', () => {
  assert.deepEqual(decideAgendaFetch(estado()), { shouldFetch: true, reason: 'due' });
});

test('com agenda do dia, não busca: uma por dia, não uma por tique', () => {
  const d = decideAgendaFetch(estado({ hasAgendaForToday: true }));
  assert.equal(d.shouldFetch, false);
  assert.equal(d.reason, 'agenda-current');
});

test('A RESERVA É PARA ISTO: busca com cota que o poll ao vivo já não pode gastar', () => {
  // O teste que discrimina a régua. Com 5 restantes, `hasUsableQuota` é falso
  // — o poll ao vivo está barrado pela reserva de 10. A agenda TEM de poder
  // gastar assim mesmo: é exatamente o que a reserva guarda. Se alguém trocar
  // a comparação por `hasUsableQuota`, a agenda nunca mais é buscada dentro da
  // própria reserva e o Worker fica em fail-open para sempre — gastando muito
  // mais do que a agenda custaria.
  const cotaNaReserva = 5;
  assert.ok(cotaNaReserva < AGENDA_RESERVE, 'a premissa do teste mudou junto com a reserva');
  assert.equal(hasUsableQuota(cotaNaReserva), false, 'o poll ao vivo deveria estar barrado aqui');

  const d = decideAgendaFetch(estado({ quotaRemaining: cotaNaReserva }));
  assert.equal(d.shouldFetch, true, 'a agenda não conseguiu gastar a reserva que é dela');
});

test('sem cota nenhuma, não busca', () => {
  assert.equal(decideAgendaFetch(estado({ quotaRemaining: 0 })).reason, 'no-quota');
  assert.equal(decideAgendaFetch(estado({ quotaRemaining: -3 })).reason, 'no-quota');
  assert.equal(decideAgendaFetch(estado({ quotaRemaining: Number.NaN })).reason, 'no-quota');
  // Controle positivo: uma única requisição restante ainda compra a agenda.
  assert.equal(decideAgendaFetch(estado({ quotaRemaining: 1 })).shouldFetch, true);
});

test('o teto de tentativas segura a reserva num dia de upstream fora do ar', () => {
  // Sem teto, o portão "não tenho agenda de hoje" fica aberto e o cron tenta a
  // cada tique: 10 tentativas em 10 minutos, reserva zerada, e aí o poll ao
  // vivo morre junto porque `hasUsableQuota` fica falso o dia inteiro.
  //
  // Literal 3 e não a constante: constante não é régua para ela mesma. Se
  // alguém subir o teto para 10, este número tem de ser reavaliado à mão — e a
  // asserção seguinte diz por quê.
  assert.equal(AGENDA_MAX_ATTEMPTS_PER_DAY, 3, 'o teto mudou: reveja a aritmética da reserva');
  assert.ok(
    AGENDA_MAX_ATTEMPTS_PER_DAY < AGENDA_RESERVE,
    'o teto de tentativas não pode consumir a reserva inteira',
  );

  const esgotado = estado({ attemptsToday: 3, lastAttemptAtMs: T0 - 10 * 60 * 60_000 });
  assert.equal(decideAgendaFetch(esgotado).reason, 'attempts-exhausted');
  // Controle positivo: com uma tentativa a menos, e fora do espaçamento, busca.
  assert.equal(decideAgendaFetch({ ...esgotado, attemptsToday: 2 }).shouldFetch, true);
});

test('tentativas coladas são recusadas: 30 minutos de cobertura, não 3 minutos', () => {
  // Três tentativas num minuto testam o mesmo instante de indisponibilidade
  // três vezes e gastam a reserva sem cobrir nada.
  const recem = estado({ attemptsToday: 1, lastAttemptAtMs: T0 - 60_000 });
  assert.equal(decideAgendaFetch(recem).reason, 'too-soon');

  // Literal defensável: 16 minutos é mais que o espaçamento de 15 e menos que
  // qualquer valor que tornaria a retentativa inútil.
  assert.equal(AGENDA_RETRY_SPACING_MS, 15 * 60_000, 'o espaçamento mudou: reveja o literal');
  const bemDepois = estado({ attemptsToday: 1, lastAttemptAtMs: T0 - 16 * 60_000 });
  assert.equal(decideAgendaFetch(bemDepois).shouldFetch, true);
});

test('a ordem das recusas: ter a agenda vence tudo', () => {
  // Com agenda do dia não importa cota, tentativa nem espaçamento: não há o
  // que buscar. Se a ordem invertesse, um dia sem cota reportaria 'no-quota'
  // com a agenda já em mãos, e o diagnóstico apontaria para o problema errado.
  const d = decideAgendaFetch(estado({
    hasAgendaForToday: true,
    quotaRemaining: 0,
    attemptsToday: 99,
  }));
  assert.equal(d.reason, 'agenda-current');
});
