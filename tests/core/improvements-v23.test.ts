import { expect, test } from 'vitest';
import { IMPROVEMENT_CONTENT, WORLD_CONTENT } from '../../src/content/units.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';
import type { TechId } from '../../src/content/economy.ts';
import { IMPROVEMENT_RULES_V23 } from '../../src/content/improvements.ts';
import { createGame } from '../../src/core/game.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { hexDistance, indexToHex } from '../../src/core/hex.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { gameVersions } from '../../src/core/versions.ts';
import { cityYield, workedTileYield } from '../../src/core/city.ts';
import { improvementOptions, resolveImprovementRound } from '../../src/core/improvements.ts';
import { ownedRareBerries } from '../../src/core/rare-berries.ts';
import { validateWorldAction } from '../../src/core/world-systems.ts';
import { parseAuditAction } from '../../src/audit/commands.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';

const duel = (gameplayVersion: GameplayVersion): GameSetup => ({ seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1', gameplayVersion,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'misty' }] });
const act = (state: GameState, action: Command['action']) => step(state, { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action });
const hq = (state: GameState) => state.cities[state.players[0].headquartersCityId];
const contentOf = (version: GameplayVersion) => version >= 23 ? IMPROVEMENT_CONTENT : WORLD_CONTENT;

/** A builder on a land tile next to the capital (worked by it), with optional techs and a planted resource. */
function site(version: GameplayVersion, options: { techs?: TechId[]; resource?: 'berry' | 'stone' | 'rare'; biome?: string } = {}) {
  const state = createGame(duel(version)), capital = hq(state);
  const tileIndex = capital.workedTileIds.find(index => state.map.tiles[index] === (options.biome ?? 'grassland'))
    ?? state.map.tiles.findIndex((biome, index) => biome === (options.biome ?? 'grassland') && hexDistance(indexToHex(index, state.map), capital.position, state.map) === 1);
  expect(tileIndex).toBeGreaterThanOrEqual(0);
  const position = indexToHex(tileIndex, state.map);
  // Clear any world resource / rare berry already there, then plant the requested one.
  delete state.expansion!.world.resources[tileIndex];
  delete state.expansion!.rareBerries!.deposits[tileIndex];
  if (options.resource === 'berry') state.expansion!.world.resources[tileIndex] = { tileIndex, position, kind: 'berry', definitionId: 'oranBerry', remaining: 3, maximum: 3, regrowsAtRound: null };
  if (options.resource === 'stone') state.expansion!.world.resources[tileIndex] = { tileIndex, position, kind: 'stone', definitionId: 'fireStone', remaining: 1, maximum: 1, regrowsAtRound: null };
  if (options.resource === 'rare') state.expansion!.rareBerries!.deposits[tileIndex] = 'petaya';
  state.players[0].research.unlockedIds.push(...(options.techs ?? []));
  for (const unit of Object.values(state.units)) if (unit.ownerId === 0 && unit.kind === 'logistics') delete state.units[unit.id];
  const builder = createMapUnit({ kind: 'logistics', role: 'builder' }, 9000, 0, position, contentOf(version), 0, 1);
  builder.charges = 3;
  state.units[9000] = builder;
  if (!capital.workedTileIds.includes(tileIndex)) { capital.workedTileIds = [...capital.workedTileIds.slice(0, Math.max(0, capital.population - 1)), tileIndex].sort((a, b) => a - b); }
  refreshKnowledge(state);
  return { state, capital, tileIndex, position };
}
const options = (state: GameState) => improvementOptions(observe(state, 0), 9000, contentOf((state.setup.gameplayVersion ?? 0) as GameplayVersion)).map(item => item.kind);

test('v23 envelope: schema 18, its own content, three improvement flags', () => {
  expect(gameVersions({ gameplayVersion: 23 })).toEqual({ schemaVersion: 18, rulesVersion: 'improvements-v23' });
  expect(IMPROVEMENT_CONTENT.version).toBe('improvements-v23');
  expect([IMPROVEMENT_CONTENT.resourceImprovements, IMPROVEMENT_CONTENT.pillage, IMPROVEMENT_CONTENT.builderCrews]).toEqual([true, true, true]);
  expect(WORLD_CONTENT.resourceImprovements).toBeUndefined();
});

test('v23 parser knows the new kinds; v22 content still rejects them', () => {
  expect(parseAuditAction({ type: 'ImproveTile', unitId: 1, tileIndex: 2, kind: 'ranch' }, IMPROVEMENT_CONTENT)).toMatchObject({ kind: 'ranch' });
  expect(() => parseAuditAction({ type: 'ImproveTile', unitId: 1, tileIndex: 2, kind: 'ranch' }, WORLD_CONTENT)).toThrow();
});

test('new tile improvements need their unlocking tech; legacy ones do not', () => {
  const locked = site(23);
  expect(options(locked.state)).toContain('berryFarm');
  expect(options(locked.state)).not.toContain('ranch');
  expect(act(locked.state, { type: 'ImproveTile', unitId: 9000, tileIndex: locked.tileIndex, kind: 'ranch' }).ok).toBe(false);
  const open = site(23, { techs: ['riding'] });
  expect(options(open.state)).toEqual(expect.arrayContaining(['berryFarm', 'ranch']));
  const built = act(open.state, { type: 'ImproveTile', unitId: 9000, tileIndex: open.tileIndex, kind: 'ranch' });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  expect(built.state.expansion!.improvements!.tiles[open.tileIndex]).toMatchObject({ kind: 'ranch', builtBy: 0 });
  const bare = { ...workedTileYield(open.state, open.tileIndex, open.state.players[0], IMPROVEMENT_CONTENT) };
  expect(workedTileYield(built.state, open.tileIndex, built.state.players[0], IMPROVEMENT_CONTENT).production).toBe(bare.production + 1);
});

test('v22 never offers the v23 kinds even with the techs', () => {
  const old = site(22, { techs: ['riding', 'lureCraft', 'oceanography'], resource: 'berry' });
  expect(options(old.state).every(kind => ['berryFarm', 'mine', 'fishery', 'observatoryCamp'].includes(kind))).toBe(true);
  expect(old.state.expansion!.improvements!.tiles).toEqual({});
});

test('resource tiles take only their matching resource improvement', () => {
  const berry = site(23, { techs: ['berryCultivation', 'riding'], resource: 'berry' });
  expect(options(berry.state)).toEqual(['berryGrove']);
  expect(act(berry.state, { type: 'ImproveTile', unitId: 9000, tileIndex: berry.tileIndex, kind: 'berryFarm' }).ok).toBe(false);
  const plain = site(23, { techs: ['berryCultivation'] });
  expect(options(plain.state)).not.toContain('berryGrove');
  const noTech = site(23, { resource: 'berry' });
  expect(options(noTech.state)).toEqual([]);
});

test('berry grove: yield, satisfaction per developed kind, and no harvesting inside own territory', () => {
  const { state, tileIndex } = site(23, { techs: ['berryCultivation'], resource: 'berry' });
  const harvester = createMapUnit({ kind: 'pokemon', speciesId: 'bulbasaur' }, 9001, 0, indexToHex(tileIndex, state.map), IMPROVEMENT_CONTENT, 0, 1);
  state.units[9001] = harvester; refreshKnowledge(state);
  expect(validateWorldAction(state, 0, { type: 'HarvestResource', unitId: 9001, tileIndex }, IMPROVEMENT_CONTENT)).toBe('harvest-own-territory');
  const built = act(state, { type: 'ImproveTile', unitId: 9000, tileIndex, kind: 'berryGrove' });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  const next = built.state, world = next.expansion!.world.players[0];
  world.satisfaction = 40;
  resolveImprovementRound(next);
  expect(world.satisfaction).toBe(40 + IMPROVEMENT_RULES_V23.groveSatisfactionPerKind);
  expect(cityYield(next, hq(next), IMPROVEMENT_CONTENT).gold).toBeGreaterThan(cityYield(state, hq(state), IMPROVEMENT_CONTENT).gold);
});

test('v22 still allows harvesting inside own territory', () => {
  const { state, tileIndex } = site(22, { resource: 'berry' });
  state.units[9001] = createMapUnit({ kind: 'pokemon', speciesId: 'bulbasaur' }, 9001, 0, indexToHex(tileIndex, state.map), WORLD_CONTENT, 0, 1);
  refreshKnowledge(state);
  expect(validateWorldAction(state, 0, { type: 'HarvestResource', unitId: 9001, tileIndex }, WORLD_CONTENT)).toBeNull();
});

test('a developed resource outside your territory cannot be harvested; an undeveloped one can', () => {
  const { state, tileIndex } = site(23, { resource: 'berry' });
  // Player 1 stands on player 0's berry bush with a city of its own within 3 tiles.
  const visitor = createMapUnit({ kind: 'pokemon', speciesId: 'charmander' }, 9101, 1, indexToHex(tileIndex, state.map), IMPROVEMENT_CONTENT, 0, 1);
  state.units[9101] = visitor;
  const p1city = state.cities[state.players[1].headquartersCityId], saved = { ...p1city.position };
  p1city.position = indexToHex(state.map.tiles.findIndex((_, i) => hexDistance(indexToHex(i, state.map), indexToHex(tileIndex, state.map), state.map) === 3
    && hexDistance(indexToHex(i, state.map), hq(state).position, state.map) > 3), state.map);
  refreshKnowledge(state);
  expect(validateWorldAction(state, 1, { type: 'HarvestResource', unitId: 9101, tileIndex }, IMPROVEMENT_CONTENT)).toBeNull();
  state.expansion!.improvements!.tiles[tileIndex] = { kind: 'berryGrove', builtBy: 0, builtAtRound: 1 };
  expect(validateWorldAction(state, 1, { type: 'HarvestResource', unitId: 9101, tileIndex }, IMPROVEMENT_CONTENT)).toBe('harvest-developed');
  p1city.position = saved;
});

test('stone quarry: takes the vein on completion, then a stone every interval while worked', () => {
  const { state, tileIndex } = site(23, { techs: ['stoneCraft'], resource: 'stone' });
  const before = state.expansion!.world.players[0].stoneInventory.fireStone;
  const built = act(state, { type: 'ImproveTile', unitId: 9000, tileIndex, kind: 'stoneQuarry' });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  const next = built.state;
  expect(next.expansion!.world.players[0].stoneInventory.fireStone).toBe(before + 1);
  expect(next.expansion!.world.resources[tileIndex].remaining).toBe(0);
  expect(built.events.map(event => event.payload.type)).toContain('StoneQuarried');
  const builtAt = next.expansion!.improvements!.tiles[tileIndex].builtAtRound;
  next.round = builtAt + IMPROVEMENT_RULES_V23.quarryInterval - 1;
  expect(resolveImprovementRound(next)).toEqual([]);
  next.round = builtAt + IMPROVEMENT_RULES_V23.quarryInterval;
  expect(resolveImprovementRound(next).map(event => event.type)).toEqual(['StoneQuarried']);
  expect(next.expansion!.world.players[0].stoneInventory.fireStone).toBe(before + 2);
});

test('plantation: a worked rare-berry tile counts two copies', () => {
  const { state, tileIndex } = site(23, { techs: ['commerce'], resource: 'rare' });
  const before = ownedRareBerries(state, 0).petaya;
  expect(before).toBe(1);
  const built = act(state, { type: 'ImproveTile', unitId: 9000, tileIndex, kind: 'plantation' });
  expect(built.ok).toBe(true);
  if (built.ok) expect(ownedRareBerries(built.state, 0).petaya).toBe(2);
});
