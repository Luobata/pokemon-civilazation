import { GameSession, replay } from '../../src/app/session.ts';
import { planNext } from '../../src/ai/plan.ts';
import { expect, test } from 'vitest';
import { rememberCityRejection, rejectedCitySite } from '../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../src/ai/memory.ts';
import { createGame } from '../../src/core/game.ts';
import { step } from '../../src/core/step.ts';
import { observe } from '../../src/core/vision.ts';
import { simulateMatch } from '../../tools/simulate.ts';

test('city rejection memory consumes only the actor observation and stays player/sequence scoped', () => {
  const state = createGame({ seed: 3, width: 24, height: 16, players: [{ id: 0, controller: 'ai' }, { id: 1, controller: 'ai' }] });
  const view = observe(state, 0), unit = view.units.find(unit => unit.ownerId === 0 && unit.kind === 'logistics')!;
  const memory: RejectedCitySite[] = [];
  const command = { actorId: 0, expectedSeq: view.commandSeq, action: { type: 'FoundCity' as const, unitId: unit.id } };
  rememberCityRejection(memory, view, command, 'not-your-turn'); expect(memory).toEqual([]);
  rememberCityRejection(memory, view, { ...command, actorId: 1 }, 'invalid-city-site'); expect(memory).toEqual([]);
  rememberCityRejection(memory, view, command, 'invalid-city-site');
  expect(memory).toEqual([{ playerId: 0, position: unit.position, seq: view.commandSeq }]);
  expect(rejectedCitySite(memory, view, unit.position)).toBe(false);
  view.commandSeq++;
  expect(rejectedCitySite(memory, view, unit.position)).toBe(true);
  expect(rejectedCitySite(memory, { ...view, playerId: 1 }, unit.position)).toBe(false);
  expect(rejectedCitySite([], view, unit.position)).toBe(false);
});

test('seed3 unit6 never retries its rejected site on later turns and moves elsewhere', () => {
  const game = simulateMatch({ id: 'smoke-3', seed: 3, mode: 'smoke', leg: 0, personalities: ['expansion', 'aggressive', 'conservative'] });
  expect(game.defect).toBe(false); expect(game.aborted).toBe(false);
  expect(game.invalid).toHaveLength(1);
  expect(game.invalid[0]).toMatchObject({ round: 10, seq: 91, reason: 'invalid-city-site', command: { actorId: 2, action: { type: 'FoundCity', unitId: 6 } } });
  let state = createGame(game.setup);
  const rejected = new Set<string>();
  for (const command of game.commands) {
    for (const item of game.invalid.filter(item => item.seq === state.commandSeq)) {
      if (item.command.action.type !== 'FoundCity') continue;
      const unit = state.units[item.command.action.unitId];
      expect(unit.position).toEqual({ q: 15, r: 6 });
      rejected.add(`${unit.id}:${unit.position!.q}:${unit.position!.r}`);
    }
    if (command.action.type === 'FoundCity') {
      const unit = state.units[command.action.unitId];
      expect(rejected.has(`${unit.id}:${unit.position!.q}:${unit.position!.r}`)).toBe(false);
    }
    const result = step(state, command); if (!result.ok) throw new Error(result.reason); state = result.state;
  }
  expect(game.commands.some(command => command.expectedSeq > 91 && command.action.type === 'Move' && command.action.unitId === 6)).toBe(true);
  expect(state.outcome).toEqual(game.outcome);
}, 30_000);

test('real rejection survives save/load; continuation and rewind branches reproduce AI commands and outcome', () => {
  const setup = { seed: 50, width: 24, height: 16, players: [
    { id: 0, controller: 'human' as const, starterId: 'bulbasaur' as const },
    { id: 1, controller: 'ai' as const, personality: 'aggressive' as const },
    { id: 2, controller: 'ai' as const, personality: 'conservative' as const },
  ] };
  // Deterministic human driver; its chosen strategy is not production AI state.
  const humanCommand = (session: GameSession) => {
    const view = session.getView(); view.economy.player.personality = 'expansion';
    return planNext(view);
  };
  const advance = (session: GameSession) => {
    const result = session.submit(humanCommand(session));
    if (!result.ok) expect(session.issue({ type: 'EndTurn' }).ok).toBe(true);
  };
  const uninterrupted = new GameSession(setup);
  while (!uninterrupted.getView().outcome && !uninterrupted.exportLog().aiRejectedCitySites!.length) advance(uninterrupted);
  const memory = uninterrupted.exportLog().aiRejectedCitySites!;
  expect(memory).toHaveLength(1); expect(memory[0]).toMatchObject({ playerId: 2, seq: 353 });
  const saved = uninterrupted.save(), resumed = new GameSession(setup);
  expect(resumed.exportLog().aiRejectedCitySites).toEqual([]); // distinct game, no global cache
  resumed.load(saved); expect(resumed.exportLog()).toEqual(uninterrupted.exportLog());
  while (!uninterrupted.getView().outcome) {
    expect(humanCommand(resumed)).toEqual(humanCommand(uninterrupted));
    advance(uninterrupted); advance(resumed);
    expect(resumed.exportLog()).toEqual(uninterrupted.exportLog());
  }
  expect(resumed.getState()).toEqual(uninterrupted.getState());
  expect(replay(resumed.exportLog())).toEqual(resumed.getState());
  const finalLog = resumed.exportLog(), finalState = resumed.getState();
  resumed.replayTo(memory[0].seq); resumed.resumeFromReplay();
  while (!resumed.getView().outcome) advance(resumed);
  expect(resumed.exportLog()).toEqual(finalLog);
  expect(resumed.getState()).toEqual(finalState);
  const legacy = JSON.parse(saved); delete legacy.log.aiRejectedCitySites;
  resumed.load(JSON.stringify(legacy)); expect(resumed.exportLog().aiRejectedCitySites).toEqual([]);
}, 30_000);
