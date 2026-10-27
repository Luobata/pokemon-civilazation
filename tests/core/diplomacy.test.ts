import { expect, test } from 'vitest';
import { combatFixture, accepted, issue } from './combat-fixture.ts';
import { observe, projectEvents } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';

test('war is immediate and diplomacy is public; proposal waits for next recipient turn', () => {
  let state = combatFixture();
  const result = issue(state, { type: 'DeclareWar', targetPlayerId: 1 });
  if (!result.ok) throw new Error(result.reason);
  expect(projectEvents(state, result.state, result.events, 1)[0].payload.type).toBe('DiplomacyChanged');
  state = result.state;
  expect(observe(state, 1).diplomacy[0].status).toBe('war');
  state.round = 5; expect(issue(state, { type: 'MakePeace', targetPlayerId: 1 }).ok).toBe(false);
  state.round = 6; state = accepted(state, { type: 'MakePeace', targetPlayerId: 1 });
  expect(issue(state, { type: 'MakePeace', targetPlayerId: 1 }).ok).toBe(false);
  expect(step(state, { actorId: 1, expectedSeq: state.commandSeq, action: { type: 'RespondPeace', targetPlayerId: 0, accept: true } })).toMatchObject({ ok: false, reason: 'not-your-turn' });
  state = accepted(state, { type: 'EndTurn' });
  expect(state.diplomacy[0].proposal).not.toBeNull();
  state = accepted(state, { type: 'EndTurn' });
  expect(state.diplomacy[0].proposal).toBeNull();
  expect(state.diplomacy[0].rejectedAtRound[0]).toBe(6);
  state.round = 10; expect(issue(state, { type: 'MakePeace', targetPlayerId: 1 }).ok).toBe(false);
  state.round = 11; expect(issue(state, { type: 'MakePeace', targetPlayerId: 1 }).ok).toBe(true);
});
test.each([false, true])('accepted peace freezes cooldown at acceptance, league=%s', league => {
  let state = accepted(combatFixture(), { type: 'DeclareWar', targetPlayerId: 1 });
  state.round = 6;
  if (league) state.players[0].research.unlockedIds.push('leagueRules');
  state = accepted(state, { type: 'MakePeace', targetPlayerId: 1 });
  state = accepted(state, { type: 'EndTurn' });
  state = accepted(state, { type: 'RespondPeace', targetPlayerId: 0, accept: true });
  const until = league ? 11 : 16;
  expect(state.diplomacy[0]).toMatchObject({ status: 'peace', cooldownUntilRound: until });
  state.players[1].research.unlockedIds.push('leagueRules'); state.round = until - 1;
  expect(issue(state, { type: 'DeclareWar', targetPlayerId: 0 }).ok).toBe(false);
  state.round++; state.diplomacy[0].citiesLostSinceWar[1] = 3;
  state = accepted(state, { type: 'DeclareWar', targetPlayerId: 0 });
  expect(state.diplomacy[0].citiesLostSinceWar).toEqual({});
});
test('proposal to an earlier seat survives round boundary and explicit rejection starts proposer cooldown', () => {
  let state = accepted(combatFixture(), { type: 'DeclareWar', targetPlayerId: 1 });
  state.round = 6; state = accepted(state, { type: 'EndTurn' });
  state = accepted(state, { type: 'MakePeace', targetPlayerId: 0 });
  state = accepted(state, { type: 'EndTurn' });
  expect(state.round).toBe(7); expect(state.diplomacy[0].proposal?.recipientId).toBe(0);
  state = accepted(state, { type: 'RespondPeace', targetPlayerId: 1, accept: false });
  expect(state.diplomacy[0].rejectedAtRound[1]).toBe(7);
});

test('third-party relation status is public but proposal and war-loss details are participant-only', () => {
  let state = accepted(combatFixture(), { type: 'DeclareWar', targetPlayerId: 1 }); state.round = 6;
  state.players[2] = { ...structuredClone(state.players[1]), id: 2 }; state.knowledge[2] = structuredClone(state.knowledge[1]);
  state.diplomacy[0].citiesLostSinceWar[1] = 2;
  const result = issue(state, { type: 'MakePeace', targetPlayerId: 1 }); if (!result.ok) throw new Error(result.reason);
  expect(observe(result.state, 2).diplomacy[0]).toMatchObject({ status: 'war', proposal: null, citiesLostSinceWar: {} });
  expect(projectEvents(state, result.state, result.events, 2)[0].payload).toMatchObject({ type: 'DiplomacyChanged', relation: { proposal: null, citiesLostSinceWar: {} } });
  state = result.state;
  expect(observe(state, 1).diplomacy[0]).toMatchObject({ proposal: { proposerId: 0, recipientId: 1 }, citiesLostSinceWar: { 1: 2 } });
});
