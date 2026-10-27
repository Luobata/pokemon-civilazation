import { expect, test } from 'vitest';
import { parseSeedCount, simulate } from '../../tools/simulate.ts';
test('sim arguments are explicit and bounded', () => {
  expect(parseSeedCount([])).toBe(10); expect(parseSeedCount(['--seeds', '10'])).toBe(10);
  for (const args of [['--seeds', '0'], ['--seeds', 'NaN'], ['--other', '1']]) expect(() => parseSeedCount(args)).toThrow('Usage');
});
test('AI-only seed finishes without invalid actions or aborts', () => {
  expect(simulate(1)).toMatchObject({ seed: 1, kind: 'score', round: 100, aborted: false, invalid: [] });
}, 30_000);
