import { expect, test } from 'vitest';
import { checkDistrictGames } from '../../tools/district-preview-check.ts';
import { leaderBalanceCases } from '../../tools/leader-balance.ts';

// One complete game exercises the same checker as the 48-game CLI; the scan includes every visible tile.
test('district public blockers and complete effects match authority through a real game', () => {
  const match = leaderBalanceCases({ seeds: 1, seedStart: 31, expansionVersion: 1, eraProgression: 'simple-v1',
    gameplayVersion: 10, roundLimit: 100, width: 24, height: 16 })[0];
  const report = checkDistrictGames([match]);
  expect(report).toMatchObject({ games: 1, completed: 1, defect: 0, aborted: 0, exceptions: 0, mismatches: 0, examples: [] });
  expect(report.blockerChecks).toBeGreaterThan(0);
  expect(report.completeEffectChecks).toBeGreaterThan(0);
  expect(report.incomplete).toBeGreaterThan(0);
  expect(report.incomplete + report.completeEffectChecks).toBe(report.blockerChecks);
}, 30_000);
