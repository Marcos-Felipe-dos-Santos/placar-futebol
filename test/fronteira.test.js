import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * O GATILHO DA DÍVIDA DE FRONTEIRA.
 *
 * `ledger` é função pura morando em `worker.js`. Pela fronteira do projeto,
 * função pura é assunto de `src/core/` — mas mover uma função com quatro
 * chamadores internos e um livro-caixa inteiro atrás dela é refactor, e
 * refactor não se faz de passagem no meio de outro PR.
 *
 * Então a dívida fica registrada COM GATILHO, porque dívida sem gatilho não é
 * cobrada. O gatilho é este teste: ele conta a superfície `__` de `worker.js`
 * e fica vermelho quando ela cresce. Não é uma proibição — é uma parada
 * obrigatória para decidir, e a mensagem diz o que decidir.
 *
 * Mesma família do `estado-diario.test.js`: quando a omissão é o modo de
 * falha, a checagem tem que ser executável. "A gente move depois" é a forma
 * mais comum de omissão em código.
 */

const SUPERFICIE_ATUAL = [
  '__CAMPOS_NAO_DIARIOS',
  '__estadoInicial',
  '__ledger',
  '__resetIsolateState',
];

test('GATILHO: a superfície de teste de worker.js não cresceu sem decisão', async () => {
  const modulo = await import('../worker.js');
  const encontrada = Object.keys(modulo).filter((k) => k.startsWith('__')).sort();

  assert.deepEqual(
    encontrada,
    SUPERFICIE_ATUAL,
    'A superfície `__` de worker.js mudou. Se CRESCEU, é o gatilho combinado: '
    + 'pare e mova `ledger` (e o que mais for função pura) para src/core/, com '
    + 'teste próprio, em vez de exportar mais um `__`. Três eram tolerância; o '
    + 'quarto export novo é o sinal de que a lógica pura já não cabe em worker.js. '
    + 'Se DIMINUIU porque a mudança foi feita, atualize esta lista.',
  );
});

test('GATILHO: nenhum outro consumidor de produção importa o ledger por atalho', async () => {
  // O segundo gatilho, e o mais grave: se `ledger` ganhar chamador FORA de
  // worker.js, ele deixou de ser detalhe do Worker e virou núcleo de fato —
  // aí a mudança não é mais opcional. Importar `__ledger` em produção seria
  // burlar a fronteira por um nome que anuncia ser só de teste.
  const arquivos = [
    'app.js',
    'src/core/agenda.js',
    'src/core/gate.js',
    'src/core/polling.js',
    'src/core/snapshot.js',
  ].filter((f) => fs.existsSync(f));

  assert.ok(arquivos.length >= 4, 'a lista de arquivos vigiados encolheu sem explicação');
  for (const arquivo of arquivos) {
    const fonte = fs.readFileSync(arquivo, 'utf8');
    assert.ok(
      !fonte.includes('__ledger') && !fonte.includes('__estadoInicial'),
      `${arquivo} importa superfície de teste de worker.js: mova a função para src/core/`,
    );
  }
});
