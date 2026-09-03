/**
 * Adaptador API-Football v3 → modelo interno.
 *
 * Escrito contra `live-sample.json`: uma resposta real de
 * `GET /fixtures?live=all` com 19 partidas ao vivo, capturada em 2026-09-03
 * sem reserialização. **Onde o arquivo e a documentação divergirem, o arquivo
 * vence.** Recortes verbatim vivem em `test/helpers/apiFootballSamples.js`,
 * porque a captura de 58 KB não é versionada.
 *
 * Esta é a única camada que conhece formato de provedor. O núcleo em
 * `src/core/` nunca vê um payload destes.
 *
 * ## O que a captura provou
 *
 * - Envelope: `{ get, parameters, errors, results, paging, response }`.
 *   `errors` vem `[]` (array) na resposta boa.
 * - Os 19 itens têm shape idêntico — um único perfil estrutural, sem campo
 *   opcional faltando em uns e presente em outros.
 * - `fixture.id` e `league.id` são **number**; o modelo interno quer string.
 * - `fixture.date` vem como `2026-09-03T20:00:00+00:00` — ISO 8601 com
 *   offset explícito, não com sufixo `Z`.
 * - `goals.home`/`goals.away` vieram todos number nesta captura. O tratamento
 *   de `null` é defensivo e obrigatório mesmo assim: é a regra que impede o
 *   gol fantasma no apito inicial.
 * - `fixture.status.short` apareceu só como `1H` e `2H`.
 *
 * ## `status.elapsed` satura, e `status.extra` existe
 *
 * `elapsed` trava no teto do período: vale 45 no primeiro tempo com acréscimo
 * correndo e 90 no segundo. A captura tem duas partidas com `elapsed: 45` e
 * `status.extra` valendo 3 e 1 — ou seja, **a API expõe o acréscimo, só que
 * num campo separado**.
 *
 * O modelo interno não tem onde guardar isso, e mudá-lo é decisão do dev, não
 * deste adaptador. Então `extra` é **descartado** por ora e `elapsedMin`
 * recebe o `elapsed` cru. Consequências registradas:
 *
 * - A UI do PR 3 mostra `45'` numa partida em 45+3, e `90'` numa em 90+6.
 *   Isso é o que a fonte diz. **Não é bug e não deve ser "consertado"**
 *   inventando o minuto; a informação existe em `status.extra` e o caminho
 *   certo é levá-la ao modelo interno, não estimá-la.
 * - `isStale` **nunca** pode usar `elapsed` como sinal de frescor. Um dado
 *   pode estar fresquíssimo com `elapsed` parado em 90 por seis minutos. O
 *   frescor vem do timestamp do snapshot, e só dele.
 *
 * @module adapters/apiFootball
 */

/**
 * `fixture.status.short` → status do modelo interno.
 *
 * Marcação de evidência:
 * - ✅ **verificado contra a captura**: `1H`, `2H`. São os únicos que
 *   aparecem nas 19 partidas.
 * - 📄 **da documentação, sem exemplo real**: todos os demais. Um segundo
 *   snapshot noturno deve trazer `HT` e `FT`; até lá, esses mapeamentos são
 *   inferência e não medição.
 *
 * Escolhas que merecem revisão do dev:
 *
 * - `SUSP` e `INT` (suspensa / interrompida) viram `'live'`, não
 *   `'cancelled'`. A partida não acabou nem foi cancelada, e o placar fica
 *   congelado — congelado não gera alerta falso. Mostrar "cancelado" numa
 *   paragem de dez minutos por chuva seria pior. Se depois for abandonada, o
 *   provedor manda `ABD` e aí sim vira `'cancelled'`.
 * - `BT` (intervalo da prorrogação) vira `'halftime'`, não `'live'`: é uma
 *   pausa, e é assim que a UI deve pintá-la.
 * - `AWD` e `WO` (vitória técnica, W.O.) viram `'cancelled'`, seguindo o
 *   typedef do modelo, que já descreve `cancelled` como "cancelada, adiada,
 *   abandonada ou W.O.".
 *
 * @type {Readonly<Record<string, import('../core/types.js').FixtureStatus>>}
 */
export const STATUS_MAP = Object.freeze({
  // ✅ verificados contra live-sample.json
  '1H': 'live',
  '2H': 'live',

  // 📄 documentação, sem exemplo real na captura
  TBD: 'scheduled',
  NS: 'scheduled',
  ET: 'live',
  P: 'live',
  LIVE: 'live',
  SUSP: 'live',
  INT: 'live',
  HT: 'halftime',
  BT: 'halftime',
  FT: 'finished',
  AET: 'finished',
  PEN: 'finished',
  PST: 'cancelled',
  CANC: 'cancelled',
  ABD: 'cancelled',
  AWD: 'cancelled',
  WO: 'cancelled',
});

/**
 * Destino de qualquer `status.short` fora do mapa.
 *
 * `'scheduled'` e nunca `'live'`: um código novo da API não pode fazer a
 * página tocar alerta de gol numa partida que talvez nem esteja acontecendo.
 * Erra para o lado silencioso.
 */
const UNKNOWN_STATUS = 'scheduled';

/**
 * Placar do provedor → placar do modelo.
 *
 * `null` significa desconhecido e continua `null`. Converter para `0` aqui
 * criaria o gol fantasma no apito inicial: o núcleo veria `null → 0` como
 * placar estável e depois `0 → 1` como gol, ou pior, veria `0` onde não há
 * informação nenhuma.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function toGoals(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function toElapsed(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * `errors` é `[]` na resposta boa e vem preenchido quando o plano não cobre o
 * endpoint — **com HTTP 200**. Checar só o status code não pega.
 *
 * @param {unknown} errors
 * @returns {boolean}
 */
function hasErrors(errors) {
  if (errors == null) return false;
  if (Array.isArray(errors)) return errors.length > 0;
  if (typeof errors === 'object') return Object.keys(errors).length > 0;
  return Boolean(errors);
}

/**
 * Converte uma partida crua. Devolve `null` quando o item não tem o mínimo
 * para virar uma `Fixture` utilizável.
 *
 * @param {any} raw
 * @returns {import('../core/types.js').Fixture|null}
 */
function toFixture(raw) {
  const id = raw?.fixture?.id;
  const homeName = raw?.teams?.home?.name;
  const awayName = raw?.teams?.away?.name;

  // Sem id não há como diffar entre snapshots; sem nome de time não há o que
  // mostrar. Nos dois casos a partida é inútil, e derrubar o snapshot inteiro
  // por causa dela seria pior.
  if (id == null || typeof homeName !== 'string' || typeof awayName !== 'string') return null;

  const short = raw?.fixture?.status?.short;

  return {
    id: String(id),
    homeName,
    awayName,
    homeGoals: toGoals(raw?.goals?.home),
    awayGoals: toGoals(raw?.goals?.away),
    status: (typeof short === 'string' && STATUS_MAP[short]) || UNKNOWN_STATUS,
    elapsedMin: toElapsed(raw?.fixture?.status?.elapsed),
    // Verbatim: já é ISO 8601 com offset, que é o que o modelo pede. Não
    // normalizo para `Z` porque reescrever a data introduziria uma conversão
    // que pode falhar e não acrescenta nada — `Intl.DateTimeFormat` lê as
    // duas formas.
    kickoffISO: typeof raw?.fixture?.date === 'string' ? raw.fixture.date : '',
    leagueId: String(raw?.league?.id ?? ''),
    leagueName: typeof raw?.league?.name === 'string' ? raw.league.name : '',
  };
}

/**
 * Converte uma resposta crua da API-Football em partidas do modelo interno.
 *
 * @param {unknown} rawResponse  Corpo JSON já parseado de `/fixtures?live=all`.
 * @returns {import('../core/types.js').Fixture[]}
 *   Objetos novos, sem referência compartilhada com o payload.
 * @throws {Error}
 *   Se o envelope não for o esperado, ou se `errors` vier preenchido. Lançar
 *   é deliberado: devolver `[]` faria o Worker gravar um snapshot vazio por
 *   cima de um bom, e a página ficaria correta e vazia — indistinguível de
 *   quebrada.
 */
export function toFixtures(rawResponse) {
  if (rawResponse == null || typeof rawResponse !== 'object' || Array.isArray(rawResponse)) {
    throw new Error('api-football: resposta não é um envelope de objeto');
  }

  const envelope = /** @type {any} */ (rawResponse);

  if (hasErrors(envelope.errors)) {
    throw new Error(`api-football: resposta traz errors: ${JSON.stringify(envelope.errors)}`);
  }

  if (!Array.isArray(envelope.response)) {
    throw new Error('api-football: envelope sem array `response`');
  }

  /** @type {import('../core/types.js').Fixture[]} */
  const fixtures = [];
  for (const raw of envelope.response) {
    const fixture = toFixture(raw);
    if (fixture !== null) fixtures.push(fixture);
  }

  return fixtures;
}
