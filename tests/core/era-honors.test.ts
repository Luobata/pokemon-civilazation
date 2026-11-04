import { expect, test } from 'vitest';
import { EXPANSION_CONTENT } from '../../src/content/units.ts';
import { ERA_HONOR_RULES, ERA_MILESTONES } from '../../src/content/era-honors.ts';
import type { EraMilestone } from '../../src/content/era-honors.ts';
import { RULE_QUERIES } from '../../src/ai/query.ts';
import { planNext } from '../../src/ai/plan.ts';
import { rememberCityRejection } from '../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../src/ai/memory.ts';
import { replay } from '../../src/app/session.ts';
import type { CommandLog } from '../../src/app/session.ts';
import { createGame } from '../../src/core/game.ts';
import { observe } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { gameVersions } from '../../src/core/versions.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { ageFor } from '../../src/core/era-honors.ts';
import { leaguePointsPerRound, playerPolicyEffects } from '../../src/core/policies.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';

const setup = (gameplayVersion: 11 | 12): GameSetup => ({ seed: 32, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion, players: [
  { id: 0, controller: 'ai', personality: 'expansion', leaderId: 'oak' }, { id: 1, controller: 'ai', personality: 'aggressive', leaderId: 'lance' },
  { id: 2, controller: 'ai', personality: 'conservative', leaderId: 'joy' }] });

function play(gameplayVersion: 11 | 12, rounds: number): { state: GameState; commands: Command[] } {
  let state = createGame(setup(gameplayVersion), EXPANSION_CONTENT);
  const commands: Command[] = [], memory: RejectedCitySite[] = [];
  while (!state.outcome && state.round < rounds) {
    const view = observe(state, state.activePlayerId, EXPANSION_CONTENT);
    let command = planNext(view, { ...RULE_QUERIES, content: EXPANSION_CONTENT }, memory);
    let result = step(state, command, EXPANSION_CONTENT);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command, EXPANSION_CONTENT);
    }
    if (!result.ok) throw new Error(result.reason);
    state = result.state; commands.push(command);
  }
  return { state, commands };
}

test('ages follow the finished era’s points per round, with a minimum era length', () => {
  const rounds = 20;
  expect(ageFor(Math.ceil(rounds * ERA_HONOR_RULES.goldenRatePermille / 1000), rounds)).toBe('golden');
  expect(ageFor(Math.floor(rounds * ERA_HONOR_RULES.darkRatePermille / 1000) - 1, rounds)).toBe('dark');
  expect(ageFor(Math.floor(rounds * 0.6), rounds)).toBe('normal');
  expect(ageFor(0, ERA_HONOR_RULES.minimumRounds - 1)).toBe('normal');
  expect(Object.keys(createGame(setup(11), EXPANSION_CONTENT).expansion!)).not.toContain('eraHonors');
  expect(createGame(setup(12), EXPANSION_CONTENT).expansion!.eraHonors!.players[0]).toMatchObject({ eraIndex: 0, score: 0, age: 'normal', history: [] });
});

test('a real v12 game scores milestones, changes ages at era changes, and replays exactly', () => {
  const { state, commands } = play(12, 70);
  let transitions = 0;
  for (const playerId of state.turnOrder) {
    const record = state.expansion!.eraHonors!.players[playerId];
    // The running score is exactly the sum of its milestones.
    expect(Object.entries(record.byMilestone).reduce((sum, [id, count]) => sum + ERA_MILESTONES[id as EraMilestone].points * count!, 0)).toBe(record.score);
    for (const [index, item] of record.history.entries()) {
      const next = record.history[index + 1]?.age ?? record.age;
      expect(next).toBe(ageFor(item.score, item.rounds));
      transitions++;
    }
  }
  expect(transitions).toBeGreaterThan(0);
  const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
  expect(state.schemaVersion).toBe(7);
  expect(canonicalSerialize(replay(log))).toBe(canonicalSerialize(state));
}, 120_000);

test('golden and dark ages apply their effects through the shared policy totals and league points', () => {
  const { state } = play(12, 15);
  const base = { effects: playerPolicyEffects(state, 0), league: leaguePointsPerRound(state, 0) };
  const golden = JSON.parse(JSON.stringify(state)) as GameState, dark = JSON.parse(JSON.stringify(state)) as GameState;
  golden.expansion!.eraHonors!.players[0].age = 'golden';
  dark.expansion!.eraHonors!.players[0].age = 'dark';
  expect(playerPolicyEffects(golden, 0).cityGold).toBe(base.effects.cityGold + 1);
  expect(leaguePointsPerRound(golden, 0)).toBe(base.league + 2);
  expect(playerPolicyEffects(dark, 0).trainingDiscountPercent).toBe(base.effects.trainingDiscountPercent + 20);
  expect(playerPolicyEffects(dark, 0).healing).toBe(base.effects.healing + 3);
  expect(observe(golden, 0, EXPANSION_CONTENT).expansion!.eraHonors!.age).toBe('golden');
  expect(observe(golden, 1, EXPANSION_CONTENT).expansion!.eraHonors!.age).toBe('normal');
}, 60_000);
