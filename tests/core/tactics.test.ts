import { expect, test } from 'vitest';
import { EXPANSION_CONTENT } from '../../src/content/units.ts';
import type { SpeciesId } from '../../src/content/units.ts';
import { createGame } from '../../src/core/game.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { reachablePaths } from '../../src/core/movement.ts';
import { previewAttack } from '../../src/core/preview.ts';
import { resolveAttack } from '../../src/core/combat.ts';
import { hexToIndex } from '../../src/core/hex.ts';
import type { Hex } from '../../src/core/hex.ts';
import type { GameSetup, GameState } from '../../src/core/model.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';

function arena(gameplayVersion?: GameplayVersion): GameState {
  const setup: GameSetup = { seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1',
    ...(gameplayVersion ? { gameplayVersion } : {}), players: [
      { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' },
      { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'lance' },
    ] };
  const state = createGame(setup);
  state.map.tiles.fill('grassland'); state.units = {};
  for (const city of Object.values(state.cities)) city.position = city.ownerId === 0 ? { q: 0, r: 0 } : { q: 20, r: 0 };
  state.diplomacy[0].status = 'war';
  for (const id of [0, 1]) {
    state.knowledge[id].exploredTileIds = state.map.tiles.map((_, i) => i);
    state.knowledge[id].rememberedTiles = Object.fromEntries(state.map.tiles.map((biomeId, i) => [i, { biomeId }]));
  }
  return state;
}
function place(state: GameState, id: number, ownerId: number, speciesId: SpeciesId, position: Hex) {
  state.units[id] = createMapUnit({ kind: 'pokemon', speciesId }, id, ownerId, position, EXPANSION_CONTENT, 0, 1);
  refreshKnowledge(state);
}
const reach = (state: GameState, id: number) => Object.keys(reachablePaths(observe(state, 0), id)).map(Number);

test('melee units exert a zone of control that stops enemy movement in gameplay v2 only', () => {
  for (const version of [undefined, 2] as const) {
    const state = arena(version);
    place(state, 10, 0, 'ponyta', { q: 6, r: 6 });
    place(state, 20, 1, 'machop', { q: 8, r: 6 });
    const tiles = reach(state, 10);
    const far = hexToIndex({ q: 10, r: 6 }, state.map)!;
    expect(tiles.includes(far)).toBe(version === undefined);
    const command = { actorId: 0, expectedSeq: 0, action: { type: 'Move' as const, unitId: 10, to: { q: 10, r: 6 } } };
    expect(step(state, command).ok).toBe(version === undefined);
    // The ZOC tile itself is still enterable.
    expect(tiles.includes(hexToIndex({ q: 7, r: 6 }, state.map)!)).toBe(true);
  }
});

test('scouts, flyers and ghosts slip through; ranged units exert no zone', () => {
  const state = arena(2);
  place(state, 20, 1, 'machop', { q: 8, r: 6 });
  place(state, 11, 0, 'pidgey', { q: 6, r: 6 });
  expect(reach(state, 11)).toContain(hexToIndex({ q: 9, r: 6 }, state.map)!);
  const ranged = arena(2);
  place(ranged, 20, 1, 'bulbasaur', { q: 8, r: 6 });
  place(ranged, 10, 0, 'ponyta', { q: 6, r: 6 });
  expect(reach(ranged, 10)).toContain(hexToIndex({ q: 10, r: 6 }, ranged.map)!);
  const peace = arena(2); peace.diplomacy[0].status = 'peace';
  place(peace, 20, 1, 'machop', { q: 8, r: 6 });
  place(peace, 10, 0, 'ponyta', { q: 6, r: 6 });
  expect(reach(peace, 10)).toContain(hexToIndex({ q: 10, r: 6 }, peace.map)!);
});

test('flanking adds 10% per adjacent ally, matching preview and authority', () => {
  for (const version of [undefined, 2] as const) {
    const state = arena(version);
    place(state, 20, 1, 'snorlax', { q: 8, r: 6 });
    place(state, 10, 0, 'machop', { q: 7, r: 6 });
    const alone = previewAttack(observe(state, 0), 10, { kind: 'unit', id: 20 });
    place(state, 11, 0, 'sandshrew', { q: 9, r: 6 });
    place(state, 12, 0, 'ekans', { q: 8, r: 5 });
    const flanked = previewAttack(observe(state, 0), 10, { kind: 'unit', id: 20 });
    expect(alone.ok && flanked.ok).toBe(true);
    if (!alone.ok || !flanked.ok) continue;
    if (version === undefined) expect(flanked.damage).toEqual(alone.damage);
    else expect(flanked.damage.max).toBeGreaterThan(alone.damage.max);
    const before = state.units[20].hp;
    resolveAttack(state, 10, { kind: 'unit', id: 20 });
    const dealt = before - (state.units[20]?.hp ?? 0);
    expect(dealt).toBeGreaterThanOrEqual(Math.min(before, flanked.damage.min));
    expect(dealt).toBeLessThanOrEqual(flanked.damage.max);
  }
});
