import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * OS CONTRATOS DO CLIENTE, verificados na FONTE.
 *
 * `app.js` é DOM puro e não roda sob `node --test` sem dependência — e
 * dependência nova é justamente o que este projeto não aceita. Então o que dá
 * para verificar sem DOM é verificado aqui, lendo o arquivo: são invariantes
 * estruturais, do tipo "esta chamada não pode existir", e para essas a fonte é
 * evidência suficiente.
 *
 * O que NÃO é coberto aqui está listado em `README`/relatório como verificação
 * manual. Um teste que lê texto não prova comportamento; prova ausência de
 * caminho proibido, que é exatamente o que estes contratos são.
 */

const app = fs.readFileSync('app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

/**
 * Recorta a função sob medição — com a guarda POR CONSTRUÇÃO.
 *
 * Este helper existe porque a guarda escrita à mão foi esquecida em seis dos
 * sete recortes deste arquivo, no mesmo commit que enunciou a regra. Provado
 * por mutação: renomeando `renderFaixa`, o teste que tinha a guarda ficou
 * vermelho e o que não tinha passou com o recorte destruído — `indexOf`
 * devolve -1, o `slice` vira lixo e `assert.ok(!lixo.includes(x))` passa por
 * vacuidade.
 *
 * A lição de segunda ordem: **regra que depende de lembrar não é regra.** Se a
 * guarda pode ser esquecida, ela vai dentro da ferramenta, e aí não há como
 * escrever o teste errado.
 *
 * @param {string} de   Marcador de início, ex.: `function renderFaixa`.
 * @param {string} ate  Marcador de fim.
 * @returns {string}
 */
function recortar(de, ate) {
  const inicio = app.indexOf(de);
  const fim = app.indexOf(ate);
  assert.notEqual(inicio, -1, `recorte falhou: "${de}" não existe mais em app.js`);
  assert.notEqual(fim, -1, `recorte falhou: "${ate}" não existe mais em app.js`);
  assert.ok(inicio < fim, `recorte invertido: "${de}" aparece depois de "${ate}"`);

  const trecho = app.slice(inicio, fim);
  assert.ok(trecho.length > 100, `recorte de "${de}" tem ${trecho.length} chars: parou de medir`);
  return trecho;
}

test('CONTRATO 1: o núcleo é consumido SÓ por applySnapshot', () => {
  // Sequenciar `diffFixtures`/`shouldAlert`/`keepLatestSnapshot` na mão
  // reintroduz um alerta falso já corrigido: réplica atrasada do KV faz o
  // placar regredir, o gol é redescoberto no poll seguinte e o som toca para
  // um gol que já está na tela.
  //
  // Casa CHAMADA (`nome(`) ou IMPORT, e não menção em prosa: a primeira versão
  // deste teste usava `includes` e ficava vermelha por causa do próprio
  // comentário de app.js que explica a regra. Teste que proíbe falar sobre a
  // regra é teste errado.
  for (const proibida of ['diffFixtures', 'shouldAlert', 'keepLatestSnapshot', 'markAlerted']) {
    const chamada = new RegExp(String.raw`(?<![\w.])${proibida}\s*\(`);
    assert.ok(
      !chamada.test(app),
      `app.js CHAMA ${proibida} direto: a ordem correta é a de applySnapshot`,
    );
  }

  // E nenhum deles entra pelo import, que é o outro caminho.
  const importados = [...app.matchAll(/import\s*\{([^}]+)\}\s*from/g)]
    .flatMap((m) => m[1].split(',').map((x) => x.trim()));
  assert.ok(importados.length > 0, 'o teste parou de encontrar imports em app.js');
  for (const proibida of ['diffFixtures', 'shouldAlert', 'keepLatestSnapshot', 'markAlerted']) {
    assert.ok(!importados.includes(proibida), `app.js importa ${proibida}`);
  }
  // Controle positivo: se o import de `applySnapshot` sumisse, os asserts
  // acima passariam com a página sem núcleo nenhum.
  assert.match(app, /import \{ applySnapshot \} from '\.\/src\/core\/session\.js'/);
  assert.match(app, /applySnapshot\(coreState, corpo/);
});

test('CONTRATO 2: o navegador nunca chama a API-Football', () => {
  // A cota de 100/dia é global da chave, não por cliente. Qualquer caminho que
  // ligue uma visita a uma requisição upstream transforma tráfego em custo
  // global.
  assert.ok(!app.includes('api-sports.io'), 'app.js aponta para a API-Football');
  assert.ok(!app.includes('x-apisports-key'), 'app.js carrega header de chave da API');
  assert.ok(!html.includes('api-sports.io'), 'index.html aponta para a API-Football');

  // E há exatamente UM fetch, para o Worker.
  const fetches = app.match(/fetch\(/g) ?? [];
  assert.equal(fetches.length, 1, `app.js tem ${fetches.length} chamadas de fetch`);
  assert.match(app, /fetch\(API_URL/);
});


test('o override de origem passa por resolveApiUrl, não por checagem solta', () => {
  // A validação é lógica e mora em módulo puro com teste próprio
  // (`test/origem.test.js`), inclusive o caso `//evil.com`, que passa numa
  // checagem ingênua de "começa com barra". Aqui só se prende que o app.js não
  // reimplemente a checagem por fora.
  assert.match(app, /import \{ resolveApiUrl \} from '\.\/src\/view\/origem\.js'/);
  assert.match(app, /const API_URL = resolveApiUrl\(/);
  assert.ok(
    !/location\.search[\s\S]{0,200}startsWith/.test(app),
    'app.js reimplementou a validação de origem por fora de resolveApiUrl',
  );
});

// O TRIPWIRE DA PUBLICAÇÃO VIVEU AQUI e foi removido em 2026-09-07, seguindo a
// instrução dele mesmo. Ele exigia que `API_PADRAO` fosse o placeholder, e
// existia porque o placeholder DEGRADA BEM DEMAIS: o fetch falha, a página
// mostra "sem dados do servidor" — degradação correta e, por isso,
// indistinguível de pipeline quebrado.
//
// Funcionou como projetado. No dia da publicação o dev abriu a página, viu a
// faixa vermelha e foi procurar o bug no Worker — diagnosticou CORS. Era a URL
// não trocada, exatamente o que o teste previa em prosa.
//
// FICA A FORMA, que vale para o próximo placeholder: um valor de configuração
// cuja ausência degrada BEM merece um teste que falhe até ser configurado, com
// a instrução de remoção escrita na própria mensagem.

test('CONTRATO 3: nenhuma dependência e nenhum build', () => {
  // Este teste é dono do `package.json` da RAIZ. A varredura da ÁRVORE inteira,
  // com a isenção de `desktop/`, mora em `zero-dependencias.test.js` —
  // separados de propósito, para não existirem duas cópias da mesma asserção
  // divergindo. Aqui: o manifesto e o `app.js`. Lá: todo o resto.
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  for (const campo of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    // Os quatro, não só os dois: `peerDependencies` e `optionalDependencies`
    // também fazem `npm install` baixar coisa, e passavam batido.
    assert.deepEqual(
      Object.keys(pkg[campo] ?? {}), [],
      'apareceu `' + campo + '` na raiz — dependência de casca vai em desktop/package.json',
    );
  }

  // Import de pacote (sem `./` nem `../`) significaria node_modules, e
  // node_modules significaria build para o GitHub Pages.
  const imports = [...app.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  assert.ok(imports.length > 0, 'nenhum import encontrado: o teste parou de medir');
  for (const especificador of imports) {
    assert.ok(
      especificador.startsWith('./') || especificador.startsWith('../'),
      `import de pacote em app.js: ${especificador}`,
    );
  }

  // E a página carrega os módulos direto, sem passo de empacotamento.
  assert.match(html, /<script type="module" src="app\.js">/);
});

test('CONTRATO 4: localStorage só para favoritas e posição do overlay', () => {
  // Espelhar snapshot, cota ou estado do cron criaria uma segunda fonte de
  // verdade que envelhece sem ninguém perceber.
  //
  // Três chaves, e a terceira foi decisão explícita do dev: favorita de LIGA é
  // permanente, favorita de PARTIDA é efêmera — o jogo acaba. Prazos
  // diferentes, chaves diferentes, e o prazo da partida é imposto em
  // `view/pins.js`, não aqui.
  const PERMITIDAS = new Set(['LS_FAVORITAS', 'LS_OVERLAY', 'LS_PARTIDAS']);
  const chaves = [...app.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(([^,)]+)/g)]
    .map((m) => m[1].trim());

  assert.ok(chaves.length >= 4, 'o teste parou de encontrar os usos de localStorage');
  for (const chave of chaves) {
    assert.ok(PERMITIDAS.has(chave), `localStorage usado com chave fora do contrato: ${chave}`);
  }
  assert.match(app, /const LS_FAVORITAS = 'placar:favoritas'/);
  assert.match(app, /const LS_OVERLAY = 'placar:overlay'/);
  assert.match(app, /const LS_PARTIDAS = 'placar:partidas'/);
});

test('a partida fixada é podada a cada snapshot, não só na leitura', () => {
  // O corte por dia sozinho manteria o jogo encerrado às 22h fixado a noite
  // inteira. `prunePins` tem de rodar no caminho do poll, com as fixtures que
  // acabaram de chegar.
  const buscar = recortar('async function buscar', '// === render');
  assert.match(buscar, /prunePins\(\[\.\.\.favoritasPartida\], corpo\?\.fixtures/);
  assert.match(buscar, /gravarPartidas\(\)/);
});

test('AUTOPLAY: soundEnabled entra como VARIÁVEL, nunca como literal', () => {
  // Este projeto já perdeu o bloqueio de autoplay uma vez, por um `git add -A`
  // disparado com a bateria de mutação rodando: o commit entrou com
  // `enabled: true` no lugar de `enabled: soundEnabled`. Nenhum teste pegou na
  // época porque a árvore de trabalho estava certa. Este pega.
  assert.match(app, /applySnapshot\([^)]*\{\s*soundEnabled\s*\}/s);
  assert.ok(
    !/soundEnabled:\s*true/.test(app),
    'soundEnabled passado como literal: o bloqueio de autoplay foi furado',
  );
});

test('STALENESS vem do timestamp do snapshot, nunca do elapsed', () => {
  // Um dado pode estar fresquíssimo com `elapsed` parado em 45 por seis
  // minutos: a API satura o minuto durante o acréscimo. Derivar frescor dele
  // pintaria vermelho num pipeline saudável e verde num quebrado.
  assert.match(app, /isStale\(snapshot\.fetchedAtMs/);
  assert.ok(
    !/isStale\([^)]*elapsed/.test(app),
    'a idade do dado está sendo calculada a partir do minuto da partida',
  );
});

test('a faixa some quando não há aviso: ela não é mobília', () => {
  // Faixa permanente vira mobília e o dia em que ela importa é o dia em que
  // ninguém repara.
  //
  // RECORTADO em `renderFaixa` de propósito. A primeira versão procurava o
  // trecho em `app.js` inteiro e passava mesmo com a faixa mutada para
  // `hidden = false`: `renderResync` tem um bloco idêntico e a regex casava com
  // ELE. Verde pelo motivo errado, e só a bateria de mutação pegou.
  //
  // O recorte vem de `recortar`, que carrega a guarda de recorte vazio por
  // construção — ver o cabeçalho do helper.
  const renderFaixa = recortar('function renderFaixa', 'function renderResync');
  assert.match(renderFaixa, /if \(texto === null\) \{\s*alvo\.hidden = true;/);
  assert.match(html, /<section id="faixa"[^>]*hidden><\/section>/);

  // O resync tem a mesma regra e o seu próprio recorte — os dois somem quando
  // não há o que dizer.
  const renderResync = recortar('function renderResync', 'function renderIdade');
  assert.match(renderResync, /if \(texto === null\) \{\s*alvo\.hidden = true;/);
});

test('o aviso de cobertura está no CHIP, e a faixa não sabe dele', () => {
  // Escopo local não disputa faixa global. Se `chipCoberturaTexto` fosse
  // chamado dentro de `renderFaixa`, o empilhamento voltaria.
  const renderFaixa = recortar('function renderFaixa', 'function renderResync');
  assert.ok(
    !renderFaixa.includes('chipCoberturaTexto'),
    'o aviso de liga voltou para a faixa global',
  );

  const renderChips = recortar('function renderChips', 'function renderGrade');
  assert.ok(renderChips.includes('chipCoberturaTexto'), 'o chip perdeu o aviso de cobertura');
});

test('resposta não-ok do Worker não vira grade vazia', () => {
  // 503 é "sem snapshot ainda" ou "KV fora do ar" — os dois são "não sei",
  // nunca "não há jogos". Renderizar lista vazia aqui seria a página correta e
  // vazia, que é o pior modo de falha deste projeto.
  const buscar = recortar('async function buscar', '// === render');
  assert.match(buscar, /if \(!resposta\.ok\) \{/);
  assert.match(buscar, /falhaDeRede = true;/);
  assert.ok(
    !/applySnapshot/.test(buscar.slice(0, buscar.indexOf('falhaDeRede = false'))),
    'o corpo de uma resposta com erro chega a applySnapshot',
  );
});
