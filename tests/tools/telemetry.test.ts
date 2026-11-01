import { expect, test } from 'vitest';
import { combatFixture, pokemon, issue } from '../core/combat-fixture.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { eligibleKnockdown, withoutTypeAdvantage, eligibleSnowball, summarizeGames } from '../../tools/summary.ts';
import type { GameMetrics } from '../../tools/summary.ts';
import type { KnockdownRecord } from '../../src/core/model.ts';
import { collectTelemetry, createTelemetry, finalizeTelemetry, roundSnapshot, uniqueScoreLeader } from '../../tools/telemetry.ts';

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

test('war telemetry counts resolved city pressure, siege timing, elimination and role evidence', () => {
  const state = combatFixture();
  state.round = 7;
  state.activePlayerId = 0;
  state.players[0].research.unlockedIds.push('siegeCraft');
  const telemetry = createTelemetry(state);
  collectTelemetry(telemetry, state, state, { actorId: 0, expectedSeq: 0, action: { type: 'EndTurn' } }, [
    { seq: 1, index: 0, payload: { type: 'TechCompleted', playerId: 0, techId: 'siegeCraft' } },
  ]);
  const declared = issue(state, { type: 'DeclareWar', targetPlayerId: 1 });
  if (!declared.ok) throw new Error(declared.reason);
  collectTelemetry(telemetry, state, declared.state, { actorId: 0, expectedSeq: 0, action: { type: 'DeclareWar', targetPlayerId: 1 } }, declared.events);
  const battleBefore = declared.state;
  battleBefore.cities[2].hp = 1;
  pokemon(battleBefore, 10, 'geodude', 0, 9, 2);
  const battle = issue(battleBefore, { type: 'Attack', unitId: 10, target: { kind: 'city', id: 2 } });
  if (!battle.ok) throw new Error(battle.reason);
  collectTelemetry(telemetry, battleBefore, battle.state, { actorId: 0, expectedSeq: 1, action: { type: 'Attack', unitId: 10, target: { kind: 'city', id: 2 } } }, battle.events);
  finalizeTelemetry(telemetry, battle.state);

  expect(telemetry.activity[0]).toMatchObject({
    resolvedCityAttacks: 1, cityCaptures: 1, hqAttacks: 1, hqCaptures: 1,
    firstCityAttackRound: 7, firstHQAttackRound: 7, siegeCraftRound: 7, warDeclarations: 1,
    cityAttacksByRole: expect.objectContaining({ siege: 1 }), cityCapturesByRole: expect.objectContaining({ siege: 1 }),
    cityAttacksByProgressionBand: expect.objectContaining({ early: 1 }),
  });
  expect(telemetry.activity[1]).toMatchObject({ cityLosses: 1 });
  expect(telemetry.cityEvents[0]).toMatchObject({
    round: 7, attackerId: 0, defenderId: 1, cityId: 2, wasHeadquarters: true, captured: true,
    newOwnerId: 0, attackerRole: 'siege', attackerTechCount: 1, attackerHasSiegeCraft: true, progressionBand: 'early',
  });
  expect(telemetry.eliminations).toEqual([{ round: 7, seq: 2, playerId: 1 }]);
  expect(telemetry.warEpisodes).toEqual([
    { a: 0, b: 1, declaredBy: 0, startRound: 7, endRound: 7, status: 'eliminated', rounds: 0 },
  ]);
  expect(telemetry.activeWarsAtEnd).toBe(0);
});

test('war episodes close on peace and attribute one agreement to each side', () => {
  const before = combatFixture();
  before.round = 4;
  const afterDeclaration = structuredClone(before);
  const relation = afterDeclaration.diplomacy[0];
  relation.status = 'war'; relation.changedAtRound = 4; relation.declaredBy = 0;
  const telemetry = createTelemetry(before);
  collectTelemetry(telemetry, before, afterDeclaration, { actorId: 0, expectedSeq: 0, action: { type: 'DeclareWar', targetPlayerId: 1 } }, [
    { seq: 1, index: 0, payload: { type: 'DiplomacyChanged', relation: structuredClone(relation) } },
  ]);
  const afterPeace = structuredClone(afterDeclaration);
  afterPeace.diplomacy[0] = { ...afterPeace.diplomacy[0], status: 'peace', changedAtRound: 9, declaredBy: null, proposal: null };
  collectTelemetry(telemetry, afterDeclaration, afterPeace, { actorId: 1, expectedSeq: 1, action: { type: 'RespondPeace', targetPlayerId: 0, accept: true } }, [
    { seq: 2, index: 0, payload: { type: 'DiplomacyChanged', relation: structuredClone(afterPeace.diplomacy[0]) } },
  ]);
  finalizeTelemetry(telemetry, afterPeace);
  expect(telemetry.warEpisodes).toEqual([
    { a: 0, b: 1, declaredBy: 0, startRound: 4, endRound: 9, status: 'peace', rounds: 5 },
  ]);
  expect(telemetry.activity[0].peaceAgreements).toBe(1);
  expect(telemetry.activity[1].peaceAgreements).toBe(1);
  expect(telemetry.activeWarsAtEnd).toBe(0);
});

test('actual era arrivals use command transitions and include every crossed era', () => {
  const initial = combatFixture();
  initial.setup.expansionVersion = 1;
  initial.setup.eraProgression = 'full-v1';
  initial.players[0].research.unlockedIds.length = 0;
  initial.round = 1;
  const telemetry = createTelemetry(initial);
  collectTelemetry(telemetry, initial, initial, { actorId: 0, expectedSeq: 0, action: { type: 'SetResearch', techId: 'typeResearch' } }, []);

  const advanced = structuredClone(initial);
  initial.round = 9;
  advanced.round = 9;
  advanced.players[0].research.unlockedIds.push('typeResearch', 'riding', 'medicine', 'training', 'siegeCraft');
  collectTelemetry(telemetry, initial, advanced, { actorId: 0, expectedSeq: 1, action: { type: 'SetResearch', techId: 'typeResearch' } }, []);

  expect(telemetry.rounds).toEqual([]);
  expect(telemetry.activity[0].eraArrivalRounds).toEqual({ 0: 1, 1: 9, 2: 9, 3: 9, 4: 9 });
});

test('final combat roles use the final state even after a mid-round clear', () => {
  const before = combatFixture();
  before.round = 5;
  pokemon(before, 10, 'geodude', 0, 3, 3);
  const roundEnded = structuredClone(before);
  const telemetry = createTelemetry(before);
  collectTelemetry(telemetry, before, roundEnded, { actorId: 0, expectedSeq: 0, action: { type: 'EndTurn' } }, [
    { seq: 1, index: 0, payload: { type: 'RoundEnded', round: 5 } },
  ]);
  expect(telemetry.activity[0].combatUnitsByRole).toMatchObject({ siege: 1 });

  const final = structuredClone(roundEnded);
  delete final.units[10];
  finalizeTelemetry(telemetry, final);
  expect(telemetry.activity[0].combatUnitsByRole).toMatchObject({ siege: 0 });
  expect(telemetry.activity[0].peakCombatUnitsByRole).toMatchObject({ siege: 1 });
});

test('elimination closes active war episodes and stops war-round accrual for dead seats', () => {
  const before = combatFixture();
  before.round = 6;
  const afterDeclaration = structuredClone(before);
  const relation = afterDeclaration.diplomacy[0];
  relation.status = 'war'; relation.changedAtRound = 4; relation.declaredBy = 0;
  const telemetry = createTelemetry(before);
  collectTelemetry(telemetry, before, afterDeclaration, { actorId: 0, expectedSeq: 0, action: { type: 'DeclareWar', targetPlayerId: 1 } }, [
    { seq: 1, index: 0, payload: { type: 'DiplomacyChanged', relation: structuredClone(relation) } },
  ]);
  const afterElimination = structuredClone(afterDeclaration);
  afterElimination.round = 6;
  afterElimination.players[1].eliminated = true;
  afterElimination.turnOrder = [0];
  collectTelemetry(telemetry, afterDeclaration, afterElimination, { actorId: 0, expectedSeq: 1, action: { type: 'Attack', unitId: 10, target: { kind: 'city', id: 2 } } }, [
    { seq: 2, index: 0, payload: { type: 'CivilizationEliminated', eliminatedPlayerId: 1 } },
  ]);
  collectTelemetry(telemetry, afterElimination, afterElimination, { actorId: 0, expectedSeq: 2, action: { type: 'EndTurn' } }, [
    { seq: 3, index: 0, payload: { type: 'RoundEnded', round: 6 } },
  ]);
  finalizeTelemetry(telemetry, afterElimination);
  expect(telemetry.warEpisodes).toEqual([
    { a: 0, b: 1, declaredBy: 0, startRound: 4, endRound: 6, status: 'eliminated', rounds: 2 },
  ]);
  expect(telemetry.activeWarsAtEnd).toBe(0);
  expect(telemetry.activity[0].warRounds).toBe(0);
  expect(telemetry.activity[1].warRounds).toBe(0);
});
