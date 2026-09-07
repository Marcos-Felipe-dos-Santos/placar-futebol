/**
 * Casca Electron — processo `main`. PR 6a: só a janela principal.
 *
 * O que este arquivo NÃO faz, e é de propósito: não tem overlay (6c), não tem
 * tray nem esconder-ao-fechar (6d). O 6a existe para provar a tese menor e
 * mais importante: **a página roda dentro da casca sem que `src/core/` saiba
 * que a casca existe.** Nada da raiz foi tocado para isto funcionar.
 *
 * ## CommonJS aqui, ESM no resto do repositório
 *
 * A raiz é `"type": "module"`; este pacote não declara `type`, então é CJS. É
 * escolha, não descuido: o processo `main` do Electron em CJS é o caminho
 * batido, e o 6a não é o lugar de descobrir as arestas de ESM no main. Os
 * módulos puros do 6b (`src/bounds.js`) não têm essa restrição.
 *
 * ## Por que um esquema `app://` e não `loadFile`
 *
 * `loadFile` serve a página de `file://`, e daí duas coisas quebram. A que
 * importa: `fetch('./mock-api.json')` é BLOQUEADO pelo Chromium a partir de
 * `file://`, então a casca não conseguiria olhar o mock local — que é
 * justamente o que se quer inspecionar antes do 6c. A outra: `file://` tem
 * origem `null`, e depender de o Worker responder `*` para sempre é apostar
 * numa política que existe por outro motivo.
 *
 * Com `protocol.handle` a página ganha origem real, `fetch` relativo funciona
 * e `resolveApiUrl` continua valendo sem uma linha de mudança. **Um caminho de
 * carregamento só** — o que o dev inspeciona é o que vai rodar. Mesmo
 * princípio do mock passar pelo adaptador em vez de ser escrito à mão.
 *
 * `webSecurity` NÃO é desligado, e não deve ser. Além do óbvio, é ele que
 * mantém de pé o contrato de que o cliente não fala com a API-Football: uma
 * casca com `webSecurity: false` transformaria o `?api=` em porta para
 * qualquer origem, que é exatamente o que `view/origem.js` existe para fechar.
 *
 * ## DECISÃO REGISTRADA PARA O 6d — não descobrir de novo
 *
 * O `globalShortcut` é REFORÇO, não porta de volta. `register()` devolve
 * `false` quando outro app já tomou o atalho, e ele falha silenciosamente
 * nesse caso. Portanto: **o tray, sozinho, é o critério para habilitar o
 * esconder-ao-fechar.** Se `new Tray()` falhar, `close` continua encerrando o
 * app, mesmo que o atalho tenha registrado. O estado inaceitável é app vivo,
 * invisível e sem porta — o usuário mata pelo Gerenciador de Tarefas e conclui
 * que travou. Fail-closed, como `null` contra `[]` na agenda.
 */

'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, protocol, net, BrowserWindow } = require('electron');

// A resolução de caminho é PURA e mora em `src/protocolo.js`, porque este
// arquivo requer `electron` no topo e não carrega em `node --test`. A guarda
// de travessia precisa de teste; então ela sai daqui.
const { resolverArquivo } = require('./src/protocolo.js');

const ESQUEMA = 'placar';

/**
 * Origem real para a página. `standard` dá resolução de caminho relativo,
 * `secure` dá contexto seguro, `supportFetchAPI` deixa o `fetch` do `app.js`
 * funcionar. Tem de vir ANTES do `ready`.
 */
protocol.registerSchemesAsPrivileged([{
  scheme: ESQUEMA,
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}]);

function criarJanelaPrincipal() {
  const janela = new BrowserWindow({
    width: 1100,
    height: 800,
    backgroundColor: '#111418',
    show: false,
    webPreferences: {
      // ESTA LINHA NÃO É SUPÉRFLUA, e há teste que falha se ela sumir.
      //
      // O default é `true`: o Chromium estrangula timers de janela em segundo
      // plano para ~1 disparo por minuto. Esta é a janela DONA — a que faz o
      // poll e chama `applySnapshot` —, e a casca existe para o overlay ficar
      // visível com a principal escondida. Com o estrangulamento ligado, o
      // poll de 60s degrada exatamente no modo de uso que motivou o projeto,
      // e degrada em silêncio: nada na tela diz que o dado parou de chegar.
      //
      // A guarda estática (desktop/test/janelas.test.js) impede que a linha
      // desapareça. Ela NÃO prova que o Chromium a respeita — isso é o
      // watchdog do 6d, no processo main, que é onde o timer não é
      // estrangulado. Duas guardas, porque uma não cobre o que a outra cobre.
      backgroundThrottling: false,

      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // `--mock` aponta a página para o arquivo local, exatamente como
  // `index.html?api=./mock-api.json` no navegador. A validação continua sendo
  // a de `src/view/origem.js`: só caminho relativo, nunca URL absoluta.
  const mock = process.argv.includes('--mock');
  const busca = mock ? '?api=./mock-api.json' : '';
  janela.loadURL(`${ESQUEMA}://app/index.html${busca}`);

  // Só mostra com conteúdo pronto: `show: false` + este evento evitam o
  // retângulo branco piscando antes do primeiro render.
  janela.once('ready-to-show', () => janela.show());

  return janela;
}

app.whenReady().then(() => {
  protocol.handle(ESQUEMA, async (requisicao) => {
    const arquivo = resolverArquivo(requisicao.url);
    if (arquivo === null) return new Response('fora da raiz', { status: 403 });
    return net.fetch(pathToFileURL(arquivo).toString());
  });

  criarJanelaPrincipal();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanelaPrincipal();
  });
});

// 6a encerra ao fechar a última janela. O esconder-ao-fechar é do 6d, e só
// entra junto com o tray — ver a decisão registrada no topo.
app.on('window-all-closed', () => {
  app.quit();
});

