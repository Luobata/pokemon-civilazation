import { expect, test } from 'vitest';
import { contentFor } from '../../src/content/units.ts';
import { DEDICATION_IDS, DEDICATIONS } from '../../src/content/dedications.ts';
import type { DedicationId } from '../../src/content/dedications.ts';
import { ERA_HONOR_RULES_V22 } from '../../src/content/era-honors.ts';
import type { EraAge } from '../../src/content/era-honors.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';
import { RULE_QUERIES } from '../../src/ai/query.ts';
import { planNext } from '../../src/ai/plan.ts';
import { planDedicationAction } from '../../src/ai/dedication-plan.ts';
import { rememberCityRejection } from '../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../src/ai/memory.ts';
import { replay } from '../../src/app/session.ts';
import type { CommandLog } from '../../src/app/session.ts';
import { createGame } from '../../src/core/game.ts';
import { observe } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { gameVersions } from '../../src/core/versions.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { ageFor, recordEraHonors, resolveEraHonorRound } from '../../src/core/era-honors.ts';
import { validateDedicationAction } from '../../src/core/dedications.ts';
import { leaguePointsPerRound, playerPolicyEffects } from '../../src/core/policies.ts';
import type { Command, EventPayload, GameSetup, GameState } from '../../src/core/model.ts';
import { turnReminders, turnStep } from '../../src/browser/turn-button.ts';
import { toastFor, toastResolved } from '../../src/browser/notifications.ts';

const setup = (gameplayVersion: GameplayVersion): GameSetup => ({ seed: 32, width: 24, height: 16, roundLimit: 100, expansionVersion: 1,
  eraProgression: 'simple-v1', gameplayVersion, players: [
    { id: 0, controller: 'ai', personality: 'expansion', leaderId: 'oak' }, { id: 1, controller: 'ai', personality: 'aggressive', leaderId: 'lance' },
    { id: 2, controller: 'ai', personality: 'conservative', leaderId: 'joy' }] });
const clone = (state: GameState) => JSON.parse(JSON.stringify(state)) as GameState;
const record = (state: GameState, playerId = 0) => state.expansion!.eraHonors!.players[playerId];

/** Moves player 0 into the next era with `previous` as the finished era's age and `score` points over 10 rounds. */
function enterEra(previous: EraAge, score: number): { state: GameState; events: EventPayload[] } {
  const before = createGame(setup(22));
  Object.assign(record(before), { age: previous, score, eraStartRound: before.round - 10 });
  const after = clone(before);
  // Every tech: player 0 is in a later era whatever the thresholds are.
  after.players[0].research.unlockedIds = Object.keys(contentFor(after.setup).techs) as never;
  const events = recordEraHonors(before, after, []);
  return { state: after, events };
}
const choose = (state: GameState, dedicationIds: string[], actorId = 0) =>
  step(state, { actorId, expectedSeq: state.commandSeq, action: { type: 'ChooseDedication', dedicationIds: dedicationIds as DedicationId[] } });

test('v22 era games carry a dedication ledger; v21 ones do not', () => {
  expect(Object.keys(record(createGame(setup(21))))).not.toContain('dedication');
  expect(record(createGame(setup(22))).dedication).toEqual({ pending: 0, heroic: false, chosen: [], progress: {} });
  expect(DEDICATION_IDS).toHaveLength(8);
  for (const id of DEDICATION_IDS) {
    expect(DEDICATIONS[id].promise.length).toBeGreaterThan(0);
    expect(Object.keys(DEDICATIONS[id].golden.policy).length).toBeGreaterThan(0);
  }
});

test('entering an era asks for 1 card (normal, dark, golden) or 3 (heroic: golden right after dark)', () => {
  const cases: [EraAge, number, EraAge, boolean, number][] = [
    // Scores over 10 rounds against the v22 lines (golden ≥ 1.5 per round, dark < 1.0).
    ['normal', 12, 'normal', false, 1], ['normal', 0, 'dark', false, 1], ['normal', 16, 'golden', false, 1],
    ['dark', 16, 'golden', true, 3], ['golden', 16, 'golden', false, 1], ['dark', 0, 'dark', false, 1]];
  for (const [previous, score, age, heroic, picks] of cases) {
    const { state, events } = enterEra(previous, score);
    expect(record(state)).toMatchObject({ age, dedication: { pending: picks, heroic, chosen: [], progress: {} } });
    expect(events).toEqual([expect.objectContaining({ type: 'EraAgeBegan', playerId: 0, age, dedicationPicks: picks, ...(heroic ? { heroic: true } : {}) })]);
    if (!heroic) expect(events[0]).not.toHaveProperty('heroic');
    expect(record(state).history.at(-1)).toMatchObject({ age: previous, score, dedications: [] });
  }
  // v21: the same transition has no pending choice and no new event fields.
  const before = createGame(setup(21)), after = clone(before);
  after.players[0].research.unlockedIds = Object.keys(contentFor(after.setup).techs) as never;
  const events = recordEraHonors(before, after, []);
  expect(Object.keys(events[0]).sort()).toEqual(['age', 'eraIndex', 'playerId', 'previousRounds', 'previousScore', 'type']);
  expect(record(after)).not.toHaveProperty('dedication');
  expect(Object.keys(record(after).history[0]).sort()).toEqual(['age', 'eraIndex', 'rounds', 'score']);
});

test('ChooseDedication: only while pending, with the exact count and no duplicates', () => {
  const fresh = createGame(setup(22));
  expect(validateDedicationAction(fresh, 0, { type: 'ChooseDedication', dedicationIds: ['ballMaster'] })).toBe('dedication-not-pending');
  expect(choose(fresh, ['ballMaster']).ok).toBe(false);
  const v21 = createGame(setup(21));
  expect(validateDedicationAction(v21, 0, { type: 'ChooseDedication', dedicationIds: ['ballMaster'] })).toBe('dedications-unavailable');
  expect(choose(v21, ['ballMaster'])).toEqual({ ok: false, reason: 'invalid-command' });

  const { state } = enterEra('dark', 16); // heroic: 3 cards
  state.activePlayerId = 0;
  const check = (ids: string[]) => validateDedicationAction(state, 0, { type: 'ChooseDedication', dedicationIds: ids as DedicationId[] });
  expect(check(['ballMaster'])).toBe('dedication-count');
  expect(check(['ballMaster', 'badgeQuest', 'grandStage', 'pioneerTrail'])).toBe('dedication-count');
  expect(check(['ballMaster', 'ballMaster', 'grandStage'])).toBe('dedication-duplicate');
  expect(check(['ballMaster', 'noSuchCard', 'grandStage'])).toBe('dedication-unknown');
  expect(choose(state, ['ballMaster', 'ballMaster', 'grandStage']).ok).toBe(false);
  expect(choose(state, ['ballMaster', 'nope', 'grandStage']).ok).toBe(false);
  expect(choose(state, ['ballMaster', 'grandStage'], 1).ok).toBe(false); // not the active player
  // The end-turn button leads to the era screen first; the notification waits for the choice.
  const pendingView = observe(state, 0), reminders = turnReminders(pendingView, contentFor(state.setup));
  expect(reminders[0]).toEqual({ label: '选择 3 张时代献礼', target: '#era-panel' });
  expect(turnStep(pendingView, reminders, { unitId: null, cityId: null }, new Set())).toEqual({ kind: 'dedication', label: '选择时代献礼 ›', panel: '#era-panel' });
  const toast = toastFor({ type: 'EraAgeBegan', playerId: 0, eraIndex: 1, age: 'golden', previousScore: 9, previousRounds: 10, heroic: true, dedicationPicks: 3 }, pendingView)!;
  expect(toast).toMatchObject({ title: '进入英雄世代', action: '选择献礼', persistent: true, target: { kind: 'screen', screen: 'era' } });
  expect(toastResolved(toast, pendingView)).toBe(false);
  const result = choose(state, ['professorNotes', 'ballMaster', 'grandStage']);
  if (!result.ok) throw new Error(result.reason);
  expect(record(result.state).dedication).toMatchObject({ pending: 0, heroic: true, chosen: ['ballMaster', 'grandStage', 'professorNotes'] });
  expect(result.events.map(event => event.payload)).toContainEqual({ type: 'DedicationChosen', playerId: 0, eraIndex: record(result.state).eraIndex, dedicationIds: ['ballMaster', 'grandStage', 'professorNotes'] });
  expect(choose(result.state, ['ballMaster', 'grandStage', 'professorNotes']).ok).toBe(false); // nothing pending any more
  expect(toastResolved(toast, observe(result.state, 0))).toBe(true);
  expect(turnReminders(observe(result.state, 0), contentFor(state.setup)).some(item => item.target === '#era-panel')).toBe(false);
  // Private: rivals' views never show the cards.
  expect(observe(result.state, 1).expansion!.eraHonors!.dedication!.chosen).toEqual([]);
  expect(observe(result.state, 0).expansion!.eraHonors!.dedication!.chosen).toEqual(['ballMaster', 'grandStage', 'professorNotes']);
});

test('promises add era score in normal and dark ages (not in golden ones), and feed the next age', () => {
  for (const age of ['normal', 'dark', 'golden'] as const) {
    const before = createGame(setup(22));
    Object.assign(record(before), { age, dedication: { pending: 0, heroic: false, chosen: ['ballMaster', 'professorNotes'], progress: {} } });
    const after = clone(before);
    // One successful capture and one discovery (milestones +1 each), in the same era.
    const events: EventPayload[] = [{ type: 'Captured', playerId: 0, unitId: 1, targetUnitId: 2, success: true, probability: 50 },
      { type: 'DiscoveryMade', playerId: 0, techId: Object.keys(contentFor(after.setup).techs)[0] as never, bonus: 5, progress: 5 }];
    expect(recordEraHonors(before, after, events)).toEqual([]);
    const promised = age === 'golden' ? 0 : 2;
    expect(record(after).score).toBe(2 + promised);
    expect(record(after).dedication!.progress).toEqual(age === 'golden' ? {} : { ballMaster: 1, professorNotes: 1 });
    // Other players' deeds never count for player 0.
    expect(record(after, 1).score).toBe(0);
  }
  // The promise points are part of the score the next age is judged on.
  const before = createGame(setup(22));
  Object.assign(record(before), { age: 'normal', score: 11, eraStartRound: before.round - 10, dedication: { pending: 0, heroic: false, chosen: ['evolutionLight'], progress: {} } });
  const after = clone(before);
  after.players[0].research.unlockedIds = Object.keys(contentFor(after.setup).techs) as never;
  const events = recordEraHonors(before, after, [{ type: 'Evolved', playerId: 0, unitId: 1, speciesId: 'ivysaur' }]);
  // 11 + milestone 2 + promise 2 = 15 over 10 rounds: exactly the v22 golden line (without the promise it would be normal).
  expect(events[0]).toMatchObject({ type: 'EraAgeBegan', previousScore: 11 + 2 + 2, age: 'golden' });
  expect(record(after).history.at(-1)).toMatchObject({ score: 15, dedications: ['evolutionLight'] });
});

test('golden effects apply only in golden and heroic ages and replace the fixed golden bonus', () => {
  const base = createGame(setup(22)), effects = playerPolicyEffects(base, 0), league = leaguePointsPerRound(base, 0);
  const withAge = (age: EraAge, chosen: DedicationId[]) => {
    const state = clone(base);
    Object.assign(record(state), { age, dedication: { pending: 0, heroic: chosen.length === 3, chosen, progress: {} } });
    return state;
  };
  const golden = withAge('golden', ['professorNotes']);
  expect(playerPolicyEffects(golden, 0).cityResearch).toBe(effects.cityResearch + 1);
  expect(playerPolicyEffects(golden, 0).cityGold).toBe(effects.cityGold); // v21's fixed +1 gold is gone
  expect(leaguePointsPerRound(golden, 0)).toBe(league); // and so is its +2 league points
  expect(playerPolicyEffects(withAge('golden', []), 0)).toEqual(effects); // nothing chosen yet: no bonus
  for (const age of ['normal', 'dark'] as const) expect(playerPolicyEffects(withAge(age, ['professorNotes']), 0).cityResearch).toBe(effects.cityResearch);
  // Dark keeps its adversity effect.
  expect(playerPolicyEffects(withAge('dark', ['professorNotes']), 0).trainingDiscountPercent).toBe(effects.trainingDiscountPercent + 20);
  const heroic = withAge('golden', ['ballMaster', 'grandStage', 'professorNotes']);
  expect(playerPolicyEffects(heroic, 0)).toMatchObject({ captureBonus: effects.captureBonus + 10, ballDiscount: effects.ballDiscount + 5, cityGold: effects.cityGold + 1, cityResearch: effects.cityResearch + 1 });
  expect(leaguePointsPerRound(heroic, 0)).toBe(league + 2);
  // Satisfaction: the golden base +3 plus 华丽舞台 +2.
  const satisfaction = heroic.expansion!.world.players[0].satisfaction;
  resolveEraHonorRound(heroic);
  expect(heroic.expansion!.world.players[0].satisfaction).toBe(Math.min(100, satisfaction + 5));
  // The view computes the same totals for the owner.
  expect(observe(heroic, 0).expansion!.eraHonors!.dedication!.chosen).toEqual(['ballMaster', 'grandStage', 'professorNotes']);
});

function play(rounds: number): { state: GameState; commands: Command[]; chosen: EventPayload[]; rejected: number } {
  const content = contentFor(setup(22));
  let state = createGame(setup(22), content);
  const commands: Command[] = [], memory: RejectedCitySite[] = [], chosen: EventPayload[] = [];
  let rejected = 0;
  while (!state.outcome && state.round < rounds) {
    const view = observe(state, state.activePlayerId, content);
    let command = planNext(view, { ...RULE_QUERIES, content }, memory);
    let result = step(state, command, content);
    if (!result.ok) {
      rejected++;
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command, content);
    }
    if (!result.ok) throw new Error(result.reason);
    // The AI never ends its turn with a dedication still to choose.
    if (command.action.type === 'EndTurn') expect(record(state, command.actorId).dedication!.pending).toBe(0);
    for (const event of result.events) if (event.payload.type === 'DedicationChosen') chosen.push(event.payload);
    state = result.state; commands.push(command);
  }
  return { state, commands, chosen, rejected };
}

test('a real v22 AI game: every era change is answered at once, promises score, and the game replays exactly', () => {
  const { state, commands, chosen, rejected } = play(60);
  expect(rejected).toBe(0);
  expect(chosen.length).toBeGreaterThan(0);
  for (const playerId of state.turnOrder) {
    const honor = record(state, playerId);
    for (const [index, item] of honor.history.entries()) if (index > 0) expect(item.dedications?.length).toBeGreaterThan(0);
    if (honor.history.length && state.activePlayerId !== playerId) expect(honor.dedication!.chosen.length).toBeGreaterThan(0);
  }
  // The AI picks what its plan says, from its own view.
  const sample = clone(state);
  Object.assign(record(sample, sample.activePlayerId).dedication!, { pending: 1, chosen: [] });
  expect(planDedicationAction(observe(sample, sample.activePlayerId))).toMatchObject({ type: 'ChooseDedication', dedicationIds: [expect.any(String)] });
  const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
  expect(canonicalSerialize(replay(log))).toBe(canonicalSerialize(state));
}, 180_000);

test('v22 golden / dark lines are stricter than v12 and the view reports them; older rules keep 0.8 / 0.45', () => {
  expect(ageFor(9, 10)).toBe('golden');
  expect(ageFor(9, 10, ERA_HONOR_RULES_V22)).toBe('dark');
  expect(ageFor(12, 10, ERA_HONOR_RULES_V22)).toBe('normal');
  expect(ageFor(15, 10, ERA_HONOR_RULES_V22)).toBe('golden');
  expect(observe(createGame(setup(22)), 0).expansion!.eraHonors).toMatchObject(ERA_HONOR_RULES_V22);
  expect(observe(createGame(setup(21)), 0).expansion!.eraHonors).toMatchObject({ goldenRatePermille: 800, darkRatePermille: 450 });
});
