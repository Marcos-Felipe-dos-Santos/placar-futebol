import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveApiUrl } from '../src/view/origem.js';

const PADRAO = 'https://placar-futebol.exemplo.workers.dev/api/live';

test('sem override, usa o Worker', () => {
  assert.equal(resolveApiUrl('', PADRAO), PADRAO);
  assert.equal(resolveApiUrl('?outra=coisa', PADRAO), PADRAO);
  assert.equal(resolveApiUrl('?api=', PADRAO), PADRAO);
});

test('caminho relativo é aceito: é para isso que o override existe', () => {
  // Controle positivo. Sem ele, um `resolveApiUrl` que devolvesse sempre o
  // padrão passaria em todos os testes de recusa abaixo e o mock local nunca
  // funcionaria.
  assert.equal(resolveApiUrl('?api=./mock-api.json', PADRAO), './mock-api.json');
  assert.equal(resolveApiUrl('?api=/mock-api.json', PADRAO), '/mock-api.json');
});

test('A API-FOOTBALL É RECUSADA: o contrato não se fura por query string', () => {
  // O dano tem nome neste projeto. Um override que aceitasse URL absoluta
  // deixaria qualquer link fazer a página falar com o upstream — e a cota de
  // 100/dia é global da chave, não por visitante.
  const upstream = 'https://v3.football.api-sports.io/fixtures?live=all';
  assert.equal(resolveApiUrl(`?api=${upstream}`, PADRAO), PADRAO);
  assert.equal(resolveApiUrl('?api=https://qualquer.coisa/x.json', PADRAO), PADRAO);
  assert.equal(resolveApiUrl('?api=http://qualquer.coisa/x.json', PADRAO), PADRAO);
});

test('PROTOCOL-RELATIVE é recusada: `//evil.com` começa com barra', () => {
  // O caso que faz esta função existir em vez de um `startsWith('/')` solto no
  // app.js. `//evil.com/x.json` é URL absoluta e passaria numa checagem
  // ingênua de "começa com barra".
  assert.equal(resolveApiUrl('?api=//evil.com/x.json', PADRAO), PADRAO);
  // Controle positivo: uma barra só continua valendo.
  assert.equal(resolveApiUrl('?api=/x.json', PADRAO), '/x.json');
});

test('esquemas exóticos também caem no padrão', () => {
  for (const perigoso of [
    'data:application/json,{}',
    'javascript:alert(1)',
    'file:///etc/passwd',
    '../fora-do-diretorio.json',
    'mock-api.json',
  ]) {
    assert.equal(resolveApiUrl(`?api=${encodeURIComponent(perigoso)}`, PADRAO), PADRAO, perigoso);
  }
});

test('query string inválida não derruba a página', () => {
  assert.equal(resolveApiUrl(null, PADRAO), PADRAO);
  assert.equal(resolveApiUrl(undefined, PADRAO), PADRAO);
  assert.equal(resolveApiUrl(42, PADRAO), PADRAO);
});
