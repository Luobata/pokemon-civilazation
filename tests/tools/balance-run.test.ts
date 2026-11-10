import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { LEADER_IDS } from '../../src/content/leaders.ts';
import { LATEST_GAMEPLAY_VERSION } from '../../src/content/eras.ts';
import { contentFor } from '../../src/content/units.ts';
import { leaderBalanceCases, PERSONALITIES, simulateLeaderCase } from '../../tools/leader-balance.ts';
import { balanceCases, createObserver, finalizeRun, formatSeeds, parseBalanceArgs, parseSeeds, playJob, prepareRun, PRESETS, readGameRecord, runJobs } from '../../tools/balance-run.ts';
import type { BalanceConfig } from '../../tools/balance-run.ts';
import { gameCurveRows, gameMetrics } from '../../tools/balance-metrics.ts';
import { compareGames } from '../../tools/compare-games.ts';

const scratch = mkdtempSync(join(tmpdir(), 'balance-run-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
/** 16×12, two players, 100 rounds: the three fastest games of seed 1 (about 3–5 s each). */
const tiny: BalanceConfig = { ...PRESETS.gate, width: 16, height: 12, rounds: 100, players: 2, seeds: [1] };
const TINY_IDS = ['s1-aggressive-r0', 's1-aggressive-r8', 's1-conservative-r5'];

test('arguments: gate preset by default, explicit flags override, bad input is refused', () => {
  const parsed = parseBalanceArgs(['--out', '/tmp/x'], 64);
  expect(parsed).toMatchObject({ preset: 'gate', workers: 32, patch: null, out: '/tmp/x' });
  expect(parsed.config).toEqual({ gameplay: LATEST_GAMEPLAY_VERSION, width: 40, height: 26, rounds: 200, eras: 'simple', seeds: [31, 32, 33, 34, 35, 36, 37, 38], players: 4, mix: 'same' });
  expect(parseBalanceArgs(['--out', '/tmp/x'], 8).workers).toBe(4);
  const custom = parseBalanceArgs(['--preset', 'full-spot', '--gameplay', '22', '--size', '24x16', '--rounds', '100', '--seeds', '1-3,7', '--players', '3',
    '--mix', 'mixed', '--workers', '6', '--patch', 'p.json', '--out', '/tmp/y'], 64);
  expect(custom.config).toEqual({ gameplay: 22, width: 24, height: 16, rounds: 100, eras: 'full', seeds: [1, 2, 3, 7], players: 3, mix: 'mixed' });
  expect(custom).toMatchObject({ preset: 'full-spot', workers: 6, patch: 'p.json' });
  expect(parseSeeds('31-38')).toEqual([31, 32, 33, 34, 35, 36, 37, 38]);
  expect(formatSeeds([1, 2, 3, 7, 9, 10])).toBe('1-3,7,9-10');
  for (const args of [[], ['--seeds', '1'], ['--out', 'a', '--out', 'b'], ['--out', 'a', '--bogus', '1'], ['--out', 'a', '--eras', 'none'],
    ['--out', 'a', '--gameplay', '3'], ['--out', 'a', '--gameplay', '99'], ['--out', 'a', '--rounds', '150'], ['--out', 'a', '--players', '5'],
    ['--out', 'a', '--size', '40'], ['--out', 'a', '--seeds', '3-1'], ['--out', 'a', '--seeds', '1,1'], ['--out', 'a', '--workers', '0'],
    ['--out', 'a', '--workers', '65'], ['--out', 'a', '--mix', 'random'], ['--out', 'a', '--preset', 'nope'], ['--out']]) {
    expect(() => parseBalanceArgs(args, 64), args.join(' ')).toThrow();
  }
});

test('gate seating: 216 games, all nine leaders play equally often in every seat and personality', () => {
  const cases = balanceCases(PRESETS.gate);
  expect(cases).toHaveLength(8 * 9 * 3);
  expect(new Set(cases.map(item => item.id)).size).toBe(cases.length);
  for (const leaderId of LEADER_IDS) {
    const seats = cases.flatMap(item => Object.entries(item.leaderBySeat).filter(([, id]) => id === leaderId).map(([seat]) => Number(seat)));
    expect(seats).toHaveLength(96);
    for (const seat of [0, 1, 2, 3]) expect(seats.filter(value => value === seat)).toHaveLength(24);
    for (const personality of PERSONALITIES) expect(cases.filter(item => item.personality === personality && Object.values(item.leaderBySeat).includes(leaderId))).toHaveLength(32);
  }
  for (const item of cases) expect(new Set(Object.values(item.leaderBySeat)).size).toBe(4);
  // Four players, one personality per table: the same setups as leader-balance (district-smoke runs rotations 0–3 of them).
  const legacy = leaderBalanceCases({ seeds: 8, seedStart: 31, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: LATEST_GAMEPLAY_VERSION, roundLimit: 200, width: 40, height: 26 });
  expect(cases.map(item => JSON.stringify(item.setup))).toEqual(legacy.map(item => JSON.stringify(item.setup)));
});

test('mixed and smaller tables keep every leader × personality pairing balanced', () => {
  for (const players of [2, 3, 4] as const) {
    const cases = balanceCases({ ...PRESETS.mixed, players, seeds: [1] });
    expect(cases).toHaveLength(27);
    const pairs = new Map<string, number>();
    for (const item of cases) for (const seat of Object.keys(item.leaderBySeat).map(Number)) {
      const key = `${item.leaderBySeat[seat]}:${item.personalityBySeat[seat]}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
      expect(item.setup.players[seat]).toMatchObject({ personality: item.personalityBySeat[seat], leaderId: item.leaderBySeat[seat] });
    }
    expect(pairs.size).toBe(27);
    expect(new Set(pairs.values())).toEqual(new Set([players]));
  }
});

test('the observer does not change the game, and metrics follow from the record', () => {
  const match = balanceCases(tiny).find(item => item.id === 's1-aggressive-r8')!;
  const plain = simulateLeaderCase(match);
  const observer = createObserver(contentFor(match.setup));
  const observed = simulateLeaderCase(match, observer.onState);
  expect(JSON.stringify(observed)).toBe(JSON.stringify(plain));
  const record = { schemaVersion: 1 as const, case: match, result: observed, samples: observer.samples, curves: observer.curves };
  const metrics = gameMetrics(record);
  expect(metrics).toMatchObject({ id: match.id, endRound: plain.round, outcome: plain.outcomeKind, winners: plain.winners, status: 'completed' });
  expect(observer.samples.map(sample => sample.r)).toEqual(Array.from({ length: plain.round }, (_, index) => index + 1));
  expect(observer.samples.at(-1)!.final).toBe(true);
  expect(observer.curves.map(point => point.round)).toEqual(Array.from({ length: Math.floor(plain.round / 10) }, (_, index) => (index + 1) * 10));
  for (const [index, seat] of metrics.seats.entries()) {
    const firstCity = (count: number) => observer.samples.find(sample => sample.e[index] === 0 && sample.c[index] >= count)?.r ?? null;
    expect([seat.secondCity, seat.thirdCity, seat.fourthCity]).toEqual([firstCity(2), firstCity(3), firstCity(4)]);
    expect(seat.leaderId).toBe(match.leaderBySeat[index]);
    expect(seat.credit).toBe(plain.winners.includes(index) ? 1 / plain.winners.length : 0);
  }
  expect(gameCurveRows(record)).toHaveLength(observer.curves.length * 2);
}, 60_000);

test('per-game files, metrics and curves are byte-identical for 1 and 3 workers', async () => {
  const run = async (name: string, workers: number) => {
    const out = join(scratch, name);
    const { manifest, jobs } = prepareRun(out, { preset: 'gate', config: tiny, workers, command: [] });
    const subset = jobs.filter(job => TINY_IDS.includes(job.case.id));
    finalizeRun(out, { ...manifest, games: subset.length }, subset, await runJobs(subset, workers), 0);
    return out;
  };
  const one = await run('one', 1), three = await run('three', 3);
  expect(compareGames(one, three)).toMatchObject({ games: 3, identical: 3, mismatches: [] });
  for (const file of ['metrics.jsonl', 'curves.jsonl']) expect(readFileSync(join(three, file))).toEqual(readFileSync(join(one, file)));
  expect(readdirSync(join(one, 'games')).sort()).toEqual(TINY_IDS.map(id => `${id}.json`).sort());
  expect(() => prepareRun(one, { preset: 'gate', config: tiny, workers: 1, command: [] })).toThrow('already exists');
  // A record re-read from disk gives the same metrics as the line written for it.
  const lines = readFileSync(join(one, 'metrics.jsonl'), 'utf8').trim().split('\n');
  expect(JSON.stringify(gameMetrics(readGameRecord(join(one, 'games', `${TINY_IDS[0]}.json`))))).toBe(lines[0]);
}, 120_000);

test('playJob writes a record whose result equals the plain simulation', () => {
  const match = balanceCases(tiny).find(item => item.id === 's1-conservative-r5')!, file = join(scratch, 'single.json');
  expect(playJob({ case: match, patch: null, file }).status).toBe('completed');
  expect(JSON.stringify(readGameRecord(file).result)).toBe(JSON.stringify(simulateLeaderCase(match)));
}, 60_000);
