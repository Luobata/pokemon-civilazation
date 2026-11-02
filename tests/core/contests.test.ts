import { expect, test } from 'vitest';
import { GameSession, replay } from '../../src/app/session.ts';
import { EXPANSION_CONTENT } from '../../src/content/units.ts';
import { createGame } from '../../src/core/game.ts';
import { observe } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { CONTEST_RULES, appealPerRound, resolveContestRound } from '../../src/core/contests.ts';
import { parseAuditAction } from '../../src/audit/commands.ts';
import type { GameSetup } from '../../src/core/model.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';

function setup(gameplayVersion?: GameplayVersion): GameSetup {
  return { seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1',
    ...(gameplayVersion ? { gameplayVersion } : {}), players: [
      { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'jasmine' },
      { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'lance' },
    ] };
}

test('contests exist only in gameplay v8; commands parse', () => {
  expect(createGame(setup(7)).expansion).not.toHaveProperty('contests');
  expect(createGame(setup(8)).expansion!.contests![0]).toEqual({ appeal: 0, halls: [], building: {}, showReadyAtRound: 1 });
  expect(parseAuditAction({ type: 'HoldContest' })).toEqual({ type: 'HoldContest' });
  expect(parseAuditAction({ type: 'BuildContestHall', cityId: 4 })).toEqual({ type: 'BuildContestHall', cityId: 4 });
});

test('a hall takes gold, then half the city production until complete, then generates appeal', () => {
  const state = createGame(setup(8));
  const cityId = state.players[0].headquartersCityId;
  const started = step(state, { actorId: 0, expectedSeq: 0, action: { type: 'BuildContestHall', cityId } });
  expect(started.ok).toBe(true);
  if (!started.ok) return;
  const next = started.state;
  expect(next.players[0].gold).toBe(state.players[0].gold - CONTEST_RULES.hallGold);
  expect(next.expansion!.contests![0].building[cityId]).toBe(0);
  expect(step(next, { actorId: 0, expectedSeq: 1, action: { type: 'BuildContestHall', cityId } }).ok).toBe(false);
  next.expansion!.contests![0].building[cityId] = CONTEST_RULES.hallCost - 1;
  const events = resolveContestRound(next, EXPANSION_CONTENT);
  expect(events).toContainEqual({ type: 'ContestHallBuilt', playerId: 0, cityId });
  expect(next.expansion!.contests![0].halls).toEqual([cityId]);
  expect(appealPerRound(next, 0, EXPANSION_CONTENT)).toBeGreaterThanOrEqual(CONTEST_RULES.perHall + 1);
  expect(observe(next, 1).expansion!.contests!.rivals).toEqual([{ playerId: 0, appeal: next.expansion!.contests![0].appeal }]);
});

test('holding a contest costs gold and cools down; dominant appeal wins the contest victory', () => {
  const state = createGame(setup(8));
  const cityId = state.players[0].headquartersCityId;
  state.expansion!.contests![0].halls = [cityId];
  state.players[0].gold = CONTEST_RULES.showGold;
  const shown = step(state, { actorId: 0, expectedSeq: 0, action: { type: 'HoldContest' } });
  expect(shown.ok && shown.state.expansion!.contests![0].appeal).toBe(CONTEST_RULES.showPerHall);
  if (!shown.ok) return;
  expect(step(shown.state, { actorId: 0, expectedSeq: 1, action: { type: 'HoldContest' } }).ok).toBe(false);
  const near = createGame(setup(8));
  near.expansion!.contests![0].appeal = CONTEST_RULES.minimum; near.expansion!.contests![1].appeal = CONTEST_RULES.minimum;
  resolveContestRound(near, EXPANSION_CONTENT);
  expect(near.outcome).toBe(null);
  const win = createGame(setup(8));
  win.expansion!.contests![0].appeal = CONTEST_RULES.minimum; win.expansion!.contests![1].appeal = 10;
  const events = resolveContestRound(win, EXPANSION_CONTENT);
  expect(win.outcome).toMatchObject({ kind: 'contest', winners: [0] });
  expect(events.some(event => event.type === 'GameEnded')).toBe(true);
});

test('gameplay v8 keeps exact save/load and replay', () => {
  const session = new GameSession({ ...setup(8), multiplayer: undefined, players: [
    { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'ai', personality: 'conservative', leaderId: 'jasmine' }] });
  for (let turn = 0; turn < 50; turn++) {
    const current = session.getState();
    if (current.outcome) break;
    expect(session.submit({ actorId: current.activePlayerId, expectedSeq: current.commandSeq, action: { type: 'EndTurn' } }).ok).toBe(true);
  }
  const saved = session.save(), loaded = new GameSession(setup(8));
  loaded.load(saved);
  expect(loaded.save()).toBe(saved);
  expect(canonicalSerialize(replay(session.exportLog()))).toBe(canonicalSerialize(session.getState()));
  expect(session.aiInvalidCommands).toEqual([]);
}, 30_000);
