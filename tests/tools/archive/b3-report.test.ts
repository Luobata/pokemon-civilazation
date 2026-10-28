import { expect, test } from 'vitest';
import { rankCandidates } from '../../../tools/archive/b3-report.ts';
import type { Candidate } from '../../../tools/archive/b3-report.ts';

function candidate(id: string, changes: Candidate['values'] = {}): Candidate {
  return { id, values: { defect: 0, aborted: 0, firstSeat: 0.5, snowball: 0.6, captures: 5, neutral: 0.5,
    meanRound: 85, meanFourRound: 90, conquest: 0.4, ...changes }, pairs: [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5]] };
}
test('B3 hard exclusions honor inclusive bounds and strict non-advantage bound', () => {
  const edge = candidate('edge', { aborted: 0.05, firstSeat: 0.55, snowball: 0.75, captures: 3, meanRound: 70, meanFourRound: 95 });
  expect(rankCandidates([edge]).winner).toBe('edge');
  for (const [key, value] of Object.entries({ defect: 1, aborted: 0.051, firstSeat: 0.551, snowball: 0.751,
    captures: 10.1, neutral: 0.25, meanRound: 69.9, meanFourRound: 95.01 })) {
    const result = rankCandidates([candidate(key, { [key]: value })]);
    expect(result.winner).toBeNull();
    expect(result.excluded[0].reasons).toContain(key);
  }
});
test('B3 fallback ranks pair balance before conquest, then distance and snowball', () => {
  const one = candidate('one', { conquest: 0.8 }), two = candidate('two', { conquest: 0.3 });
  one.pairs = [[0.5, 0.5], [0.8, 0.2], [0.8, 0.2]];
  two.pairs = [[0.5, 0.5], [0.5, 0.5], [0.7, 0.3]];
  expect(rankCandidates([one, two]).winner).toBe('two');
  const more = { ...two, id: 'more', values: { ...two.values, conquest: 0.35 } };
  expect(rankCandidates([two, more]).winner).toBe('more');
  const closer = { ...more, id: 'closer', pairs: [[0.5, 0.5], [0.5, 0.5], [0.65, 0.35]] };
  expect(rankCandidates([more, closer]).winner).toBe('closer');
  const lessSnowball = { ...closer, id: 'less', values: { ...closer.values, snowball: 0.5 } };
  expect(rankCandidates([closer, lessSnowball]).winner).toBe('less');
});
test('B3 full-target candidates precede incomplete candidates and then minimize snowball', () => {
  const incomplete = candidate('incomplete', { conquest: 0.8 });
  incomplete.pairs[0] = [0.7, 0.3];
  const full = candidate('full'), safer = candidate('safer', { snowball: 0.55 });
  expect(rankCandidates([incomplete, full, safer]).eligible.map(row => row.id)).toEqual(['safer', 'full', 'incomplete']);
});
test('B3 missing primary metrics cannot silently win', () => {
  const missing = candidate('missing'); missing.pairs[0][0] = null;
  expect(rankCandidates([missing]).winner).toBeNull();
});
