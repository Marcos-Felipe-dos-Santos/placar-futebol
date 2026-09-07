import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chooseNotice } from '../src/core/notice.js';
import { visibleFixtures } from '../src/view/filter.js';
import { toFixturesWithReport } from '../src/adapters/apiFootball.js';
import { DEFAULT_LEAGUE_IDS } from '../src/core/leagues.js';

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
      const saida = execFileSync(process.execPath, ['tools/make-mock.mjs', cenario, tmp], { encoding: 'utf8' });
      const corpo = JSON.parse(fs.readFileSync(tmp, 'utf8'));

      // A CONDIÇÃO DE VISUALIZAÇÃO sai do próprio anúncio, não de um id fixo.
      // A faixa `vazio` não vem do snapshot — vem de `visibleCount`, que sai
      // das favoritas do navegador. Um teste que assumisse `favorites: []`
      // para todo cenário mediria uma condição que o gerador não anunciou, e
      // `saudavel` falharia por um motivo que não é defeito dele.
      const pedeFavorita = /favorite: liga (\S+) /.exec(saida);
      const favoritas = pedeFavorita ? [pedeFavorita[1]] : [];

      const visiveis = visibleFixtures({ fixtures: corpo.fixtures, favorites: favoritas });
      const notice = chooseNotice({
        nowMs: Date.now(),
        snapshot: corpo,
        cron: corpo.cron,
        visibleCount: visiveis.length,
      });

      assert.equal(
        notice === null ? null : notice.code,
        esperado,
        `cenário "${cenario}" anuncia ${esperado} e produz ${notice?.code ?? null}`
        + ` (favoritas: ${JSON.stringify(favoritas)})`,
      );

      // CONTROLE POSITIVO da condição anunciada: quando o gerador pede uma
      // favorita, ela tem de MUDAR a grade. Sem isto o `exec` poderia casar
      // uma liga sem partida nenhuma e o teste passaria por vacuidade, com a
      // grade vazia dos dois jeitos.
      if (pedeFavorita) {
        assert.ok(visiveis.length > 0, `a favorita anunciada em "${cenario}" não encheu a grade`);
      }
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

/**
 * A VALIDADE ANUNCIADA SEPARA OS DOIS TIPOS DE CENÁRIO.
 *
 * Os mocks gravam `fetchedAtMs` absoluto, e a página o compara com o relógio:
 * um cenário fresco vira `parado-sem-jogo` sozinho depois de `FRESH_MAX_MS`.
 * O gerador avisa disso na saída — e o aviso é promessa, como o da faixa.
 *
 * O par positivo/negativo é o ponto: se o teste só conferisse que `saudavel`
 * anuncia prazo, ele continuaria verde com um gerador que imprimisse o mesmo
 * prazo para TODO cenário, inclusive os que nasceram parados e não vencem.
 */
test('a saída separa cenário que vence de cenário que não vence', { skip: temCaptura ? false : motivo }, () => {
  const tmp = path.join(os.tmpdir(), `mock-validade-${process.pid}.json`);

  try {
    // Positivo: nasce fresco, logo tem prazo — e o prazo é uma hora concreta.
    const fresco = execFileSync(process.execPath, ['tools/make-mock.mjs', 'saudavel', tmp], { encoding: 'utf8' });
    assert.match(fresco, /validade: ate \d{2}:\d{2}:\d{2} — \d+s a partir de agora\./,
      'cenário fresco não anunciou a hora em que vence');
    assert.match(fresco, /Regenere\./, 'anunciou o prazo sem dizer o que fazer quando vencer');

    // Negativo: nasce parado 40 min atrás, logo NÃO vence — a faixa
    // `parado-quebrado` que ele existe para mostrar não muda com o relógio.
    const parado = execFileSync(process.execPath, ['tools/make-mock.mjs', 'quebrado', tmp], { encoding: 'utf8' });
    assert.match(parado, /validade: nao vence/, 'cenário que nasceu parado anunciou prazo que não tem');
    assert.doesNotMatch(parado, /Regenere\./, 'mandou regenerar um mock que não vence');
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

/**
 * O MOCK NÃO INVENTA `leagueId`.
 *
 * Uma versão anterior do gerador reetiquetava 12 partidas para as ligas da
 * semente, para os chips terem conteúdo. O resultado foi cartão de
 * "Brasileirão Série A" sobre Aalesund x Start — e, pior que o absurdo
 * visível, um teste de filtro que não testava o filtro: `leagueId` é o dado
 * sobre o qual o filtro opera, então falsificá-lo põe o dev olhando o
 * falsificador.
 *
 * Este teste é a guarda. Ele compara o multiconjunto de ligas do mock com o da
 * captura: qualquer reetiquetagem futura muda as contagens e fica vermelho.
 */
test('o mock preserva o leagueId real da captura', { skip: temCaptura ? false : motivo }, () => {
  const tmp = path.join(os.tmpdir(), `mock-liga-${process.pid}.json`);

  try {
    execFileSync(process.execPath, ['tools/make-mock.mjs', 'saudavel', tmp], { stdio: 'pipe' });
    const corpo = JSON.parse(fs.readFileSync(tmp, 'utf8'));

    // A captura vem do PowerShell com BOM; `JSON.parse` engasga nela.
    const cru = JSON.parse(fs.readFileSync(CAPTURA, 'utf8').replace(/^﻿/, ''));
    const daCaptura = toFixturesWithReport(cru).fixtures;

    const conta = (lista) => {
      const m = new Map();
      for (const f of lista) m.set(f.leagueId, (m.get(f.leagueId) ?? 0) + 1);
      return [...m].sort((a, b) => a[0].localeCompare(b[0]));
    };

    // Sem isto, um gerador que devolvesse zero partidas passaria: dois mapas
    // vazios são iguais.
    assert.ok(daCaptura.length > 20, 'captura pequena demais para a comparação valer');
    assert.deepEqual(conta(corpo.fixtures), conta(daCaptura),
      'o mock alterou a distribuição de ligas da captura');

    // CONTROLE NEGATIVO: a captura de fato não tem liga da semente. Se um dia
    // tiver, este assert cai e o cenário `vazio` precisa ser repensado — é o
    // aviso, não um teste a relaxar.
    const semente = new Set(DEFAULT_LEAGUE_IDS.map(String));
    assert.equal(
      corpo.fixtures.filter((f) => semente.has(f.leagueId)).length, 0,
      'a captura passou a ter liga da semente: o cenário `vazio` deixou de ser vazio',
    );
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});
