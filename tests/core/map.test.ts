import { describe, expect, it } from 'vitest';
import { selectStarts } from '../../src/core/map.ts';
import { generateWorldMap } from '../../src/core/map-v24.ts';
import type { MapTerrain } from '../../src/core/map.ts';
import { createRng } from '../../src/core/rng.ts';
import { canonicalSerialize, stateDigest } from '../../src/core/snapshot.ts';

it('generates identical full world map state and digest twice in Node', () => {
  const first = generateWorldMap({ seed: 12345, width: 24, height: 16, playerCount: 4 });
  const second = generateWorldMap({ seed: 12345, width: 24, height: 16, playerCount: 4 });
  expect(second).toEqual(first);
  expect(canonicalSerialize(second)).toBe(canonicalSerialize(first));
  expect(stateDigest(generateWorldMap({ seed: 12346, width: 24, height: 16, playerCount: 4 }))).not.toBe(stateDigest(first));
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
  });
});

it.each([[24, 16, 2], [30, 20, 3], [40, 26, 4]])('supports map %s×%s with %s civilizations', (width, height, playerCount) => {
  const map = generateWorldMap({ seed: 12345, width, height, playerCount });
  expect(map.tiles).toHaveLength(width * height);
  expect(map.starts).toHaveLength(playerCount);
});
