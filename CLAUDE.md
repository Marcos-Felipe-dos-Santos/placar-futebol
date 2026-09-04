# placar-futebol — regras do projeto

Página estática que mostra jogos de futebol ao vivo, permite favoritar, exibe um overlay flutuante
com placar e minuto, e toca alerta sonoro quando sai gol. HTML/CSS/JS vanilla com ES modules, **sem
build e sem dependências**, publicada no GitHub Pages, alimentada por um Cloudflare Worker com KV e
Cron Trigger. Testes com `node --test`; rode `npm test`.

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
3 MB e 1237 ligas. Não leia integralmente; peça um resumo por script.

A chave de produção é **secret do painel do Cloudflare**. Nunca no código, nunca no cliente, nunca
num log, nunca num commit, e o `wrangler.toml` versionado nunca a contém. O README descreve o
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

**O que continua NÃO observado:** o shape de `GET /fixtures?date=YYYY-MM-DD`, que é o que alimenta
a agenda e, por ela, o portão do cron. **Não invente esse mapeamento** — a mesma regra que valeu
para o `live=all` vale aqui, e é por isso que o cron opera em fail-open enquanto a chave `agenda`
do KV estiver vazia. Quando a captura chegar, só o adaptador muda; se exigir mudança no núcleo, a
fronteira falhou e isso é assunto para o dev, não algo a contornar.

No `STATUS_MAP`, só `1H` e `2H` foram verificados contra captura real; os outros 17 são inferência
da documentação e estão marcados como tal no arquivo. Não os promova a medidos sem uma captura que
os contenha.

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

## Orçamento de cota

A API-Football free dá **100 requisições/dia**, globais da chave, com reset às **00:00 UTC = 21:00
BRT**. Não é por cliente: é a chave inteira.

- **O navegador NUNCA chama a API upstream.** O cron do Worker busca, grava snapshot no KV, o
  navegador lê o KV. Uma aba pollando a 60s consumiria a cota do dia inteiro em menos de um jogo.
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

  Em nenhum dos três o gancho é prosa: são campo e função, com teste.
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

**Não há pre-commit hook neste projeto, e não há lockfile.** O projeto tem `dependencies: {}` e
`devDependencies: {}` por restrição dura — nada a travar. Se um hook for adicionado depois, o que
faz sentido guardar aqui não é lockfile: é (a) recusar conteúdo staged que case com padrão de
chave, e (b) recusar commit que introduza qualquer dependência, que é a restrição do projeto mais
fácil de violar sem perceber.

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

As duas últimas nasceram da revisão do adaptador; a versão longa, com o exemplo real, está em
`.claude/agents/junior-dev.md`.
