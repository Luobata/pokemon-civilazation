import { expect, test } from 'vitest';
import { assessD45, rankD45 } from '../../tools/b7-report.ts';

function candidate(id: string, aggressiveExpansion = 0.5, aggressiveConservative = 0.5, snowball = 0.6) {
  return { id, values: { defect: 0, aborted: 0, conquest: 0.4, meanRound: 90, meanFourRound: 95, firstSeat: 0.55,
    snowball, captures: 5, neutral: 0.3 }, pairs: [
    { pair: 'aggressive/expansion', results: [{ personality: 'aggressive', pointEstimate: aggressiveExpansion }, { personality: 'expansion', pointEstimate: 1 - aggressiveExpansion }] },
    { pair: 'aggressive/conservative', results: [{ personality: 'aggressive', pointEstimate: aggressiveConservative }, { personality: 'conservative', pointEstimate: 1 - aggressiveConservative }] },
    { pair: 'conservative/expansion', results: [{ personality: 'conservative', pointEstimate: 0.1 }, { personality: 'expansion', pointEstimate: 0.9 }] },
  ] };
}
test('D45 accepts conservative weakness, inclusive boundaries and no1v3 lower bound; neutral is strict', () => {
  const a = candidate('a', 0.4, 0.6); a.values.meanFourRound = 69;
  expect(assessD45(a)).toMatchObject({ allTargets: true, passed: 11, failures: [] });
  a.values.neutral = 0.25;
  expect(assessD45(a).failures).toEqual(['neutral']);
});
test('D45 qualifying selection minimizes largest deviation then snowball, without favoring conquest', () => {
  const a = candidate('a', 0.5, 0.58, 0.5); a.values.conquest = 0.6;
  const b = candidate('b', 0.54, 0.55, 0.6), c = candidate('c', 0.54, 0.55, 0.59);
  expect(rankD45([a, b, c]).winner).toBe('c');
  expect(rankD45([b, { ...b, id: 'tied' }]).winner).toBe('b');
});
test('D45 fallback counts each pair once and requires both sides, then maximizes conquest', () => {
  const a = candidate('a', 0.39), b = candidate('b', 0.39), c = candidate('c', 0.39);
  a.values.conquest = 0.39; b.values.conquest = 0.4; c.values.conquest = 0.41;
  expect(rankD45([a, b, c])).toMatchObject({ winner: 'c', qualified: false });
  const missing = candidate('missing'); missing.pairs[0].results.pop();
  expect(assessD45(missing).failures).toEqual(['aggressive/expansion']);
  const unequal = candidate('unequal'); unequal.pairs[0].results[1].pointEstimate = 0.61;
  expect(assessD45(unequal).failures).toEqual(['aggressive/expansion']);
});
test('D45 markers respect exact5pp and do not include the descriptive pairing', () => {
  const a = assessD45(candidate('a', 0.45));
  expect(a.checks.find(row => row.key === 'aggressive/expansion')!.needsAdditionalSeeds).toBe(false);
  expect(a.checks.some(row => row.key === 'conservative/expansion')).toBe(false);
  expect(assessD45(candidate('b', 0.44)).checks.find(row => row.key === 'aggressive/expansion')!.needsAdditionalSeeds).toBe(true);
});
