import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseNotice, QUOTA_BAIXA } from '../src/core/notice.js';
import { FRESH_MAX_MS } from '../src/core/staleness.js';

const T0 = Date.parse('2026-09-04T18:00:00.000Z');

/** Snapshot fresco, completo e sem nada a dizer. */
function snap(overrides = {}) {
  return {
    version: 1,
    fetchedAtMs: T0,
    fixtures: [],
    quotaRemaining: 80,
    quotaResetAtMs: T0 + 3 * 60 * 60_000,
    discarded: 0,
    upstreamCount: 5,
    truncated: false,
    reason: 'due',
    ...overrides,
  };
}

/** Cron saudável: nada falhando, cota folgada. */
function cron(overrides = {}) {
  return { consecutiveFailures: 0, backoffUntilMs: 0, quotaRemaining: 80, ...overrides };
}

function entrada(overrides = {}) {
  return { nowMs: T0, snapshot: snap(), cron: cron(), visibleCount: 3, ...overrides };
}

// Literal defensável: 8 minutos passa de WARN_MAX_MS (7 min) e é
// inequivocamente parado. Não uso a constante — constante não é régua para ela
// mesma, e se alguém baixar FRESH_MAX_MS para 1ms os testes de "fresco"
// continuariam verdes sozinhos.
const OITO_MIN = 8 * 60_000;

test('nada a dizer devolve null: a faixa não é mobília', () => {
  // O caso mais importante do módulo. Se ele devolvesse algo aqui, a faixa
  // ficaria permanente e o usuário aprenderia a não olhar para ela — e o dia
  // em que ela importa seria o dia em que ninguém repara.
  assert.equal(chooseNotice(entrada()), null);
});

test('sem snapshot vence tudo: nada na tela é real', () => {
  const n = chooseNotice(entrada({
    snapshot: null,
    cron: cron({ consecutiveFailures: 9, quotaRemaining: 0 }),
    visibleCount: 0,
  }));
  assert.equal(n.code, 'sem-dado');
  assert.equal(n.severity, 'erro');
});

// === precedência entre os avisos de DADO PARADO =============================

test('quebrado vence sem-cota: reset não conserta pipeline caído', () => {
  // Os dois disparam juntos num dia ruim. Se "sem cota" vencesse, a página
  // prometeria "volta às 21:00" para um Worker que não vai voltar — mentira
  // confortável, que é pior que erro visível.
  const n = chooseNotice(entrada({
    nowMs: T0 + OITO_MIN,
    cron: cron({ consecutiveFailures: 4, quotaRemaining: 0, backoffUntilMs: T0 + 60_000 }),
  }));

  assert.equal(n.code, 'parado-quebrado');
  assert.equal(n.data.failures, 4);
});

test('sem-cota vence motivo-desconhecido e sem-jogo, e leva a hora do reset', () => {
  const n = chooseNotice(entrada({
    nowMs: T0 + OITO_MIN,
    cron: cron({ quotaRemaining: 1 }),
  }));

  assert.equal(n.code, 'parado-sem-cota');
  assert.equal(n.data.resetAtMs, T0 + 3 * 60 * 60_000, 'sem isto a página não diz quando volta');
});

test('QUOTA null é "não sei", nunca "acabou"', () => {
  // `quotaRemaining: null` vem de estado gravado em outro dia UTC. Tratá-lo
  // como número baixo anunciaria cota esgotada com o dia inteiro disponível —
  // exatamente o erro que a checagem de dia no Worker existe para evitar, e
  // que voltaria pela view se este ramo fosse escrito com `<=` sozinho.
  const n = chooseNotice(entrada({
    nowMs: T0 + OITO_MIN,
    cron: cron({ quotaRemaining: null }),
  }));

  assert.notEqual(n.code, 'parado-sem-cota', 'null virou "cota esgotada"');
  assert.equal(n.code, 'parado-sem-jogo');
});

test('motivo desconhecido fica ACIMA do caso benigno', () => {
  // `cron: null` é "não sei por que parou". Se caísse em 'parado-sem-jogo', a
  // página afirmaria "não há jogo agora" sem ter como saber — e essa é a
  // frase que faz o usuário fechar a aba achando que está tudo certo.
  const n = chooseNotice(entrada({ nowMs: T0 + OITO_MIN, cron: null }));
  assert.equal(n.code, 'parado-motivo-desconhecido');
  assert.equal(n.severity, 'alerta');
});

test('parado sem jogo é dito, mesmo sendo o caso benigno', () => {
  // Controle positivo: com tudo saudável e o dado velho, ainda há o que dizer.
  // Silêncio aqui deixaria a grade vazia sem explicação.
  const n = chooseNotice(entrada({ nowMs: T0 + OITO_MIN }));
  assert.equal(n.code, 'parado-sem-jogo');
  assert.equal(n.severity, 'info');
  assert.ok(n.data.ageMs >= OITO_MIN);
});

test('dado dentro da janela fresca não gera aviso de parado', () => {
  // Controle positivo da fronteira: 210s é o limite documentado, e abaixo dele
  // pintar amarelo seria alarmar sobre o funcionamento normal.
  assert.equal(chooseNotice(entrada({ nowMs: T0 + FRESH_MAX_MS })), null);
  assert.equal(chooseNotice(entrada({ nowMs: T0 + FRESH_MAX_MS + 1 })).code, 'parado-sem-jogo');
});

// === precedência entre os avisos de DADO FRESCO =============================

test('incompleto vence às-cegas: perder partida é pior que cobertura reduzida', () => {
  // Os dois convivem: uma busca sem agenda que ainda descartou partidas. O
  // descarte é mais grave porque a partida que falta pode ser a favorita, e o
  // usuário não tem como saber que ela existia.
  const n = chooseNotice(entrada({
    snapshot: snap({ discarded: 3, upstreamCount: 19, reason: 'no-agenda' }),
  }));

  assert.equal(n.code, 'incompleto');
  assert.equal(n.data.discarded, 3);
  assert.equal(n.data.upstreamCount, 19, 'sem o denominador a página diz "3 descartadas" de quê?');
});

test('truncado também é incompleto, mesmo com discarded zero', () => {
  const n = chooseNotice(entrada({ snapshot: snap({ truncated: true }) }));
  assert.equal(n.code, 'incompleto');
  assert.equal(n.data.truncated, true);
});

test('às-cegas aparece quando o dado está fresco e completo', () => {
  const n = chooseNotice(entrada({ snapshot: snap({ reason: 'no-agenda' }) }));
  assert.equal(n.code, 'as-cegas');
  assert.equal(n.severity, 'alerta');
});

test('dado parado vence qualquer aviso de completude', () => {
  // Um snapshot velho E incompleto: dizer "3 descartadas" sobre dado de 8
  // minutos atrás desvia a atenção do que importa, que é o dado estar parado.
  const n = chooseNotice(entrada({
    nowMs: T0 + OITO_MIN,
    snapshot: snap({ discarded: 3, reason: 'no-agenda' }),
  }));
  assert.equal(n.code, 'parado-sem-jogo');
});

// === a grade vazia ==========================================================

test('GRADE VAZIA NUNCA FICA CALADA', () => {
  // O modo de falha que este projeto mais combate. Com tudo saudável, fresco e
  // completo, e nenhuma partida para mostrar, a página tem de AFIRMAR que está
  // vazia de propósito — senão é indistinguível de quebrada.
  const n = chooseNotice(entrada({ visibleCount: 0 }));
  assert.equal(n.code, 'vazio');
  assert.equal(n.severity, 'info');
});

test('a favorita descoberta viaja junto do vazio, e só dele', () => {
  // `uncoveredFavorites` NÃO disputa precedência: é propriedade de uma liga,
  // permanente, e mora junto do filtro dela. A exceção é a grade vazia, onde a
  // contagem ajuda a ligar o vazio à causa provável numa frase só — em vez de
  // uma segunda faixa empilhada.
  const n = chooseNotice(entrada({ visibleCount: 0, uncoveredCount: 2 }));
  assert.equal(n.code, 'vazio');
  assert.equal(n.data.uncovered, 2);

  // Controle positivo: com a grade cheia, a favorita descoberta não vira faixa
  // nenhuma. Se virasse, disputaria espaço todo dia com avisos temporais.
  assert.equal(chooseNotice(entrada({ visibleCount: 3, uncoveredCount: 2 })), null);
});

test('grade vazia com dado parado explica o motivo, não repete o vazio', () => {
  // Controle positivo da ordem: 'vazio' é o último recurso, não o primeiro.
  // Se viesse antes, a página diria "nenhum jogo agora" quando a verdade é
  // "não consigo atualizar há 8 minutos".
  const n = chooseNotice(entrada({
    nowMs: T0 + OITO_MIN,
    visibleCount: 0,
    cron: cron({ consecutiveFailures: 2 }),
  }));
  assert.equal(n.code, 'parado-quebrado');
});

test('o limiar de cota baixa não é a reserva do portão', () => {
  // Reusar `AGENDA_RESERVE` aqui amarraria o texto da tela a uma decisão de
  // orçamento: se a reserva subisse para 20, a página anunciaria "sem cota"
  // com 19 requisições disponíveis.
  assert.equal(QUOTA_BAIXA, 3, 'o limiar mudou: reveja o texto da faixa');

  const noLimiar = chooseNotice(entrada({
    nowMs: T0 + OITO_MIN,
    cron: cron({ quotaRemaining: QUOTA_BAIXA }),
  }));
  assert.equal(noLimiar.code, 'parado-sem-cota');

  const acima = chooseNotice(entrada({
    nowMs: T0 + OITO_MIN,
    cron: cron({ quotaRemaining: QUOTA_BAIXA + 1 }),
  }));
  assert.equal(acima.code, 'parado-sem-jogo', 'cota folgada virou aviso de cota');
});

test('todo código devolvido tem severidade e dados, nunca texto', () => {
  // A redação fica na view. Se um dia alguém puser string de interface aqui, o
  // núcleo passa a conhecer português e a fronteira vaza — foi a mesma decisão
  // tomada quando os rótulos de `reason` não entraram em src/core/.
  const casos = [
    entrada({ snapshot: null }),
    entrada({ nowMs: T0 + OITO_MIN, cron: cron({ consecutiveFailures: 1 }) }),
    entrada({ nowMs: T0 + OITO_MIN, cron: cron({ quotaRemaining: 0 }) }),
    entrada({ nowMs: T0 + OITO_MIN, cron: null }),
    entrada({ nowMs: T0 + OITO_MIN }),
    entrada({ snapshot: snap({ discarded: 1 }) }),
    entrada({ snapshot: snap({ reason: 'no-agenda' }) }),
    entrada({ visibleCount: 0 }),
  ];

  const vistos = new Set();
  for (const caso of casos) {
    const n = chooseNotice(caso);
    assert.ok(n, 'um caso que deveria avisar devolveu null');
    vistos.add(n.code);
    assert.ok(['erro', 'alerta', 'info'].includes(n.severity), `severidade inválida: ${n.severity}`);
    assert.equal(typeof n.data, 'object');
    for (const [chave, valor] of Object.entries(n.data)) {
      // Nenhuma string, e a regra é dura de propósito: um código de
      // classificação a mais aqui viraria um segundo lugar para decidir cor ou
      // texto, e é o `code` que serve para isso. Números e booleanos só.
      assert.ok(
        typeof valor === 'number' || typeof valor === 'boolean' || valor === null,
        `${n.code}.${chave} não é número, booleano nem null: texto e códigos são da view`,
      );
    }
  }
  assert.equal(vistos.size, 8, 'os oito códigos precisam estar todos exercitados aqui');
});
