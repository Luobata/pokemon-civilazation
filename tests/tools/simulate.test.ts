import { expect, test } from 'vitest';
import { parseSeedCount, simulate } from '../../tools/simulate.ts';
test('sim arguments are explicit and bounded', () => {
  expect(parseSeedCount([])).toBe(10); expect(parseSeedCount(['--seeds', '10'])).toBe(10);
  for (const args of [['--seeds', '0'], ['--seeds', 'NaN'], ['--other', '1']]) expect(() => parseSeedCount(args)).toThrow('Usage');
});
test('AI-only seed finishes without invalid actions or aborts', () => {
  const result = simulate(1);
  expect(result).toMatchObject({ seed: 1, aborted: false, defect: false, invalid: [] });
  expect(result.kind).not.toBeNull();
  expect(result.round).toBeGreaterThan(0);
  expect(result.round).toBeLessThanOrEqual(100);
  expect(result.winners.length).toBeGreaterThan(0);
}, 120_000);
