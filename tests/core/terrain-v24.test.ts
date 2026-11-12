import { expect, test } from 'vitest';
import { contentFor } from '../../src/content/units.ts';
import type { SpeciesId } from '../../src/content/units.ts';
import { createGame } from '../../src/core/game.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { emptyKnowledge, observe, refreshKnowledge, visibleTiles } from '../../src/core/vision.ts';
import { previewAttack } from '../../src/core/preview.ts';
import { resolveAttack } from '../../src/core/combat.ts';
import { cityYield, workCandidates, workedTileYield } from '../../src/core/city.ts';
import { reachablePaths } from '../../src/core/movement.ts';
import { step } from '../../src/core/step.ts';
import { hexToIndex } from '../../src/core/hex.ts';
import type { Hex } from '../../src/core/hex.ts';
import type { GameSetup, GameState } from '../../src/core/model.ts';
import type { MapFeatures } from '../../src/core/terrain.ts';
import { describeTile } from '../../src/browser/tile-info.ts';
import { tileYieldReader } from '../../src/browser/tile-yields.ts';
import { buildScene } from '../../src/browser/render/scene.ts';

const duel = (gameplayVersion: 23 | 24): GameSetup => ({ seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1', gameplayVersion,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'misty' }] });
const empty = (): MapFeatures => ({ hills: [], peaks: [], rivers: [], lakes: [], deep: [], landmarks: [] });
/** A flat grassland arena with the given features; two capitals far apart, one attacker at (9,6), one defender at (10,6). */
function arena(features: Partial<MapFeatures>, attacker: SpeciesId = 'machop', defender: SpeciesId = 'rattata', version: 23 | 24 = 24): GameState {
  const state = createGame(duel(version));
  state.map.tiles.fill('grassland'); state.units = {}; state.diplomacy[0].status = 'war';
  if (version === 24) state.map.features = { ...empty(), ...features };
  else delete state.map.features;
  state.cities[state.players[0].headquartersCityId].position = { q: 3, r: 3 };
  state.cities[state.players[1].headquartersCityId].position = { q: 18, r: 12 };
  for (const city of Object.values(state.cities)) { city.workedTileIds = []; city.lockedTileIds = []; }
  const content = contentFor(state.setup);
  state.knowledge[0] = emptyKnowledge(); state.knowledge[1] = emptyKnowledge();
  state.units[9000] = createMapUnit({ kind: 'pokemon', speciesId: attacker }, 9000, 0, { q: 9, r: 6 }, content, 0, 1);
  state.units[9001] = createMapUnit({ kind: 'pokemon', speciesId: defender }, 9001, 1, { q: 10, r: 6 }, content, 0, 1);
  refreshKnowledge(state);
  return state;
}
const at = (state: GameState, hex: Hex) => hexToIndex(hex, state.map)!;
const preview = (state: GameState) => { const result = previewAttack(observe(state, 0), 9000, { kind: 'unit', id: 9001 }); if (!result.ok) throw new Error(result.reason); return result; };
const labels = (state: GameState) => preview(state).strength!.factors.map(factor => `${factor.label}${factor.value}`);

test('v24 features: hill cover, river crossing, high-ground city in the preview, and the authority stays inside it', () => {
  const plain = arena({}), defenderTile = at(plain, { q: 10, r: 6 });
  const hill = arena({ hills: [defenderTile] });
  expect(labels(hill)).toContain('丘陵掩护3');
  expect(preview(hill).strength!.gap).toBe(preview(plain).strength!.gap - 3);
  // Forest cover (+5) and hill cover do not stack.
  const forestHill = arena({ hills: [defenderTile] }); forestHill.map.tiles[defenderTile] = 'forest'; refreshKnowledge(forestHill);
  expect(labels(forestHill)).toContain('森林掩护5');
  expect(labels(forestHill)).not.toContain('丘陵掩护3');
  // A melee attacker crossing into a river tile; a ranged one does not pay.
  const river = arena({ rivers: [defenderTile] });
  expect(labels(river)).toContain('渡河-5');
  expect(labels(arena({ rivers: [defenderTile] }, 'charmander'))).not.toContain('渡河-5');
  expect(labels(arena({ rivers: [defenderTile, at(plain, { q: 9, r: 6 })] }))).not.toContain('渡河-5');
  // Authority: the hit lies inside the previewed range.
  const range = preview(hill).damage, before = hill.units[9001].hp;
  resolveAttack(hill, 9000, { kind: 'unit', id: 9001 });
  const dealt = before - (hill.units[9001]?.hp ?? 0);
  expect(dealt).toBeGreaterThanOrEqual(range.min); expect(dealt).toBeLessThanOrEqual(range.max);
  // City on a hill.
  const city = arena({}), enemy = city.cities[city.players[1].headquartersCityId];
  city.map.features!.hills = [at(city, enemy.position)];
  city.units[9000].position = { q: 17, r: 12 }; delete city.units[9001]; refreshKnowledge(city);
  const cityPreview = previewAttack(observe(city, 0), 9000, { kind: 'city', id: enemy.id });
  expect(cityPreview.ok && cityPreview.strength!.factors.map(f => f.label)).toContain('高地城池');
  // v23: the same tiles carry no features and no new terms.
  expect(labels(arena({}, 'machop', 'rattata', 23)).some(label => /丘陵|渡河|高地/.test(label))).toBe(false);
});

test('v24 yields: hills +1 production, rivers +1 gold, deep water 1/0/1/0; peaks, landmarks and polar ice are not workable; fresh water', () => {
  const state = arena({}), city = state.cities[state.players[0].headquartersCityId], player = state.players[0];
  const a = at(state, { q: 4, r: 3 }), b = at(state, { q: 3, r: 4 }), c = at(state, { q: 2, r: 3 }), d = at(state, { q: 4, r: 2 });
  state.map.tiles[d] = 'ocean';
  state.map.features = { ...empty(), hills: [a], rivers: [b], peaks: [c], deep: [d] };
  expect(workedTileYield(state, a, player)).toEqual({ food: 2, production: 2, gold: 0, research: 0 });
  expect(workedTileYield(state, b, player)).toEqual({ food: 2, production: 1, gold: 1, research: 0 });
  expect(workedTileYield(state, d, player)).toEqual({ food: 1, production: 0, gold: 1, research: 0 });
  expect(workCandidates(state, city)).not.toContain(c);
  expect(workCandidates(state, city)).toContain(a);
  expect(workCandidates(state, city).some(index => Math.floor(index / state.map.width) === 0)).toBe(false);
  state.map.features = empty();
  const dry = cityYield(state, city).food;
  state.map.features = { ...empty(), rivers: [b] };
  expect(cityYield(state, city).food).toBe(dry + 1);
  state.map.features = { ...empty(), lakes: [b] };
  expect(cityYield(state, city).food).toBe(dry + 1);
});

test('v24 movement: hills cost +1, entering a river from dry land +1, peaks impassable except to flyers; the authority charges the same', () => {
  const state = arena({}, 'rattata'), from = { q: 9, r: 6 }, east = { q: 10, r: 5 }, hill = at(state, east);
  delete state.units[9001]; refreshKnowledge(state);
  state.map.features = { ...empty(), hills: [hill] };
  const result = step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'Move', unitId: 9000, to: east } });
  expect(result.ok && result.state.units[9000].movesSpent).toBe(2);
  state.map.features = { ...empty(), rivers: [hill] };
  const crossed = step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'Move', unitId: 9000, to: east } });
  expect(crossed.ok && crossed.state.units[9000].movesSpent).toBe(2);
  state.map.features = { ...empty(), peaks: [hill] }; state.map.tiles[hill] = 'mountain';
  expect(reachablePaths(observe(state, 0), 9000)[hill]).toBeUndefined();
  expect(step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'Move', unitId: 9000, to: east } })).toEqual({ ok: false, reason: 'unreachable' });
  state.units[9000] = createMapUnit({ kind: 'pokemon', speciesId: 'pidgey' }, 9000, 0, from, contentFor(state.setup), 0, 1); refreshKnowledge(state);
  expect(reachablePaths(observe(state, 0), 9000)[hill]).toBeDefined();
});

test('v24 vision and views: a hill sees one tile further; the view carries features of explored tiles only', () => {
  const state = arena({}), unitTile = at(state, { q: 9, r: 6 });
  const flat = visibleTiles(state, 0).size;
  state.map.features = { ...empty(), hills: [unitTile] };
  expect(visibleTiles(state, 0).size).toBeGreaterThan(flat);
  const far = at(state, { q: 20, r: 2 });
  state.map.features = { ...empty(), hills: [unitTile, far], rivers: [far] };
  refreshKnowledge(state);
  const view = observe(state, 0);
  expect(view.map.features!.hills).toContain(unitTile);
  expect(view.knowledge.exploredTileIds).not.toContain(far);
  expect(view.map.features!.hills).not.toContain(far);
  expect(view.map.features!.rivers).toEqual([]);
});

test('v24 tile info and scene: feature names, passage text, yields with features; v23 tiles unchanged', () => {
  const state = arena({}), tile = at(state, { q: 9, r: 6 }), water = at(state, { q: 10, r: 5 });
  state.map.tiles[water] = 'ocean';
  state.map.features = { ...empty(), hills: [tile], rivers: [tile], deep: [water] };
  refreshKnowledge(state);
  const view = observe(state, 0);
  const info = describeTile(view, tile);
  expect(info.terrain!.name).toContain('丘陵');
  expect(info.terrain!.name).toContain('河流');
  expect(info.terrain!.moveCost).toBe(2);
  expect(describeTile(view, water).terrain!.access).toContain('远洋航行');
  expect(tileYieldReader(view)(tile)!.yields).toEqual({ food: 2, production: 2, gold: 1, research: 0 });
  const scene = buildScene({ view });
  expect(scene.terrain!.hills).toContain(tile);
  expect(scene.terrain!.rivers.find(river => river.index === tile)!.links.length).toBeGreaterThan(0);
  const old = arena({}, 'machop', 'rattata', 23), oldView = observe(old, 0);
  expect(describeTile(oldView, tile).terrain!.name).toBe('草原');
  expect(buildScene({ view: oldView }).terrain).toBeUndefined();
});
