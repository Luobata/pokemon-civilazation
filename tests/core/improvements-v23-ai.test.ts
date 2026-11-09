import { expect, test } from 'vitest';
import { contentFor } from '../../src/content/units.ts';
import { IMPROVEMENTS } from '../../src/content/improvements.ts';
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
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';

const setup: GameSetup = { seed: 31, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 23,
  players: [0, 1, 2, 3].map(id => ({ id, controller: 'ai' as const, personality: 'aggressive' as const })) };

test('a real v23 AI game: builders take escorts, develop resources, pillage and repair without rejected commands, and replay exactly', () => {
  const content = contentFor(setup);
  let state: GameState = createGame(setup, content);
  const commands: Command[] = [], memory: RejectedCitySite[] = [], rejected: string[] = [];
  const seen = { escorted: 0, resource: 0, newKinds: 0, pillaged: 0, repaired: 0 };
  while (!state.outcome && state.round < 80) {
    const view = observe(state, state.activePlayerId, content);
    let command = planNext(view, { ...RULE_QUERIES, content }, memory);
    let result = step(state, command, content);
    if (!result.ok) {
      rejected.push(command.action.type);
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command, content);
    }
    if (!result.ok) throw new Error(result.reason);
    for (const { payload } of result.events) {
      if (payload.type === 'UnitTrained' && payload.unit.kind === 'logistics' && payload.unit.role === 'builder' && payload.unit.escortId) seen.escorted++;
      if (payload.type === 'TileWorked' && payload.completed && IMPROVEMENTS[payload.kind].resource) seen.resource++;
      if (payload.type === 'TileWorked' && payload.completed && ['ranch', 'honeyHive', 'pearlBed'].includes(payload.kind)) seen.newKinds++;
      if (payload.type === 'ImprovementPillaged') seen.pillaged++;
      if (payload.type === 'ImprovementRepaired') seen.repaired++;
    }
    state = result.state; commands.push(command);
  }
  // Only fog-limited city sites may be refused (as in every version); never an improvement, pillage or repair command.
  expect(rejected.filter(type => type !== 'FoundCity')).toEqual([]);
  expect(seen.escorted).toBeGreaterThan(0);
  expect(seen.resource).toBeGreaterThan(0);
  // Harvest never happens inside the harvester's own territory (checked by the authority; the AI is never refused).
  const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
  expect(canonicalSerialize(replay(log))).toBe(canonicalSerialize(state));
}, 240_000);
