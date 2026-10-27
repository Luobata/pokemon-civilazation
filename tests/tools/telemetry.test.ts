import { expect, test } from 'vitest';
import { combatFixture, pokemon, issue } from '../core/combat-fixture.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { eligibleKnockdown, withoutTypeAdvantage, eligibleSnowball, summarizeGames } from '../../tools/summary.ts';
import type { GameMetrics } from '../../tools/summary.ts';
import type { KnockdownRecord } from '../../src/core/model.ts';
import { createTelemetry, uniqueScoreLeader, roundSnapshot } from '../../tools/telemetry.ts';

const kill: KnockdownRecord = { source: { id: 10, ownerId: 0, kind: 'pokemon', typeId: 'fire' },
  target: { id: 11, ownerId: null, kind: 'pokemon', typeId: 'water' }, effectiveness: 50, counter: false };
test('D37 filters kind/owner and includes E50/E100 but excludes advantage', () => {
  expect(withoutTypeAdvantage(kill)).toBe(true);
  expect(withoutTypeAdvantage({ ...kill, counter: true, effectiveness: 100 })).toBe(true);
  expect(eligibleKnockdown({ ...kill, effectiveness: 220 })).toBe(true);
  expect(withoutTypeAdvantage({ ...kill, effectiveness: 220 })).toBe(false);
  expect(eligibleKnockdown({ ...kill, source: { ...kill.source, ownerId: null } })).toBe(false);
  expect(eligibleKnockdown({ ...kill, source: { ...kill.source, kind: 'city', typeId: null } })).toBe(false);
  expect(eligibleKnockdown({ ...kill, target: { ...kill.target, kind: 'logistics', typeId: null } })).toBe(false);
});
test('core emits actual final-hit attributes including counters, cities and logistics without changing kill rules', () => {
  const state = combatFixture(); pokemon(state); pokemon(state, 11, 'bulbasaur', null, 4, 3).hp = 1;
  state.players[0].research.unlockedIds.push('typeResearch');
  const attack = { type: 'Attack' as const, unitId: 10, target: { kind: 'unit' as const, id: 11 } };
  const result = issue(state, attack); if (!result.ok) throw new Error(result.reason);
  const battle = result.events[0].payload;
  expect(battle).toMatchObject({ type: 'BattleResolved', knockdowns: [{ source: { ownerId: 0, kind: 'pokemon', typeId: 'fire' }, target: { ownerId: null, kind: 'pokemon', typeId: 'grass' }, effectiveness: 220, counter: false }] });
  expect(result.state.players[0].knockdownCount).toBe(state.players[0].knockdownCount + 1);
  expect(result.state.units[11]).toBeUndefined(); expect(state.units[11].hp).toBe(1);
  state.diplomacy[0].status = 'war'; state.units[11] = createMapUnit({ kind: 'logistics', role: 'settler' }, 11, 1, { q: 4, r: 3 });
  const logistics = issue(state, attack); if (!logistics.ok) throw new Error(logistics.reason);
  expect(logistics.events[0].payload).toMatchObject({ knockdowns: [{ target: { kind: 'logistics', typeId: null }, effectiveness: 100 }] });
  pokemon(state, 10, 'charmander', 0, 9, 2).hp = 1;
  const city = issue(state, { type: 'Attack', unitId: 10, target: { kind: 'city', id: 2 } }); if (!city.ok) throw new Error(city.reason);
  expect(city.events[0].payload).toMatchObject({ knockdowns: [{ source: { kind: 'city', ownerId: 1, typeId: null }, counter: true, effectiveness: 100 }] });
  pokemon(state, 10, 'charmander', 0, 3, 3).hp = 1; pokemon(state, 11, 'squirtle', 1, 4, 3);
  const counter = issue(state, attack); if (!counter.ok) throw new Error(counter.reason);
  expect(counter.events[0].payload).toMatchObject({ knockdowns: [{ source: { id: 11, typeId: 'water' }, target: { id: 10 }, counter: true, effectiveness: 200 }] });
});
function game(seed: number, round: number, leader: number | null, reached = true, aborted = false): GameMetrics {
  const state = combatFixture(), telemetry = createTelemetry(state); telemetry.round30Leader = leader; telemetry.reachedRound30End = reached;
  return { id: `g${seed}`, seed, mode: '1v1', leg: 0, personalities: ['expansion', 'aggressive'], winners: [0], kind: 'score', round, aborted,
    defect: false, legacyAborted: aborted, invalid: [], exception: null, commandLimitReached: false, commandCount: 1, starters: [], outcome: null, telemetry, completedRounds: reached ? 30 : 0 };
}
test('snowball denominator excludes early, tied, aborted and incomplete round30; ties count0.5 wins', () => {
  const early = game(1, 29, null, false), tie = game(2, 100, null), aborted = game(3, 40, 0, true, true), mid30 = game(4, 30, null, false);
  const win = game(5, 100, 0), loss = game(6, 100, 1), draw = game(7, 100, 0); draw.winners = [0, 1];
  for (const excluded of [early, tie, aborted, mid30]) expect(eligibleSnowball(excluded)).toBe(false);
  const summary = summarizeGames([early, tie, aborted, mid30, win, loss, draw]);
  expect(summary.snowball).toMatchObject({ numerator: 1.5, n: 3, independentSeeds: 3, pointEstimate: 0.5 });
  expect(summary.earlyEndingBeforeRound30Count).toBe(1);
  expect(summary.snowballExclusions).toEqual({ aborted: 1, defect: 0, noRound30End: 2, tiedRound30Lead: 1 });
  const score = roundSnapshot(combatFixture(), 30); expect(uniqueScoreLeader(score)).toBeNull();
  score.players[0].score.total++; expect(uniqueScoreLeader(score)).toBe(0);
});
test('1v3 never enters first-seat or pairwise metrics, capture metric counts attempts', () => {
  const duel = game(1, 80, 0), four = game(2, 90, 0); four.mode = '1v3'; four.personalities = ['expansion', 'aggressive', 'conservative', 'expansion'];
  four.telemetry.activity[0].captureAttempts = 6;
  const summary = summarizeGames([duel, four]);
  expect(summary.firstSeat.n).toBe(1); expect(summary.pairwise[0].results[0].n).toBe(1);
  expect(summary.captureAttemptsPerGame.value).toBe(3);
  expect(summary.fourPlayerWinners.find(row => row.personality === 'expansion')).toMatchObject({ n: 1, pointEstimate: 1 });
});
test('D38 retains fog-rejected completed games and excludes defect games separately from command-limit aborts', () => {
  const fog = game(1, 100, 0), defect = game(2, 100, 0), limit = game(3, 100, 0, true, true);
  const rejected = { round: 1, seq: 0, reason: 'invalid-city-site', command: { actorId: 0, expectedSeq: 0, action: { type: 'FoundCity' as const, unitId: 10 } } };
  fog.legacyAborted = true; fog.invalid = [{ ...rejected, category: 'fog' }];
  defect.defect = true; defect.invalid = [{ ...rejected, category: 'defect' }];
  const summary = summarizeGames([fog, defect, limit]);
  expect(summary.valid).toBe(1); expect(summary.snowball.n).toBe(1);
  expect(summary.aborted).toMatchObject({ numerator: 1, n: 3 });
  expect(summary).toMatchObject({ defectGameCount: 1, fogRejectionCount: 1, defectRejectionCount: 1 });
});
