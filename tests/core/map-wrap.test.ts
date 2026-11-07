// Gameplay v22 east-west wrap (docs/design/world-v22.md §A): geometry, rules across the seam, generation.
import { describe, expect, it } from 'vitest';
import { contentFor } from '../../src/content/units.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';
import { createGame } from '../../src/core/game.ts';
import { generateMap } from '../../src/core/map.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { canonicalHex, edgeDistance, hexDistance, hexToIndex, hexToOffset, indexToHex, nearestCopy, neighbors, offsetToHex, HEX_DIRECTIONS } from '../../src/core/hex.ts';
import type { GridSize, Hex } from '../../src/core/hex.ts';
import { observe, refreshKnowledge, visibleTiles } from '../../src/core/vision.ts';
import { reachablePaths } from '../../src/core/movement.ts';
import { previewAttack } from '../../src/core/preview.ts';
import { resolveAttack } from '../../src/core/combat.ts';
import { step } from '../../src/core/step.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';
import { copyShifts, hexToWorld, mapSpan, tileToScreen, toScreen, toWorld, worldToHex } from '../../src/browser/camera.ts';
import { moveTrack } from '../../src/browser/render/animation.ts';
import type { AnimationFrame } from '../../src/browser/render/animation.ts';

const FLAT: GridSize = { width: 24, height: 16 };
const WRAP: GridSize = { width: 24, height: 16, wrap: true };
const at = (col: number, row: number): Hex => offsetToHex({ col, row });
/** Breadth-first steps over the neighbour graph: the independent reference for hexDistance. */
function bfs(from: Hex, size: GridSize): number[] {
  const distance = Array.from({ length: size.width * size.height }, () => -1), start = hexToIndex(from, size)!;
  distance[start] = 0;
  for (const queue = [start]; queue.length;) {
    const index = queue.shift()!;
    for (const next of neighbors(indexToHex(index, size), size)) {
      const n = hexToIndex(next, size);
      if (n !== null && distance[n] < 0) { distance[n] = distance[index] + 1; queue.push(n); }
    }
  }
  return distance;
}

describe('wrapped geometry', () => {
  it('the first and last column are neighbours on every row; positions stay canonical', () => {
    for (let row = 0; row < 16; row++) {
      const east = at(23, row), west = at(0, row);
      expect(hexDistance(east, west, WRAP)).toBe(1);
      expect(hexDistance(east, west, FLAT)).toBe(23);
      expect(neighbors(east, WRAP)[0]).toEqual(west); // E of the last column is the first column
      expect(neighbors(west, WRAP)[3]).toEqual(east); // W of the first column is the last column
      for (const next of neighbors(east, WRAP)) {
        const { col } = hexToOffset(next);
        expect(col).toBeGreaterThanOrEqual(0); expect(col).toBeLessThan(24);
      }
    }
    // Off-canonical columns fold back on a wrapping map only; rows never wrap.
    expect(hexToIndex(at(24, 6), WRAP)).toBe(6 * 24);
    expect(hexToIndex(at(-1, 6), WRAP)).toBe(6 * 24 + 23);
    expect(hexToIndex(at(24, 6), FLAT)).toBeNull();
    expect(hexToIndex(at(3, -1), WRAP)).toBeNull();
    expect(hexToIndex(at(3, 16), WRAP)).toBeNull();
    expect(canonicalHex(at(-2, 5), WRAP)).toEqual(at(22, 5));
    expect(canonicalHex(at(-2, 5), FLAT)).toEqual(at(-2, 5));
  });

  it('hexDistance equals breadth-first steps over the wrapped neighbour graph (shortest path may cross the seam)', () => {
    for (const source of [at(0, 0), at(23, 7), at(11, 8), at(1, 15), at(22, 3)]) {
      const reference = bfs(source, WRAP);
      for (let index = 0; index < 24 * 16; index++) {
        const hex = indexToHex(index, WRAP);
        expect(hexDistance(source, hex, WRAP)).toBe(reference[index]);
        expect(hexDistance(hex, source, WRAP)).toBe(reference[index]);
        expect(hexDistance(source, hex, WRAP)).toBeLessThanOrEqual(hexDistance(source, hex, FLAT));
      }
    }
  });

  it('without wrap every result is the classic flat geometry (v≤21 unchanged)', () => {
    for (let a = 0; a < 24 * 16; a += 7) for (let b = 0; b < 24 * 16; b += 5) {
      const ha = indexToHex(a, FLAT), hb = indexToHex(b, FLAT), dq = ha.q - hb.q, dr = ha.r - hb.r;
      expect(hexDistance(ha, hb, FLAT)).toBe(Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)));
    }
    const hex = { q: -5, r: 3 };
    expect(neighbors(hex, FLAT)).toEqual(HEX_DIRECTIONS.map(d => ({ q: hex.q + d.q, r: hex.r + d.r })));
    for (const reference of [at(0, 0), at(12, 9)]) expect(bfs(reference, FLAT).every((steps, index) => steps === hexDistance(reference, indexToHex(index, FLAT), FLAT))).toBe(true);
    expect(edgeDistance(at(0, 8), FLAT)).toBe(0);
    expect(nearestCopy(at(23, 4), at(0, 4), FLAT)).toEqual(at(0, 4));
  });

  it('only the poles are map edges on a wrapping map; nearestCopy points across the seam for drawing', () => {
    expect(edgeDistance(at(0, 8), WRAP)).toBe(7);
    expect(edgeDistance(at(23, 0), WRAP)).toBe(0);
    expect(edgeDistance(at(5, 14), WRAP)).toBe(1);
    expect(nearestCopy(at(23, 4), at(0, 4), WRAP)).toEqual({ q: at(0, 4).q + 24, r: 4 });
    expect(nearestCopy(at(0, 5), at(23, 5), WRAP)).toEqual({ q: at(23, 5).q - 24, r: 5 });
    expect(nearestCopy(at(10, 5), at(12, 5), WRAP)).toEqual(at(12, 5));
  });
});

const duel = (gameplayVersion: GameplayVersion): GameSetup => ({ seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1', gameplayVersion,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'misty' }] });
const act = (state: GameState, action: Command['action']) => step(state, { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action });
/** Open grassland; player 0's unit on the last column, player 1's two columns further east (across the seam). */
function seam(version: GameplayVersion, attacker: 'ponyta' | 'charmander', defenderCol = 1): GameState {
  const state = createGame(duel(version)), content = contentFor(state.setup);
  state.map.tiles.fill('grassland'); state.units = {}; state.diplomacy[0].status = 'war';
  state.cities[state.players[0].headquartersCityId].position = at(12, 2);
  state.cities[state.players[1].headquartersCityId].position = at(12, 13);
  state.units[9000] = createMapUnit({ kind: 'pokemon', speciesId: attacker }, 9000, 0, at(23, 6), content, 0, 1);
  state.units[9001] = createMapUnit({ kind: 'pokemon', speciesId: 'rattata' }, 9001, 1, at(defenderCol, 6), content, 0, 1);
  state.map.tiles.forEach((biomeId, index) => { state.knowledge[0].rememberedTiles[index] = { biomeId }; });
  refreshKnowledge(state);
  return state;
}

describe('v22 rules across the seam', () => {
  it('v22 games and their views carry wrap; v21 games do not', () => {
    const v22 = createGame(duel(22)), v21 = createGame(duel(21));
    expect(v22.map.wrap).toBe(true);
    expect(observe(v22, 0).map.wrap).toBe(true);
    expect('wrap' in v21.map).toBe(false);
    expect('wrap' in observe(v21, 0).map).toBe(false);
  });

  it('a unit walks east off the last column onto the first, paying each tile once', () => {
    const state = seam(22, 'ponyta', 5);
    const target = hexToIndex(at(1, 6), state.map)!;
    expect(reachablePaths(observe(state, 0), 9000)[target]).toEqual([at(23, 6), at(0, 6), at(1, 6)]);
    const moved = act(state, { type: 'Move', unitId: 9000, to: at(1, 6) });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.state.units[9000].position).toEqual(at(1, 6));
    expect(moved.state.units[9000].movesSpent).toBe(2);
    const event = moved.events.find(item => item.payload.type === 'Moved');
    expect(event?.payload.type === 'Moved' && event.payload.path).toEqual([at(23, 6), at(0, 6), at(1, 6)]);
    // The tile across the seam costs its own biome: forest (2) on the first column.
    const forest = seam(22, 'ponyta', 5);
    forest.map.tiles[hexToIndex(at(0, 6), forest.map)!] = 'forest';
    forest.knowledge[0].rememberedTiles[hexToIndex(at(0, 6), forest.map)!] = { biomeId: 'forest' };
    refreshKnowledge(forest);
    const into = act(forest, { type: 'Move', unitId: 9000, to: at(0, 6) });
    expect(into.ok && into.state.units[9000].position).toEqual(at(0, 6));
    expect(into.ok && into.state.units[9000].movesSpent).toBe(2);
    // A command naming an off-canonical copy of the tile resolves to the canonical tile.
    const copy = act(seam(22, 'ponyta', 5), { type: 'Move', unitId: 9000, to: at(25, 6) });
    expect(copy.ok && copy.state.units[9000].position).toEqual(at(1, 6));
    // v21: the same column is 22 steps away; the far side is unreachable.
    expect(reachablePaths(observe(seam(21, 'ponyta', 5), 0), 9000)[target]).toBeUndefined();
  });

  it('vision and attack range reach across the seam; preview matches the authority', () => {
    const state = seam(22, 'charmander');
    expect(contentFor(state.setup).species.charmander.range).toBe(2);
    const visible = visibleTiles(state, 0);
    expect(visible.has(hexToIndex(at(0, 6), state.map)!)).toBe(true);
    expect(visible.has(hexToIndex(at(1, 6), state.map)!)).toBe(true);
    const view = observe(state, 0);
    expect(view.units.map(unit => unit.id)).toContain(9001);
    const preview = previewAttack(view, 9000, { kind: 'unit', id: 9001 });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const hp = state.units[9001].hp, attackerHp = state.units[9000].hp;
    const attack = act(state, { type: 'Attack', unitId: 9000, target: { kind: 'unit', id: 9001 } });
    expect(attack.ok).toBe(true);
    if (!attack.ok) return;
    const dealt = hp - attack.state.units[9001].hp;
    expect(dealt).toBeGreaterThanOrEqual(preview.damage.min);
    expect(dealt).toBeLessThanOrEqual(preview.damage.max);
    expect(attackerHp - attack.state.units[9000].hp).toBe(preview.counter.trigger === 'never' ? 0 : preview.counter.damage);
    // resolveAttack directly agrees too (same RNG draw as the command).
    const again = seam(22, 'charmander');
    resolveAttack(again, 9000, { kind: 'unit', id: 9001 });
    expect(again.units[9001].hp).toBe(attack.state.units[9001].hp);
    // v21: two columns apart on a flat map is 22 tiles; out of sight and out of range.
    const flat = seam(21, 'charmander');
    expect(visibleTiles(flat, 0).has(hexToIndex(at(1, 6), flat.map)!)).toBe(false);
    expect(observe(flat, 0).units.map(unit => unit.id)).not.toContain(9001);
  });

  it('zone of control and flanking count neighbours across the seam', () => {
    const state = seam(22, 'ponyta', 1);
    state.units[9002] = createMapUnit({ kind: 'pokemon', speciesId: 'machop' }, 9002, 1, at(0, 4), contentFor(state.setup), 0, 1);
    refreshKnowledge(state);
    // (0,5) touches machop's tile (0,4); entering it from (23,6) ends the move.
    const paths = reachablePaths(observe(state, 0), 9000);
    const stop = hexToIndex(at(23, 5), state.map)!;
    expect(hexDistance(at(23, 5), at(0, 4), state.map)).toBe(1);
    expect(paths[stop]).toBeDefined();
    const beyond = Object.entries(paths).filter(([, path]) => path.slice(1, -1).some(hex => hexDistance(hex, at(0, 4), state.map) === 1));
    expect(beyond).toEqual([]);
  });
});

describe('v22 generation', () => {
  it('poles at the top and bottom rows, no east/west wall, wrapped start spacing', () => {
    for (const seed of [1, 7, 31, 12345]) {
      const map = generateMap({ seed, width: 24, height: 16, playerCount: 4, wrap: true });
      expect(map.wrap).toBe(true);
      for (let col = 0; col < 24; col++) for (const row of [0, 15]) expect(['snow', 'ocean', 'volcano']).toContain(map.tiles[row * 24 + col]);
      // East/west edge columns are ordinary terrain, not a forced wall of ocean or volcano.
      const edge = Array.from({ length: 12 }, (_, i) => i + 2).flatMap(row => [map.tiles[row * 24], map.tiles[row * 24 + 23]]);
      expect(edge.filter(biome => biome === 'ocean' || biome === 'volcano').length).toBeLessThan(edge.length);
      expect(new Set(edge).size).toBeGreaterThan(1);
      for (const [i, start] of map.starts.entries()) {
        expect(edgeDistance(indexToHex(start.tileIndex, map), map)).toBeGreaterThanOrEqual(2);
        for (const other of map.starts.slice(i + 1)) expect(hexDistance(indexToHex(start.tileIndex, map), indexToHex(other.tileIndex, map), map)).toBeGreaterThanOrEqual(map.startDistance);
      }
    }
    // Starts may sit in the outer columns on a wrapping map (they never could on a flat one).
    const outer = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].flatMap(seed => generateMap({ seed, width: 24, height: 16, playerCount: 4, wrap: true }).starts)
      .filter(start => [0, 1, 22, 23].includes(start.tileIndex % 24));
    expect(outer.length).toBeGreaterThan(0);
  });

  it('flat generation is unchanged and has no wrap key', () => {
    const map = generateMap({ seed: 12345, width: 24, height: 16, playerCount: 4 });
    expect('wrap' in map).toBe(false);
    expect(map.starts.every(start => edgeDistance(indexToHex(start.tileIndex, map), map) >= 2)).toBe(true);
  });
});

describe('browser geometry for the seam (pure helpers)', () => {
  const camera = { x: -400, y: 20, zoom: 1 };
  it('draws one copy on a flat map and every copy that touches the viewport on a wrapping map', () => {
    expect(copyShifts(FLAT, camera, 1200, 88)).toEqual([0]);
    const span = mapSpan(WRAP), shifts = copyShifts(WRAP, camera, 1200, 88);
    expect(shifts).toContain(0);
    expect(shifts).toContain(span);
    // Together the copies cover the viewport with no gap.
    for (let x = 0; x <= 1200; x += 50) expect(shifts.some(shift => x >= camera.x + shift - 40 && x <= camera.x + shift + span + 40)).toBe(true);
  });

  it('a pointer over a copy across the seam resolves to the canonical tile; overlays anchor on the copy nearest the centre', () => {
    const copy = { q: at(0, 7).q + 24, r: 7 }; // first column, drawn one map-width to the east
    const pointer = toScreen(hexToWorld(copy), camera);
    expect(hexToIndex(worldToHex(toWorld(pointer, camera)), WRAP)).toBe(7 * 24);
    expect(hexToIndex(worldToHex(toWorld(pointer, camera)), FLAT)).toBeNull();
    const anchor = tileToScreen(at(0, 7), { x: -mapSpan(WRAP) + 300, y: 0, zoom: 1 }, WRAP, 1200);
    expect(anchor.x).toBeGreaterThan(0); expect(anchor.x).toBeLessThan(1200);
    expect(tileToScreen(at(0, 7), camera, FLAT, 1200)).toEqual(toScreen(hexToWorld(at(0, 7)), camera));
  });

  it('a move animation across the seam slides one hex instead of crossing the map', () => {
    const unit = { kind: 'pokemon' as const, speciesId: 'ponyta' as const, id: 1, ownerId: 0 };
    const frameAt = (map: GridSize | undefined, elapsed: number) => {
      const frame: AnimationFrame = { poses: [], effects: [] };
      moveTrack(unit, [at(23, 6), at(0, 6)], undefined, map).sample(elapsed, { unitPosition: () => undefined }, frame);
      return frame.poses[0].position;
    };
    const start = hexToWorld(at(23, 6)), hex = Math.sqrt(3) * 22;
    expect(frameAt(WRAP, 90).x).toBeCloseTo(start.x + hex / 2, 6);
    expect(frameAt(FLAT, 90).x).toBeLessThan(start.x - hex * 10);
  });
});
