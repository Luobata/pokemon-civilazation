// A real v24 mid-game for the icon-first UI screenshots: the AI plays every seat (seat 0 is the human seat), nothing
// is patched, so the save replays exactly. Stops on seat 0's turn once the round is reached.
import { contentFor } from '../../../src/content/units.ts';
import { RULE_QUERIES } from '../../../src/ai/query.ts';
import { planNext } from '../../../src/ai/plan.ts';
import { rememberCityRejection } from '../../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../../src/ai/memory.ts';
import { createGame } from '../../../src/core/game.ts';
import { observe } from '../../../src/core/vision.ts';
import { step } from '../../../src/core/step.ts';
import { gameVersions } from '../../../src/core/versions.ts';
import { serializeSave } from '../../../src/app/save.ts';
import type { CommandLog } from '../../../src/app/session.ts';
import type { Command, GameSetup, GameState } from '../../../src/core/model.ts';

export type MidGameFixture = { state: GameState; save: string };
let cached: MidGameFixture | null = null;

export function midGameFixture(round = 45, seed = 2): MidGameFixture {
  if (cached) return cached;
  const setup: GameSetup = { seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 24,
    players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, ...[1, 2, 3].map(id => ({ id, controller: 'ai' as const, personality: 'aggressive' as const }))] };
  const content = contentFor(setup);
  let state = createGame(setup, content);
  const commands: Command[] = [], memory: RejectedCitySite[] = [];
  while (!state.outcome && !(state.round >= round && state.activePlayerId === 0)) {
    const view = observe(state, state.activePlayerId, content);
    let command = planNext(view, { ...RULE_QUERIES, content }, memory);
    let result = step(state, command, content);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command, content);
    }
    if (!result.ok) throw new Error(`mid-game fixture rejected ${command.action.type}: ${result.reason}`);
    state = result.state; commands.push(command);
  }
  const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
  return cached = { state, save: serializeSave(state, log) };
}
