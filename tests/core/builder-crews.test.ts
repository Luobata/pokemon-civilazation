import { expect, test } from 'vitest';
import { IMPROVEMENT_CONTENT, WORLD_CONTENT } from '../../src/content/units.ts';
import type { SpeciesId } from '../../src/content/units.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';
import { CREW_SPECIALTIES, CREW_SPECIALTY_IDS, IMPROVEMENT_RULES_V23, crewSpecialtyFor } from '../../src/content/improvements.ts';
import type { TypeId } from '../../src/content/species.ts';
import { createGame } from '../../src/core/game.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { hexDistance, indexToHex } from '../../src/core/hex.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { workedTileYield } from '../../src/core/city.ts';
import { improvementOptions } from '../../src/core/improvements.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';

const duel = (gameplayVersion: GameplayVersion): GameSetup => ({ seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1', gameplayVersion,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'misty' }] });
const act = (state: GameState, action: Command['action']) => step(state, { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action });
const hq = (state: GameState) => state.cities[state.players[0].headquartersCityId];

function crewSite(escortId: SpeciesId, biome = 'grassland') {
  const state = createGame(duel(23)), capital = hq(state);
  const tileIndex = state.map.tiles.findIndex((tile, index) => tile === biome && hexDistance(indexToHex(index, state.map), capital.position, state.map) === 1
    && !state.expansion!.world.resources[index] && !state.expansion!.rareBerries!.deposits[index]);
  expect(tileIndex).toBeGreaterThanOrEqual(0);
  const builder = createMapUnit({ kind: 'logistics', role: 'builder', escortId }, 9000, 0, indexToHex(tileIndex, state.map), IMPROVEMENT_CONTENT, 0, 1);
  builder.charges = 3; state.units[9000] = builder; refreshKnowledge(state);
  return { state, tileIndex };
}

test('every type maps to exactly one specialty', () => {
  const types: TypeId[] = ['grass', 'fire', 'water', 'electric', 'normal', 'fighting', 'flying', 'rock', 'psychic', 'ghost', 'dragon', 'ground', 'poison', 'bug', 'ice', 'steel', 'dark', 'fairy'];
  for (const type of types) expect(CREW_SPECIALTY_IDS.filter(id => CREW_SPECIALTIES[id].types.includes(type))).toEqual([crewSpecialtyFor(type)]);
});

test('v23 trains builders with a registered escort; v22 refuses the escort', () => {
  const state = createGame(duel(23)), city = hq(state), escortId = state.players[0].registeredSpeciesIds[0] as SpeciesId;
  expect(act(state, { type: 'SetProductionQueue', cityId: city.id, orders: [{ item: { kind: 'logistics', defId: 'builder', escortId } }] }).ok).toBe(true);
  expect(act(state, { type: 'SetProductionQueue', cityId: city.id, orders: [{ item: { kind: 'logistics', defId: 'builder', escortId: 'dragonite' } }] }).ok).toBe(false);
  const old = createGame(duel(22));
  expect(act(old, { type: 'SetProductionQueue', cityId: hq(old).id, orders: [{ item: { kind: 'logistics', defId: 'builder', escortId } }] }).ok).toBe(false);
  expect(WORLD_CONTENT.builderCrews).toBeUndefined();
});

test('a garden crew records its specialty on the tile and adds food there', () => {
  const { state, tileIndex } = crewSite('bulbasaur');
  const built = act(state, { type: 'ImproveTile', unitId: 9000, tileIndex, kind: 'berryFarm' });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  expect(built.state.expansion!.improvements!.tiles[tileIndex]).toMatchObject({ kind: 'berryFarm', crew: 'garden' });
  const plain = createGame(duel(23));
  plain.expansion!.improvements!.tiles[tileIndex] = { kind: 'berryFarm', builtBy: 0, builtAtRound: 0 };
  expect(workedTileYield(built.state, tileIndex, built.state.players[0], IMPROVEMENT_CONTENT).food)
    .toBe(workedTileYield(plain, tileIndex, plain.players[0], IMPROVEMENT_CONTENT).food + 1);
  // The bonus stays on the tile after the builder is gone.
  delete built.state.units[9000];
  expect(built.state.expansion!.improvements!.tiles[tileIndex].crew).toBe('garden');
});

test('a fire crew (开荒) sends production to the nearest own city on each build', () => {
  const { state, tileIndex } = crewSite('charmander');
  const built = act(state, { type: 'ImproveTile', unitId: 9000, tileIndex, kind: 'berryFarm' });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  expect(built.state.expansion!.civilization.pendingProductionByCity[hq(state).id]).toEqual({ playerId: 0, amount: IMPROVEMENT_RULES_V23.clearingProduction });
  expect(built.events.map(event => event.payload.type)).toContain('CrewClearing');
});

test('a water crew (引水) reaches ocean tiles two away', () => {
  const state = createGame(duel(23)), capital = hq(state);
  // Make a coastal tile two steps from a land tile next to the capital (this seed's capital is inland).
  const stand = capital.workedTileIds.find(index => state.map.tiles[index] !== 'ocean') ?? state.map.tiles.findIndex((tile, index) => tile !== 'ocean' && hexDistance(indexToHex(index, state.map), capital.position, state.map) === 1);
  const ocean = state.map.tiles.findIndex((_, index) => hexDistance(indexToHex(index, state.map), indexToHex(stand, state.map), state.map) === 2
    && hexDistance(indexToHex(index, state.map), capital.position, state.map) === 2 && !state.expansion!.world.resources[index] && !state.expansion!.rareBerries!.deposits[index]);
  expect(ocean).toBeGreaterThanOrEqual(0);
  state.map.tiles[ocean] = 'ocean';
  for (const [escortId, reach] of [['squirtle', true], ['geodude', false]] as const) {
    const builder = createMapUnit({ kind: 'logistics', role: 'builder', escortId }, 9000, 0, indexToHex(stand, state.map), IMPROVEMENT_CONTENT, 0, 1);
    state.units[9000] = builder; refreshKnowledge(state);
    expect(improvementOptions(observe(state, 0, IMPROVEMENT_CONTENT), 9000, IMPROVEMENT_CONTENT).some(option => option.tileIndex === ocean)).toBe(reach);
  }
});

test('a handy crew (巧手) repairs without spending its action', () => {
  const { state, tileIndex } = crewSite('gastly');
  state.expansion!.improvements!.tiles[tileIndex] = { kind: 'berryFarm', builtBy: 0, builtAtRound: 0, damaged: true, damagedAtRound: 0 };
  refreshKnowledge(state);
  const repaired = act(state, { type: 'RepairImprovement', unitId: 9000, tileIndex });
  expect(repaired.ok).toBe(true);
  if (repaired.ok) expect(repaired.state.units[9000]).toMatchObject({ actionLeft: 1, charges: 3 });
});
