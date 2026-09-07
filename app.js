/**
 * A PÁGINA. Só DOM e eventos — toda decisão mora em módulo puro e testado.
 *
 * ## Os quatro contratos que este arquivo não negocia
 *
 * 1. **`applySnapshot` é o ÚNICO consumo do núcleo.** `diffFixtures`,
 *    `shouldAlert` e `keepLatestSnapshot` continuam exportadas para os testes
 *    delas, mas sequenciá-las aqui na mão reintroduz um alerta falso já
 *    corrigido: réplica atrasada do KV faz o placar regredir, o gol é
 *    redescoberto no poll seguinte e o som toca para um gol que já está na
 *    tela. A ordem correta é diffar, filtrar pelo dedupe, registrar e só então
 *    avançar o estado — e é isso que `applySnapshot` faz de uma vez.
 * 2. **O navegador NUNCA chama a API-Football.** Só `/api/live` do Worker. A
 *    cota de 100 requisições/dia é global da chave, não por cliente: uma aba
 *    pollando a 60s consumiria o dia inteiro em menos de um jogo.
 * 3. **Zero dependências, zero build.** É a premissa que sustenta GitHub
 *    Pages e o projeto inteiro.
 * 4. **`localStorage` só para favoritas (liga e partida) e posição do
 *    overlay.** Nada de espelhar snapshot, cota ou estado do cron: seriam
 *    segundas fontes de verdade que envelhecem sem ninguém perceber.
 *
 *    As duas favoritas têm PRAZOS diferentes e por isso chaves diferentes:
 *    liga é permanente, partida é efêmera — o jogo acaba. Ver `view/pins.js`.
 *
 * ## O estado do núcleo é OPACO
 *
 * `coreState` sai de `applySnapshot` e volta para `applySnapshot`. Não se lê,
 * não se remonta, não se persiste. Ele carrega o snapshot e o registro de
 * alertados juntos justamente para que não exista caminho que emita um evento
 * sem gravar a chave do dedupe.
 *
 * @module app
 */

import { applySnapshot } from './src/core/session.js';
import { isStale } from './src/core/staleness.js';
import { chooseNotice } from './src/core/notice.js';
import { uncoveredFavorites } from './src/core/leagues.js';
import { visibleFixtures, leagueChips, sortFixtures } from './src/view/filter.js';
import { parsePins, prunePins, serializePins } from './src/view/pins.js';
import { resolveApiUrl } from './src/view/origem.js';
import {
  noticeTexto,
  resyncTexto,
  chipCoberturaTexto,
  statusTexto,
  minutoTexto,
  placarTexto,
  idadeCurta,
} from './src/view/copy.js';

/**
 * Endereço do Worker. Trocar aqui ao publicar.
 *
 * Isto NÃO é segredo: é uma URL pública que serve o KV. A chave da
 * API-Football é secret do painel do Cloudflare e não passa nem perto do
 * cliente.
 */
const API_PADRAO = 'https://placar-futebol.SEU-SUBDOMINIO.workers.dev/api/live';

/**
 * Origem do dado. `index.html?api=./mock-api.json` aponta para o mock local
 * gerado por `tools/make-mock.mjs`; a validação — só caminho relativo, nunca
 * URL absoluta — mora em `view/origem.js`, com teste.
 */
const API_URL = resolveApiUrl(
  typeof location === 'undefined' ? '' : location.search,
  API_PADRAO,
);

/**
 * Intervalo do poll ao KV.
 *
 * Não é o intervalo upstream: o Worker busca a cada ~135s e o navegador só lê
 * o que já está no KV, então pollar mais rápido que o Worker não gasta cota da
 * API-Football — gasta leitura de KV, que tem orçamento próprio e folgado. 30s
 * mantém a idade exibida honesta sem transformar uma aba aberta o dia todo em
 * dezenas de milhares de leituras.
 */
const POLL_MS = 30_000;

/** Com que frequência a idade na tela é recalculada, sem ir à rede. */
const TICK_MS = 1_000;

const LS_FAVORITAS = 'placar:favoritas';
const LS_OVERLAY = 'placar:overlay';
const LS_PARTIDAS = 'placar:partidas';

// === estado da sessão =======================================================

/** Opaco: sai de `applySnapshot`, volta para `applySnapshot`. */
let coreState = null;

/** Estado do cron servido junto do snapshot. `null` é "não sei". */
let cronState = null;

/** `true` só depois de um gesto do usuário. Ver `liberarSom`. */
let soundEnabled = false;

let leagueFilter = null;
let showAll = false;
let ultimoResync = null;
let falhaDeRede = false;

/** @type {string[]} */
let favoritas = lerFavoritas();

/**
 * Partidas fixadas no overlay.
 *
 * Persistidas, mas com prazo: `parsePins` descarta o que foi fixado em outro
 * dia e `prunePins` descarta o que já terminou. Sem os dois, o overlay
 * carregaria os jogos da terça passada e o usuário teria de limpar a lista à
 * mão para a página voltar a servir.
 *
 * @type {Set<string>}
 */
let favoritasPartida = new Set(lerPartidas());

// === localStorage, com desconfiança =========================================

function lerFavoritas() {
  try {
    const cru = JSON.parse(localStorage.getItem(LS_FAVORITAS) ?? '[]');
    return Array.isArray(cru) ? cru.filter((x) => typeof x === 'string') : [];
  } catch {
    // `localStorage` corrompido não pode derrubar a página. Sem favoritas a
    // grade ainda mostra a semente.
    return [];
  }
}

function gravarFavoritas() {
  try {
    localStorage.setItem(LS_FAVORITAS, JSON.stringify(favoritas));
  } catch {
    // Modo privado do Safari, cota estourada. A favorita vale para esta
    // sessão; falhar aqui não pode custar a página.
  }
}

function lerPartidas() {
  try {
    return parsePins(localStorage.getItem(LS_PARTIDAS), Date.now());
  } catch {
    return [];
  }
}

function gravarPartidas() {
  try {
    localStorage.setItem(LS_PARTIDAS, JSON.stringify(serializePins([...favoritasPartida], Date.now())));
  } catch {
    // Mesma degradação das favoritas de liga: vale para esta sessão.
  }
}

// === o som ==================================================================

let audioCtx = null;

/**
 * Libera o áudio no primeiro gesto do usuário.
 *
 * O navegador bloqueia áudio sem interação, e `AudioContext` criado antes do
 * gesto nasce suspenso. Enquanto `soundEnabled` for `false`, `applySnapshot`
 * não emite evento nenhum e nada fica pendente — liberar o som no minuto 80
 * não dispara os gols do primeiro tempo.
 */
function liberarSom() {
  if (soundEnabled) return;
  try {
    audioCtx = new (window.AudioContext ?? window.webkitAudioContext)();
    soundEnabled = true;
    document.getElementById('som-aviso')?.classList.add('escondido');
    render();
  } catch {
    // Sem WebAudio o resto da página funciona. Silêncio é degradação
    // aceitável; página quebrada não é.
  }
}

/** Bipe sintetizado — sem arquivo de áudio, para não ter dependência. */
function tocarGol() {
  if (!soundEnabled || audioCtx === null) return;
  try {
    const agora = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const ganho = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, agora);
    osc.frequency.setValueAtTime(1180, agora + 0.12);
    ganho.gain.setValueAtTime(0.0001, agora);
    ganho.gain.exponentialRampToValueAtTime(0.3, agora + 0.02);
    ganho.gain.exponentialRampToValueAtTime(0.0001, agora + 0.45);
    osc.connect(ganho).connect(audioCtx.destination);
    osc.start(agora);
    osc.stop(agora + 0.5);
  } catch {
    // Falha ao tocar não pode interromper o render do gol na tela.
  }
}

// === o poll =================================================================

async function buscar() {
  let resposta;
  try {
    resposta = await fetch(API_URL, { headers: { accept: 'application/json' } });
  } catch {
    falhaDeRede = true;
    render();
    return;
  }

  if (!resposta.ok) {
    // 503 do Worker é "sem snapshot ainda" ou "KV fora do ar" — os dois são
    // "não sei", nunca "não há jogos". O corpo não vira grade vazia.
    falhaDeRede = true;
    render();
    return;
  }

  let corpo;
  try {
    corpo = await resposta.json();
  } catch {
    falhaDeRede = true;
    render();
    return;
  }

  falhaDeRede = false;
  cronState = corpo?.cron ?? null;

  // Partida que acabou sai do overlay AGORA, sem esperar a virada do dia. O
  // corte por dia da leitura sozinho manteria o jogo encerrado às 22h fixado a
  // noite inteira.
  const antes = favoritasPartida.size;
  favoritasPartida = new Set(prunePins([...favoritasPartida], corpo?.fixtures ?? []));
  if (favoritasPartida.size !== antes) gravarPartidas();

  // CONTRATO 1. Uma chamada, na ordem certa, com o estado opaco entrando e
  // saindo. `soundEnabled` é a VARIÁVEL — passar `true` aqui furaria o
  // bloqueio de autoplay e faria a página tocar som que o navegador ia
  // recusar, ou pior, tocar antes de o usuário pedir.
  const r = applySnapshot(coreState, corpo, { soundEnabled });
  coreState = r.state;

  for (const evento of r.events) {
    tocarGol();
    piscar(evento.fixture.id);
  }

  if (r.resynced) ultimoResync = { swallowedGoals: r.swallowedGoals };

  render();
}

// === render =================================================================

/** @returns {import('./src/core/snapshot.js').StoredSnapshot|null} */
function snapshotAtual() {
  // Leitura do estado opaco SÓ para exibir. Nenhuma decisão do núcleo sai
  // daqui: quem decide alerta é `applySnapshot`, e já decidiu.
  return coreState?.snapshot ?? null;
}

function el(tag, className, texto) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (texto !== undefined) node.textContent = texto;
  return node;
}

function render() {
  const snapshot = falhaDeRede ? null : snapshotAtual();
  const agora = Date.now();

  const todas = snapshot?.fixtures ?? [];
  const visiveis = sortFixtures(visibleFixtures({
    fixtures: todas,
    favorites: favoritas,
    leagueFilter,
    showAll,
  }));

  renderFaixa(snapshot, agora, visiveis.length);
  renderResync();
  renderIdade(snapshot, agora);
  renderChips(todas);
  renderGrade(visiveis);
  renderOverlay(visiveis);
}

function renderFaixa(snapshot, agora, visibleCount) {
  const alvo = document.getElementById('faixa');
  alvo.replaceChildren();

  const notice = chooseNotice({
    nowMs: agora,
    snapshot,
    cron: cronState,
    visibleCount,
    uncoveredCount: uncoveredFavorites(favoritas).size,
  });
  const texto = noticeTexto(notice);

  // Sem aviso, sem faixa. A faixa não é mobília: se ficasse sempre visível, o
  // dia em que ela importa seria o dia em que ninguém repara.
  if (texto === null) {
    alvo.hidden = true;
    return;
  }

  alvo.hidden = false;
  alvo.dataset.severidade = notice.severity;
  alvo.append(el('strong', 'faixa-titulo', texto.titulo), el('p', 'faixa-detalhe', texto.detalhe));
}

function renderResync() {
  const alvo = document.getElementById('resync');
  alvo.replaceChildren();

  const texto = ultimoResync ? resyncTexto(true, ultimoResync.swallowedGoals) : null;
  if (texto === null) {
    alvo.hidden = true;
    return;
  }

  // Elemento SEPARADO da faixa de propósito: a faixa descreve o estado atual e
  // é recalculada a cada render; isto é um evento passado, que precisa
  // continuar visível depois de o estado voltar ao normal. Lifetimes
  // diferentes não cabem no mesmo elemento.
  alvo.hidden = false;
  const fechar = el('button', 'resync-fechar', '×');
  fechar.type = 'button';
  fechar.setAttribute('aria-label', 'Dispensar aviso');
  fechar.addEventListener('click', () => { ultimoResync = null; render(); });
  alvo.append(el('strong', null, texto.titulo), el('p', null, texto.detalhe), fechar);
}

function renderIdade(snapshot, agora) {
  const alvo = document.getElementById('idade');

  if (snapshot === null) {
    alvo.dataset.nivel = 'stale';
    alvo.textContent = 'sem dados';
    return;
  }

  // STALENESS VEM DO TIMESTAMP DO SNAPSHOT, nunca do `elapsed` da partida. Um
  // dado pode estar fresquíssimo com `elapsed` parado em 45 por seis minutos:
  // a API satura o minuto durante o acréscimo.
  const { level, ageMs } = isStale(snapshot.fetchedAtMs, agora);
  alvo.dataset.nivel = level;
  alvo.textContent = `atualizado ${idadeCurta(ageMs)}`;
}

function renderChips(todas) {
  const alvo = document.getElementById('chips');
  alvo.replaceChildren();

  const chips = leagueChips({ fixtures: todas, favorites: favoritas });

  const todasBtn = el('button', 'chip', `Todas de interesse`);
  todasBtn.type = 'button';
  todasBtn.setAttribute('aria-pressed', String(leagueFilter === null && !showAll));
  todasBtn.addEventListener('click', () => { leagueFilter = null; showAll = false; render(); });
  alvo.append(todasBtn);

  for (const chip of chips) {
    const botao = el('button', 'chip');
    botao.type = 'button';
    botao.setAttribute('aria-pressed', String(leagueFilter === chip.leagueId));
    botao.append(el('span', null, `${chip.leagueName} (${chip.count})`));

    // AVISO DE ESCOPO LOCAL: mora no chip da liga a que se refere, nunca na
    // faixa global. Na faixa disputaria precedência todo dia com avisos
    // temporais e acabaria escondendo um deles ou empilhando.
    const aviso = chipCoberturaTexto(chip.uncovered);
    if (aviso !== null) {
      botao.classList.add('chip-sem-cobertura');
      botao.title = aviso;
      const marca = el('span', 'chip-marca', '!');
      marca.setAttribute('aria-label', 'sem cobertura ao vivo garantida');
      botao.append(marca);
    }

    botao.addEventListener('click', () => {
      leagueFilter = leagueFilter === chip.leagueId ? null : chip.leagueId;
      render();
    });
    alvo.append(botao);
  }

  const verTudo = el('button', 'chip chip-tudo', showAll ? 'Voltar ao interesse' : 'Ver todas as ligas');
  verTudo.type = 'button';
  verTudo.addEventListener('click', () => { showAll = !showAll; leagueFilter = null; render(); });
  alvo.append(verTudo);
}

function renderGrade(visiveis) {
  const alvo = document.getElementById('grade');
  alvo.replaceChildren();

  for (const f of visiveis) {
    const cartao = el('article', 'cartao');
    cartao.dataset.fixture = f.id;
    cartao.dataset.status = f.status;

    const topo = el('header', 'cartao-topo');
    topo.append(el('span', 'cartao-liga', f.leagueName || f.leagueId));
    topo.append(el('span', 'cartao-estado', `${statusTexto(f)} ${minutoTexto(f)}`.trim()));
    cartao.append(topo);

    const linha = el('div', 'cartao-placar');
    linha.append(el('span', 'time', f.homeName));
    linha.append(el('span', 'gols', placarTexto(f.homeGoals)));
    linha.append(el('span', 'x', '×'));
    linha.append(el('span', 'gols', placarTexto(f.awayGoals)));
    linha.append(el('span', 'time', f.awayName));
    cartao.append(linha);

    const fixada = favoritasPartida.has(f.id);
    const fav = el('button', 'favorita', fixada ? '✓ Fixada' : 'Fixar');
    fav.type = 'button';
    fav.title = 'Fixar esta partida no overlay flutuante';
    fav.setAttribute('aria-pressed', String(fixada));
    fav.addEventListener('click', () => {
      if (favoritasPartida.has(f.id)) favoritasPartida.delete(f.id);
      else favoritasPartida.add(f.id);
      gravarPartidas();
      render();
    });
    cartao.append(fav);

    const ligaFav = favoritas.includes(f.leagueId);
    const favLiga = el('button', 'favorita-liga', ligaFav ? '★ Liga' : '☆ Liga');
    favLiga.type = 'button';
    favLiga.title = 'Favoritar a competição (entra no filtro de ligas)';
    favLiga.setAttribute('aria-pressed', String(ligaFav));
    favLiga.addEventListener('click', () => {
      favoritas = favoritas.includes(f.leagueId)
        ? favoritas.filter((id) => id !== f.leagueId)
        : [...favoritas, f.leagueId];
      gravarFavoritas();
      render();
    });
    cartao.append(favLiga);

    alvo.append(cartao);
  }
}

function renderOverlay(visiveis) {
  const alvo = document.getElementById('overlay');
  const corpo = document.getElementById('overlay-corpo');
  corpo.replaceChildren();

  const fixadas = visiveis.filter((f) => favoritasPartida.has(f.id));
  if (fixadas.length === 0) {
    alvo.hidden = true;
    return;
  }

  alvo.hidden = false;
  for (const f of fixadas) {
    const linha = el('div', 'overlay-linha');
    linha.append(el('span', 'overlay-times', `${f.homeName} × ${f.awayName}`));
    linha.append(el('span', 'overlay-gols', `${placarTexto(f.homeGoals)}–${placarTexto(f.awayGoals)}`));
    linha.append(el('span', 'overlay-min', minutoTexto(f)));
    corpo.append(linha);
  }
}

function piscar(fixtureId) {
  const cartao = document.querySelector(`[data-fixture="${CSS.escape(fixtureId)}"]`);
  if (cartao === null) return;
  cartao.classList.remove('gol');
  // Força reflow para a animação reiniciar em dois gols seguidos.
  void cartao.offsetWidth;
  cartao.classList.add('gol');
}

// === overlay arrastável =====================================================

function posicionarOverlay() {
  const alvo = document.getElementById('overlay');
  try {
    const cru = JSON.parse(localStorage.getItem(LS_OVERLAY) ?? 'null');
    if (cru && Number.isFinite(cru.x) && Number.isFinite(cru.y)) {
      alvo.style.left = `${Math.max(0, Math.min(cru.x, window.innerWidth - 80))}px`;
      alvo.style.top = `${Math.max(0, Math.min(cru.y, window.innerHeight - 40))}px`;
    }
  } catch {
    // Posição ilegível: o CSS já tem um canto padrão.
  }
}

function arrastar(alvo) {
  let ativo = false;
  let dx = 0;
  let dy = 0;

  alvo.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    ativo = true;
    const r = alvo.getBoundingClientRect();
    dx = e.clientX - r.left;
    dy = e.clientY - r.top;
    alvo.setPointerCapture(e.pointerId);
  });

  alvo.addEventListener('pointermove', (e) => {
    if (!ativo) return;
    // Preso à viewport: overlay arrastado para fora da tela vira um recurso
    // que o usuário não consegue recuperar sem limpar o localStorage.
    const x = Math.max(0, Math.min(e.clientX - dx, window.innerWidth - 80));
    const y = Math.max(0, Math.min(e.clientY - dy, window.innerHeight - 40));
    alvo.style.left = `${x}px`;
    alvo.style.top = `${y}px`;
  });

  alvo.addEventListener('pointerup', () => {
    if (!ativo) return;
    ativo = false;
    try {
      const r = alvo.getBoundingClientRect();
      localStorage.setItem(LS_OVERLAY, JSON.stringify({ x: r.left, y: r.top }));
    } catch {
      // Sem persistir, o overlay volta ao canto padrão no próximo carregamento.
    }
  });
}

// === início =================================================================

function iniciar() {
  posicionarOverlay();
  arrastar(document.getElementById('overlay'));

  document.getElementById('som-liberar').addEventListener('click', liberarSom);
  // Qualquer gesto serve como liberação — o botão é só o convite explícito.
  document.addEventListener('pointerdown', liberarSom, { once: true });

  render();
  buscar();
  setInterval(buscar, POLL_MS);
  // A idade envelhece sozinha, sem ir à rede. Sem isto a tela diria "há 5s"
  // por trinta segundos.
  setInterval(render, TICK_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', iniciar);
} else {
  iniciar();
}
