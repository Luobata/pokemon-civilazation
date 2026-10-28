import { expect, test } from 'vitest';
import { parsePatch } from '../../tools/patch.ts';
import { CONTENT, unitDefinition } from '../../src/content/units.ts';
import { createGame } from '../../src/core/game.ts';
import { createCity, maxCityHp, tileYield } from '../../src/core/city.ts';
import { cityCounterDamage, cityDamage } from '../../src/core/combat-query.ts';
import { observe } from '../../src/core/vision.ts';
import { scorePlayer, finishGame, eliminateCivilization } from '../../src/core/victory.ts';
import { roundSnapshot } from '../../tools/telemetry.ts';
import { combatFixture, pokemon } from '../core/combat-fixture.ts';
import { explorationMatches, matchSetup } from '../../tools/matches.ts';
import { simulateMatch } from '../../tools/simulate.ts';

test.each([
  [null, 'patch'], [[], 'patch'], [{ typo: 1 }, 'patch.typo'],
  [{ species: { missing: { attack: 10 } } }, 'patch.species.missing'],
  [{ species: { bulbasaur: { attack: '40' } } }, 'patch.species.bulbasaur.attack'],
  [{ species: { bulbasaur: { defense: 0 } } }, 'patch.species.bulbasaur.defense'],
  [{ species: { bulbasaur: { move: 1.5 } } }, 'patch.species.bulbasaur.move'],
  [{ species: { bulbasaur: { maxHp: Infinity } } }, 'patch.species.bulbasaur.maxHp'],
  [{ species: { bulbasaur: { power: NaN } } }, 'patch.species.bulbasaur.power'],
  [{ species: { venusaur: { evolution: { xp: 1 } } } }, 'patch.species.venusaur.evolution'],
  [{ buildings: { headquarters: { cost: 1 } } }, 'patch.buildings.headquarters.cost'],
  [{ techs: { riding: { tier: 1 } } }, 'patch.techs.riding.tier'],
  [{ balance: { city: { baseHp: 49 } } }, 'patch.balance.city.baseHp'],
  [{ ai: { expansionCaptureHpPercent: 101 } }, 'patch.ai.expansionCaptureHpPercent'],
  [{ ai: { conservativeCaptureTerritoryOnly: 0 } }, 'patch.ai.conservativeCaptureTerritoryOnly'],
  [{ ai: { conservativeCaptureTerritoryOnly: 'false' } }, 'patch.ai.conservativeCaptureTerritoryOnly'],
  [{ ai: { conservativeCaptureTerritoryOnly: null } }, 'patch.ai.conservativeCaptureTerritoryOnly'],
  [{ ai: { conservativeCaptureTerritoryOnly: {} } }, 'patch.ai.conservativeCaptureTerritoryOnly'],
  [JSON.parse('{"species":{"__proto__":{"attack":1}}}'), 'patch.species.__proto__'],
])('invalid patch %# reports its exact path', (input, path) => {
  expect(() => parsePatch(input)).toThrow(String(path));
});
test('patches are isolated, aliased species stay consistent, hashes ignore key order', () => {
  const before = JSON.stringify(CONTENT);
  const first = parsePatch({ species: { bulbasaur: { upkeep: 9, move: 4 } }, settler: { trainCost: 50 } });
  const second = parsePatch({ settler: { trainCost: 50 }, species: { bulbasaur: { move: 4, upkeep: 9 } } });
  expect(first.sha256).toBe(second.sha256);
  expect(first.content.units.bulbasaur).toBe(first.content.species.bulbasaur);
  expect(unitDefinition({ kind: 'pokemon', speciesId: 'bulbasaur' }, first.content)).toMatchObject({ upkeep: 9, move: 4 });
  expect(first.content.units.settler.trainCost).toBe(50);
  expect(JSON.stringify(CONTENT)).toBe(before);
  expect(parsePatch({}).content).toEqual(CONTENT);
});
test('city HP, damage, observation, scoring and telemetry use injected rules', () => {
  const { content } = parsePatch({ balance: { city: { baseHp: 60, buildingHp: 7, counterAttack: 90, squirtleCounterAttack: 95, defense: 25 },
    effects: { siegeMultiplier: 2000, leagueScoreMultiplier: 1500, meteorologyResearch: 3 }, score: { cities: 200 } }, species: { charmander: { upkeep: 9 } } });
  const game = createGame(matchSetup(explorationMatches(3)[0]), content);
  expect(Object.values(game.cities).every(city => city.hp === 60)).toBe(true);
  const state = combatFixture(), unit = pokemon(state, 10, 'onix', 0, 9, 2);
  const city = createCity(3, 0, { q: 5, r: 5 }, false, content); city.buildingIds.push('pasture');
  expect(maxCityHp(city, content)).toBe(67);
  expect(cityDamage(unit, 'grassland', 'grassland', true, 100, content)).toBeGreaterThan(cityDamage(unit, 'grassland', 'grassland', true, 100));
  const view = observe(state, 0, content), target = state.cities[2];
  const expected = state.players[target.ownerId!].starterId === 'squirtle' ? 95 : 90;
  expect(view.combat.cities[2].counterAttack).toBe(expected);
  expect(cityCounterDamage(expected, unit, 'grassland', 'grassland', content)).toBeGreaterThan(0);
  const player = state.players[0]; player.research.unlockedIds.push('leagueRules', 'meteorology');
  expect(tileYield('snow', player, content).research).toBe(4);
  const score = scorePlayer(state, 0, content);
  expect(score.total).toBe(Math.floor((score.cities * 200 + score.population * 10 + score.species * 5 + score.techs * 20 + score.knockdowns * 2) * 1.5));
  pokemon(state, 11, 'charmander');
  expect(roundSnapshot(state, 1, content).players[0]).toMatchObject({ score: scorePlayer(state, 0, content), upkeep: content.species.onix.upkeep + 9 });
  finishGame(state, 'score', undefined, content);
  expect(state.outcome!.ranking.find(row => row.playerId === 0)).toEqual(scorePlayer(state, 0, content));
  eliminateCivilization(state, 1, content);
  expect(state.players[1].frozenScore).toEqual(scorePlayer(state, 1, content));
});
test('empty patch preserves a full match', () => {
  const match = explorationMatches(3)[0], baseline = simulateMatch(match);
  expect(JSON.stringify(simulateMatch(match, 100, parsePatch({})))).toBe(JSON.stringify(baseline));
}, 30_000);

test('boolean AI patches preserve explicit false and do not mutate defaults', () => {
  expect(parsePatch({ ai: { conservativeCaptureTerritoryOnly: false } }).ai.conservativeCaptureTerritoryOnly).toBe(false);
  expect(parsePatch({ ai: { conservativeCaptureTerritoryOnly: true } }).ai.conservativeCaptureTerritoryOnly).toBe(true);
  expect(parsePatch({}).ai.conservativeCaptureTerritoryOnly).toBe(true);
});

test.each([
  [{ ai: { conservativeMayDeclareWar: 1 } }, 'conservativeMayDeclareWar'],
  [{ ai: { aggressiveSeekUnknownHq: 'true' } }, 'aggressiveSeekUnknownHq'],
  [{ ai: { conservativeDeclareStrength: -1 } }, 'conservativeDeclareStrength'],
  [{ ai: { conservativeDeclareStrength: 10001 } }, 'conservativeDeclareStrength'],
  [{ ai: { conservativeBorderDistance: 0 } }, 'conservativeBorderDistance'],
  [{ ai: { conservativeBorderDistance: 25 } }, 'conservativeBorderDistance'],
  [{ balance: { city: { capturedHp: 0 } } }, 'capturedHp'],
  [{ balance: { city: { capturedHp: 101 } } }, 'capturedHp'],
  [{ balance: { city: { baseHp: 50, capturedHp: 60 } } }, 'capturedHp'],
])('B4 rejects invalid new fields %#', (patch, field) => {
  expect(() => parsePatch(patch)).toThrow(String(field));
});
test('B4 patch leaves defaults off and admits captured HP equal to the smallest city maximum', () => {
  expect(parsePatch({}).ai).toMatchObject({ conservativeMayDeclareWar: false, conservativeDeclareStrength: 2000,
    conservativeBorderDistance: 1, aggressiveSeekUnknownHq: false });
  expect(parsePatch({}).content.balance.city.capturedHp).toBe(50);
  expect(parsePatch({ balance: { city: { baseHp: 60, capturedHp: 60 } } }).content.balance.city.capturedHp).toBe(60);
});
