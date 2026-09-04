/**
 * Modelo interno normalizado do projeto.
 *
 * Este arquivo é o CONTRATO. Todo o núcleo (`src/core/`) trabalha exclusivamente
 * com estes tipos e nunca vê um payload de provedor. A tradução de qualquer API
 * externa para cá acontece só nos adaptadores (`src/adapters/`).
 *
 * Sem TypeScript e sem build: os tipos existem como JSDoc para o editor.
 * Nada aqui é validado em runtime — quem constrói um Fixture é o adaptador,
 * e é responsabilidade dele respeitar o contrato.
 *
 * @module core/types
 */

/**
 * Estado de uma partida, normalizado.
 *
 * Mapeia os muitos códigos de status dos provedores para cinco casos que a UI
 * e o núcleo sabem tratar. Prorrogação e pênaltis são `'live'` — do ponto de
 * vista do alerta de gol e do overlay, a partida está correndo.
 *
 * - `'scheduled'`  — ainda não começou (placar desconhecido)
 * - `'live'`       — em andamento, inclusive prorrogação/pênaltis
 * - `'halftime'`   — intervalo
 * - `'finished'`   — encerrada (tempo normal, prorrogação ou pênaltis)
 * - `'cancelled'`  — cancelada, adiada, abandonada ou W.O.
 *
 * @typedef {'scheduled'|'live'|'halftime'|'finished'|'cancelled'} FixtureStatus
 */

/**
 * Uma partida no modelo interno.
 *
 * @typedef  {object} Fixture
 * @property {string} id
 *   Identificador estável da partida, string. Estável entre snapshots — é a
 *   chave do diff. Adaptadores convertem ids numéricos para string.
 * @property {string} homeName    Nome do time da casa, já pronto para exibição.
 * @property {string} awayName    Nome do time visitante, já pronto para exibição.
 * @property {number|null} homeGoals
 *   Gols do time da casa. `null` quando o placar é desconhecido (tipicamente
 *   `'scheduled'`). `null` NÃO é sinônimo de zero: o núcleo se recusa a
 *   comparar placares quando um dos lados é desconhecido, justamente para que
 *   `null → 0` no apito inicial não vire um gol fantasma.
 * @property {number|null} awayGoals  Gols do visitante. Mesma regra de `null`.
 * @property {FixtureStatus} status   Estado normalizado.
 * @property {number|null} elapsedMin
 *   Minuto de jogo, quando o provedor informa. `null` fora de jogo ou quando
 *   indisponível. Puramente informativo: o núcleo nunca deriva nada dele,
 *   porque o minuto anda para trás em correções de provedor.
 * @property {string} kickoffISO  Horário do apito inicial, ISO 8601 com timezone (UTC).
 * @property {string} leagueId    Identificador da competição, string.
 * @property {string} leagueName  Nome da competição, pronto para exibição.
 */

/**
 * UMA LINHA DA AGENDA DO DIA — o mínimo para o portão do cron decidir.
 *
 * Não é uma `Fixture` reduzida: é outro tipo, com outro propósito. A agenda
 * responde uma pergunta só — "há jogo de interesse hoje, e a que horas?" — e
 * o portão lê exatamente estes dois campos. Guardar `Fixture` inteira aqui
 * seria carregar nome de time, placar, logo e estádio numa chave do KV que
 * nada disso alimenta: MEDIDO na captura de 2026-09-04, 421 KB de payload cru
 * contra 26,6 KB reduzido, para as mesmas 454 partidas.
 *
 * Placar e status NÃO entram de propósito. A agenda é buscada uma vez por
 * dia; qualquer placar dela nasce velho, e um segundo lugar com placar seria
 * um segundo lugar de onde a UI poderia lê-lo errado. Placar vem do snapshot,
 * e só dele.
 *
 * @typedef  {object} AgendaEntry
 * @property {string} leagueId
 *   Id da liga, string — mesma convenção de `Fixture.leagueId`, para cruzar
 *   com `activeLeagueIds` sem comparar número com string.
 * @property {string} kickoffISO
 *   Início programado, ISO 8601 verbatim do provedor. É o que
 *   `hasMatchInProgress` compara com o relógio.
 */

/**
 * Uma leitura completa do estado ao vivo, num instante.
 *
 * O snapshot é a unidade que o Worker grava no KV e que o cliente compara.
 * `fetchedAtMs` é o instante da busca upstream — não o da leitura do KV, que
 * pode vir de cache. É dele que sai toda a conta de staleness.
 *
 * @typedef  {object} Snapshot
 * @property {number} fetchedAtMs  Epoch em ms de quando o upstream respondeu.
 * @property {Fixture[]} fixtures  Partidas observadas nessa leitura.
 */

/**
 * Um gol detectado entre dois snapshots.
 *
 * Só existe para aumento de placar. Queda de placar (correção do provedor)
 * atualiza o estado em silêncio e nunca vira evento.
 *
 * @typedef  {object} GoalEvent
 * @property {string} fixtureId       Id da partida onde o gol saiu.
 * @property {'home'|'away'} side     Lado que marcou.
 * @property {number} goalsBefore     Gols daquele lado no snapshot anterior.
 * @property {number} goalsAfter      Gols daquele lado no snapshot novo.
 * @property {number} detectedAtMs    `fetchedAtMs` do snapshot novo.
 * @property {Fixture} fixture        A partida no estado novo, para exibição.
 */

/**
 * Nível de confiança na idade do dado exibido.
 *
 * - `'fresh'`  — dentro da janela normal do pipeline; sem aviso na UI
 * - `'warn'`   — atrasado além do esperado; faixa amarela
 * - `'stale'`  — provavelmente quebrado; faixa vermelha
 *
 * @typedef {'fresh'|'warn'|'stale'} StalenessLevel
 */

/**
 * Resultado de `isStale`: o nível mais a idade crua, para a UI escrever
 * "dados de há 40s" sem refazer a conta.
 *
 * @typedef  {object} Staleness
 * @property {StalenessLevel} level
 * @property {number} ageMs  Idade do dado em ms, nunca negativa.
 */

export {};
