import { expect, it } from 'vitest';
import { edgeDistance, hexDistance, hexToIndex, hexToOffset, indexToHex, neighbors, offsetToHex } from '../../src/core/hex.ts';

it('uses fixed E, NE, NW, W, SW, SE neighbor order', () => {
  expect(neighbors({ q: 2, r: 3 })).toEqual([
    { q: 3, r: 3 }, { q: 3, r: 2 }, { q: 2, r: 2 },
    { q: 1, r: 3 }, { q: 1, r: 4 }, { q: 2, r: 4 },
  ]);
});

it('round-trips odd-r offsets, including negative and odd rows', () => {
  expect(offsetToHex({ col: 3, row: 3 })).toEqual({ q: 2, r: 3 });
  for (let row = -3; row < 6; row++) {
    for (let col = -3; col < 6; col++) expect(hexToOffset(offsetToHex({ col, row }))).toEqual({ col, row });
  }
});

it('computes cube-equivalent distance and all neighbors are one step away', () => {
  const origin = { q: 0, r: 0 };
  expect(hexDistance(origin, { q: 3, r: -5 })).toBe(5);
  expect(hexDistance({ q: -3, r: 5 }, origin)).toBe(5);
  expect(hexDistance(origin, origin)).toBe(0);
  for (const hex of neighbors(origin)) expect(hexDistance(hex, origin)).toBe(1);
});

it('round-trips every index of a 24×16 rectangle in row-major order', () => {
  const size = { width: 24, height: 16 };
  expect(indexToHex(24, size)).toEqual({ q: 0, r: 1 });
  expect(indexToHex(48, size)).toEqual({ q: -1, r: 2 });
  for (let index = 0; index < 384; index++) expect(hexToIndex(indexToHex(index, size), size)).toBe(index);
});

it('handles boundary neighbors and rejects out-of-map indices', () => {
  const size = { width: 24, height: 16 };
  expect(neighbors({ q: 0, r: 0 }).map(hex => hexToIndex(hex, size))).toEqual([1, null, null, null, null, 24]);
  expect(edgeDistance(indexToHex(0, size), size)).toBe(0);
  expect(edgeDistance(offsetToHex({ col: 2, row: 2 }), size)).toBe(2);
  expect(() => indexToHex(-1, size)).toThrow(RangeError);
  expect(() => indexToHex(384, size)).toThrow(RangeError);
});
