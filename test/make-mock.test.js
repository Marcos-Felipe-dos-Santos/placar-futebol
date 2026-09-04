import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chooseNotice } from '../src/core/notice.js';
import { visibleFixtures } from '../src/view/filter.js';

/**
 * O GERADOR DE MOCK CUMPRE O QUE PROMETE.
 *
 * Cada cenário anuncia, na própria saída, qual código da faixa ele exercita. Se
 * o anúncio e o resultado divergirem, o dev abre a página esperando ver
 * `parado-quebrado`, vê outra coisa, e passa a desconfiar da faixa em vez do
 * mock. Anúncio é promessa — mesma regra das mensagens de assert.
 *
 * ## Por que pode ser PULADO
 *
 * O gerador lê `live-pico.json`, que não é versionado: 167 KB de payload cru,
 * e a mesma regra que mantém as outras capturas fora do repositório. Num clone
 * limpo o arquivo não existe, e aí o teste **pula com o motivo dito**, em vez
 * de falhar por uma ausência esperada ou — pior — de ser apagado por inútil.
 *
 * ## Por que escreve em arquivo temporário
 *
 * `npm test` não pode sobrescrever o `mock-api.json` que o dev acabou de
 * gerar. Ele estaria com o cenário `quebrado` aberto no navegador e a suíte o
 * trocaria por outro sem avisar — efeito colateral silencioso de rodar teste,
 * que é justamente o que este projeto não tolera.
 */

const CAPTURA = 'live-pico.json';
const temCaptura = fs.existsSync(CAPTURA);
const motivo = `${CAPTURA} não está aqui (não é versionada): nada a converter`;

/** O que cada cenário promete na saída do gerador. */
const PROMESSAS = {
  saudavel: null,
  'sem-jogo': 'parado-sem-jogo',
  stale: 'parado-motivo-desconhecido',
  'sem-cota': 'parado-sem-cota',
  quebrado: 'parado-quebrado',
  incompleto: 'incompleto',
  'as-cegas': 'as-cegas',
  vazio: 'vazio',
};

test('o gerador entrega a faixa que cada cenário anuncia', { skip: temCaptura ? false : motivo }, () => {
  const tmp = path.join(os.tmpdir(), `mock-teste-${process.pid}.json`);

  try {
    for (const [cenario, esperado] of Object.entries(PROMESSAS)) {
      execFileSync(process.execPath, ['tools/make-mock.mjs', cenario, tmp], { stdio: 'pipe' });
      const corpo = JSON.parse(fs.readFileSync(tmp, 'utf8'));

      const visiveis = visibleFixtures({ fixtures: corpo.fixtures, favorites: [] });
      const notice = chooseNotice({
        nowMs: Date.now(),
        snapshot: corpo,
        cron: corpo.cron,
        visibleCount: visiveis.length,
      });

      assert.equal(
        notice === null ? null : notice.code,
        esperado,
        `cenário "${cenario}" anuncia ${esperado} e produz ${notice?.code ?? null}`,
      );
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

test('o mock tem os seis campos que a página lê', { skip: temCaptura ? false : motivo }, () => {
  // O bug do primeiro mock, feito com o shape cru da API: faltavam
  // `discarded`, `upstreamCount`, `truncated`, `reason`, `quotaResetAtMs` e
  // `quotaRemaining`. O efeito não era erro visível — `undefined > 0` é
  // `false`, e a faixa `incompleto` simplesmente nunca disparava.
  const tmp = path.join(os.tmpdir(), `mock-campos-${process.pid}.json`);

  try {
    execFileSync(process.execPath, ['tools/make-mock.mjs', 'saudavel', tmp], { stdio: 'pipe' });
    const corpo = JSON.parse(fs.readFileSync(tmp, 'utf8'));

    for (const campo of ['discarded', 'upstreamCount', 'truncated', 'reason', 'quotaResetAtMs', 'quotaRemaining']) {
      assert.ok(campo in corpo, `o mock não tem \`${campo}\`, que a página lê`);
    }
    assert.equal(corpo.version, 1, 'sem `version` correta o parseSnapshot recusaria o envelope');
    assert.ok(Array.isArray(corpo.fixtures) && corpo.fixtures.length > 0);

    // `backoffUntilMs: 0` e não `null` — é o valor que o Worker grava quando
    // não há backoff, e o mock existe para parecer com o Worker.
    assert.equal(corpo.cron.backoffUntilMs, 0);
    assert.equal(typeof corpo.cron.consecutiveFailures, 'number');
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

test('o gerador recusa cenário desconhecido em vez de inventar um', { skip: temCaptura ? false : motivo }, () => {
  assert.throws(
    () => execFileSync(process.execPath, ['tools/make-mock.mjs', 'nao-existe'], { stdio: 'pipe' }),
    'cenário inventado gerou mock em vez de erro',
  );
});
