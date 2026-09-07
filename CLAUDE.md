# placar-futebol — regras do projeto

Mostra jogos de futebol ao vivo, permite favoritar, exibe um overlay com placar e minuto, e toca
alerta sonoro quando sai gol. Alimentado por um Cloudflare Worker com KV e Cron Trigger. Testes com
`node --test`; rode `npm test`.

`npm test` da raiz roda `test/*.test.js` e cobre **só o entregável web** — o glob não é recursivo
e não alcança `desktop/`. Teste da casca mora em `desktop/test/` com runner próprio, invocado
pelo `package.json` de lá. Não junte os dois: o da raiz precisa continuar rodando num clone sem
`npm install` nenhum, que é a prova viva da tese de zero dependências.

## DOIS ENTREGÁVEIS, e a restrição vale para UM

Isto governa a leitura do arquivo inteiro e por isso vem antes de tudo. Até 2026-09-07 o projeto era
uma coisa só, e várias regras abaixo foram escritas como se fossem globais. **Onde uma restrição
disser "o projeto", leia "o entregável web"** — as exceções estão nomeadas aqui.

1. **Página web** — portfólio. HTML/CSS/JS vanilla com ES modules, **sem build e sem dependências**,
   publicada no GitHub Pages. `index.html`, `style.css`, `app.js`, `src/`.
2. **Casca desktop** — uso pessoal. Electron em `desktop/`, com `package.json` e lockfile próprios,
   para o overlay ser uma JANELA DO SISTEMA: arrastável, redimensionável e acima da barra de
   tarefas. `div` em navegador não faz isso e nunca ia fazer.

**O `package.json` da RAIZ continua com `dependencies: {}` e `devDependencies: {}`.** Não é higiene:
é o que mantém a tese do entregável 1 verificável, e **está preso por teste** —
`test/zero-dependencias.test.js` falha se a raiz ganhar dependência ou se um arquivo fora de
`desktop/` importar pacote. Prosa não verifica; a guarda verifica.

O que a casca **não** muda, e é o ponto de ter escolhido casca em vez de reescrita: `src/core/`
inteiro com seus testes, o adaptador, o Worker, o cron, o KV e o orçamento de cota. A chave **não**
pode morar no binário — ver "Orçamento de cota" — e é o cron que protege a cota.

## Relação com o `CLAUDE.md` global

O `~/.claude/CLAUDE.md` do dev continua valendo integralmente e **não é repetido aqui**. Idioma e
estilo, o fluxo obrigatório antes e depois de alterar arquivos, a proibição de `git push` sem
autorização, de `git reset --hard` e de reescrever histórico, e as regras de qualidade (não inventar
API, não remover teste para passar, não mascarar erro) vêm de lá.

Este arquivo tem só o que é **específico deste projeto** ou o que **estende** uma regra global.
Quando estender, o texto diz o que acrescenta. Duas cópias da mesma regra divergem; se algo aqui
contradisser o global, o global vence e o erro é deste arquivo.

## 🔒 NUNCA leia o `.env`

O global já proíbe ler, imprimir ou modificar `.env`, tokens, chaves e credenciais. Aqui a regra
ganha um reforço que o global não tem, porque o repositório passou a ter um `.env` real com a
`APISPORTS_KEY` que o dev usa em consultas manuais no PowerShell.

**A proibição não tem exceção de diagnóstico.** Não vale abrir para conferir se existe, para
diagnosticar um teste que falhou, nem parcialmente por `grep`, `head` ou contagem de linhas. "Só
queria ver se a chave está configurada" é exatamente o caminho pelo qual uma credencial entra num
transcript e nunca mais sai.

**Se precisar saber se a chave está configurada, pergunte ao dev.** Você não verifica. Isso vale
inclusive quando um teste falha por falta de chave: reporte a falha e pare.

Vale também para `*-sample.json` — não pelo segredo, mas pelo tamanho: `leagues-sample.json` tem
3 MB e 1237 ligas, `agenda-sample.json` tem 440 KB. Não leia integralmente; peça um resumo por
script, e escreva o script num arquivo em vez de `node -e`: as capturas têm **BOM**, e `JSON.parse`
falhando dentro de `node -e` faz o node ecoar a entrada inteira — foi assim que meio arquivo entrou
num transcript. Remova o BOM (`.replace(/^﻿/, '')`) antes de parsear.

Toda captura nova entra no `.gitignore` **antes** de qualquer `git add`. As quatro de hoje estão
lá; a quinta é responsabilidade de quem a criar.

A chave de produção é **secret do painel do Cloudflare**. Nunca no código, nunca no cliente, nunca
num log, nunca num commit, e o `wrangler.toml` versionado nunca a contém.

**"Nunca no cliente" passou a incluir um BINÁRIO, e isso APERTA a regra em vez de afrouxá-la.** Um
app desktop é o pior cliente possível para guardar segredo: o usuário tem o arquivo, e `asar` é
empacotamento, não cifra — `npx asar extract` devolve a fonte. Não existe variável de ambiente,
build step nem `.env` do `desktop/` que torne isso aceitável. A casca lê `/api/live`, que é
público e não precisa de chave; se um dia algum caminho da casca parecer precisar da chave, o
caminho está errado, não a regra. O README descreve o
cadastro pelo painel e jamais pede que alguém cole a chave em arquivo do repositório.

## NENHUM SUBAGENTE COMMITA

Subagente não commita, não faz push, não abre PR remoto. Quem grava no histórico é a sessão
principal, depois de mostrar o que mudou ao dev.

**O motivo, por extenso:** um subagente descrito como somente leitura escreveu num arquivo e
commitou usando `Bash`, logo depois de declarar no próprio output que não tinha ferramenta de
escrita. O commit foi revertido. A declaração era sincera e ainda assim falsa, e é isso que torna o
caso importante: **`Bash` É ferramenta de escrita.** `>`, `>>`, heredoc, `sed -i`, `git commit` —
todos gravam. Um papel de leitura que tem `Bash` não é um papel de leitura, por mais que o prompt
diga que é, e o próprio agente não percebe a contradição porque a lista de ferramentas parece
inofensiva.

A consequência prática: a fronteira entre quem lê e quem grava não pode depender de instrução em
prosa. Ela tem que estar na lista de ferramentas, que é a única coisa que o agente não consegue
contornar querendo.

Um segundo motivo, aprendido depois: subagente que commita commita **o que estiver no disco naquele
instante**, sem saber o que mais está acontecendo no repositório. Ver a seção "Bateria de mutação e
`git add`" — foi assim que uma implementação sabotada quase entrou no histórico.

## Por que `Bash` foi removido de três agentes

`senior-reviewer`, `fable-architect` e `scout` tiveram `Bash` removido da lista de ferramentas em
2026-08-25, **de propósito**. Não é omissão e não deve ser recolocado. O motivo é a seção acima.

A consequência é real e foi assumida junto com a remoção:

- **Eles não rodam `git diff`, `npm test` nem qualquer medição por conta própria.** Quem roda é a
  sessão principal, que passa a saída dentro do pedido. Papel instruído a rodar um comando que ele
  não tem ferramenta para rodar é armadilha, então o corpo dos três foi reescrito na mesma mudança
  para pedir a medição em vez de executá-la.
- **Quem mede e quem grava continuam separados.** Se um plano ou uma revisão precisar de um número,
  peça o comando à sessão principal e receba a saída.

Os três continuam com `Read`, `Grep` e `Glob`, que é o suficiente para ler a árvore de trabalho —
e é lá que uma revisão ganha o que o diff sozinho não dá.

## Fronteira núcleo ↔ adaptador

- `src/core/` — funções puras. Conhece **só** o modelo interno de `src/core/types.js` e nunca um
  payload de provedor. Sem `Math.random()`, sem `Date.now()`, sem `fetch`, sem `localStorage`, sem
  `setTimeout`. Tempo e estado entram por parâmetro. Teste do núcleo usa fixture sintética do modelo
  interno, nunca resposta de API.
- `src/adapters/` — única camada que fala formato de provedor.
- `worker.js` — Cron Trigger + KV.
- Raiz — `index.html`, `style.css`, `app.js`.

`src/core/` importando de `src/adapters/` é erro bloqueante.

**`src/adapters/apiFootball.js` está implementado contra o payload REAL** de
`GET /fixtures?live=all` (captura de 2026-09-03, 19 partidas). A fronteira funcionou: nada em
`src/core/` mudou quando ele saiu do stub. Recortes verbatim da captura vivem em
`test/helpers/apiFootballSamples.js`, porque o arquivo de 58 KB não é versionado.

**`GET /fixtures?date=YYYY-MM-DD` foi observado em 2026-09-04** (454 partidas, 209 ligas) e o
adaptador da agenda está implementado contra ele. A fronteira aguentou de novo: nada em `src/core/`
mudou por causa do endpoint novo — só entrou o typedef `AgendaEntry`, que é modelo interno.

**Os dois endpoints têm o MESMO shape de item, e isto é medido, não suposto:** a união dos caminhos
de campo das 454 partidas da agenda é idêntica à das 89 de `live=all`, com uma única diferença —
`events` existe no ao vivo e não na agenda. O adaptador não lê `events`, então é **um adaptador com
dois pontos de entrada**, `toFixturesWithReport` e `toAgendaWithReport`, que diferem no formato de
SAÍDA. Não os separe em dois arquivos "porque são endpoints diferentes": a entrada é a mesma e duas
cópias divergem.

**A agenda vai reduzida ao KV:** `AgendaEntry` é `{leagueId, kickoffISO}`, que é exatamente o que
`hasMatchInProgress` lê. Medido: 421 KB crus contra 26,6 KB reduzidos, mesmas 454 partidas.
**Não filtre por liga no escritor** — daria zero entradas na captura de 2026-09-04, e assaria
`DEFAULT_LEAGUE_IDS` num dado gravado uma vez por dia. O filtro é do leitor.

**A busca diária da agenda existe** (`src/core/agenda.js` + `buscarAgenda` no Worker) e o cron sai
do fail-open assim que ela grava. As decisões, para não serem redecididas:

- **Sai da reserva de 10, não de orçamento próprio.** Uma fonte de verdade para "quanto posso
  gastar hoje". Dois orçamentos divergem, e três bugs deste projeto nasceram da virada do dia UTC.
  Por isso os contadores de tentativa zeram no MESMO discriminador do `ledger`.
- **A régua de cota é `quotaRemaining > 0`, NUNCA `hasUsableQuota`.** A reserva existe justamente
  para a agenda gastar quando o poll ao vivo já não pode; medi-la com a régua do poll faria a
  reserva guardar cota para uma busca que nunca acontece. Há teste que prende isso com
  `quotaRemaining: 5`.
- **O portão é a virada do dia, sem segundo relógio.** A condição é "não tenho agenda para o
  `dayKeyUTC` corrente", e ela passa a valer sozinha às 00:00 UTC = 21:00 BRT, que é o reset da
  cota e o começo do dia que a agenda cobre. Não acrescente checagem de horário: seria um segundo
  relógio divergindo do que já governa o livro-caixa.
- **A agenda guarda o dia junto com as entradas.** `{dayKeyUTC, entries}`. Agenda de outro dia lê
  como `null` — **nunca `[]`** —, porque os kickoffs de ontem estão 24h fora da janela de 3h e
  fariam o portão dizer "não há jogo" o dia inteiro, com a página correta e vazia.
- **Falha da agenda não inventa estado.** Não há `reason` novo nem campo de erro no snapshot: o
  `reason: 'no-agenda'` já existe, já é servido, e o Worker segue em fail-open.
- **Teto de 3 tentativas/dia, espaçadas de 15 min — e isto ESTENDE a decisão do dev.** É estado
  interno novo no `state` (`agendaAttemptsToday`, `agendaLastAttemptMs`), não campo visível ao
  cliente. Sem teto, o portão "não tenho agenda" fica aberto e o cron tenta a cada tique: 10
  tentativas em 10 minutos, reserva zerada, e aí `hasUsableQuota` fica falso e o poll ao vivo morre
  junto. Os contadores também vivem na memória do isolate, senão um dia de KV instável — justamente
  quando a reserva mais importa — não teria teto nenhum.
- **O tique que busca a agenda NÃO busca o ao vivo.** Duas requisições no mesmo minuto por um dado
  que muda uma vez ao dia. O tique seguinte chega em 60s já com a agenda no lugar; nos tiques entre
  tentativas o fail-open continua acontecendo, então uma agenda quebrada não emudece o produto.

No `STATUS_MAP`, sete códigos foram medidos: `1H`, `2H` e `HT` em `live=all`; `NS`, `FT`, `PST` e
`PEN` em `date=`. Os outros doze são inferência da documentação e estão marcados como tal no
arquivo, com a captura de origem ao lado de cada medido — status visto só em `date=` é evidência
mais fraca para o caminho ao vivo, que é o que dispara alerta de gol. Não os promova sem uma captura
que os contenha; há teste (`S2b`) que exige recorte verbatim para cada um marcado como medido, e que
falha se um inferido ganhar amostra sem a marcação mudar.

## Consumo do núcleo: só `applySnapshot`

O cliente consome **exclusivamente** `applySnapshot`, de `src/core/session.js`.

`diffFixtures`, `shouldAlert`, `keepLatestSnapshot` e as demais continuam exportadas — para os
testes delas. Mas código de produção que as sequencie na mão está errado, mesmo que funcione: a
ordem correta é diffar contra o estado anterior, filtrar pelo dedupe, registrar o que alertou e só
então avançar o estado, e trocar qualquer passo de lugar reintroduz um alerta falso já corrigido
(réplica atrasada do KV faz o placar regredir, o gol é redescoberto no poll seguinte e toca som para
um gol que já estava na tela).

O estado devolvido por `applySnapshot` é opaco: sai dele, volta para ele. Carrega o snapshot e o
registro de alertados juntos justamente para que não exista caminho que emita um evento sem gravar a
chave.

## UM DONO SÓ POR INSTÂNCIA DO APP — e o overlay é projeção

Consequência direta do parágrafo acima, e a regra que a casca desktop torna fácil de violar sem
perceber. **Exatamente um lugar, por instância do app, faz o poll e chama `applySnapshot`.**

Na web isso é trivial: uma aba, um `app.js`. No desktop são duas janelas, e a tentação é o overlay
carregar o mesmo `app.js` "porque já funciona". Não pode. A janela **principal** é a dona; a janela
do overlay **não importa nada de `src/core/`, não faz `fetch` e não tem `coreState`** — recebe
por IPC o que já foi decidido.

**O motivo não é economia de requisição, é correção.** O estado de `applySnapshot` carrega o
registro `alerted`. Duas instâncias são dois registros: cada uma preserva a invariante
internamente — nenhuma emite evento sem gravar a chave — e o produto toca **dois sons para um gol**.
A invariante por instância continua verdadeira enquanto a do produto quebra, e é por isso que
nenhum teste unitário pega: cada metade está certa.

Corolário do `tocarGol()`: ele mora na janela DONA, junto de quem decidiu. No overlay, o som
dependeria de a janela do overlay estar viva — e ela é justamente a que o usuário fecha quando quer
a tela limpa.

Regra geral, que vale além do Electron: **quando um estado existe para fechar um furo, duplicá-lo
reabre o furo em um nível acima, onde os testes daquele estado não olham.**

## Orçamento de cota

A API-Football free dá **100 requisições/dia**, globais da chave, com reset às **00:00 UTC = 21:00
BRT**. Não é por cliente: é a chave inteira.

- **NENHUM CLIENTE chama a API upstream — web ou desktop.** O cron do Worker busca, grava snapshot
  no KV, o cliente lê o KV. O renderer do Electron **é** um navegador e não abre exceção: a casca
  lê `/api/live` exatamente como a aba, e o processo `main` também não fala com a upstream. Uma aba pollando a 60s consumiria a cota do dia inteiro em menos de um jogo.
  Qualquer código que faça o cliente falar com a API-Football é erro bloqueante.
- **Reserva de 10 requisições/dia para a agenda**, intocável pelo poll ao vivo.
- **O cron só grava no KV quando de fato buscou upstream.** Nada de heartbeat: o free tier do KV dá
  ~1000 escritas/dia e um cron por minuto gravando sempre daria 1440 — estouraria antes da cota da
  API.
- **O portão do cron vem da AGENDA, nunca do `live=all`.** Perguntar ao `live=all` se vale a pena
  chamar `live=all` já gastou a requisição. O portão abre quando há jogo ao vivo numa liga do
  conjunto efetivo — `activeLeagueIds(agendaDeHoje)` em `src/core/leagues.js` —, que é a interseção
  da SEMENTE de ligas com o que a agenda diz ter jogo hoje. Numa terça sem jogo brasileiro isso
  custa **zero requisições**, mesmo com centenas de partidas ao vivo no mundo.
- **Favorita NÃO entra no portão, e o Worker chama com um argumento de propósito.** Uma versão
  anterior deste arquivo dizia `activeLeagueIds(agendaDeHoje, favoritas)` no portão; estava errada,
  e foi este arquivo que mudou, não o código. Favoritas moram no `localStorage` de cada navegador e
  o portão é global: levá-las ao Worker exigiria estado por usuário no KV e deixaria qualquer
  visitante abrir o portão e gastar a cota do dono da chave — uma chave só, 100 req/dia.
  Desproporcional para uso pessoal, perigoso num portfólio público. O segundo argumento existe e é
  legítimo, mas **só o filtro da UI o passa**. Prende isso o teste
  "cron: o portão é da SEMENTE" em `test/worker.test.js`.
- **A FAIXA DE DIAGNÓSTICO tem precedência decidida em `src/core/notice.js`, não no CSS.**
  Ela aparece **só quando há algo a dizer** — faixa permanente vira mobília e o dia em que ela
  importa é o dia em que ninguém repara —, e quando aparece é **uma só**, nunca empilhada.

  O critério de ordem: **quanto mais o aviso invalida o que está na tela, mais alto ele fica.** Não
  é gravidade no servidor, é quanto do que o usuário está vendo deixa de ser confiável. Daí a ordem
  `sem-dado` > `parado-quebrado` > `parado-sem-cota` > `parado-motivo-desconhecido` >
  `parado-sem-jogo` > `incompleto` > `as-cegas` > `vazio`. Dois pontos que parecem invertidos e não
  são: **quebrado vence sem-cota** (pipeline caído não volta no reset, e prometer "volta às 21:00"
  seria mentira confortável) e **"não sei" vence o caso benigno** (`cron === null` jamais pode ser
  apresentado como "não há jogo agora").

  **`uncoveredFavorites` fica FORA da faixa**, e é isso que resolve o empilhamento sem perder o
  aviso: ele não é estado da página, é propriedade permanente de UMA liga, e mora junto do filtro
  dela. A exceção é a grade vazia, onde a contagem viaja em `data.uncovered` para caber numa frase
  só. Regra geral que sai daqui: **aviso de escopo local não disputa faixa global** — senão ou
  esconde um aviso temporal ou empilha.

  `chooseNotice` devolve **código e números, nunca texto**: a redação é da view, pelo mesmo motivo
  que os rótulos de `reason` não entraram no núcleo. Há teste que falha se uma string entrar em
  `data`.
- **Dois avisos que o PR 3 TEM de renderizar.** São os dois casos conhecidos de "correta e vazia",
  o modo de falha que este projeto mais combate, e por isso ficam juntos:
  1. **Favorita sem cobertura.** Liga favoritada fora da semente não tem cobertura ao vivo
     garantida — pode vir de carona numa busca disparada pelo Brasileirão, mas nada nela causa uma
     busca. Gancho: `uncoveredFavorites` em `src/core/leagues.js`.
  2. **Busca às cegas.** `snapshot.reason === 'no-agenda'` significa que o cron buscou sem a agenda
     do dia, com cobertura reduzida. A página diz isso; não mostra uma grade curta calada.
  3. **Por que o dado está parado.** Quando `isStale` acusa, a explicação sai do campo **`cron`**,
     **não** do `reason` do snapshot: `consecutiveFailures > 0` é "quebrou", `quotaRemaining` no fim
     é "acabou a cota" (com `quotaResetAtMs` para dizer a que horas volta), e nenhum dos dois é
     "não havia jogo agora" — e aí a grade vazia está CERTA e a página pode dizer isso.
     `cron === null` é "não sei", que também se diz, e nunca se pinta de verde.

  Em nenhum dos três o gancho é prosa: são campo e função, com teste. Os três chegam à tela por
  `chooseNotice`, exceto o primeiro — ver a faixa de diagnóstico acima.
- **Duas perguntas, duas chaves, duas fontes na resposta.** `GET /api/live` serve o snapshot **e**
  o estado do cron, no campo `cron`. `snapshot.fetchedAtMs` responde *"o dado é novo?"*;
  `cron` responde *"por que não é?"*. Isso **não** viola "nada de heartbeat": o `state` já é escrito
  em toda tentativa real, inclusive fracassada — não há escrita nova, só um dado que existia e não
  era servido. Duas leituras de KV, zero chamadas upstream.

  Exposto: `consecutiveFailures` (quebrou), `backoffUntilMs` (quando volta a tentar) e
  `quotaRemaining` (acabou a cota; o horário do reset vem de `quotaResetAtMs` do snapshot). Os três
  separam os três casos parados. **`spentToday` e `lastFetchAtMs` ficaram de fora de propósito** —
  não distinguem nenhum caso e nada os renderiza; campo que ninguém lê vira o próximo `intervalMs`.

  `cron` é `null` quando não há estado legível, e **`null` é obrigatório**: devolver estado saudável
  inventado afirmaria como fato o que não se sabe. Falha ao ler o `state` **nunca** derruba a
  resposta — diagnóstico que quebra não pode custar o dado.

  `cron` entra **ao lado** dos campos do envelope, nunca envolvendo-o num `{ snapshot, cron }`: o
  corpo tem de continuar sendo superconjunto do `Snapshot` interno, senão `applySnapshot` para de
  consumi-lo direto. Há teste.
- **`reason` VAI no snapshot; `intervalMs` não.** São decisões opostas e o critério é o mesmo:
  o campo desfaz uma ambiguidade que mata o produto em silêncio, ou cria uma?

  `reason` diz por que a busca que gerou ESTE snapshot aconteceu — `'due'` ou `'no-agenda'`. Só
  esses dois chegam ao envelope, porque `buildSnapshot` só roda sob `shouldFetch: true`. **Não é ele
  que explica um snapshot parado**; isso é o `cron` do bullet acima.

  O nome deixou de ser `no-agenda-fail-open`: "fail-open" é jargão de quem escreveu o portão, e este
  valor vira texto na tela. Os outros quatro (`no-live-match`, `too-soon`, `backoff`,
  `quota-exhausted`) são diagnóstico interno, nunca aparecem em snapshot e por isso não foram
  renomeados pensando no leitor da página.

  **REGISTRO DE UMA INSTRUÇÃO IMPOSSÍVEL — vale mais que a correção.** A versão anterior deste
  arquivo mandava o PR 3 *"renderizar `reason` quando o snapshot estiver parado"*. Não dava para
  cumprir, e o motivo é que **"nada de heartbeat" — regra deste mesmo arquivo — garante que o
  snapshot não seja escrito exatamente nos tiques em que o cron decide não buscar.** O snapshot
  parado carrega o motivo da última busca *bem-sucedida*; o motivo de ter parado nunca chega nele. A
  restrição e a instrução vinham do mesmo lugar e se contradiziam.

  O que isso ensina, e por isso está escrito aqui: **uma regra de economia (não escreva) apaga a
  observabilidade do caminho que ela suprime.** Toda vez que uma regra deste projeto disser "não
  escreva", "não chame" ou "não gaste", pergunte de onde virá o diagnóstico do caso suprimido — e a
  resposta vai ser outra fonte, como foi aqui. Não foi erro de redação: foi consequência real de uma
  restrição real, e só apareceu quando alguém tentou implementar.
- **A INVARIANTE DIÁRIA, e a lição que ela carrega — da mesma família da de cima.** Todo campo do
  `state` que descreve "o que aconteceu hoje" zera pelo MESMO discriminador de `dayKeyUTC`, no
  `ledger`. Isto **não é uma regra em prosa: é `test/estado-diario.test.js`**, e é assim porque
  prosa já falhou aqui — quatro bugs de virada de dia UTC, todos com a forma "dois campos que
  descrevem o mesmo fato zerando por critérios diferentes", e os três primeiros já tinham a lição
  registrada em algum lugar quando o quarto nasceu.

  O que generaliza, e vale muito além deste campo: **quando a omissão é o modo de falha, enumere o
  lado que não deve crescer.** A lista versionada é a dos campos NÃO diários
  (`__CAMPOS_NAO_DIARIOS` em `worker.js`), com o motivo escrito de cada um — nunca a dos diários.
  Invertida assim, um campo novo que ninguém classificar cai automaticamente no lado que exige
  ação e o teste fica vermelho nomeando o campo esquecido. Listar os diários deixaria o campo novo
  de fora por omissão e o teste passaria, que é exatamente como os quatro entraram.

  **Fail-closed: o silêncio acusa em vez de passar.** É o mesmo princípio de `[]` contra `null` na
  agenda e de "página correta e vazia é indistinguível de quebrada" — em todos, a ausência de sinal
  não pode ser lida como "está tudo bem". Se um dia aparecer outra lista neste projeto cuja
  desatualização seja silenciosa, ela também deve ser escrita pelo complemento.
- **`intervalMs` não vai no snapshot do KV.** Ele mistura ritmo desejado com freio de cota: com
  `quotaRemaining: 11` vale 3 HORAS e a busca acontece assim mesmo. Cliente que fizesse "fresco até
  `fetchedAtMs + intervalMs`" pintaria verde por três horas — frescor é `isStale`, com régua
  própria. O campo foi removido do envelope justamente porque prosa num typedef não impede ninguém
  de ler o número; há teste exigindo que não volte. Se o PR 3 precisar exibir o ritmo, isso é
  conversa com o dev, não um campo a reintroduzir.
- **`hasLiveFavorite` é pré-condição de portão, não modificador de ritmo.** Quando é `false`, o cron
  não busca. Tratá-lo como "buscar mais devagar" faz os jogos de domingo de manhã consumirem a
  janela e deixarem a noite descoberta.
- **Agenda ausente ≠ agenda vazia.** `[]` é "não há jogo hoje", o portão fecha e o custo é zero.
  `null` é "não consegui a agenda", e aí o sistema **falha aberto**: assumir que não há jogo apagaria
  a página o dia inteiro sem erro nenhum na tela. Página correta e vazia é indistinguível de página
  quebrada, e esse é o pior modo de falha deste projeto.

## Números honestos

Estes vão no README e em qualquer texto visível ao usuário. **Nunca prometa melhor** — e diga
quais são medidos e quais não são, porque a diferença importa.

- **Latência do alerta de gol: 0–210s — NÃO MEDIDA.** A parcela de até 150s é o intervalo upstream,
  que é nosso e verificável no código. A parcela de até 60s é a consistência eventual do KV, que
  vem da documentação do Cloudflare e **nunca foi exercitada aqui**: os testes do Worker usam um
  KV falso, um `Map` síncrono, que não reproduz propagação, latência nem `put` concorrente. O
  número é o pior caso plausível, não um resultado.
  Documente-o **marcado como não medido**, pela mesma regra que se aplicou ao `status.elapsed` do
  adaptador. Só perde a marca quando alguém medir contra o KV de verdade.
  Se algum documento ainda disser 0–150s, está desatualizado: corrija.
- **Cobertura ao vivo: 3–4h/dia**, com a reserva de 10 requisições preservada.
- **Reset da cota: 21:00 BRT.**
- A agenda de fallback (football-data.org) cobre só 12 competições, e com placar atrasado.

Se um número não puder ser medido, escreva "não medido". Não estime.

## Bateria de mutação e `git add`

A bateria de mutação prova que os testes pegam sabotagem: ela **reescreve arquivos de `src/core/` em
disco**, roda a suíte, confere que ficou vermelha e restaura o original. Um arquivo passa alguns
segundos adulterado a cada iteração.

**Ela não é versionada** — hoje vive no scratchpad da sessão e some com ele. A regra abaixo vale
para qualquer processo que reescreva a árvore de trabalho, não só para essa bateria; se um dia ela
entrar no repositório, o lugar natural é `tools/`.

**Nunca rode `git add`, `git commit` ou `git stash` enquanto a bateria estiver rodando.** Já
aconteceu: um `git add -A` disparado com a bateria em background capturou `enabled: true` no lugar
de `enabled: soundEnabled`, e o commit entrou com o bloqueio de autoplay desligado.

O que torna isso perigoso é que **nenhum teste pega**. A bateria restaura o arquivo e a suíte volta
verde; o que ficou errado está só no histórico. Quem pega é `git show HEAD -- <arquivo>`. Se
suspeitar, audite os commits, não a árvore de trabalho.

Regra prática: espere a bateria imprimir a linha `total: N mutantes, M sobreviventes` antes de
qualquer comando que leia o disco para o índice do git.

**DÍVIDA ANOTADA — se a bateria virar `tools/` versionada, a lista de mutantes vai para JSON e ela
ganha teste próprio.** Não fazer agora. O motivo: hoje a lista de sabotagens vive embutida no script
do scratchpad, então ninguém revisa o que ela testa e ninguém percebe quando um mutante para de ser
representativo. Versionada, a lista em JSON fica revisável no diff, e o teste próprio responde a
pergunta que a bateria não responde sobre si mesma — se ela ainda sabe detectar um mutante que
deveria matar, ou se está verde porque parou de rodar.

**Não há pre-commit hook neste projeto. Na RAIZ não há lockfile; em `desktop/` há.** A raiz tem
`dependencies: {}` e `devDependencies: {}` por restrição dura — nada a travar. A casca tem
Electron e trava normalmente, e o lockfile dela é versionado como o de qualquer app.

Se um hook for adicionado depois, o que faz sentido guardar aqui é (a) recusar conteúdo staged que
case com padrão de chave, e (b) recusar commit que introduza dependência **na raiz** — que é a
restrição mais fácil de violar sem perceber. **O escopo em (b) não é detalhe:** escrito como
"qualquer dependência", o hook bloquearia todo trabalho legítimo no `desktop/`, seria desligado
por atrapalhar, e aí não protegeria mais a raiz também. Guarda que atrapalha o caminho legítimo é
guarda que alguém remove.

## O que do PR 3 ficou SEM teste automatizado

Decisão do dev, e a razão é dura: **nenhuma dependência nova no ENTREGÁVEL WEB.** Cobertura de DOM
exigiria um test runner de browser, e a restrição de zero dependências é a premissa que sustenta
GitHub Pages, zero build e o entregável 1. Trocá-la por cobertura de DOM seria vender a tese por um
teste.

**A casca desktop NÃO afrouxa isto, e a distinção é fina o bastante para merecer letra:** `desktop/`
tem Electron e lockfile, mas Electron é a casca, não um test runner do `app.js`. Usar o Electron
já instalado para rodar teste de DOM da página traria a cobertura por uma porta lateral — e a
página passaria a ser testada só num ambiente que o entregável 1 não tem. Se um dia a cobertura de
DOM vier, ela paga o preço no entregável 1 ou não vale.

O que se fez em vez disso: **toda decisão saiu do `app.js`** e virou função pura testada —
`src/core/notice.js` (precedência da faixa), `src/view/copy.js` (redação) e `src/view/filter.js`
(filtro, chips, ordenação). O `app.js` ficou burro: lê estado, chama função pura, escreve no DOM.

`test/app-contratos.test.js` cobre o que dá para provar lendo a fonte — ausência de caminho
proibido. Ele NÃO prova comportamento, e a diferença importa: prova que `diffFixtures` não é
chamado, não que a tela renderize certo.

**Fica sem verificação automatizada, e precisa de olho humano a cada mudança no `app.js`:**

1. O som tocar de fato depois do gesto de liberação (e **não** tocar antes).
2. **WEB:** o arrasto do overlay-`div` e a persistência da posição em `LS_OVERLAY` entre
   recarregamentos.
3. A animação de gol reiniciar em dois gols seguidos na mesma partida.
4. Layout responsivo e a faixa continuar legível em tela estreita.
5. CORS de verdade contra o Worker publicado — o teste do Worker usa `Response` sintética.

**Superfície NOVA da casca desktop, sem teste, acrescentada em 2026-09-07:**

6. **DESKTOP:** o arrasto e o redimensionamento da janela do overlay, e a persistência de
   `getBounds`/`setBounds` entre SESSÕES do app. **Não é o item 2 noutro lugar: é outro
   mecanismo.** O item 2 é `div`, CSS e `localStorage` dentro de uma viewport; este é geometria
   de janela do SO, persistida pela casca, com monitor que muda de resolução e monitor que some.
   Confundi-los faria "já está coberto" valer para o lado que não está.
7. **DESKTOP:** o overlay ficar de fato acima da barra de tarefas
   (`setAlwaysOnTop(true, 'screen-saver')`), e continuar acima depois de outro app pedir foco.
8. **DESKTOP:** o poll continuar rodando com a janela principal escondida — é o que
   `backgroundThrottling: false` compra, e é invisível até falhar tarde.
9. **DESKTOP:** a porta de volta pelo tray, incluindo o caso em que o tray não aparece.

Se um dia o projeto aceitar uma dependência de teste, é este bloco que ela paga. Enquanto não
aceitar, **este bloco é o inventário honesto do buraco**, não um TODO a ignorar. **A casca não
encolheu o buraco: aumentou.** Um entregável novo que não acrescentasse linha nenhuma aqui seria
sinal de que ninguém olhou, não de que veio pronto.

## O que um mock pode forjar, e o que não pode

**A régua: entrada do que se OBSERVA pode ser forjada; dado que o MECANISMO OBSERVADO PROCESSA,
não.** Vale para mock, fixture, stub e qualquer dado de mentira que este projeto venha a produzir.

O caso que a ensinou: `tools/make-mock.mjs` reetiquetava 12 partidas da captura para as ligas da
semente, porque `live-pico.json` não tem nenhuma liga prioritária ao vivo e sem isso a grade nasce
vazia. O resultado foi cartão de "Brasileirão Série A" sobre Aalesund x Start, e — pior que o
absurdo visível — **um mock construído para exercitar o filtro por liga, falsificando exatamente o
campo sobre o qual o filtro opera.** Quem olhasse a tela não estaria olhando o filtro; estaria
olhando o falsificador. O sintoma que denunciou foi um contador `(3)` idêntico em todos os chips,
que era só 12 dividido por 4.

No mesmo arquivo continuam sintéticos, e corretamente, `discarded`, `consecutiveFailures`,
`quotaRemaining`, `reason` e o deslocamento de `fetchedAtMs`: são as **entradas** da faixa de
diagnóstico, que é o que se quer observar. Forjá-las é o propósito da ferramenta. `leagueId` é o
**dado de trabalho** do mecanismo, e por isso é intocável. A diferença não é de grau.

Corolário prático, que custou dois turnos para aparecer: **quando o dado real não produz o estado
que você queria ver, o conserto é uma captura melhor, não um dado melhorado.** Aqui a consequência
foi assumida — a grade padrão nasce vazia, e um cenário com liga prioritária espera uma captura com
Brasileirão no ar. Grade vazia é a verdade do dado; "nenhum jogo de interesse agora" é informação.

Um segundo corolário, sobre onde o aviso mora: **condição de visualização faz parte do anúncio.** A
faixa `vazio` não sai do snapshot — sai de `visibleCount`, que vem das favoritas do navegador. Um
cenário que anuncia "(nenhuma faixa)" sem dizer sob que filtro isso vale promete o que o arquivo
sozinho não entrega. Por isso a condição está na saída de cada execução, no `ajuda()` **e** na
asserção do teste.

**É a mesma família de outras lições deste arquivo, e elas se leem juntas** — ver também "QUAL lado enumerar", logo abaixo:

- *"Uma regra de economia (não escreva) apaga a observabilidade do caminho que ela suprime"* — o
  registro da instrução impossível, na seção "Orçamento de cota". Lá, a restrição destruiu o
  diagnóstico do caso que ela mesma criava.
- *"Quando a omissão é o modo de falha, enumere o lado que não deve crescer"* — a invariante diária,
  na mesma seção. Lá, listar o lado errado deixava o campo novo passar em silêncio.
- Aqui, a conveniência de ter a tela cheia destruiu o que a tela servia para mostrar.

O que as três compartilham: **uma decisão local e defensável apaga, em outro lugar, exatamente a
coisa que ela deveria ter deixado visível.** Nenhuma foi descuido — as três tinham justificativa boa
no ponto em que foram tomadas, e só apareceram quando alguém foi usar o resultado. A pergunta que
elas deixam, e que vale fazer antes de qualquer atalho: **o que este atalho torna impossível de
ver?**

## QUAL lado enumerar — o critério, não a regra decorada

Duas seções deste arquivo mandam enumerar o lado que **não** deve crescer: a invariante diária
(`__CAMPOS_NAO_DIARIOS`) e a guarda de dependências (`ISENTOS`). Em 2026-09-07 o PR 6a produziu um
caso que aponta para o **lado oposto**, e é por isso que esta seção existe: a regra decorada teria
levado ao erro.

**O critério verdadeiro nunca foi "enumere os não-X". É: `qual lado, esquecido, falha em
silêncio?`** Enumere aquele. As duas seções antigas apontam para um lado porque, nelas, o
esquecimento silencioso mora lá. Quando o dano muda de sinal, o critério aponta para o outro lado,
e continua sendo o mesmo critério.

O caso: `desktop/src/protocolo.js` serve arquivos do disco para a página, via `placar://`. A
primeira versão servia **qualquer arquivo sob a raiz** e barrava só o que escapasse com `..`.

- Enumerar os PROIBIDOS: um segredo novo no repositório passa a ser servido sem que nada acuse.
  Silencioso e catastrófico.
- Enumerar os PERMITIDOS: um arquivo novo do entregável web dá 404 até alguém classificá-lo.
  Barulhento e inofensivo — a página não carrega e quem mexeu vê na hora.

Então ali a lista versionada é a dos **permitidos**, ao contrário das outras duas. Não é
inconsistência; é o critério aplicado.

**E a lição de segunda ordem, que vale mais que a primeira:** a versão errada não foi descuido de
segurança. Ela guardava contra travessia de diretório, que é a ameaça que todo mundo conhece — e a
ameaça real era outra, porque **`new URL()` normaliza o `..` antes de qualquer guarda ver**.
`placar://app/../.env` chega ao handler como `/.env` e resolve DENTRO da raiz. A guarda estava
certa contra o ataque errado.

Daí a pergunta que fica, e que é a versão dura de "o que este atalho torna impossível de ver?":
**contra o que exatamente esta guarda protege, e o que ela deixa passar por não ser o caso que eu
imaginei?** Quem escreveu a primeira versão sabia de travessia. Ninguém tinha perguntado o que
sobrava depois da normalização.

## Disciplina de teste

Três regras que este projeto aprendeu na prática e que valem mais que cobertura:

1. **Vermelho primeiro, e pelo motivo certo.** `not implemented` conta; `undefined is not a
   function` por import errado não conta.
2. **Todo teste negativo precisa de controle positivo.** Se você assere `deepEqual(resultado, [])`,
   acrescente o caso quase idêntico em que o resultado **não** é vazio. Sem isso o teste passa por
   vacuidade — verde sem testar nada.
3. **Constante nunca é régua para ela mesma.** `assert.ok(ms >= MIN_INTERVAL_MS)` continua verde se
   alguém baixar `MIN_INTERVAL_MS` para 1. Use um literal defensável e explique-o no comentário.
4. **Teste que itera uma estrutura tem que cobrir o domínio inteiro da invariante.**
   `Object.entries` não vê a cadeia de protótipos, então um teste que assere "nenhum valor deste
   mapa está fora do contrato" iterando as chaves próprias é cego para `mapa['constructor']`.
   Aconteceu aqui.
5. **Mensagem de assert é promessa, e entra na revisão.** Se o código não impõe a invariante que a
   mensagem enuncia, a mensagem é mentira documentada. Descreva o caso, ou imponha a lei.
6. **Asserção sobre texto-fonte precisa ser recortada na função sob medição.** Regex no arquivo
   inteiro casa o bloco idêntico de outra função e fica verde pelo motivo errado. E acrescente
   `assert.ok(recorte.length > N)`: recorte vazio, no dia em que a função for renomeada, faz o
   `assert.ok(!recorte.includes(...))` passar por vacuidade.

As regras 4, 5 e 6 são o MESMO erro em três formas — **teste cego por construção**, que não podia
pegar o que dizia pegar e ficava verde por isso. Não é cobertura faltando: é teste que remove a
desconfiança em vez de criar. Antes de escrever um teste, pergunte se ele conseguiria ver o bug que
você teme; se a resposta depender do iterador, da amostra ou do recorte, é um dos três. A versão
longa, com os três exemplos reais, está em `.claude/agents/junior-dev.md`.
