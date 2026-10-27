import { describe, expect, it } from 'vitest';
import { createRng, nextUint32, randomBelow } from '../../src/core/rng.ts';

describe('xorshift32-v1', () => {
  it.each([
    [1, [270369, 67634689, 2647435461, 307599695, 2398689233]],
    [0, [1085196063, 2447379481, 2618286376, 1701901981, 265159372]],
    [0xffffffff, [253983, 4228382207, 1958451267, 4056713434, 2049502865]],
  ])('matches the independent five-output vector for seed %s', (seed, vector) => {
    const rng = createRng(seed as number);
    expect(Array.from({ length: 5 }, () => nextUint32(rng))).toEqual(vector);
  });

  it('maps zero and resumes from a JSON-serialized state', () => {
    const rng = createRng(0);
    expect(rng.value).toBe(0x6d2b79f5);
    nextUint32(rng);
    const restored = JSON.parse(JSON.stringify(rng));
    expect(nextUint32(restored)).toBe(nextUint32(rng));
  });

  it('rejects the high tail before sampling the requested interval', () => {
    const rng = createRng(12345);
    // 3336926330 - 1 exceeds the 2^31 acceptance limit; second draw wins.
    expect(randomBelow(rng, 0x80000000)).toBe(1697253806);
    expect(rng.value).toBe(1697253807);
  });

  it('uses the entire nonzero xorshift domain and honors interval bounds', () => {
    expect(randomBelow(createRng(1), 0xffffffff)).toBe(270368);
    expect(randomBelow(createRng(1), 1)).toBe(0);
    const rng = createRng(42);
    for (let i = 0; i < 200; i++) {
      const value = randomBelow(rng, 7);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
    }
  });

  it('rejects unsupported seeds and empty intervals', () => {
    for (const seed of [-1, 0x100000000, NaN, 1.5]) expect(() => createRng(seed)).toThrow(RangeError);
    for (const size of [0, -1, 0x100000000]) expect(() => randomBelow(createRng(1), size)).toThrow(RangeError);
  });
});
