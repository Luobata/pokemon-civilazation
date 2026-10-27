import { afterEach, expect, test, vi } from 'vitest';
import * as planner from '../../src/ai/plan.ts';
import { GameSession } from '../../src/app/session.ts';
import { combatFixture } from '../core/combat-fixture.ts';
import { simulateMatch } from '../../tools/simulate.ts';

afterEach(() => vi.restoreAllMocks());

test('session ends the AI action turn after a rejected candidate without resubmitting it', () => {
  const plan = vi.spyOn(planner, 'planNext').mockImplementation(view => ({
    actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'FoundCity', unitId: -1 },
  }));
  const session = new GameSession(combatFixture().setup);
  expect(session.issue({ type: 'EndTurn' }).ok).toBe(true);
  expect(plan).toHaveBeenCalledTimes(1);
  expect(session.aiInvalidCommands).toHaveLength(1);
  expect(session.getView().activePlayerId).toBe(0);
  expect(session.getView().round).toBe(2);
  expect(session.exportLog().commands.map(command => command.action.type)).toEqual(['EndTurn', 'EndTurn']);
});

test('simulator rejects at most once per actor and round and still reaches the ending', () => {
  const plan = vi.spyOn(planner, 'planNext').mockImplementation(view => ({
    actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'FoundCity', unitId: -1 },
  }));
  const result = simulateMatch({ id: 'forced-rejection', seed: 1, mode: '1v1', leg: 0, personalities: ['expansion', 'aggressive'] });
  expect(result.kind).toBe('score'); expect(result.round).toBe(100);
  expect(result.aborted).toBe(false); expect(result.defect).toBe(true); expect(result.legacyAborted).toBe(true);
  expect(result.invalid).toHaveLength(200); expect(plan).toHaveBeenCalledTimes(200);
  expect(new Set(result.invalid.map(item => `${item.round}/${item.command.actorId}`)).size).toBe(200);
  expect(result.commands).toHaveLength(200);
  expect(result.commands.every(command => command.action.type === 'EndTurn')).toBe(true);
});
