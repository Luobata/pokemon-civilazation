import { expect, test } from 'vitest';
import { ratio, wilson95, winCredit, threshold } from '../../tools/statistics.ts';
import { explorationMatches, matchSetup } from '../../tools/matches.ts';
import { createGame } from '../../src/core/game.ts';

test('D18 Wilson 50/100 vector and no observations', () => {
  const interval = wilson95(50, 100)!;
  expect(interval[0] * 100).toBeCloseTo(40.38, 2); expect(interval[1] * 100).toBeCloseTo(59.62, 2);
  expect(ratio([])).toEqual({ numerator: 0, n: 0, independentSeeds: 0, pointEstimate: null, wilson95: null });
});
test('draws always credit 0.5 per winner; independent seeds are deduplicated', () => {
  expect(winCredit([0, 1, 2], 0)).toBe(0.5); expect(winCredit([0, 1], 2)).toBe(0); expect(winCredit([0], 0)).toBe(1);
  const stat = ratio([{ seed: 1, successes: 0.5, trials: 1 }, { seed: 1, successes: 1, trials: 1 }]);
  expect(stat).toMatchObject({ numerator: 1.5, n: 2, independentSeeds: 1, pointEstimate: 0.75 });
});
test('D18 point targets and exactly5 percentage points do not demand extra seeds', () => {
  expect(threshold(0.45, 0.4, 0.6, true).needsAdditionalSeeds).toBe(false);
  expect(threshold(0.44, 0.4, 0.6, true).needsAdditionalSeeds).toBe(true);
  expect(threshold(0.39, 0.4, 0.6, true).passes).toBe(false);
  expect(threshold(0.25, 0.25, null, true, true).passes).toBe(false);
  expect(threshold(96, 70, 95, false).needsAdditionalSeeds).toBe(true);
  expect(threshold(null, 0, 1, true).passes).toBeNull();
});
test('100 seeds produce33/33/34 paired1v1 and100 four-player matches', () => {
  const matches = explorationMatches(100), duels = matches.filter(match => match.mode === '1v1');
  expect(matches).toHaveLength(300); expect(duels).toHaveLength(200);
  expect(new Set(matches.map(match => match.seed)).size).toBe(100);
  const pairs = new Map<string, number>();
  for (const match of duels) { const key = [...match.personalities].sort().join('/'); pairs.set(key, (pairs.get(key) ?? 0) + 1); }
  expect([...pairs.values()].sort()).toEqual([66, 66, 68]);
  for (const match of matches.filter(match => match.mode === '1v3')) expect(match.personalities).toHaveLength(4);
  const [a, b] = matches;
  expect(b.personalities).toEqual([...a.personalities].reverse());
  const first = createGame(matchSetup(a)), swapped = createGame(matchSetup(b));
  expect(first.map).toEqual(swapped.map); expect(first.rng).toEqual(swapped.rng);
  expect(first.cities).toEqual(swapped.cities);
  expect(first.players[0].personality).toBe(swapped.players[1].personality);
});
