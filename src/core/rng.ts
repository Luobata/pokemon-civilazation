export type RngState = { algorithm: 'xorshift32-v1'; value: number };
const UINT32_MAX = 0xffffffff;

export function createRng(seed: number): RngState {
  if (!Number.isInteger(seed) || seed < 0 || seed > UINT32_MAX) {
    throw new RangeError('Seed must be an unsigned 32-bit integer.');
  }
  return { algorithm: 'xorshift32-v1', value: seed || 0x6d2b79f5 };
}

export function nextUint32(rng: RngState): number {
  let value = rng.value;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  rng.value = value >>> 0;
  return rng.value;
}

// [0, upperExclusive). A nonzero xorshift32 state visits 1..2^32-1,
// so subtract 1 and reject against that domain, not an assumed 2^32 outcomes.
export function randomBelow(rng: RngState, upperExclusive: number): number {
  if (!Number.isInteger(upperExclusive) || upperExclusive < 1 || upperExclusive > UINT32_MAX) {
    throw new RangeError('Random interval must contain 1..2^32-1 integers.');
  }
  const limit = UINT32_MAX - (UINT32_MAX % upperExclusive);
  let value: number;
  do {
    value = nextUint32(rng) - 1;
  } while (value >= limit);
  return value % upperExclusive;
}

export function shuffled<T>(values: readonly T[], rng: RngState): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomBelow(rng, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
