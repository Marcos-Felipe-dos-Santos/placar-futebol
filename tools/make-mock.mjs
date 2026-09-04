/**
 * Gera `mock-api.json` — a resposta de `/api/live` para abrir a página sem
 * Worker, sem KV e sem gastar uma requisição da cota.
 *
 * ## Por que passar pelo adaptador, e não montar o JSON à mão
 *
 * A primeira tentativa de mock foi montada com o shape CRU da API, e faltavam
 * seis campos que a página lê: `discarded`, `upstreamCount`, `truncated`,
 * `reason`, `quotaResetAtMs`, `quotaRemaining`. O efeito não é um erro visível
 * — é pior: `snapshot.discarded` vira `undefined`, `undefined > 0` é `false`, e
 * a faixa `incompleto` simplesmente nunca dispara. O mock parece funcionar e
 * silenciosamente esconde metade do que se queria testar.
 *
 * Então este script **não escreve o envelope**: ele chama as mesmas funções do
 * caminho de produção — `toFixturesWithReport` do adaptador, `buildSnapshot` e
 * `toPublicCronState` do núcleo. Se o envelope mudar, o mock muda junto, porque
 * é o mesmo código. Um mock montado à mão diverge no dia seguinte e ninguém
 * percebe até a página mentir.
 *
 * ## O que aqui é REAL e o que é SINTÉTICO
 *
 * - **Real:** as partidas, os nomes de time, os minutos e os status vêm de
 *   `live-pico.json` — captura de `GET /fixtures?live=all` em horário de pico,
 *   89 partidas, 2026-09-04.
 * - **SINTÉTICO, e o script avisa em toda execução:** as ligas de algumas
 *   partidas são reetiquetadas para a semente. A captura não tem nenhuma liga
 *   prioritária ao vivo, então sem isso o filtro padrão devolve zero e a grade
 *   nasce vazia — impossível olhar os cartões. O cenário `vazio` é o único que
 *   NÃO reetiqueta, porque lá o vazio é o ponto.
 *
 * ## Uso
 *
 *   node tools/make-mock.mjs [cenario] [saida]
 *
 * Sem argumento, lista os cenários. `saida` existe para o teste escrever num
 * arquivo temporário: sem ela, rodar `npm test` sobrescreveria o
 * `mock-api.json` que o dev acabou de gerar, e ele abriria a página esperando
 * o cenário `quebrado` e veria outro — sem nada indicando a troca.
 *
 * @module tools/make-mock
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toFixturesWithReport } from '../src/adapters/apiFootball.js';
import { buildSnapshot, toPublicCronState } from '../src/core/snapshot.js';
import { DEFAULT_LEAGUE_IDS } from '../src/core/leagues.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CAPTURA = path.join(RAIZ, 'live-pico.json');
const SAIDA = path.join(RAIZ, 'mock-api.json');

const MIN = 60_000;

/** Nomes só para a grade ficar legível; os ids é que importam para o filtro. */
const NOMES_SEMENTE = {
  71: 'Brasileirão Série A',
  13: 'CONMEBOL Libertadores',
  11: 'CONMEBOL Sudamericana',
  73: 'Copa do Brasil',
};

/**
 * Cada cenário devolve os ajustes sobre a base. `notice` documenta qual código
 * da faixa ele exercita — é o índice que o dev usa para saber o que olhar.
 */
const CENARIOS = {
  saudavel: {
    notice: '(nenhuma faixa)',
    descricao: 'Dado fresco, completo, cron saudável. A faixa NÃO deve aparecer.',
    ajustes: () => ({}),
  },
  'sem-jogo': {
    notice: 'parado-sem-jogo',
    descricao: 'Dado de 12 min atrás, cron saudável: parou porque não havia o que buscar.',
    ajustes: (agora) => ({ fetchedAtMs: agora - 12 * MIN }),
  },
  stale: {
    notice: 'parado-motivo-desconhecido',
    descricao: 'Dado de 12 min atrás e SEM estado do cron. "Não sei por quê" nunca vira "tudo bem".',
    ajustes: (agora) => ({ fetchedAtMs: agora - 12 * MIN, cron: null }),
  },
  'sem-cota': {
    notice: 'parado-sem-cota',
    descricao: 'Dado parado com a cota no fim. A faixa diz a que horas ela volta.',
    ajustes: (agora) => ({
      fetchedAtMs: agora - 25 * MIN,
      estado: { quotaRemaining: 1 },
      quotaResetAtMs: agora + 2 * 60 * MIN,
    }),
  },
  quebrado: {
    notice: 'parado-quebrado',
    descricao: 'Dado parado com o pipeline falhando. Vence "sem cota" mesmo com a cota zerada.',
    ajustes: (agora) => ({
      fetchedAtMs: agora - 40 * MIN,
      estado: { consecutiveFailures: 4, backoffUntilMs: agora + 5 * MIN, quotaRemaining: 0 },
    }),
  },
  incompleto: {
    notice: 'incompleto',
    descricao: 'Dado fresco, mas partidas se perderam na conversão. Mostra "N de M".',
    ajustes: () => ({ discarded: 7 }),
  },
  'as-cegas': {
    notice: 'as-cegas',
    descricao: 'Dado fresco e completo, buscado SEM a agenda do dia. Cobertura reduzida.',
    ajustes: () => ({ reason: 'no-agenda' }),
  },
  vazio: {
    notice: 'vazio',
    descricao: 'Tudo saudável e nenhuma partida de interesse. A grade vazia é AFIRMADA.',
    // Único cenário que não reetiqueta: aqui o vazio é o ponto.
    ajustes: () => ({ semReetiquetar: true }),
  },
};

function ajuda() {
  console.log('uso: node tools/make-mock.mjs <cenario>\n');
  console.log('cenarios:');
  const largura = Math.max(...Object.keys(CENARIOS).map((k) => k.length));
  for (const [nome, c] of Object.entries(CENARIOS)) {
    console.log(`  ${nome.padEnd(largura)}  ${c.notice.padEnd(28)} ${c.descricao}`);
  }
  console.log('\nA faixa `sem-dado` nao sai daqui: ela aparece quando o fetch FALHA.');
  console.log('Para ve-la, aponte a pagina para um arquivo que nao existe:');
  console.log('  index.html?api=./nao-existe.json');
}

function main() {
  const cenario = process.argv[2];
  const saida = process.argv[3] ? path.resolve(process.argv[3]) : SAIDA;

  if (!cenario || !Object.hasOwn(CENARIOS, cenario)) {
    if (cenario) console.error(`cenario desconhecido: ${cenario}\n`);
    ajuda();
    process.exit(cenario ? 1 : 0);
  }

  if (!fs.existsSync(CAPTURA)) {
    console.error(`nao encontrei ${path.basename(CAPTURA)}.`);
    console.error('A captura nao e versionada (167 KB de payload cru). Sem ela nao ha o que');
    console.error('converter, e inventar partidas aqui daria um mock que nao prova nada.');
    process.exit(1);
  }

  // BOM: as capturas vem do PowerShell com marca de ordem de bytes, e
  // `JSON.parse` engasga nela. Ver a regra no CLAUDE.md.
  const cru = JSON.parse(fs.readFileSync(CAPTURA, 'utf8').replace(/^﻿/, ''));

  // O MESMO adaptador do Worker. Se ele lancar, o mock nao e escrito — e isso
  // e correto: mock gerado de payload invalido seria mentira.
  const relatorio = toFixturesWithReport(cru);

  const agora = Date.now();
  const a = CENARIOS[cenario].ajustes(agora);

  let fixtures = relatorio.fixtures;
  let reetiquetadas = 0;

  if (!a.semReetiquetar) {
    // SINTETICO. A captura nao tem liga prioritaria ao vivo, entao sem isto o
    // filtro padrao devolve zero e a grade nasce vazia em todo cenario.
    fixtures = fixtures.map((f, i) => {
      if (i >= 12) return f;
      const id = DEFAULT_LEAGUE_IDS[i % DEFAULT_LEAGUE_IDS.length];
      reetiquetadas += 1;
      return { ...f, leagueId: String(id), leagueName: NOMES_SEMENTE[id] };
    });
  }

  const fetchedAtMs = a.fetchedAtMs ?? agora;
  const discarded = a.discarded ?? relatorio.discarded;

  // `buildSnapshot` do nucleo: mesmo envelope, mesmos fallbacks, mesma versao.
  const snapshot = buildSnapshot({
    fetchedAtMs,
    fixtures,
    quotaRemaining: 87,
    quotaResetAtMs: a.quotaResetAtMs ?? agora + 3 * 60 * MIN,
    discarded,
    upstreamCount: fixtures.length + discarded,
    truncated: false,
    reason: a.reason ?? 'due',
  });

  // `toPublicCronState` do nucleo, com um estado no formato que o Worker grava
  // — inclusive `backoffUntilMs: 0`, que e o valor real quando nao ha backoff.
  const hoje = new Date(agora).toISOString().slice(0, 10);
  const estado = {
    consecutiveFailures: 0,
    backoffUntilMs: 0,
    quotaRemaining: 87,
    dayKeyUTC: hoje,
    ...(a.estado ?? {}),
  };
  const cron = a.cron === null ? null : toPublicCronState(estado, hoje);

  const corpo = { ...snapshot, cron };
  fs.writeFileSync(saida, JSON.stringify(corpo, null, 2), 'utf8');

  const c = CENARIOS[cenario];
  console.log(`cenario:  ${cenario}`);
  console.log(`faixa:    ${c.notice}`);
  console.log(`          ${c.descricao}`);
  console.log(`fixtures: ${fixtures.length} reais da captura` + (reetiquetadas
    ? `, ${reetiquetadas} com a LIGA REETIQUETADA para a semente (sintetico)`
    : ' — nenhuma reetiquetada, o filtro padrao vai devolver zero'));
  console.log(`idade:    ${Math.round((agora - fetchedAtMs) / 1000)}s`);
  console.log(`cron:     ${cron === null ? 'null (desconhecido)' : JSON.stringify(cron)}`);
  console.log(`escrito:  ${path.basename(saida)} (${(JSON.stringify(corpo).length / 1024).toFixed(0)} KB)`);
  console.log('\nabra com:  python -m http.server 8080');
  console.log('           http://localhost:8080/index.html?api=./mock-api.json');
}

main();
