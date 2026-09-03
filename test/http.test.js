import test from 'node:test';
import assert from 'node:assert/strict';
import {
  routeRequest,
  checkRateLimit,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
} from '../src/worker/http.js';

const T0 = 1_700_000_000_000;

// --- rotas ------------------------------------------------------------------

test('GET /api/live é a única rota servida', () => {
  const r = routeRequest('GET', '/api/live');
  assert.equal(r.ok, true);
  assert.equal(r.route, 'live');
});

test('HEAD /api/live é aceito: é GET sem corpo', () => {
  assert.equal(routeRequest('HEAD', '/api/live').ok, true);
});

test('método não autorizado devolve 405, não 404', () => {
  // 404 diria "esse caminho não existe", o que é falso e confunde.
  for (const metodo of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const r = routeRequest(metodo, '/api/live');
    assert.equal(r.ok, false, `${metodo} foi aceito`);
    assert.equal(r.status, 405, `${metodo} não devolveu 405`);
  }
});

test('caminho não autorizado devolve 404', () => {
  for (const caminho of ['/', '/api', '/api/', '/api/live/', '/api/fixtures', '/admin', '/.env']) {
    const r = routeRequest('GET', caminho);
    assert.equal(r.ok, false, `${caminho} foi aceito`);
    assert.equal(r.status, 404, `${caminho} não devolveu 404`);
  }
});

test('nenhuma rota que force o Worker a buscar upstream é exposta', () => {
  // Não existe /api/refresh, /api/fetch nem nada que um visitante possa
  // chamar para gastar a cota da chave. Se um dia existir, o custo é global.
  for (const caminho of ['/api/refresh', '/api/fetch', '/api/update', '/api/cron', '/api/poll']) {
    assert.equal(routeRequest('GET', caminho).ok, false, `${caminho} está exposto`);
  }
});

test('o roteador é case-sensitive no caminho', () => {
  assert.equal(routeRequest('GET', '/API/LIVE').ok, false);
});

// --- rate limit -------------------------------------------------------------

test('as primeiras requisições dentro do limite passam', () => {
  const estado = new Map();
  let nowMs = T0;
  for (let i = 0; i < RATE_LIMIT_MAX; i += 1) {
    const r = checkRateLimit(estado, '1.2.3.4', nowMs, {});
    assert.equal(r.allowed, true, `requisição ${i + 1} foi barrada`);
    nowMs += 100;
  }
});

test('passar do limite na mesma janela é barrado', () => {
  const estado = new Map();
  for (let i = 0; i < RATE_LIMIT_MAX; i += 1) checkRateLimit(estado, '1.2.3.4', T0, {});

  const r = checkRateLimit(estado, '1.2.3.4', T0, {});
  assert.equal(r.allowed, false);
  assert.ok(r.retryAfterMs > 0, 'quem é barrado precisa saber quando voltar');
});

test('a janela desliza: passado o intervalo, volta a passar', () => {
  const estado = new Map();
  for (let i = 0; i < RATE_LIMIT_MAX; i += 1) checkRateLimit(estado, '1.2.3.4', T0, {});
  assert.equal(checkRateLimit(estado, '1.2.3.4', T0, {}).allowed, false);

  assert.equal(
    checkRateLimit(estado, '1.2.3.4', T0 + RATE_LIMIT_WINDOW_MS + 1, {}).allowed,
    true,
  );
});

test('um IP barrado não afeta os outros', () => {
  const estado = new Map();
  for (let i = 0; i < RATE_LIMIT_MAX + 5; i += 1) checkRateLimit(estado, '1.2.3.4', T0, {});

  assert.equal(checkRateLimit(estado, '1.2.3.4', T0, {}).allowed, false);
  assert.equal(checkRateLimit(estado, '5.6.7.8', T0, {}).allowed, true);
});

test('IP ausente é tratado como um bucket próprio, não liberado', () => {
  // Sem cf-connecting-ip, liberar seria o caminho óbvio para contornar o
  // limite: basta omitir o header.
  const estado = new Map();
  for (let i = 0; i < RATE_LIMIT_MAX; i += 1) checkRateLimit(estado, null, T0, {});
  assert.equal(checkRateLimit(estado, null, T0, {}).allowed, false);
});

test('o limite acomoda o poll normal do cliente com folga', () => {
  // O cliente polla /api/live a cada 10–15s. Um limite abaixo disso barraria
  // o uso legítimo — e a aba do usuário viraria a primeira vítima.
  const porMinuto = RATE_LIMIT_MAX / (RATE_LIMIT_WINDOW_MS / 60_000);
  assert.ok(porMinuto >= 12, `${porMinuto.toFixed(1)} req/min é apertado para poll de 10s`);
});

test('o estado não cresce sem limite: entradas velhas são podadas', () => {
  const estado = new Map();
  for (let i = 0; i < 50; i += 1) checkRateLimit(estado, `10.0.0.${i}`, T0, {});
  assert.equal(estado.size, 50);

  // Muito depois, um IP novo: os 50 antigos não podem continuar ocupando
  // memória do isolate para sempre.
  checkRateLimit(estado, '10.0.1.1', T0 + RATE_LIMIT_WINDOW_MS * 10, {});
  // `< 51` passaria com os 50 antigos ainda lá: bastaria a poda remover um. A
  // mensagem prometia que nenhum sobrevive, então o assert tem que exigir isso.
  assert.equal(estado.size, 1, `estado ficou com ${estado.size} entradas`);
});

test('os limites são configuráveis por opção', () => {
  const estado = new Map();
  const opcoes = { max: 2, windowMs: 1_000 };
  assert.equal(checkRateLimit(estado, 'x', T0, opcoes).allowed, true);
  assert.equal(checkRateLimit(estado, 'x', T0, opcoes).allowed, true);
  assert.equal(checkRateLimit(estado, 'x', T0, opcoes).allowed, false);
  assert.equal(checkRateLimit(estado, 'x', T0 + 1_001, opcoes).allowed, true);
});
