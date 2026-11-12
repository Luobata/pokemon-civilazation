import { expect, test } from 'vitest';
import { generateWorldMap } from '../../src/core/map-v24.ts';
import { generateMap } from '../../src/core/map.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from '../../src/core/hex.ts';
import type { MapState } from '../../src/core/map.ts';

const around = (map: MapState, i: number) => neighbors(indexToHex(i, map), map).map(hex => hexToIndex(hex, map)).filter((j): j is number => j !== null);
const within = (map: MapState, i: number, radius: number) => map.tiles.flatMap((_, j) => j !== i && hexDistance(indexToHex(i, map), indexToHex(j, map), map) <= radius ? [j] : []);
/** Connected land components (peaks excluded when `peaks` is given). */
function components(map: MapState, open: (i: number) => boolean): number[][] {
  const seen = new Set<number>(), out: number[][] = [];
  for (let i = 0; i < map.tiles.length; i++) if (open(i) && !seen.has(i)) {
    const group = [i]; seen.add(i);
    for (let k = 0; k < group.length; k++) for (const j of around(map, group[k])) if (open(j) && !seen.has(j)) { seen.add(j); group.push(j); }
    out.push(group);
  }
  return out;
}

test('v24 generator: deterministic from the seed, sorted feature lists, wrapping', () => {
  const a = generateWorldMap({ seed: 31, width: 40, height: 26, playerCount: 4 }), b = generateWorldMap({ seed: 31, width: 40, height: 26, playerCount: 4 });
  expect(a).toEqual(b);
  expect(a.wrap).toBe(true);
  for (const list of [a.features!.hills, a.features!.peaks, a.features!.rivers, a.features!.lakes, a.features!.deep]) expect(list).toEqual([...list].sort((x, y) => x - y));
  expect(generateWorldMap({ seed: 32, width: 40, height: 26, playerCount: 4 }).tiles).not.toEqual(a.tiles);
});

test.each([[40, 26, 4], [40, 26, 3], [40, 26, 2], [24, 16, 4], [56, 36, 4]])('v24 generator %ix%i, %i players: land, continents, chains, peaks, rivers, starts', (width, height, players) => {
  for (const seed of [31, 34, 37]) {
    const map = generateWorldMap({ seed, width, height, playerCount: players }), f = map.features!, n = width * height;
    const peaks = new Set(f.peaks), lakes = new Set(f.lakes), deep = new Set(f.deep), rivers = new Set(f.rivers);
    const land = map.tiles.filter(t => t !== 'ocean').length;
    expect(land * 100 / n).toBeGreaterThanOrEqual(width < 30 ? 48 : 53);
    expect(land * 100 / n).toBeLessThanOrEqual(60);
    // Polar rows are deep water; nothing grows in the outer two rows.
    for (let c = 0; c < width; c++) { expect(deep.has(c)).toBe(true); expect(deep.has(n - width + c)).toBe(true); }
    for (let i = 0; i < 2 * width; i++) { expect(map.tiles[i]).toBe('ocean'); expect(map.tiles[n - 1 - i]).toBe('ocean'); }
    // Deep = ocean with no land neighbour (lakes never deep); lakes are ocean tiles.
    for (let i = 0; i < n; i++) if (map.tiles[i] === 'ocean' && !lakes.has(i) && Math.floor(i / width) > 0 && Math.floor(i / width) < height - 1) {
      expect(deep.has(i)).toBe(!around(map, i).some(j => map.tiles[j] !== 'ocean'));
    }
    for (const i of lakes) expect(map.tiles[i]).toBe('ocean');
    for (const i of peaks) expect(map.tiles[i]).toBe('mountain');
    // Every start is reachable from every other over land and shallow water (island chains), without crossing peaks.
    const shallowOrLand = (i: number) => !peaks.has(i) && (map.tiles[i] !== 'ocean' || !deep.has(i));
    const reach = components(map, shallowOrLand).find(group => group.includes(map.starts[0].tileIndex))!;
    for (const start of map.starts) expect(reach).toContain(start.tileIndex);
    // Two starts per continent (4 players: two continents with two civilizations each).
    const landGroups = components(map, i => map.tiles[i] !== 'ocean' && !peaks.has(i));
    const groupOf = (tile: number) => landGroups.findIndex(group => group.includes(tile));
    const perGroup = new Map<number, number>();
    for (const start of map.starts) perGroup.set(groupOf(start.tileIndex), (perGroup.get(groupOf(start.tileIndex)) ?? 0) + 1);
    expect([...perGroup.values()].sort()).toEqual(players === 4 ? [2, 2] : players === 3 ? [1, 2] : [2]);
    // Starts: grassland/forest, coast within 3, at least 18 usable land tiles within 3, separated by the chosen distance.
    for (const start of map.starts) {
      expect(['grassland', 'forest']).toContain(map.tiles[start.tileIndex]);
      expect(within(map, start.tileIndex, 3).some(j => map.tiles[j] === 'ocean' && !lakes.has(j) && !deep.has(j))).toBe(true);
      expect(within(map, start.tileIndex, 3).filter(j => map.tiles[j] !== 'ocean' && !peaks.has(j) && map.tiles[j] !== 'volcano').length).toBeGreaterThanOrEqual(18);
      for (const other of map.starts) if (other !== start) expect(hexDistance(indexToHex(start.tileIndex, map), indexToHex(other.tileIndex, map), map)).toBeGreaterThanOrEqual(map.startDistance);
    }
    // Rivers: every river tile is land; each continent has at least one; every river reaches water (a river tile next to water).
    for (const i of rivers) expect(map.tiles[i]).not.toBe('ocean');
    for (const group of landGroups.filter(g => g.length >= 60)) expect(group.some(i => rivers.has(i))).toBe(true);
    for (const group of components(map, i => rivers.has(i))) expect(group.some(i => around(map, i).some(j => map.tiles[j] === 'ocean'))).toBe(true);
    // Hills sit on flat land only.
    for (const i of f.hills) expect(['grassland', 'forest', 'desert', 'snow']).toContain(map.tiles[i]);
  }
});

test('v24 generator: peaks never split a continent', () => {
  for (const seed of [31, 32, 33, 34, 35, 36]) {
    const map = generateWorldMap({ seed, width: 40, height: 26, playerCount: 4 }), peaks = new Set(map.features!.peaks);
    const withPeaks = components(map, i => map.tiles[i] !== 'ocean'), withoutPeaks = components(map, i => map.tiles[i] !== 'ocean' && !peaks.has(i));
    // Removing peaks removes tiles but never adds a component.
    expect(withoutPeaks.length).toBe(withPeaks.length);
  }
});

test('v24 generator: start fairness and 56x36 timing', () => {
  const spreads: number[] = [];
  for (const seed of [31, 32, 33, 34, 35, 36, 37, 38]) {
    const map = generateWorldMap({ seed, width: 40, height: 26, playerCount: 4 }), peaks = new Set(map.features!.peaks);
    const usable = map.starts.map(start => within(map, start.tileIndex, 3).filter(j => map.tiles[j] !== 'ocean' && !peaks.has(j) && map.tiles[j] !== 'volcano').length);
    spreads.push(Math.max(...usable) - Math.min(...usable));
  }
  expect(spreads.filter(spread => spread <= 9).length).toBe(spreads.length);
  generateWorldMap({ seed: 30, width: 56, height: 36, playerCount: 4 }); // warm-up
  const started = performance.now();
  for (const seed of [31, 32, 33]) generateWorldMap({ seed, width: 56, height: 36, playerCount: 4 });
  // Spec target is 50 ms per map; the bound leaves room for loaded CI machines.
  expect((performance.now() - started) / 3).toBeLessThan(250);
});

test('the v22/v23 generator is untouched', () => {
  const map = generateMap({ seed: 31, width: 24, height: 16, playerCount: 4, wrap: true });
  expect(map.features).toBeUndefined();
  expect(map.starts.map(start => start.tileIndex)).toEqual(generateMap({ seed: 31, width: 24, height: 16, playerCount: 4, wrap: true }).starts.map(start => start.tileIndex));
});
