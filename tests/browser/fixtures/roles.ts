import { ROSTER_CONTENT } from '../../../src/content/units.ts';
import { RULE_QUERIES } from '../../../src/ai/query.ts';
import { planNext } from '../../../src/ai/plan.ts';
import { rememberCityRejection } from '../../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../../src/ai/memory.ts';
import { createGame } from '../../../src/core/game.ts';
import { observe } from '../../../src/core/vision.ts';
import { step } from '../../../src/core/step.ts';
import { gameVersions } from '../../../src/core/versions.ts';
import { improvementOptions } from '../../../src/core/improvements.ts';
import { serializeSave } from '../../../src/app/save.ts';
import type { CommandLog } from '../../../src/app/session.ts';
import type { Command, GameSetup, GameState } from '../../../src/core/model.ts';

// A real v18 game (the AI plays both seats; nothing is patched, so the save replays exactly).
const setupFor = (seed: number): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 18,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'ai', personality: 'expansion', leaderId: 'joy' }] });
export type BuilderFixture = { state: GameState; save: string; seed: number; builderId: number };

/** Stops on player 0's turn when one of its 工匠 stands where it can build right now. */
function search(seed: number): BuilderFixture | null {
  let state = createGame(setupFor(seed), ROSTER_CONTENT);
  const commands: Command[] = [], memory: RejectedCitySite[] = [];
  while (!state.outcome && state.round < 60) {
    const view = observe(state, state.activePlayerId, ROSTER_CONTENT);
    if (state.activePlayerId === 0) {
      const builder = view.units.find(unit => unit.ownerId === 0 && unit.kind === 'logistics' && unit.role === 'builder' && improvementOptions(view, unit.id, ROSTER_CONTENT).length);
      if (builder) {
        const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
        return { state, save: serializeSave(state, log), seed, builderId: builder.id };
      }
    }
    let command = planNext(view, { ...RULE_QUERIES, content: ROSTER_CONTENT }, memory);
    let result = step(state, command, ROSTER_CONTENT);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command, ROSTER_CONTENT);
    }
    if (!result.ok) throw new Error(`Builder fixture rejected ${command.action.type}: ${result.reason}`);
    state = result.state; commands.push(command);
  }
  return null;
}
let cached: BuilderFixture | undefined;
export function builderFixture(): BuilderFixture {
  if (cached) return cached;
  for (let seed = 1; seed <= 40; seed++) { const found = search(seed); if (found) return cached = found; }
  throw new Error('No seed reached a ready 工匠 for player 0');
}
