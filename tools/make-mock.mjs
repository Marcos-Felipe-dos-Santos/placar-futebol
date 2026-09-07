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
 *   Isso inclui o `leagueId`, que é PRESERVADO da captura.
 * - **Sintético:** só o que descreve o ESTADO DA BUSCA — `discarded`,
 *   `consecutiveFailures`, `quotaRemaining`, `reason` e o deslocamento de
 *   `fetchedAtMs`. São as entradas do que se quer observar (a faixa), e
 *   forjá-las é o propósito da ferramenta.
 *
 * ## A linha: por que `leagueId` NÃO pode ser forjado
 *
 * Uma versão anterior reetiquetava 12 partidas para as ligas da semente, para
 * os chips terem conteúdo. Estava errado, e o erro tem forma geral: **o filtro
 * por liga é o mecanismo que se quer olhar, e `leagueId` é o dado sobre o qual
 * ele opera.** Falsificá-lo não deixa o dev olhando o filtro — deixa o dev
 * olhando o falsificador. Produziu cartões com "Brasileirão Série A" sobre
 * Aalesund x Start, e o contador `(3)` idêntico em todo chip, que era só
 * 12 partidas divididas por 4 ligas.
 *
 * `discarded: 7` continua sintético e está certo que continue: ele é entrada
 * do que se observa, não o dado que o mecanismo observado processa.
 *
 * A consequência é assumida: **esta captura não tem NENHUMA liga da semente**,
 * então o filtro padrão devolve zero e a grade nasce vazia. Isso é a verdade
 * do dado. Para ver cartões, favorite uma liga real (o script diz qual) ou use
 * "Ver todas as ligas". Um cenário com liga prioritária exige uma captura com
 * Brasileirão no ar, que ainda não existe.
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
import { FRESH_MAX_MS } from '../src/core/staleness.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CAPTURA = path.join(RAIZ, 'live-pico.json');
const SAIDA = path.join(RAIZ, 'mock-api.json');

const MIN = 60_000;

/**
 * Cada cenário devolve os ajustes sobre a base. `notice` documenta qual código
 * da faixa ele exercita — é o índice que o dev usa para saber o que olhar.
 */
const CENARIOS = {
  saudavel: {
    notice: '(nenhuma faixa)',
    descricao: 'Dado fresco, completo, cron saudável. A faixa NÃO deve aparecer.',
    // Único cenário cuja faixa depende da grade ter conteúdo: sem favorita,
    // `visibleCount` é 0 e `chooseNotice` devolve `vazio` — corretamente.
    comFavorita: true,
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
    descricao: 'Tudo saudável e nenhuma liga de interesse ao vivo. O vazio é AFIRMADO.',
    // MESMO ARQUIVO que `saudavel` — e isso é honesto, não um descuido: a
    // faixa `vazio` depende de `visibleCount`, que sai das FAVORITAS do
    // navegador, não do snapshot. Os dois cenários diferem em como se olha,
    // não no que se serve. Por isso este exige favorita nenhuma.
    comFavorita: false,
    ajustes: () => ({}),
  },
};

function ajuda() {
  console.log('uso: node tools/make-mock.mjs <cenario>\n');
  console.log('cenarios:');
  const largura = Math.max(...Object.keys(CENARIOS).map((k) => k.length));
  for (const [nome, c] of Object.entries(CENARIOS)) {
    // A condicao de visualizacao entra AQUI tambem, e nao so na saida de cada
    // execucao: a ajuda e a primeira coisa que o dev le, e um cenario listado
    // como "(nenhuma faixa)" sem dizer que isso exige favorita promete o que o
    // arquivo sozinho nao entrega.
    const marca = c.comFavorita ? ' [pede favorita]' : '';
    console.log(`  ${nome.padEnd(largura)}  ${(c.notice + marca).padEnd(44)} ${c.descricao}`);
  }
  console.log('');
  console.log('Esta captura tem ZERO partidas de liga da semente, entao o filtro padrao');
  console.log('devolve grade vazia. Isso e a verdade do dado, nao defeito: para ver');
  console.log('cartoes, favorite uma liga real (cada execucao diz qual) ou clique');
  console.log('"Ver todas as ligas". Um cenario com liga prioritaria exige uma captura');
  console.log('com Brasileirao no ar, que ainda nao existe.');
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

  // `leagueId` VEM DA CAPTURA, intocado. Ver "A linha" no topo do arquivo.
  const fixtures = relatorio.fixtures;

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
  console.log(`fixtures: ${fixtures.length} reais da captura, leagueId PRESERVADO`);

  // A liga mais numerosa da captura: e o que o dev favorita para ver a grade
  // com dado REAL. Sai daqui, e nao de um id fixo no teste, para continuar
  // certo se a captura mudar.
  const porLiga = new Map();
  for (const fx of fixtures) {
    const atual = porLiga.get(fx.leagueId);
    if (atual) atual.n += 1;
    else porLiga.set(fx.leagueId, { n: 1, nome: fx.leagueName || fx.leagueId });
  }
  // Desempate pelo id: sem ele duas ligas empatadas trocariam de lugar entre
  // execucoes e o teste leria uma sugestao diferente da que o dev viu.
  const ranking = [...porLiga.entries()].sort(
    (x, y) => y[1].n - x[1].n || x[0].localeCompare(y[0]),
  );
  const semente = new Set(DEFAULT_LEAGUE_IDS.map(String));
  const daSemente = fixtures.filter((fx) => semente.has(fx.leagueId)).length;

  console.log(`ligas:    ${porLiga.size} distintas; ${daSemente} partida(s) de liga da SEMENTE`);

  // A CONDICAO DE VISUALIZACAO faz parte do anuncio. A faixa `vazio` nao sai
  // do snapshot: sai de `visibleCount`, que depende das favoritas do
  // navegador. Anunciar a faixa sem dizer sob que filtro ela vale seria
  // prometer o que o arquivo sozinho nao entrega.
  const [idSug, sug] = ranking[0];
  if (c.comFavorita) {
    console.log('favorite: liga ' + idSug + ' "' + sug.nome + '" (' + sug.n + ' partidas) — SEM ela a faixa e `vazio`.');
  } else {
    console.log(`favorite: nenhuma — este cenario vale com o filtro padrao, sem favorita.`);
  }
  console.log(`idade:    ${Math.round((agora - fetchedAtMs) / 1000)}s`);

  // VALIDADE. `fetchedAtMs` e absoluto no instante da geracao e a pagina o
  // compara com o relogio, entao os cenarios frescos apodrecem em
  // FRESH_MAX_MS. O que torna isso pior que um incomodo: um `saudavel`
  // vencido fica IDENTICO a um `sem-jogo` — medido, os corpos so diferem no
  // timestamp —, entao a pagina nao mente por bug, ela relata com precisao um
  // estado que o arquivo de fato descreve. Nada na tela denuncia a troca.
  //
  // Distinguir os dois exigiria um campo no corpo, e o corpo tem de continuar
  // sendo o envelope EXATO de /api/live — e faria a producao ler um campo que
  // so o mock escreve. Entao o aviso sai AQUI, na ferramenta, e nao depende de
  // o dev lembrar da regua: regra que depende de lembrar nao e regra.
  const venceEmMs = fetchedAtMs + FRESH_MAX_MS;
  if (venceEmMs > agora) {
    const hora = new Date(venceEmMs).toLocaleTimeString("pt-BR");
    const restam = Math.round((venceEmMs - agora) / 1000);
    console.log(`validade: ate ${hora} — ${restam}s a partir de agora.`);
    console.log("          DEPOIS DISSO a faixa vira `parado-sem-jogo` sozinha, e este");
    console.log("          arquivo fica indistinguivel do cenario `sem-jogo`. Regenere.");
  } else {
    console.log("validade: nao vence — nasceu parado, a faixa nao muda com o relogio.");
  }
  console.log(`cron:     ${cron === null ? 'null (desconhecido)' : JSON.stringify(cron)}`);
  console.log(`escrito:  ${path.basename(saida)} (${(JSON.stringify(corpo).length / 1024).toFixed(0)} KB)`);
  console.log('\nabra com:  python -m http.server 8080');
  console.log('           http://localhost:8080/index.html?api=./mock-api.json');
}

main();
