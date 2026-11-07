import { expect, test } from 'vitest';
import { BATTLE_CONTENT, OPENING_CONTENT, contentFor } from '../../src/content/units.ts';
import { ITEM_BALLS, OBJECTIVES, OPENING_RULES, victoryTargets } from '../../src/content/opening.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';
import { createGame } from '../../src/core/game.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { observe, refreshKnowledge, visibleTiles } from '../../src/core/vision.ts';
import { previewAttack } from '../../src/core/preview.ts';
import { resolveAttack } from '../../src/core/combat.ts';
import { recordDiscoveries } from '../../src/core/discoveries.ts';
import { recordOpening, wallBonus } from '../../src/core/opening.ts';
import { cityYield } from '../../src/core/city.ts';
import { gameVersions } from '../../src/core/versions.ts';
import { hexDistance, hexToIndex, indexToHex } from '../../src/core/hex.ts';
import type { GameSetup, GameState } from '../../src/core/model.ts';

const duel = (gameplayVersion: GameplayVersion): GameSetup => ({ seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1', gameplayVersion,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'misty' }] });
const capital = (state: GameState, playerId: number) => state.cities[state.players[playerId].headquartersCityId];

test('v21 content and envelope; v20 keeps its content and has no opening ledger', () => {
  expect(gameVersions({ gameplayVersion: 21 })).toEqual({ schemaVersion: 16, rulesVersion: 'opening-v21' });
  expect(contentFor({ expansionVersion: 1, gameplayVersion: 21 })).toBe(OPENING_CONTENT);
  expect(contentFor({ expansionVersion: 1, gameplayVersion: 20 })).toBe(BATTLE_CONTENT);
  expect(Object.values(OPENING_CONTENT.techs).filter(tech => tech.tier === 1).every(tech => tech.cost === 14)).toBe(true);
  expect(OPENING_CONTENT.units.settler.trainCost).toBe(24);
  expect(OPENING_CONTENT.balance.city.baseHp).toBe(100);
  expect(createGame(duel(20)).expansion).not.toHaveProperty('opening');
});

test('v21 places item balls with a stable hash: same world and RNG as v20, away from cities and each other, private until seen', () => {
  const v20 = createGame(duel(20)), v21 = createGame(duel(21)), balls = Object.keys(v21.expansion!.opening!.itemBalls).map(Number);
  expect(v21.rng).toEqual(v20.rng);
  expect(v21.map).toEqual(v20.map);
  expect(v21.expansion!.world).toEqual(v20.expansion!.world);
  expect(balls.length).toBeGreaterThanOrEqual(3);
  for (const index of balls) {
    expect(v21.map.tiles[index]).not.toBe('ocean');
    for (const city of Object.values(v21.cities)) expect(hexDistance(city.position, indexToHex(index, v21.map), v21.map)).toBeGreaterThanOrEqual(OPENING_RULES.ballCityDistance);
    for (const other of balls) if (other !== index) expect(hexDistance(indexToHex(other, v21.map), indexToHex(index, v21.map), v21.map)).toBeGreaterThanOrEqual(OPENING_RULES.ballSpacing);
  }
  expect(createGame(duel(21)).expansion!.opening).toEqual(v21.expansion!.opening);
  const view = observe(v21, 0).expansion!.opening!;
  const explored = new Set(v21.knowledge[0].exploredTileIds);
  expect(view.itemBalls.every(item => explored.has(item.tileIndex))).toBe(true);
  expect(view.objectives).toEqual([]);
});

test('objectives pay once; an item ball is picked up by the unit standing on it', () => {
  const state = createGame(duel(21)), player = state.players[0], gold = player.gold;
  player.research.unlockedIds = ['training'];
  expect(recordOpening(state, [])).toContainEqual({ type: 'ObjectiveCompleted', playerId: 0, objectiveId: 'firstTech' });
  expect(player.gold).toBe(gold + OBJECTIVES.firstTech.reward.gold!);
  expect(recordOpening(state, [])).toEqual([]);
  expect(player.gold).toBe(gold + OBJECTIVES.firstTech.reward.gold!);
  // First capture only counts a successful capture event of this command.
  expect(recordOpening(state, [{ type: 'Captured', playerId: 0, unitId: 1, targetId: 2, success: false } as never])).toEqual([]);

  const [index, kind] = Object.entries(state.expansion!.opening!.itemBalls)[0];
  const unit = createMapUnit({ kind: 'pokemon', speciesId: 'rattata' }, 9000, 0, indexToHex(Number(index), state.map), OPENING_CONTENT);
  state.units[9000] = unit;
  const before = { gold: player.gold, research: player.research.reserve, balls: player.ballInventory.pokeBall, xp: unit.xp };
  expect(recordOpening(state, [])).toEqual([{ type: 'ItemBallClaimed', playerId: 0, tileIndex: Number(index), kind, unitId: 9000 }]);
  expect(state.expansion!.opening!.itemBalls).not.toHaveProperty(index);
  const gained = { gold: player.gold - before.gold, research: player.research.reserve - before.research, balls: player.ballInventory.pokeBall - before.balls, xp: unit.xp - before.xp };
  const amount = ITEM_BALLS[kind].amount;
  if (kind === 'gold') expect(gained.gold).toBe(amount);
  if (kind === 'research') expect(gained.research).toBe(amount);
  if (kind === 'balls') expect(gained.balls).toBe(amount);
  if (kind === 'xp') expect(gained.xp).toBe(amount);
  expect(recordOpening(state, [])).toEqual([]);
});

test('city centres produce research and the capital extra production only in v21', () => {
  const v20 = createGame(duel(20)), v21 = createGame(duel(21));
  const a = cityYield(v20, capital(v20, 0), BATTLE_CONTENT), b = cityYield(v21, capital(v21, 0), OPENING_CONTENT);
  expect(b.research - a.research).toBe(OPENING_RULES.capitalResearch);
  expect(b.production - a.production).toBe(OPENING_RULES.capitalProduction);
});

test('walls grow with the round, are listed in the preview and match the authority', () => {
  expect([0, 19, 20, 40, 100, 400].map(round => wallBonus(round))).toEqual([0, 0, 3, 6, 15, 15]);
  expect(wallBonus(40, true)).toBe(6 + OPENING_RULES.capitalDefense);
  const state = createGame(duel(21)), city = capital(state, 1);
  state.map.tiles.fill('grassland'); state.units = {}; state.diplomacy[0].status = 'war'; state.round = 40;
  capital(state, 0).position = { q: 3, r: 3 }; city.position = { q: 12, r: 8 };
  state.units[9000] = createMapUnit({ kind: 'pokemon', speciesId: 'machop' }, 9000, 0, { q: 11, r: 8 }, OPENING_CONTENT, 0, 1);
  refreshKnowledge(state);
  const preview = previewAttack(observe(state, 0), 9000, { kind: 'city', id: city.id });
  if (!preview.ok) throw new Error(preview.reason);
  expect(preview.strength!.factors).toContainEqual({ side: 'defense', label: '城墙', value: wallBonus(40, true) });
  const hp = city.hp;
  resolveAttack(state, 9000, { kind: 'city', id: city.id });
  expect(hp - city.hp).toBeGreaterThanOrEqual(preview.damage.min);
  expect(hp - city.hp).toBeLessThanOrEqual(preview.damage.max);
  expect(hexToIndex(city.position, state.map)).not.toBeNull();
});

test('v21 domestication discovery: first battle with a wild Pokémon (older rules still need a capture)', () => {
  for (const [version, content, expected] of [[21, OPENING_CONTENT, true], [20, BATTLE_CONTENT, false]] as const) {
    const before = createGame(duel(version));
    before.units[9000] = createMapUnit({ kind: 'pokemon', speciesId: 'rattata' }, 9000, 0, { q: 5, r: 5 }, content);
    before.units[9001] = createMapUnit({ kind: 'pokemon', speciesId: 'pidgey' }, 9001, null, { q: 6, r: 5 }, content);
    const next: GameState = structuredClone(before);
    recordDiscoveries(before, next, { actorId: 0, expectedSeq: 0, action: { type: 'EndTurn' } }, [{ type: 'BattleResolved', attackerId: 9000, target: { kind: 'unit', id: 9001 },
      positions: [], damage: 10, counterDamage: 0, capturedCity: false, knockedDownUnitIds: [] }], content);
    expect(next.expansion!.discoveries![0].includes('domestication')).toBe(expected);
  }
});

test('victory targets scale with the round limit in v21 only; 100 rounds keeps the old numbers', () => {
  const old = { contestMinimum: 500, faithMinimumCities: 6, championshipTitles: 2, pokedexBonus: 0 };
  expect(victoryTargets({ gameplayVersion: 20, roundLimit: 200 })).toEqual(old);
  expect(victoryTargets({ gameplayVersion: 21, roundLimit: 100 })).toEqual(old);
  expect(victoryTargets({ gameplayVersion: 21, roundLimit: 200 })).toEqual({ contestMinimum: 2000, faithMinimumCities: 8, championshipTitles: 3, pokedexBonus: 16 });
});

test('a captured former capital gets no capital walls in the preview either (its fallen founder still names it as headquarters)', () => {
  const state = createGame({ ...duel(21), players: [...duel(21).players, { id: 2, controller: 'human', starterId: 'squirtle', leaderId: 'brock' }] });
  const city = state.cities[state.players[1].headquartersCityId];
  state.map.tiles.fill('grassland'); state.units = {}; for (const relation of state.diplomacy) relation.status = 'war'; state.round = 40;
  // Player 2 took player 1's capital; player 1 is out but keeps its headquartersCityId.
  city.ownerId = 2; state.players[1].eliminated = true; state.turnOrder = [0, 2];
  capital(state, 0).position = { q: 3, r: 3 }; capital(state, 2).position = { q: 20, r: 2 }; city.position = { q: 12, r: 8 };
  state.units[9000] = createMapUnit({ kind: 'pokemon', speciesId: 'machop' }, 9000, 0, { q: 11, r: 8 }, OPENING_CONTENT, 0, 1);
  refreshKnowledge(state);
  expect(observe(state, 0).cities.find(item => item.id === city.id)?.headquartersOf).toBe(1);
  const preview = previewAttack(observe(state, 0), 9000, { kind: 'city', id: city.id });
  if (!preview.ok) throw new Error(preview.reason);
  expect(preview.strength!.factors).toContainEqual({ side: 'defense', label: '城墙', value: wallBonus(40) });
  const hp = city.hp;
  resolveAttack(state, 9000, { kind: 'city', id: city.id });
  expect(hp - city.hp).toBeGreaterThanOrEqual(preview.damage.min);
  expect(hp - city.hp).toBeLessThanOrEqual(preview.damage.max);
});

test('fog memory: a ball a rival picks up out of your sight stays on your map until you see the tile again', () => {
  const state = createGame(duel(21));
  // A ball player 0 cannot see from the start.
  const index = Object.keys(state.expansion!.opening!.itemBalls).map(Number).find(tile => !visibleTiles(state, 0).has(tile))!;
  expect(index).toBeDefined();
  const hex = indexToHex(index, state.map), next = { q: hex.q, r: hex.r + 1 };
  const shown = () => observe(state, 0).expansion!.opening!.itemBalls.some(item => item.tileIndex === index);
  expect(shown()).toBe(false);
  // A scout of player 0 passes next to it, then leaves.
  state.units[9000] = createMapUnit({ kind: 'pokemon', speciesId: 'pidgey' }, 9000, 0, next, OPENING_CONTENT);
  refreshKnowledge(state);
  expect(shown()).toBe(true);
  delete state.units[9000];
  refreshKnowledge(state);
  expect(visibleTiles(state, 0).has(index)).toBe(false);
  expect(shown()).toBe(true);
  // The view never says what is inside.
  expect(observe(state, 0).expansion!.opening!.itemBalls.every(item => Object.keys(item).join() === 'tileIndex')).toBe(true);
  // Player 1 picks it up out of player 0's sight: player 0 still remembers a ball there.
  state.units[9001] = createMapUnit({ kind: 'pokemon', speciesId: 'rattata' }, 9001, 1, hex, OPENING_CONTENT);
  expect(recordOpening(state, []).some(event => event.type === 'ItemBallClaimed' && event.tileIndex === index)).toBe(true);
  refreshKnowledge(state);
  expect(shown()).toBe(true);
  expect(observe(state, 1).expansion!.opening!.itemBalls.some(item => item.tileIndex === index)).toBe(false);
  // Player 0 looks again: the ball is gone.
  state.units[9002] = createMapUnit({ kind: 'pokemon', speciesId: 'pidgey' }, 9002, 0, next, OPENING_CONTENT);
  refreshKnowledge(state);
  expect(shown()).toBe(false);
});
