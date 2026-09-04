/**
 * REDAÇÃO E DERIVAÇÃO DA VIEW — puro, sem DOM.
 *
 * Aqui mora todo o português da interface. `src/core/` devolve códigos e
 * números; este módulo os transforma em frase. A separação existe para que o
 * núcleo não conheça idioma nem layout, e é a mesma razão pela qual os rótulos
 * de `reason` não entraram em `core/gate.js`.
 *
 * **Nada aqui toca `document`.** É o que torna o PR 3 testável sem dependência
 * nova: o DOM fica burro em `app.js` e tudo o que decide texto é testado aqui.
 *
 * ## A REGRA DO RELÓGIO — decidida por um bug previsto, não por acidente
 *
 * `backoffUntilMs`, `quotaResetAtMs` e afins são instantes ABSOLUTOS gravados
 * pelo relógio do Worker. O relógio do navegador diverge do dele — sempre um
 * pouco, às vezes muito, e a máquina com relógio errado é a mesma que menos
 * suspeita disso.
 *
 * - **Instante absoluto → HORA DE PAREDE: pode.** "a cota volta às 21:00" é
 *   verdade independentemente da divergência: o instante é o instante, e o
 *   navegador só o formata no fuso local.
 * - **Instante absoluto → CONTAGEM REGRESSIVA contra `Date.now()`: nunca.**
 *   "tenta de novo em 3 min" é uma subtração entre dois relógios diferentes.
 *   Com o cliente adiantado dá número negativo; com ele atrasado, número
 *   inflado. E o erro aparece justamente quando algo já está quebrado, que é o
 *   pior momento para a tela inventar um número.
 *
 * A ÚNICA subtração entre relógios nesta interface é a idade do dado, que é
 * inerente ao produto — não dá para mostrar frescor sem comparar com agora. O
 * `isStale` já é dono dela e já trava em zero para não exibir "há -30s". Fora
 * dela, formate a hora e deixe o usuário comparar com o próprio relógio.
 *
 * @module view/copy
 */

/**
 * Hora de parede local, `HH:MM`.
 *
 * @param {number|null|undefined} ms  Instante absoluto.
 * @returns {string|null} `null` quando não há instante utilizável — e a frase
 *   que o usaria tem de saber viver sem ele, nunca imprimir "às null".
 */
export function horaLocal(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Idade em texto curto. A única subtração entre relógios da interface, e ela
 * chega aqui já feita e travada em zero por `isStale`.
 *
 * @param {number} ageMs
 * @returns {string}
 */
export function idadeCurta(ageMs) {
  if (typeof ageMs !== 'number' || !Number.isFinite(ageMs)) return 'idade desconhecida';
  const seg = Math.floor(ageMs / 1000);
  if (seg < 60) return `há ${seg}s`;
  const min = Math.floor(seg / 60);
  if (min < 60) return `há ${min} min`;
  const horas = Math.floor(min / 60);
  return `há ${horas}h${String(min % 60).padStart(2, '0')}`;
}

/** Rótulos de status. `scheduled` some da grade ao vivo, mas pode aparecer. */
const STATUS_TEXTO = Object.freeze({
  live: 'ao vivo',
  halftime: 'intervalo',
  finished: 'encerrado',
  cancelled: 'não aconteceu',
  scheduled: 'a começar',
});

/**
 * @param {import('../core/types.js').Fixture} fixture
 * @returns {string}
 */
export function statusTexto(fixture) {
  const status = fixture?.status;
  return Object.hasOwn(STATUS_TEXTO, status) ? STATUS_TEXTO[status] : 'estado desconhecido';
}

/**
 * O minuto exibido na partida.
 *
 * MEDIDO na captura: `elapsed` TRAVA em 45 durante o acréscimo do primeiro
 * tempo, e a API põe o acréscimo num campo separado que o modelo interno não
 * carrega. Então uma partida em 45+3 aparece como `45'` — **isso é a fonte
 * falando, não bug da tela**, e não deve ser "consertado" estimando o minuto.
 * Inventar `48'` seria a interface mentindo com mais confiança do que o dado
 * que ela tem.
 *
 * @param {import('../core/types.js').Fixture} fixture
 * @returns {string}
 */
export function minutoTexto(fixture) {
  if (fixture?.status === 'halftime') return 'INT';
  const min = fixture?.elapsedMin;
  if (typeof min !== 'number' || !Number.isFinite(min)) return '';
  return `${min}'`;
}

/**
 * Placar para exibição. `null` é desconhecido e vira travessão, NUNCA zero.
 *
 * Mostrar `0` onde o dado é desconhecido é a versão visual do gol fantasma que
 * o núcleo evita: o usuário lê 0-0 e acredita que a partida começou empatada.
 *
 * @param {number|null} gols
 * @returns {string}
 */
export function placarTexto(gols) {
  return typeof gols === 'number' && Number.isFinite(gols) ? String(gols) : '–';
}

/**
 * A frase da faixa de diagnóstico, a partir do código de `chooseNotice`.
 *
 * @param {import('../core/notice.js').Notice|null} notice
 * @returns {{titulo: string, detalhe: string}|null}
 */
export function noticeTexto(notice) {
  if (notice === null || notice === undefined) return null;
  const d = notice.data ?? {};

  switch (notice.code) {
    case 'sem-dado':
      return {
        titulo: 'Sem dados do servidor',
        detalhe: 'Nada nesta tela veio da API. Não é "não há jogos" — é "não consegui saber".',
      };

    case 'parado-quebrado': {
      const hora = horaLocal(d.retryAtMs);
      // Hora de parede, nunca "em N minutos": ver a regra do relógio no topo.
      const quando = hora ? ` Próxima tentativa por volta das ${hora}.` : '';
      return {
        titulo: `Dados parados ${idadeCurta(d.ageMs)}`,
        detalhe: `O servidor falhou ${d.failures} ${d.failures === 1 ? 'vez' : 'vezes'} seguidas ao `
          + `buscar os jogos. Ele tenta de novo sozinho — não adianta recarregar.${quando}`,
      };
    }

    case 'parado-sem-cota': {
      const hora = horaLocal(d.resetAtMs);
      const quando = hora ? ` A cota volta às ${hora}.` : '';
      return {
        titulo: `Dados parados ${idadeCurta(d.ageMs)}`,
        detalhe: `A cota diária de consultas à API acabou.${quando} Os placares abaixo são os `
          + 'últimos que deu para buscar.',
      };
    }

    case 'parado-motivo-desconhecido':
      return {
        titulo: `Dados parados ${idadeCurta(d.ageMs)}`,
        detalhe: 'Não foi possível saber por quê — o servidor não respondeu sobre o próprio estado. '
          + 'Os placares abaixo podem estar desatualizados.',
      };

    case 'parado-sem-jogo':
      return {
        titulo: `Dados de ${idadeCurta(d.ageMs).replace('há ', '')} atrás`,
        detalhe: 'Nenhuma partida das competições acompanhadas está em andamento, então o servidor '
          + 'não está gastando consultas. Isto é o funcionamento normal.',
      };

    case 'incompleto': {
      const truncado = d.truncated
        ? 'A resposta da API veio cortada, então há partidas que nem chegaram. '
        : '';
      const perdidas = d.discarded > 0
        ? `${d.discarded} de ${d.upstreamCount} partidas não puderam ser lidas e não estão abaixo. `
        : '';
      return {
        titulo: 'A lista está incompleta',
        detalhe: `${truncado}${perdidas}Uma partida que você acompanha pode ser justamente uma das `
          + 'que faltam.',
      };
    }

    case 'as-cegas':
      return {
        titulo: 'Cobertura reduzida hoje',
        detalhe: 'O servidor não conseguiu a agenda do dia e está buscando às cegas. Os jogos '
          + 'mostrados são reais, mas pode faltar algum.',
      };

    case 'vazio': {
      const semCobertura = d.uncovered > 0
        ? ` Você tem ${d.uncovered} ${d.uncovered === 1 ? 'liga favoritada' : 'ligas favoritadas'} `
          + 'sem cobertura ao vivo garantida, o que pode explicar a lista vazia.'
        : '';
      return {
        titulo: 'Nenhuma partida ao vivo agora',
        detalhe: `A lista está vazia porque não há jogo em andamento, e não porque algo falhou.${semCobertura}`,
      };
    }

    default:
      // Código novo em `chooseNotice` sem redação aqui. Dizer isso é melhor do
      // que devolver `null` e sumir com o aviso — sumir é o modo de falha que
      // a faixa inteira existe para combater.
      return {
        titulo: 'Aviso sem texto',
        detalhe: `A página recebeu o aviso "${notice.code}" e não sabe redigi-lo. É bug da tela, `
          + 'não do servidor.',
      };
  }
}

/**
 * O aviso da ressincronização — REQUISITO EXPLÍCITO do contrato de
 * `applySnapshot`.
 *
 * ## Por que NÃO entra na faixa de diagnóstico
 *
 * Escopo diferente, e a regra é "classifique o escopo antes da precedência".
 * A faixa descreve o ESTADO ATUAL da página e é recalculada a cada render; a
 * ressincronização é um EVENTO passado, que precisa continuar visível depois
 * de o estado já ter voltado ao normal. Lifetimes diferentes não cabem no
 * mesmo elemento: ou o evento seria apagado pelo render seguinte, ou o estado
 * ficaria congelado no momento do evento.
 *
 * @param {boolean} resynced
 * @param {number} swallowedGoals
 * @returns {{titulo: string, detalhe: string}|null}
 */
export function resyncTexto(resynced, swallowedGoals) {
  if (!resynced) return null;

  if (swallowedGoals > 0) {
    return {
      titulo: `${swallowedGoals} ${swallowedGoals === 1 ? 'gol pode ter passado' : 'gols podem ter passado'} sem alerta`,
      detalhe: 'Houve um intervalo grande entre duas leituras e os placares avançaram sem que o som '
        + 'tocasse. Confira as partidas abaixo.',
    };
  }

  // `resynced` com zero gols engolidos merece texto diferente: houve buraco, e
  // nada se perdeu. Dizer "0 gols podem ter passado" assustaria à toa.
  return {
    titulo: 'Houve uma interrupção nas leituras',
    detalhe: 'A conexão com o servidor ficou um tempo sem atualizar, mas nenhum gol se perdeu nesse '
      + 'intervalo.',
  };
}

/**
 * Aviso preso ao CHIP DA LIGA, nunca à faixa global.
 *
 * Escopo local: é propriedade permanente de uma liga, não estado da página.
 * Na faixa, disputaria precedência todo dia com avisos temporais e acabaria
 * escondendo um deles ou empilhando.
 *
 * @param {boolean} semCobertura
 * @returns {string|null} Texto para `title`/tooltip do chip.
 */
export function chipCoberturaTexto(semCobertura) {
  if (!semCobertura) return null;
  return 'Sem cobertura ao vivo garantida: esta liga não faz o servidor buscar. '
    + 'Os jogos dela só aparecem de carona numa busca disparada por outra competição.';
}
