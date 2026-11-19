// ui-25d: saves of real v26 games where every seat (seat 0 included) is played by the shipped AI, stopped at the start of seat 0's
// turn in a given round. Nothing is patched, so the saves replay exactly through the normal importer.
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

export type AiGameFixture = { state: GameState; save: string };
type Run = { state: GameState; commands: Command[]; memory: RejectedCitySite[]; saves: Map<number, AiGameFixture> };
/** One running game per seed and size: later rounds resume where the last request stopped (fixtures in one worker share it). */
const runs = new Map<string, Run>();

export function aiGameAt(seed: number, round: number, size: { width: 24 | 30 | 40; height: 16 | 20 | 26 } = { width: 30, height: 20 }): AiGameFixture {
  const key = `${seed}:${size.width}`;
  let run = runs.get(key);
  if (!run || run.state.round > round && !run.saves.has(round)) {
    const setup: GameSetup = { seed, ...size, roundLimit: 200, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 26,
      players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, ...[1, 2, 3].map(id => ({ id, controller: 'ai' as const, personality: 'expansion' as const }))] };
    run = { state: createGame(setup, contentFor(setup)), commands: [], memory: [], saves: new Map() };
    runs.set(key, run);
  }
  const saved = run.saves.get(round);
  if (saved) return saved;
  const content = contentFor(run.state.setup);
  let state = run.state;
  while (!state.outcome && !(state.round >= round && state.activePlayerId === 0)) {
    const view = observe(state, state.activePlayerId, content);
    let command = planNext(view, { ...RULE_QUERIES, content }, run.memory);
    let result = step(state, command, content);
    if (!result.ok) {
      rememberCityRejection(run.memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command, content);
    }
    if (!result.ok) throw new Error(`ui-25d fixture rejected ${command.action.type}: ${result.reason}`);
    state = result.state; run.commands.push(command);
  }
  run.state = state;
  const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands: [...run.commands] };
  const fixture = { state, save: serializeSave(state, log) };
  run.saves.set(round, fixture);
  return fixture;
}
