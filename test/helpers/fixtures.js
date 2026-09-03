/**
 * Fábricas de dados sintéticos NO MODELO INTERNO.
 *
 * Nenhum teste do núcleo pode tocar num payload de provedor. Se um teste
 * precisar de um campo que não existe em `Fixture`, o problema é o contrato,
 * não o teste.
 *
 * @module test/helpers/fixtures
 */

let seq = 0;

/**
 * @param {Partial<import('../../src/core/types.js').Fixture>} [overrides]
 * @returns {import('../../src/core/types.js').Fixture}
 */
export function makeFixture(overrides = {}) {
  seq += 1;
  return {
    id: `f${seq}`,
    homeName: 'Palmeiras',
    awayName: 'Corinthians',
    homeGoals: 0,
    awayGoals: 0,
    status: 'live',
    elapsedMin: 10,
    kickoffISO: '2026-09-03T21:30:00.000Z',
    leagueId: '71',
    leagueName: 'Serie A',
    ...overrides,
  };
}

/**
 * @param {number} fetchedAtMs
 * @param {import('../../src/core/types.js').Fixture[]} fixtures
 * @returns {import('../../src/core/types.js').Snapshot}
 */
export function makeSnapshot(fetchedAtMs, fixtures) {
  return { fetchedAtMs, fixtures };
}

/**
 * Mesma partida (mesmo `id`) num estado novo — o caso central do diff.
 *
 * @param {import('../../src/core/types.js').Fixture} fixture
 * @param {Partial<import('../../src/core/types.js').Fixture>} changes
 * @returns {import('../../src/core/types.js').Fixture}
 */
export function evolve(fixture, changes) {
  return { ...fixture, ...changes };
}

/**
 * @param {Partial<import('../../src/core/types.js').GoalEvent>} [overrides]
 * @returns {import('../../src/core/types.js').GoalEvent}
 */
export function makeGoalEvent(overrides = {}) {
  const fixture = overrides.fixture ?? makeFixture({ homeGoals: 1 });
  return {
    fixtureId: fixture.id,
    side: 'home',
    goalsBefore: 0,
    goalsAfter: 1,
    detectedAtMs: 1_000_000,
    fixture,
    ...overrides,
  };
}
