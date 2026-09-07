# placar-futebol

Placar de futebol ao vivo: mostra os jogos em andamento, permite favoritar competições e
partidas, e toca um alerta quando sai gol.

O problema interessante não é a tela — é o **orçamento**. A API-Football gratuita dá **100
requisições por dia**, globais da chave inteira, e uma aba de navegador pollando a cada 60s
consumiria a cota do dia em menos de um jogo. Quase todas as decisões deste repositório saem daí.

## O que ele faz para caber em 100 requisições

- **O navegador nunca fala com a API.** Um Cloudflare Worker com Cron Trigger busca, grava o
  resultado no KV, e a página lê o KV. Um visitante ou mil custam o mesmo.
- **O portão vem da agenda, não do jogo ao vivo.** Perguntar "há jogo agora?" para o endpoint de
  jogos ao vivo já gastou a requisição. Uma vez por dia o Worker busca a agenda do dia; o cron só
  gasta quando essa agenda diz que há partida de uma competição acompanhada. Numa terça sem jogo
  brasileiro o custo é **zero**, mesmo com centenas de partidas ao vivo no mundo.
- **Reserva de 10 requisições/dia** para a agenda, que o poll ao vivo não pode tocar.
- **O cron só escreve quando de fato buscou.** Sem heartbeat: um cron por minuto gravando sempre
  daria 1440 escritas/dia e estouraria o free tier do KV antes da cota da API.
- **Ritmo adaptativo:** o intervalo entre buscas sai da cota restante e do tempo até o reset, com
  piso de 60s.

## Os dois entregáveis

| | |
|---|---|
| **Página web** | HTML/CSS/JS vanilla com ES modules. **Sem build e sem dependências** — `dependencies: {}` e `devDependencies: {}`, e há teste que falha se isso mudar. Publicada no GitHub Pages. |
| **Casca desktop** | Electron em `desktop/`, uso pessoal. Existe por um motivo só: o overlay como **janela do sistema**, acima da barra de tarefas. `div` em navegador não faz isso. |

A restrição de zero dependências vale para o primeiro. A casca tem seu `package.json` e seu
lockfile, e nada dela vaza para a raiz.

O núcleo é o mesmo nos dois: `src/core/` são funções puras, sem `fetch`, sem `Date.now()`, sem
`localStorage` — tempo e estado entram por parâmetro. `src/adapters/` é a única camada que conhece
o formato do provedor. Foi essa fronteira que permitiu a casca desktop existir sem que uma linha do
núcleo mudasse.

## Limitações honestas

Esta seção existe porque um portfólio que só mostra o que funciona não diz nada sobre quem o
escreveu. **Onde um número não foi medido, está escrito que não foi.**

- **Latência do alerta de gol: 0–210s — NÃO MEDIDA.** A parcela de até 150s é o intervalo entre
  buscas, que é nosso e verificável no código. A parcela de até 60s é a consistência eventual do
  KV, que vem da documentação do Cloudflare e **nunca foi exercitada aqui**: os testes do Worker
  usam um KV falso, um `Map` síncrono, que não reproduz propagação nem escrita concorrente. O
  número é o pior caso plausível, não um resultado. Só perde a marca quando alguém medir contra o
  KV real.
- **Cobertura ao vivo: 3–4h por dia**, preservada a reserva de 10 requisições. Não dá para cobrir
  um dia inteiro com 100 requisições, e o projeto não finge que dá.
- **Reset da cota: 21:00 BRT** (00:00 UTC). É quando o orçamento do dia recomeça.
- **A agenda de fallback (football-data.org) cobre só 12 competições**, e com placar atrasado.
- **A página é atualizada a cada 30s**, mas isso é a leitura do KV — não o intervalo da busca
  upstream, que é maior. Ver a latência acima.
- **O que não tem teste automatizado está listado**, não escondido: comportamento de DOM, som
  depois do gesto de liberação, arrasto do overlay, CORS real, e a superfície nova da casca
  desktop. A lista completa, com o motivo de cada item, está no `CLAUDE.md`.

## Rodar

```sh
npm test          # roda sem instalar nada
```

O `npm test` da raiz roda num clone limpo, sem `npm install`. É a prova viva da tese de zero
dependências, não uma conveniência.

Para abrir a página sem Worker e sem gastar cota, existe um gerador de mock:

```sh
node tools/make-mock.mjs            # lista os cenários
node tools/make-mock.mjs saudavel   # gera mock-api.json
python -m http.server 8080
# http://localhost:8080/index.html?api=./mock-api.json
```

Ele monta a resposta passando pelas **mesmas funções do caminho de produção**, então o mock não
diverge do envelope real. Os cenários cobrem os estados da faixa de diagnóstico — sem cota,
pipeline quebrado, dado parado, busca às cegas — que são difíceis de produzir de propósito em
produção. O gerador requer uma captura da API que não é versionada.

A casca desktop:

```sh
cd desktop && npm install
npm start          # contra o Worker
npm run mock       # contra o mock-api.json local
```

## Publicar

### 1. O Worker

1. **KV:** no painel do Cloudflare, *Storage & Databases > KV > Create namespace*. Anote o ID e
   ponha em `wrangler.toml`.
2. **Worker:** *Workers & Pages > Create > Worker*. Faça o deploy de `worker.js` (o repositório não
   usa bundler; o Worker importa `src/**/*.js` direto).
3. **Binding:** no Worker, *Settings > Bindings > Add > KV Namespace*, variável `PLACAR_KV`
   apontando para o namespace criado.
4. **A chave, como Secret:** *Settings > Variables and Secrets > Add > tipo **Secret***, nome
   `API_FOOTBALL_KEY`. Pegue a chave em [api-football.com](https://www.api-football.com/).

   > **Nunca ponha a chave em arquivo do repositório.** Não em `wrangler.toml`, não em `.env`
   > commitado, não no cliente. Secret do painel não volta na leitura e não entra em log. A cota é
   > global da chave: quem a tiver gasta o seu dia.

5. **Cron:** *Settings > Trigger Events > Cron Triggers*, `* * * * *`. O cron decide sozinho quando
   vale gastar — rodar a cada minuto não significa buscar a cada minuto.

### 2. A página no GitHub Pages

1. Em `app.js`, troque `API_PADRAO` pela URL do seu Worker
   (`https://SEU-WORKER.workers.dev/api/live`).
2. *Settings > Pages*, source **Deploy from a branch**, branch `main`, pasta `/ (root)`.
3. Sem build: o Pages serve os arquivos como estão.

O Worker responde `access-control-allow-origin: *`, então a página publicada o alcança de qualquer
origem.

## Estrutura

```
index.html  style.css  app.js     a página (entregável 1)
src/core/                         funções puras — sem I/O, sem relógio, sem DOM
src/adapters/                     única camada que fala o formato do provedor
src/view/                         redação, filtro e precedência de aviso, puros
worker.js  wrangler.toml          Cloudflare Worker: cron, KV, orçamento
desktop/                          casca Electron (entregável 2)
tools/                            gerador de mock e relatório de captura
test/                             node --test, sem runner externo
```

`CLAUDE.md` registra as decisões e, mais útil, **os erros**: quatro bugs de virada de dia UTC, um
mock que falsificava o dado que ele existia para exercitar, uma guarda escrita contra o ataque
errado. Cada um vira uma regra com o motivo por extenso.

## Licença

Sem licença definida. Projeto pessoal de estudo.
