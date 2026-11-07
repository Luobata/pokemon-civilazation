import { describe, expect, it } from 'vitest';
import { generateMap, selectStarts } from '../../src/core/map.ts';
import type { MapTerrain } from '../../src/core/map.ts';
import { edgeDistance, hexDistance, hexToIndex, indexToHex, neighbors } from '../../src/core/hex.ts';
import { createRng } from '../../src/core/rng.ts';
import { canonicalSerialize, stateDigest } from '../../src/core/snapshot.ts';

it('generates identical full state and digest twice in Node, with a frozen seed fixture', () => {
  const first = generateMap({ seed: 12345 });
  const second = generateMap({ seed: 12345 });
  expect(second).toEqual(first);
  expect(canonicalSerialize(second)).toBe(canonicalSerialize(first));
  expect(stateDigest(first)).toBe('3381a0de');
  expect(stateDigest(second)).toBe('3381a0de');
  expect(stateDigest(generateMap({ seed: 12346 }))).not.toBe(stateDigest(first));
});

it('enforces volcano and four-player start constraints for seeds 0..199', () => {
  const distances = { 8: 0, 6: 0, 4: 0 };
  for (let seed = 0; seed < 200; seed++) {
    const map = generateMap({ seed }); // Any rejection fails this batch.
    distances[map.startDistance]++;
    expect(new Set(map.tiles).size).toBe(7);
    const boundary = map.tiles.flatMap((_, i) => edgeDistance(indexToHex(i, map), map) === 0 ? [indexToHex(i, map)] : []);
    const volcanoes = map.tiles.flatMap((biome, i) => biome === 'volcano' ? [i] : []);
    expect(volcanoes.length).toBeGreaterThan(0);
    expect(volcanoes.length * 100).toBeLessThanOrEqual(map.tiles.length * 3);
    for (const i of volcanoes) expect(edgeDistance(indexToHex(i, map), map)).toBe(0);
    const reached = new Set([volcanoes[0]]);
    const pending = [volcanoes[0]];
    for (let i = 0; i < pending.length; i++) {
      for (const hex of neighbors(indexToHex(pending[i], map), map)) {
        const index = hexToIndex(hex, map);
        if (index !== null && map.tiles[index] === 'volcano' && !reached.has(index)) {
          reached.add(index); pending.push(index);
        }
      }
    }
    expect(reached.size).toBe(volcanoes.length);
    expect(map.starts).toHaveLength(4);
    for (const [i, start] of map.starts.entries()) {
      expect(['grassland', 'forest']).toContain(map.tiles[start.tileIndex]);
      const hex = indexToHex(start.tileIndex, map);
      // Independent geometric check against every boundary tile.
      expect(Math.min(...boundary.map(edge => hexDistance(hex, edge, map)))).toBeGreaterThanOrEqual(2);
      for (const other of map.starts.slice(i + 1)) {
        expect(hexDistance(hex, indexToHex(other.tileIndex, map), map)).toBeGreaterThanOrEqual(map.startDistance);
      }
    }
  }
  expect(Object.values(distances).reduce((a, b) => a + b, 0)).toBe(200);
});

function grassStrip(width: number): MapTerrain {
  return { width, height: 5, tiles: Array.from({ length: width * 5 }, () => 'grassland') };
}

describe('start-distance fallback only when no stronger solution exists', () => {
  it.each([[13, 8], [11, 6], [9, 4]] as const)('uses distance %s-width strip => %s', (width, expected) => {
    const result = selectStarts(grassStrip(width), 2, createRng(1));
    expect(result.startDistance).toBe(expected);
    expect(result.starts.map(start => start.tileIndex).sort((a, b) => a - b)).toEqual([2 * width + 2, 3 * width - 3]);
  });

  it('backtracks past unusable first choices rather than rejecting a valid configuration', () => {
    const result = selectStarts(grassStrip(13), 3, createRng(1));
    expect(result.startDistance).toBe(4);
    expect(result.starts.map(start => start.tileIndex).sort((a, b) => a - b)).toEqual([28, 32, 36]);
  });

  it('rejects a truly unsatisfiable map without weakening distance or edge rules', () => {
    expect(() => selectStarts(grassStrip(5), 2, createRng(1))).toThrow('No legal starting positions');
    expect(() => generateMap({ seed: 1, width: 4, height: 4, playerCount: 4 })).toThrow('No legal starting positions');
  });
});

it.each([[24, 16, 2], [30, 20, 3], [40, 26, 4]])('supports map %s×%s with %s civilizations', (width, height, playerCount) => {
  const map = generateMap({ seed: 12345, width, height, playerCount });
  expect(map.tiles).toHaveLength(width * height);
  expect(map.starts).toHaveLength(playerCount);
});
