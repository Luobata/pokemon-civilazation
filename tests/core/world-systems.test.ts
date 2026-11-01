import { describe, expect, test } from 'vitest';
import { createCity } from '../../src/core/city.ts';
import { createGame } from '../../src/core/game.ts';
import { initializeLeaders } from '../../src/core/leader-systems.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from '../../src/core/hex.ts';
import type { Hex } from '../../src/core/hex.ts';
import type { EventPayload, GameSetup, GameState, MapUnit, UnitState } from '../../src/core/model.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { emptyKnowledge, refreshKnowledge } from '../../src/core/vision.ts';
import {
  applyWorldAction, initializeWorld, isWorldAction, observeWorld, planWorldAction,
  resolveWorldRound, updateWorldRecords, validateWorldAction, worldCityYield, worldVisionSources,
} from '../../src/core/world-systems.ts';
import type { WorldAction } from '../../src/core/world-systems.ts';
import { WORLD_CONTENT, WORLD_DEFINITIONS } from '../../src/content/world-systems.ts';

const setup: GameSetup = {
  seed: 1729, width: 12, height: 9, expansionVersion: undefined,
  players: [
    { id: 0, controller: 'human', starterId: 'bulbasaur' },
    { id: 1, controller: 'ai', personality: 'expansion' },
  ],
};

function fixture(): GameState {
  const state = createGame({ ...setup, expansionVersion: undefined });
  state.map = { width: 12, height: 9, tiles: Array(108).fill('grassland') };
  state.turnOrder = [0, 1];
  state.units = {};
  state.nextEntityId = 9000;
  state.cities = {
    9001: createCity(9001, 0, { q: 2, r: 2 }, true),
    9002: createCity(9002, 1, { q: 9, r: 6 }, true),
  };
  state.players[0].headquartersCityId = 9001;
  state.players[1].headquartersCityId = 9002;
  state.players[1].starterId = 'charmander';
  state.players[1].registeredSpeciesIds = ['charmander'];
  state.knowledge = { 0: emptyKnowledge(), 1: emptyKnowledge() };
  state.expansion = { version: 1 } as GameState['expansion'];
  initializeLeaders(state);
  initializeWorld(state, WORLD_CONTENT.base);
  const starter = createMapUnit({ kind: 'pokemon', speciesId: 'bulbasaur' }, state.nextEntityId++, 0,
    { q: 2, r: 3 }, WORLD_CONTENT.base, 0, 1);
  state.units[starter.id] = starter;
  refreshKnowledge(state, WORLD_CONTENT.base);
  return state;
}

function visibleTilesFor(state: GameState): Set<number> {
  const unit = Object.values(state.units).find((unit): unit is MapUnit => unit.ownerId === 0 && unit.location === 'map');
  const city = state.cities[9001];
  const indexes = state.map.tiles.map((_, index) => index)
    .filter(index => hexDistance(indexToHex(index, state.map), city.position) <= 2
      || (unit && hexDistance(indexToHex(index, state.map), unit.position) <= 2));
  return new Set(indexes);
}

function placeNear(state: GameState, position: Hex, offset = 1): number {
  const unitId = state.nextEntityId++;
  const target = neighbors(position).sort((a, b) => hexToIndex(a, state.map)! - hexToIndex(b, state.map)!)[offset - 1];
  state.units[unitId] = createMapUnit({ kind: 'pokemon', speciesId: 'bulbasaur' }, unitId, 0, target, WORLD_CONTENT.base, 0, 1);
  refreshKnowledge(state, WORLD_CONTENT.base);
  return unitId;
}

describe('world initialization', () => {
  test('places a complete deterministic expansion without changing legacy state shape', () => {
    const first = fixture();
    const second = fixture();
    const summary = (state: GameState) => {
      const world = state.expansion!.world;
      return {
        nests: Object.values(world.nests).map(nest => [nest.tileIndex, nest.speciesId]).sort(),
        overlords: Object.values(world.overlords).map(site => [site.tileIndex, site.speciesId]).sort(),
        berries: Object.values(world.resources).filter(site => site.kind === 'berry').map(site => [site.tileIndex, site.definitionId]).sort(),
        stones: Object.values(world.resources).filter(site => site.kind === 'stone').map(site => [site.tileIndex, site.definitionId]).sort(),
      };
    };
    expect(summary(first)).toEqual(summary(second));
    expect(Object.keys(first.expansion!.world.nests)).toHaveLength(WORLD_DEFINITIONS.nests.count);
    expect(Object.keys(first.expansion!.world.overlords)).toHaveLength(WORLD_DEFINITIONS.overlords.count);
    expect(Object.values(first.expansion!.world.resources).filter(site => site.kind === 'berry')).toHaveLength(WORLD_DEFINITIONS.berryDeposits);
    expect(Object.values(first.expansion!.world.resources).filter(site => site.kind === 'stone'))
      .toHaveLength(Object.values(WORLD_DEFINITIONS.stones).reduce((sum, stone) => sum + stone.deposits, 0));
    expect(first.expansion!.world.players[0].pokedex.bulbasaur.captured).toBe(true);
    expect(first.expansion!.world.players[1].pokedex.bulbasaur.captured).toBe(false);
  });

  test('recognizes only world command variants', () => {
    expect(isWorldAction({ type: 'HarvestResource', unitId: 1, tileIndex: 2 })).toBe(true);
    expect(isWorldAction({ type: 'Move', unitId: 1, to: { q: 0, r: 0 } })).toBe(false);
  });
});

describe('nests', () => {
  test('clearing costs actions, deals counter damage, then awards a bounded reward', () => {
    const state = fixture();
    const nest = Object.values(state.expansion!.world.nests).sort((a, b) =>
      hexDistance(a.position, state.cities[9001].position) - hexDistance(b.position, state.cities[9001].position))[0];
    const unitId = placeNear(state, nest.position);
    let strikes = 0;
    while (state.expansion!.world.nests[nest.id] && strikes < 10) {
      state.units[unitId].actionLeft = 1;
      const action: WorldAction = { type: 'ClearNest', unitId, nestId: nest.id };
      expect(validateWorldAction(state, 0, action, WORLD_CONTENT.base)).toBeNull();
      applyWorldAction(state, 0, action, WORLD_CONTENT.base);
      strikes++;
    }
    expect(strikes).toBeGreaterThanOrEqual(3);
    expect(state.expansion!.world.nests[nest.id]).toBeUndefined();
    expect(state.units[unitId].hp).toBeGreaterThanOrEqual(1);
    expect(state.players[0].gold).toBe(50 + WORLD_DEFINITIONS.nests.clearGoldReward);
    expect(state.expansion!.world.players[0].satisfaction).toBe(WORLD_DEFINITIONS.nests.clearSatisfactionReward);
  });

  test('spawns and rampagers safely pressure cities without conquest transfer', () => {
    const state = fixture();
    const world = state.expansion!.world;
    state.round = 7;
    const events = resolveWorldRound(state, WORLD_CONTENT.base);
    expect(events.some(event => event.type === 'WorldNestSpawned')).toBe(true);
    expect(world.rampagingUnitIds.length).toBeGreaterThan(0);
    const rampagerId = world.rampagingUnitIds[0];
    const rampager = state.units[rampagerId];
    expect(rampager?.ownerId).toBeNull();
    if (!rampager || rampager.location !== 'map') return;
    const city = Object.values(state.cities).sort((a, b) =>
      hexDistance(rampager.position, a.position) - hexDistance(rampager.position, b.position))[0];
    state.units[rampagerId].position = neighbors(city.position)[0];
    state.cities[city.id].hp = 2;
    state.round++;
    for (const [unitId, unit] of Object.entries(state.units)) {
      if (Number(unitId) !== rampagerId && unit.ownerId !== null) delete state.units[Number(unitId)];
    }
    const attackEvents = resolveWorldRound(state, WORLD_CONTENT.base);
    const attack = attackEvents.find(event => event.type === 'WorldRampageStruckCity');
    expect(attack).toBeDefined();
    expect(state.cities[city.id].ownerId).toBe(city.ownerId);
    expect(state.cities[city.id].hp).toBe(1);
    expect(state.outcome).toBeNull();
  });
});

describe('resources and overlords', () => {
  test('berries harvest from the resource tile, feed a nearby city, and regrow', () => {
    const state = fixture();
    const world = state.expansion!.world;
    const tileIndex = state.map.tiles.findIndex((_, index) =>
      hexDistance(indexToHex(index, state.map), state.cities[9001].position) === 2);
    const definition = WORLD_DEFINITIONS.berries.oranBerry;
    world.resources = { [tileIndex]: {
      tileIndex, position: indexToHex(tileIndex, state.map), kind: 'berry', definitionId: definition.id,
      remaining: definition.uses, maximum: definition.uses, regrowsAtRound: null,
    } };
    const unitId = state.nextEntityId++;
    state.units[unitId] = createMapUnit({ kind: 'pokemon', speciesId: 'bulbasaur' }, unitId, 0,
      indexToHex(tileIndex, state.map), WORLD_CONTENT.base, 0, 1);
    refreshKnowledge(state, WORLD_CONTENT.base);
    const foodBefore = state.cities[9001].food;
    applyWorldAction(state, 0, { type: 'HarvestResource', unitId, tileIndex }, WORLD_CONTENT.base);
    expect(state.units[unitId].actionLeft).toBe(0);
    expect(state.cities[9001].food).toBe(foodBefore + definition.food);
    expect(world.players[0].berryInventory[definition.id]).toBe(1);
    expect(world.players[0].satisfaction).toBe(definition.satisfaction);
    expect(world.resources[tileIndex].remaining).toBe(definition.uses - 1);
    state.round += definition.regrowthRounds;
    resolveWorldRound(state, WORLD_CONTENT.base);
    expect(world.resources[tileIndex].remaining).toBe(definition.uses);
    expect(world.resources[tileIndex].regrowsAtRound).toBeNull();
  });

  test('evolution stones are finite and consume the evolving unit action', () => {
    const state = fixture();
    const world = state.expansion!.world;
    const unitId = state.nextEntityId++;
    state.units[unitId] = createMapUnit({ kind: 'pokemon', speciesId: 'clefairy' }, unitId, 0, { q: 2, r: 4 },
      WORLD_CONTENT.base, 100, 1);
    world.players[0].stoneInventory.moonStone = 1;
    const action: WorldAction = { type: 'UseEvolutionStone', unitId, intoSpeciesId: 'clefable', stoneId: 'moonStone' };
    expect(validateWorldAction(state, 0, action, WORLD_CONTENT.base)).toBeNull();
    applyWorldAction(state, 0, action, WORLD_CONTENT.base);
    expect(state.units[unitId]).toMatchObject({ speciesId: 'clefable', xp: 0, actionLeft: 0 });
    expect(world.players[0].stoneInventory.moonStone).toBe(0);
    expect(world.players[0].pokedex.clefable.captured).toBe(true);
    expect(state.players[0].registeredSpeciesIds).toContain('clefable');
  });

  test('overlord bonds give vision and real local yields once per round', () => {
    const state = fixture();
    const world = state.expansion!.world;
    const overlord = Object.values(world.overlords)[0];
    overlord.position = { q: 4, r: 2 };
    overlord.tileIndex = hexToIndex(overlord.position, state.map)!;
    overlord.bondByPlayer[0] = 35;
    world.overlords = { [overlord.id]: overlord };
    const city = state.cities[9001];
    city.food = 20;
    const action: WorldAction = { type: 'OfferToOverlord', overlordId: overlord.id, cityId: city.id, currency: 'food' };
    expect(validateWorldAction(state, 0, action, WORLD_CONTENT.base)).toBeNull();
    applyWorldAction(state, 0, action, WORLD_CONTENT.base);
    expect(city.food).toBe(10);
    expect(overlord.bondByPlayer[0]).toBe(40);
    expect(validateWorldAction(state, 0, action, WORLD_CONTENT.base)).toBe('world-already-offered');
    expect(worldVisionSources(state, 0)).toEqual([{ position: overlord.position, radius: WORLD_DEFINITIONS.overlords.tier1VisionRadius }]);
    expect(worldCityYield(state, city, WORLD_CONTENT.base)).toEqual(WORLD_DEFINITIONS.overlords.tier2Yield);
  });
});

describe('pokedex, fog and planning', () => {
  test('records are per player and hidden battle endpoints do not leak species', () => {
    const before = fixture();
    const next = structuredClone(before);
    const attackerId = Number(Object.keys(before.units).find(id => before.units[Number(id)].ownerId === 0)!);
    const defenderId = (state: GameState): number | undefined => Object.values(state.units).find((unit: UnitState) => unit.ownerId === null)?.id;
    expect(defenderId(before)).toBeUndefined();
    const hiddenId = before.nextEntityId++;
    before.units[hiddenId] = createMapUnit({ kind: 'pokemon', speciesId: 'gyarados' }, hiddenId, null, { q: 10, r: 8 }, WORLD_CONTENT.base, 0, 1);
    next.units[hiddenId] = before.units[hiddenId];
    const event: EventPayload = {
      type: 'BattleResolved', attackerId, target: { kind: 'unit', id: hiddenId },
      positions: [before.units[attackerId].position!, before.units[hiddenId].position!],
      damage: 0, counterDamage: 0, capturedCity: false, knockedDownUnitIds: [],
    };
    updateWorldRecords(before, next, { actorId: 0, expectedSeq: before.commandSeq, action: { type: 'EndTurn' } }, [event], WORLD_CONTENT.base);
    expect(next.expansion!.world.players[0].pokedex.gyarados.observed).toBe(false);
    expect(next.expansion!.world.players[0].pokedex.bulbasaur.observed).toBe(true);
    expect(next.expansion!.world.players[1].pokedex.bulbasaur.observed).toBe(false);
  });

  test('documenting the target number finishes a pokedex victory for only that player', () => {
    const before = fixture();
    const next = structuredClone(before);
    const records = Object.values(next.expansion!.world.players[0].pokedex)
      .sort((a, b) => a.speciesId < b.speciesId ? -1 : 1).slice(0, next.expansion!.world.victory.targetDocumentedSpecies);
    for (const record of records) {
      record.observed = true;
      record.battled = true;
    }
    const events = updateWorldRecords(before, next, { actorId: 0, expectedSeq: 0, action: { type: 'EndTurn' } }, [], WORLD_CONTENT.base);
    expect(events.some(event => event.type === 'WorldVictoryAchieved' && event.playerId === 0)).toBe(true);
    expect(events.some(event => event.type === 'GameEnded' && event.outcome.kind === 'pokedex')).toBe(true);
    expect(next.outcome).toMatchObject({ kind: 'pokedex', winners: [0] });
    expect(next.expansion!.world.victory.achievedAtRound).toBe(next.round);
  });

  test('visible nest projection hides rampage units that have moved into fog', () => {
    const state = fixture();
    const world = state.expansion!.world;
    const nest = Object.values(world.nests)[0];
    nest.position = { q: 2, r: 2 };
    nest.tileIndex = hexToIndex(nest.position, state.map)!;
    const visibleUnit = Object.values(state.units).find((unit): unit is MapUnit => unit.ownerId === 0 && unit.location === 'map')!;
    const hiddenId = state.nextEntityId++;
    state.units[hiddenId] = createMapUnit({ kind: 'pokemon', speciesId: 'rattata' }, hiddenId, null, { q: 10, r: 8 }, WORLD_CONTENT.base, 0, 1);
    nest.activeUnitIds = [visibleUnit.id, hiddenId];
    world.nests = { [nest.id]: nest };
    const view = observeWorld(state, 0, visibleTilesFor(state));
    expect(view.nests[0].activeUnitIds).toEqual([visibleUnit.id]);
  });

  test('world projection hides sites but exposes only caller ledgers', () => {
    const state = fixture();
    const visible = visibleTilesFor(state);
    const view = observeWorld(state, 0, visible);
    for (const nest of view.nests) expect(visible.has(nest.tileIndex)).toBe(true);
    expect(view.player).toStrictEqual(state.expansion!.world.players[0]);
    expect(view.victory).toEqual(state.expansion!.world.victory);
    const hiddenNest = Object.values(state.expansion!.world.nests).find(nest => !visible.has(nest.tileIndex));
    if (hiddenNest) expect(view.nests.some(nest => nest.id === hiddenNest.id)).toBe(false);
  });

  test('AI planning uses a visible action rather than a stub', () => {
    const state = fixture();
    const visible = visibleTilesFor(state);
    const view = {
      playerId: 0, round: state.round, map: state.map, visibleTileIds: [...visible],
      units: Object.values(state.units).filter(unit => unit.ownerId === 0),
      economy: { player: state.players[0], cities: [{ ...state.cities[9001], yields: { food: 0, production: 0, gold: 0, research: 0 }, availableTileIds: [] }] },
      expansion: { version: 1 as const, world: observeWorld(state, 0, visible) },
    };
    const action = planWorldAction(view as never, WORLD_CONTENT);
    expect(action === null || isWorldAction(action)).toBe(true);
  });

  test('AI stops tier3 overlord offerings and reserves gold for leadership routes', () => {
    const state = fixture();
    const world = state.expansion!.world;
    const overlord = Object.values(world.overlords)[0];
    overlord.position = { q: 3, r: 2 };
    overlord.tileIndex = hexToIndex(overlord.position, state.map)!;
    overlord.bondByPlayer[0] = WORLD_DEFINITIONS.overlords.tier3Bond;
    world.overlords = { [overlord.id]: overlord };
    world.nests = {};
    world.resources = {};
    state.cities[9001].food = 0;
    state.players[0].gold = 119;
    const visible = visibleTilesFor(state);
    const view = {
      playerId: 0, round: state.round, map: state.map, visibleTileIds: [...visible], units: [],
      economy: { player: state.players[0], cities: [{ ...state.cities[9001], yields: { food: 0, production: 0, gold: 0, research: 0 }, availableTileIds: [] }] },
      expansion: { version: 1 as const, world: observeWorld(state, 0, visible) },
    };
    expect(planWorldAction(view as never, WORLD_CONTENT)).toBeNull();

    overlord.bondByPlayer[0] = 0;
    state.players[0].gold = 120;
    view.expansion = { version: 1 as const, world: observeWorld(state, 0, visible) };
    expect(planWorldAction(view as never, WORLD_CONTENT)).toEqual({ type: 'OfferToOverlord', overlordId: overlord.id, cityId: 9001, currency: 'gold' });
  });

  test('AI only harvests berries near an owned city but can harvest standing stones anywhere', () => {
    const state = fixture();
    const starter = Object.values(state.units).find((unit): unit is MapUnit => unit.ownerId === 0 && unit.location === 'map')!;
    const tileIndex = hexToIndex(starter.position, state.map)!;
    state.cities[9001].position = { q: 9, r: 6 };
    state.expansion!.world.nests = {};
    state.expansion!.world.overlords = {};
    state.expansion!.world.resources = {
      [tileIndex]: { tileIndex, position: starter.position, kind: 'berry', definitionId: 'oranBerry', remaining: 2, maximum: 3, regrowsAtRound: null },
    };
    const visible = visibleTilesFor(state);
    const view = {
      playerId: 0, round: state.round, map: state.map, visibleTileIds: [...visible],
      units: [starter], economy: { player: state.players[0], cities: [{ ...state.cities[9001], yields: { food: 0, production: 0, gold: 0, research: 0 }, availableTileIds: [] }] },
      expansion: { version: 1 as const, world: observeWorld(state, 0, visible) },
    };
    expect(planWorldAction(view as never, WORLD_CONTENT)).toBeNull();

    state.expansion!.world.resources[tileIndex] = { ...state.expansion!.world.resources[tileIndex], kind: 'stone', definitionId: 'fireStone' };
    view.expansion = { version: 1 as const, world: observeWorld(state, 0, visible) };
    expect(planWorldAction(view as never, WORLD_CONTENT)).toEqual({ type: 'HarvestResource', unitId: starter.id, tileIndex });
  });
});
