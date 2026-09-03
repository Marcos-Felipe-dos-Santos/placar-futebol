/**
 * Relatório de uma captura de `GET /fixtures?live=all`.
 *
 * Responde as quatro perguntas que a revisão do adaptador deixou em aberto,
 * sem despejar o payload em lugar nenhum:
 *
 *   1. `results`
 *   2. `paging` inteiro          -> fecham a questão da paginação
 *   3. `response.length`
 *   4. `status.short` distintos com contagem
 *                                -> diz se HT/FT aparecem, convertendo metade
 *                                   do STATUS_MAP de inferência em medição
 *
 * ESTE SCRIPT NÃO LÊ A CHAVE. Ele recebe o caminho de um arquivo que você já
 * capturou. A `APISPORTS_KEY` fica no seu `.env`, que nenhum agente abre.
 *
 * Captura (PowerShell, o mesmo padrão que você já usou):
 *
 *   $k = (Get-Content .env | Select-String 'APISPORTS_KEY=(.+)').Matches.Groups[1].Value
 *   Invoke-WebRequest -Uri 'https://v3.football.api-sports.io/fixtures?live=all' `
 *     -Headers @{ 'x-apisports-key' = $k } `
 *     -OutFile 'live-pico.json'
 *
 * Relatório:
 *
 *   node tools/report-live.mjs live-pico.json
 *
 * Arquivos `*-sample.json` e `live-pico.json` são gitignored. Me mande a
 * SAÍDA do script, não o arquivo.
 */

import { readFileSync, existsSync } from 'node:fs';

const caminho = process.argv[2];

if (!caminho) {
  console.error('uso: node tools/report-live.mjs <arquivo.json>');
  process.exit(2);
}
if (!existsSync(caminho)) {
  console.error(`arquivo não encontrado: ${caminho}`);
  process.exit(2);
}

// O PowerShell grava com BOM; sem isto o JSON.parse morre no primeiro byte.
const bruto = readFileSync(caminho, 'utf8').replace(/^﻿/, '');

let j;
try {
  j = JSON.parse(bruto);
} catch (erro) {
  console.error(`JSON inválido: ${erro.message}`);
  process.exit(1);
}

const resposta = Array.isArray(j.response) ? j.response : [];

console.log(`arquivo    ${caminho}  (${(bruto.length / 1024).toFixed(1)} KB)`);
console.log(`get        ${JSON.stringify(j.get)}   parameters ${JSON.stringify(j.parameters)}`);
console.log(`errors     ${JSON.stringify(j.errors)}`);
console.log();

// (1) (2) (3) — a questão da paginação
console.log(`results          ${j.results}`);
console.log(`paging           ${JSON.stringify(j.paging)}`);
console.log(`response.length  ${resposta.length}`);

const truncado =
  (typeof j.paging?.total === 'number' && j.paging.total > 1) ||
  (typeof j.results === 'number' && j.results !== resposta.length);

console.log(
  truncado
    ? '>>> PAGINAÇÃO REAL DETECTADA — o gatilho de reversão do adaptador disparou'
    : '>>> sem paginação nesta captura',
);
console.log();

// (4) — o vocabulário real de status
const porStatus = new Map();
const porLiga = new Map();
for (const f of resposta) {
  const s = f?.fixture?.status?.short ?? '(ausente)';
  porStatus.set(s, (porStatus.get(s) || 0) + 1);
  const L = f?.league;
  if (L) porLiga.set(`${L.id}`, `${L.country} — ${L.name}`);
}

console.log('status.short distintos:');
for (const [s, n] of [...porStatus.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${s}`);
}

// Os que o STATUS_MAP marca como inferência e esta captura poderia medir.
const inferidos = ['HT', 'FT', 'ET', 'BT', 'P', 'AET', 'PEN', 'SUSP', 'INT', 'ABD', 'PST', 'CANC', 'AWD', 'WO', 'NS', 'TBD', 'LIVE'];
const medidosAgora = inferidos.filter((s) => porStatus.has(s));
console.log();
console.log(
  medidosAgora.length
    ? `>>> saem da inferência: ${medidosAgora.join(', ')}`
    : '>>> nenhum código novo: STATUS_MAP segue com 1H e 2H como únicos medidos',
);

// Bônus barato: as 4 ligas prioritárias aparecem?
const PRIORITARIAS = { 71: 'Brasileirão', 13: 'Libertadores', 11: 'Sudamericana', 73: 'Copa do Brasil' };
const presentes = Object.keys(PRIORITARIAS).filter((id) => porLiga.has(id));
console.log();
console.log(
  presentes.length
    ? `>>> ligas prioritárias ao vivo: ${presentes.map((id) => PRIORITARIAS[id]).join(', ')}`
    : '>>> nenhuma liga prioritária ao vivo nesta captura',
);
console.log(`ligas distintas na resposta: ${porLiga.size}`);
