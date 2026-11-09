import { expect, test } from 'vitest';
import { LEADER_IDS } from '../../src/content/leaders.ts';
import type { LeaderId } from '../../src/content/leaders.ts';
import type { AiPersonality } from '../../src/core/model.ts';
import { acceptance, bootstrapInterval, delta, estimate, gameMetrics, gini, judge, median, quantile, uniqueLeader } from '../../tools/balance-metrics.ts';
import type { GameMetrics, OutcomeKind, SeatMetrics } from '../../tools/balance-metrics.ts';
import { formatDelta, parseReportArgs, renderBalanceReport } from '../../tools/balance-report.ts';
import type { BalanceData } from '../../tools/balance-report.ts';
import { balanceCases, PRESETS } from '../../tools/balance-run.ts';
import type { BalanceGameRecord, BalanceManifest } from '../../tools/balance-run.ts';
import { parseParam, parseSweepArgs, patchFor, stockValue, sweepCells } from '../../tools/balance-sweep.ts';
import type { LeaderGameResult } from '../../tools/leader-balance.ts';

const roles = { ranged: 2, melee: 2, scout: 1, fast: 1, siege: 1, naval: 1, air: 0 };
function seat(index: number, leaderId: LeaderId, personality: AiPersonality, overrides: Partial<SeatMetrics> = {}): SeatMetrics {
  return { seat: index, leaderId, personality, credit: 0, rank: index + 1, score: 100, cities: 3, peakCities: 6, eliminatedRound: null, secondCity: 8, thirdCity: 18,
    fourthCity: 30, firstTech: 5, eras: { 0: 1, 1: 30, 2: 70 }, firstWar: 40, firstCityLost: null, peakRoles: { ...roles }, ...overrides };
}
/** 36 games over 4 seeds: rotations cycle the nine leaders, the winner seat rotates too, so every leader wins 1/4 of its games. */
function games(outcomes: (OutcomeKind | null)[], endRounds: number[], seatOverrides: Partial<SeatMetrics> = {}): GameMetrics[] {
  return outcomes.map((outcome, index) => {
    const rotation = index % 9, winner = index % 4;
    return { id: `g${index}`, seed: 31 + Math.floor(index / 9), group: 'expansion', rotation, roundLimit: 200, status: 'completed', exception: false, outcome,
      winners: [winner], endRound: endRounds[index], eliminated: 0, firstWar: 40, firstCityAttack: 50, firstCityLost: 60,
      leaderAt: { 30: winner, 60: (winner + 1) % 4, 100: null }, leaderChanges: 4, decidedRound: 120, gini: 0.2,
      seats: [0, 1, 2, 3].map(index2 => seat(index2, LEADER_IDS[(index2 + rotation) % 9], 'expansion', { credit: index2 === winner ? 1 : 0, peakCities: 8, ...seatOverrides })) };
  });
}
const KINDS: OutcomeKind[] = ['conquest', 'score', 'pokedex', 'contest', 'faith', 'championship'];
// 36 games: 6 of each victory kind (16.7% each), end rounds spread around 145.
const healthy = games(Array.from({ length: 36 }, (_, index) => KINDS[index % 6]), Array.from({ length: 36 }, (_, index) => 100 + (index * 7) % 90));

test('judge: point estimate decides pass / fail, the interval decides clear / marginal', () => {
  expect(judge(0.2, [0.15, 0.25], 0.1, 0.3)).toEqual({ status: 'pass', confidence: 'clear' });
  expect(judge(0.28, [0.2, 0.36], 0.1, 0.3)).toEqual({ status: 'pass', confidence: 'marginal' });
  expect(judge(0.4, [0.35, 0.45], 0.1, 0.3)).toEqual({ status: 'fail', confidence: 'clear' });
  expect(judge(0.05, [0.02, 0.12], 0.1, 0.3)).toEqual({ status: 'fail', confidence: 'marginal' });
  expect(judge(22, null, null, 22)).toEqual({ status: 'pass', confidence: null });
  expect(judge(Infinity, [20, Infinity], null, 22)).toEqual({ status: 'fail', confidence: 'marginal' });
  expect(judge(null, null, 0, 1).status).toBe('n/a');
});

test('never-reached civs count as infinity in the November medians', () => {
  expect(quantile([10, 20, Infinity, Infinity], 0.5)).toBe(Infinity);
  expect(median([10, 20, 30, Infinity])).toBe(25);
  expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.1)).toBeCloseTo(1.9);
  const sample = games(['conquest', 'score'], [120, 150]);
  sample[0].seats[0].thirdCity = null; sample[0].seats[1].thirdCity = null; sample[1].seats[0].thirdCity = null;
  sample[0].seats[2].thirdCity = 10;
  // 8 civs: 10, 18 ×4, ∞ ×3 → median of [10,18,18,18,18,∞,∞,∞] = 18; one more ∞ makes it ∞.
  expect(estimate(sample, 'thirdCityMedian').value).toBe(18);
  sample[1].seats[1].thirdCity = null;
  expect(estimate(sample, 'thirdCityMedian').value).toBe(Infinity);
  expect(estimate(sample, 'thirdCityReachedMedian').value).toBe(18);
  expect(estimate(sample, 'neverThirdCity')).toMatchObject({ successes: 4, n: 8, value: 0.5 });
});

test('acceptance lines and November targets on a synthetic batch', () => {
  const { checks, targets } = acceptance(healthy, { players: 4, mix: 'same' });
  const status = Object.fromEntries([...checks, ...targets].map(check => [check.id, check.status]));
  expect(status).toMatchObject({ 'max-victory-share': 'pass', 'victory-diversity': 'pass', 'conquest-share': 'pass', 'full-length-share': 'pass',
    'median-end': 'pass', 'ended-before-80': 'pass', 'round60-leader-wins': 'pass', 'leader-changes': 'pass', 'peak-cities': 'pass', 'peak-cities-expansion': 'pass',
    'second-city-median': 'pass', 'never-second-city': 'pass', 'max-role-share': 'pass', 'naval-share': 'pass', 'leader-win-band': 'pass', 'personality-win-band': 'n/a',
    health: 'pass', 'target-first-tech': 'pass', 'target-third-city': 'pass', 'target-median-end': 'pass' });
  expect(estimate(healthy, 'leader60Won').value).toBe(0);
  // Conquest everywhere, short games, a missing leader, a defect.
  const bad = games(Array.from({ length: 36 }, () => 'conquest' as const), Array.from({ length: 36 }, () => 70), { thirdCity: null, peakCities: 2 });
  for (const game of bad) game.seats = game.seats.filter(item => item.leaderId !== 'giovanni');
  bad[0].status = 'defect';
  const failed = acceptance(bad, { players: 4, mix: 'same' });
  const byId = Object.fromEntries([...failed.checks, ...failed.targets].map(check => [check.id, check]));
  for (const id of ['max-victory-share', 'victory-diversity', 'conquest-share', 'median-end', 'ended-before-80', 'peak-cities', 'leader-win-band', 'health', 'target-third-city', 'target-median-end']) {
    expect(byId[id].status, id).toBe('fail');
  }
  expect(byId['leader-win-band'].detail).toContain('未上场：giovanni');
  expect(byId.health.value).toBe(1);
  expect(byId['target-third-city'].value).toBe(Infinity);
  expect(acceptance(healthy, { players: 4, mix: 'mixed' }).checks.find(check => check.id === 'personality-win-band')!.status).toBe('fail');
}, 60_000);

test('intervals: seed-cluster bootstrap is deterministic, paired deltas vanish for identical batches', () => {
  const statistic = (sample: GameMetrics[]) => median(sample.map(game => game.endRound));
  const first = bootstrapInterval(healthy, statistic), second = bootstrapInterval(healthy, statistic);
  expect(first).toEqual(second);
  expect(first![0]).toBeLessThanOrEqual(statistic(healthy)!);
  expect(first![1]).toBeGreaterThanOrEqual(statistic(healthy)!);
  expect(delta(healthy, healthy, 'endMedian')).toEqual({ value: 0, interval: [0, 0] });
  const conquest = delta(healthy, games(Array.from({ length: 36 }, () => 'conquest' as const), healthy.map(game => game.endRound)), 'conquest');
  expect(conquest.value).toBeCloseTo(1 / 6 - 1);
  expect(conquest.interval![1]).toBeLessThan(0);
  expect(formatDelta({ value: -0.05, interval: [-0.1, 0.01] }, 'share')).toBe('−5.0 pp [−10.0, +1.0]');
  expect(formatDelta({ value: 3, interval: [1, Infinity] }, 'round')).toBe('+3 [+1, +∞]');
});

test('per-game metrics: city rounds, leaders, decided round and snowball eligibility', () => {
  const match = balanceCases({ ...PRESETS.gate, players: 2, seeds: [5] })[0];
  const samples = [
    { r: 1, c: [1, 1], s: [10, 10], t: [0, 0], e: [0, 0] },
    { r: 2, c: [2, 1], s: [20, 10], t: [1, 0], e: [0, 0] },
    { r: 3, c: [3, 2], s: [20, 30], t: [1, 1], e: [0, 0] },
    { r: 4, c: [3, 3], s: [40, 30], t: [2, 1], e: [0, 0] },
    { r: 5, c: [4, 3], s: [50, 30], t: [2, 2], e: [0, 0], final: true as const },
  ];
  const result = { status: 'completed', exception: null, outcomeKind: 'faith', winners: [0], round: 5, eliminatedSeats: [], eliminations: [],
    ranking: [{ playerId: 0, total: 50 }, { playerId: 1, total: 30 }], cityEvents: [
      { round: 3, defenderId: -1, attackerId: 1, captured: true }, { round: 4, defenderId: 0, attackerId: 1, captured: false }, { round: 5, defenderId: 1, attackerId: 0, captured: true }],
    warEpisodes: [{ a: 0, b: 1, startRound: 4 }], progressionBySeat: [{ seat: 0, eraArrivalRounds: { 0: 1, 1: 4 } }, { seat: 1, eraArrivalRounds: { 0: 1 } }],
    scoreByLeader: { [match.leaderBySeat[0]]: { winCredit: 1, rank: 1, total: 50, cities: 4 }, [match.leaderBySeat[1]]: { winCredit: 0, rank: 2, total: 30, cities: 3 } },
    activityByLeader: { [match.leaderBySeat[0]]: { peakCities: 4, peakCombatUnitsByRole: roles }, [match.leaderBySeat[1]]: { peakCities: 3, peakCombatUnitsByRole: roles } },
  } as unknown as LeaderGameResult;
  const metrics = gameMetrics({ schemaVersion: 1, case: match, result, samples, curves: [] } satisfies BalanceGameRecord);
  expect(metrics).toMatchObject({ firstWar: 4, firstCityAttack: 4, firstCityLost: 5, leaderChanges: 2, decidedRound: 4, leaderAt: { 30: null, 60: null, 100: null } });
  expect(metrics.seats[0]).toMatchObject({ secondCity: 2, thirdCity: 3, fourthCity: 5, firstTech: 2, eras: { 0: 1, 1: 4 }, credit: 1, firstWar: 4, firstCityLost: null });
  expect(metrics.seats[1]).toMatchObject({ secondCity: 3, thirdCity: 4, fourthCity: null, firstTech: 3, firstCityLost: 5 });
  expect(uniqueLeader({ s: [5, 5, 3], e: [0, 0, 0] })).toBeNull();
  expect(uniqueLeader({ s: [9, 5, 3], e: [1, 0, 0] })).toBe(1);
  expect(gini([1, 1, 1])).toBe(0);
  expect(gini([0, 0, 4])).toBeCloseTo(2 / 3);
});

test('the report prints targets, lines and both delta columns', () => {
  const manifest = { config: PRESETS.gate, games: 36, gitHead: 'abc', gitDirty: false, node: 'v22', contentVersion: 'improvements-v23', scheduleSha256: '0'.repeat(64),
    workers: 4, wallSeconds: 1, cpuSeconds: 2, patch: null } as unknown as BalanceManifest;
  const data: BalanceData = { directory: '/tmp/x', manifest, games: healthy, curves: [] };
  const markdown = renderBalanceReport(data, { baseline: data, anchor: { ...data, directory: '/tmp/anchor' } });
  expect(markdown).toContain('11 月目标：3/3 通过');
  expect(markdown).toContain('| Δ 基线 | Δ 锚点 |');
  expect(markdown).toContain('第三座城（每个文明，中位） | ≤ 22 | 18');
  expect(markdown).toContain('±0 [±0, ±0]');
  expect(parseReportArgs(['dir', '--anchor', 'a', '--out', 'r.md'])).toEqual({ directory: 'dir', baseline: null, anchor: 'a', out: 'r.md' });
  expect(() => parseReportArgs(['--anchor', 'a'])).toThrow();
}, 60_000);

test('sweep: parameters, stock detection and validation against the version content', () => {
  expect(parseParam('balance.city.defense=50,60,70')).toEqual({ path: 'balance.city.defense', values: [50, 60, 70] });
  expect(parseParam('ai.expansionMaySiege=true,false').values).toEqual([true, false]);
  expect(() => parseParam('ai.x=1.5')).toThrow();
  expect(() => parseParam('ai.x=1,1')).toThrow('duplicate');
  expect(patchFor('balance.city.defense', 60)).toEqual({ balance: { city: { defense: 60 } } });
  const config = { ...PRESETS.sweep };
  expect(stockValue(config, 'balance.city.defense')).toBe(50);
  expect(stockValue(config, 'balance.city.baseHp')).toBe(100);
  expect(stockValue(config, 'ai.aggressiveWarStrength')).toBe(1250);
  const cells = sweepCells(config, [parseParam('balance.city.defense=50,60'), parseParam('ai.aggressiveWarStrength=1250,1500')]);
  expect(cells.map(cell => cell.name)).toEqual(['stock', 'balance.city.defense=50+ai.aggressiveWarStrength=1500', 'balance.city.defense=60+ai.aggressiveWarStrength=1250',
    'balance.city.defense=60+ai.aggressiveWarStrength=1500']);
  expect(cells[3].patch).toEqual({ balance: { city: { defense: 60 } }, ai: { aggressiveWarStrength: 1500 } });
  expect(() => sweepCells(config, [parseParam('balance.city.nope=1')])).toThrow();
  expect(() => sweepCells(config, [parseParam('balance.city.defense=0')])).toThrow('patch.balance.city.defense');
  const parsed = parseSweepArgs(['--param', 'balance.city.defense=60', '--param', 'ai.peaceCitiesLost=2', '--seeds', '31', '--out', '/tmp/s'], 64);
  expect(parsed).toMatchObject({ preset: 'sweep', workers: 32, out: '/tmp/s' });
  expect(parsed.config.seeds).toEqual([31]);
  expect(parsed.params).toHaveLength(2);
  expect(() => parseSweepArgs(['--out', '/tmp/s'], 64)).toThrow();
  expect(() => parseSweepArgs(['--param', 'a.b=1', '--param', 'a.b=2', '--out', '/tmp/s'], 64)).toThrow('each path once');
});
