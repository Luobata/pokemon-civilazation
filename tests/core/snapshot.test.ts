import { expect, it } from 'vitest';
import { canonicalSerialize, stateDigest } from '../../src/core/snapshot.ts';

it('sorts object keys recursively while retaining ordered arrays', () => {
  expect(canonicalSerialize({ z: [2, 1], a: { z: true, a: null } })).toBe('{"a":{"a":null,"z":true},"z":[2,1]}');
  expect(stateDigest({ a: 1, b: 2 })).toBe(stateDigest({ b: 2, a: 1 }));
  expect(stateDigest([1, 2])).not.toBe(stateDigest([2, 1]));
});

it('refuses non-finite numbers instead of collapsing them to null', () => {
  expect(() => canonicalSerialize(NaN)).toThrow('finite');
});
