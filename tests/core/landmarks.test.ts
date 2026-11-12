import { expect, test } from 'vitest';
import { LANDMARKS } from '../../src/content/terrain.ts';
import { contentFor } from '../../src/content/units.ts';
import { createGame } from '../../src/core/game.ts';
import { generateWorldMap } from '../../src/core/map-v24.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from '../../src/core/hex.ts';
import { workedTileYield } from '../../src/core/city.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { recordLandmarks, resolveLandmarkRound } from '../../src/core/landmarks.ts';
import { habitatWeights } from '../../src/core/wild.ts';
import { onContinent, isPeak, isLandmarkTile } from '../../src/core/terrain.ts';
import { observe } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { isFlying } from '../../src/core/movement.ts';
import type { GameSetup, GameState } from '../../src/core/model.ts';

const setup = (seed = 31, width = 40, height = 26): GameSetup => ({ seed, width, height, roundLimit: 200, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 24,
  players: [0, 1, 2, 3].map(id => ({ id, controller: 'ai' as const, starterId: 'bulbasaur' as const, personality: 'expansion' as const })) });
const around = (state: { map: GameState['map'] }, index: number) => neighbors(indexToHex(index, state.map), state.map).map(hex => hexToIndex(hex, state.map)!).filter(i => i !== null);

test('landmarks: one per 110 land tiles, unique kinds, on their terrain, ≥ 4 from starts and ≥ 6 apart', () => {
  for (const seed of [31, 32, 33, 34]) {
    const map = generateWorldMap({ seed, width: 40, height: 26, playerCount: 4 }), sites = map.features!.landmarks;
    const land = map.tiles.filter(tile => tile !== 'ocean').length;
    expect(sites.length).toBeLessThanOrEqual(Math.floor(land / 110));
    expect(sites.length).toBeGreaterThanOrEqual(Math.floor(land / 110) - 1);
    expect(new Set(sites.map(site => site.id)).size).toBe(sites.length);
    for (const site of sites) {
      const biome = map.tiles[site.tileIndex], kind = LANDMARKS[site.id].site;
      expect(kind === 'lake' ? biome === 'ocean' : kind === 'grasslandHill' ? biome === 'grassland' : kind === 'coastalMountain' ? biome === 'mountain' : biome === kind).toBe(true);
      for (const start of map.starts) expect(hexDistance(indexToHex(start.tileIndex, map), indexToHex(site.tileIndex, map), map)).toBeGreaterThanOrEqual(4);
      for (const other of sites) if (other !== site) expect(hexDistance(indexToHex(other.tileIndex, map), indexToHex(site.tileIndex, map), map)).toBeGreaterThanOrEqual(6);
    }
  }
  expect(generateWorldMap({ seed: 31, width: 24, height: 16, playerCount: 4 }).features!.landmarks.length).toBe(1);
});

test('landmarks: adjacent yields, healing, discovery (era score, first-in-world research, private event)', () => {
  const state = createGame(setup()), content = contentFor(state.setup), site = state.map.features!.landmarks[0];
  const neighbour = around(state, site.tileIndex).find(index => state.map.tiles[index] !== 'ocean' && !isPeak(state.map, index))!;
  const player = state.players[0];
  const withSite = workedTileYield(state, neighbour, player, content);
  const features = state.map.features!;
  state.map.features = { ...features, landmarks: [] };
  const without = workedTileYield(state, neighbour, player, content);
  state.map.features = features;
  const added = LANDMARKS[site.id];
  if (!added.waterOnly) for (const [key, value] of Object.entries(added.adjacent)) expect(withSite[key as 'food'] - without[key as 'food']).toBe(value);
  // Discovery once, with the first-in-world research; nobody else sees the event.
  state.knowledge[0].exploredTileIds = [...new Set([...state.knowledge[0].exploredTileIds, site.tileIndex])].sort((a, b) => a - b);
  const reserve = player.research.reserve, score = state.expansion!.eraHonors!.players[0].score;
  const events = recordLandmarks(state, []);
  expect(events).toContainEqual({ type: 'LandmarkDiscovered', playerId: 0, landmarkId: site.id, tileIndex: site.tileIndex, first: true });
  expect(player.research.reserve).toBe(reserve + 15);
  expect(state.expansion!.eraHonors!.players[0].score).toBe(score + 1);
  expect(recordLandmarks(state, []).filter(event => event.type === 'LandmarkDiscovered' && event.playerId === 0)).toEqual([]);
  expect(observe(state, 0).expansion!.landmarks!.discovered).toContain(site.id);
  // Elder Canopy healing (on a test copy of the ledger).
  state.map.features = { ...features, landmarks: [{ tileIndex: site.tileIndex, id: 'elderCanopy' }] };
  state.units[9000] = { ...createMapUnit({ kind: 'pokemon', speciesId: 'machop' }, 9000, 0, indexToHex(neighbour, state.map), content, 0, 1), hp: 20 };
  resolveLandmarkRound(state, content);
  expect(state.units[9000].hp).toBe(30);
});

test('world sites: nests, overlords, sanctuaries, item balls and legend traces sit on passable continental land; 2 + 2 sanctuaries', () => {
  for (const seed of [31, 35]) {
    const state = createGame(setup(seed)), map = state.map, world = state.expansion!.world;
    const passable = (index: number) => map.tiles[index] !== 'ocean' && !isPeak(map, index) && !isLandmarkTile(map, index);
    for (const index of [...Object.values(world.nests).map(site => site.tileIndex), ...Object.values(world.overlords).map(site => site.tileIndex),
      ...Object.keys(state.expansion!.opening!.itemBalls).map(Number), ...(Object.values(state.expansion!.legends?.sites ?? {}) as number[]),
      ...state.expansion!.civilization.sanctuaries.map(site => hexToIndex(site.position, map)!)]) {
      expect(passable(index)).toBe(true);
      expect(onContinent(map, index)).toBe(true);
    }
    for (const index of Object.keys(world.resources).map(Number)) expect(passable(index)).toBe(true);
    // Each continent (with two capitals) has two sanctuaries.
    const capitals = Object.values(state.cities).map(city => hexToIndex(city.position, map)!);
    const sameMass = (a: number, b: number) => { const seen = new Set([a]), queue = [a]; for (let k = 0; k < queue.length; k++) for (const n of around(state, queue[k])) if (!seen.has(n) && map.tiles[n] !== 'ocean') { seen.add(n); queue.push(n); } return seen.has(b); };
    for (const capital of capitals) {
      expect(state.expansion!.civilization.sanctuaries.filter(site => sameMass(capital, hexToIndex(site.position, map)!)).length).toBe(2);
    }
  }
});

test('habitats: hills, rivers, deep water and landmark residents change the table; v24 spawns respect peaks and landmarks', () => {
  const state = createGame(setup()), content = contentFor(state.setup), f = state.map.features!;
  const hill = f.hills.find(index => state.map.tiles[index] === 'grassland')!;
  expect(habitatWeights(state, hill, content).geodude).toBeGreaterThanOrEqual(15);
  const deep = f.deep.find(index => Math.floor(index / state.map.width) > 0 && Math.floor(index / state.map.width) < state.map.height - 1)!;
  const deepTable = habitatWeights(state, deep, content);
  expect(deepTable.squirtle).toBeUndefined();
  expect(deepTable.lapras).toBe(30);
  const site = f.landmarks[0], beside = around(state, site.tileIndex)[0];
  for (const resident of LANDMARKS[site.id].residents) expect(habitatWeights(state, beside, content)[resident]).toBeGreaterThanOrEqual(50);
  // A real game for 20 rounds: wild Pokémon never stand on peaks or landmarks.
  let current = state;
  for (let k = 0; k < 80 && current.round < 10; k++) {
    const result = step(current, { actorId: current.activePlayerId, expectedSeq: current.commandSeq, action: { type: 'EndTurn' } });
    if (!result.ok) break;
    current = result.state;
  }
  for (const unit of Object.values(current.units)) if (unit.position) {
    const index = hexToIndex(unit.position, current.map)!;
    expect(isPeak(current.map, index) && !isFlying(unit, content)).toBe(false);
    expect(isLandmarkTile(current.map, index)).toBe(false);
  }
});
