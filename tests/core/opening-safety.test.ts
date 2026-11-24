import { expect, test } from 'vitest';
import { contentFor } from '../../src/content/units.ts';
import type { Content } from '../../src/content/units.ts';
import type { SpeciesId } from '../../src/content/species.ts';
import { createGame } from '../../src/core/game.ts';
import { actWild } from '../../src/core/wild.ts';
import { observe } from '../../src/core/vision.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from '../../src/core/hex.ts';
import type { Hex } from '../../src/core/hex.ts';
import { isMapUnit } from '../../src/core/model.ts';
import type { GameSetup, GameState, MapUnit } from '../../src/core/model.ts';
import { canEnterTile } from '../../src/core/movement.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { faithWinCount, faithWinShareView, viewFaithWinCount } from '../../src/core/opening-safety.ts';
import { isCitySite } from '../../src/ai/query.ts';

const setup = (gameplayVersion: 27): GameSetup => ({ seed: 31, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur' }, { id: 1, controller: 'ai' }] });
/** A game with only player 0's settler on the map (every other unit removed). */
function lonelySettler(version: 27): { state: GameState; content: Content; settler: MapUnit } {
  const state = createGame(setup(version)), content = contentFor(state.setup);
  const settler = Object.values(state.units).find(unit => unit.ownerId === 0 && unit.kind === 'logistics') as MapUnit;
  for (const id of Object.keys(state.units).map(Number)) if (id !== settler.id) delete state.units[id];
  return { state, content, settler };
}
const free = (state: GameState, hex: Hex) => !Object.values(state.units).filter(isMapUnit).some(unit => hexDistance(unit.position, hex, state.map) === 0);
function addWild(state: GameState, content: Content, near: Hex, speciesId: SpeciesId = 'rattata'): MapUnit {
  const hex = neighbors(near, state.map).filter(item => free(state, item) && canEnterTile({ kind: 'pokemon', speciesId }, state.map, hexToIndex(item, state.map)!, content))
    .sort((a, b) => hexToIndex(a, state.map)! - hexToIndex(b, state.map)!)[0];
  const id = state.nextEntityId++;
  state.units[id] = createMapUnit({ kind: 'pokemon', speciesId }, id, null, hex, content);
  return state.units[id] as MapUnit;
}

test('v27: a civilian next to a striking wild Pokémon flees to the lowest free tile 2 away from it, and nobody is struck', () => {
  const { state, content, settler } = lonelySettler(27), from = { ...settler.position };
  const wild = addWild(state, content, settler.position);
  const expected = neighbors(from, state.map).filter(hex => free(state, hex) && canEnterTile(settler, state.map, hexToIndex(hex, state.map)!, content)
    && hexDistance(hex, wild.position, state.map) === 2).sort((a, b) => hexToIndex(a, state.map)! - hexToIndex(b, state.map)!)[0];
  expect(expected).toBeDefined();
  const events = actWild(state, content);
  expect(state.units[settler.id]).toBeDefined();
  expect((state.units[settler.id] as MapUnit).position).toEqual(expected);
  expect(events.map(event => event.type)).toEqual(['Moved', 'CivilianFled']);
  expect(events[1]).toMatchObject({ type: 'CivilianFled', playerId: 0, unitId: settler.id, from, to: expected, wildId: wild.id, wildSpeciesId: 'rattata' });
  expect(state.units[wild.id].hp).toBe(content.species.rattata.maxHp);
});

test('v27: with no tile to flee to, the strike happens as before', () => {
  const { state, content, settler } = lonelySettler(27);
  const wild = addWild(state, content, settler.position);
  // Fill every tile around the settler (the blockers are own builders: no Pokémon, so nothing else is struck first).
  for (const hex of neighbors(settler.position, state.map)) if (free(state, hex)) {
    const id = state.nextEntityId++;
    state.units[id] = createMapUnit({ kind: 'logistics', role: 'builder' }, id, 1, hex, content);
  }
  const events = actWild(state, content);
  const battle = events.find(event => event.type === 'BattleResolved');
  expect(battle).toMatchObject({ attackerId: wild.id });
  expect(events.some(event => event.type === 'CivilianFled')).toBe(false);
});

test('faith compensation: 65% of the counted cities in v27 (integers); the view mirrors the authority', () => {
  const v27 = contentFor(setup(27));
  expect([5, 6, 10, 13, 20].map(count => faithWinCount(count, v27))).toEqual([4, 4, 7, 9, 13]);
  for (let count = 0; count <= 40; count++) {
    expect(viewFaithWinCount({ totalCities: count, ...faithWinShareView(v27) })).toBe(faithWinCount(count, v27));
  }
  expect(faithWinShareView(v27)).toEqual({ winShare: 0.65, winSharePercent: 65 });
  const state = createGame(setup(27));
  expect(observe(state, 0, v27).expansion!.faith?.winSharePercent ?? 65).toBe(65);
});

test('AI city sites: v27 needs radius 2 explored (ring 3 may be unknown); the view-only fallback reads the view content', () => {
  const state = createGame(setup(27)), v27 = contentFor(state.setup);
  const full = observe(state, 0, v27);
  full.map = { ...full.map, tiles: [...state.map.tiles] };
  const site = state.map.tiles.map((_, index) => indexToHex(index, state.map)).find(hex => isCitySite(full, hex, v27)
    && neighbors(hex, state.map).length === 6)!;
  expect(site).toBeDefined();
  const ring3 = state.map.tiles.map((_, index) => index).find(index => hexDistance(indexToHex(index, state.map), site, state.map) === 3)!;
  const ring2 = state.map.tiles.map((_, index) => index).find(index => hexDistance(indexToHex(index, state.map), site, state.map) === 2)!;
  const hidden3 = { ...full, map: { ...full.map, tiles: full.map.tiles.map((tile, index) => index === ring3 ? null : tile) } };
  expect(isCitySite(hidden3, site, v27)).toBe(true);
  expect(isCitySite(hidden3, site)).toBe(true);
  const hidden2 = { ...full, map: { ...full.map, tiles: full.map.tiles.map((tile, index) => index === ring2 ? null : tile) } };
  expect(isCitySite(hidden2, site, v27)).toBe(false);
});
