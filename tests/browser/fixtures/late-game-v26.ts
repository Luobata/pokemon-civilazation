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
import type { Command, GameSetup, GameState, PlayerView } from '../../../src/core/model.ts';

// Real v26 games (depth-v26 lane 2): the AI plays every seat (seat 0 is the human seat), nothing is patched, so saves replay exactly.
const setupFor = (seed: number): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 26,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, ...[1, 2, 3].map(id => ({ id, controller: 'ai' as const, personality: 'conservative' as const }))] });
export type V26Fixture = { state: GameState; save: string; id: number };

function play(seed: number, pick: (view: PlayerView) => number | undefined): V26Fixture | null {
  const setup = setupFor(seed), content = contentFor(setup);
  let state = createGame(setup, content);
  const commands: Command[] = [], memory: RejectedCitySite[] = [];
  while (!state.outcome && state.round < 100) {
    const view = observe(state, state.activePlayerId, content);
    const id = state.activePlayerId === 0 ? pick(view) : undefined;
    if (id !== undefined) {
      const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
      return { state, save: serializeSave(state, log), id };
    }
    let command = planNext(view, { ...RULE_QUERIES, content }, memory);
    let result = step(state, command, content);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command, content);
    }
    if (!result.ok) throw new Error(`v26 fixture rejected ${command.action.type}: ${result.reason}`);
    state = result.state; commands.push(command);
  }
  return null;
}
const cache: Record<string, V26Fixture> = {};
function first(key: string, seeds: number[], pick: (view: PlayerView) => number | undefined): V26Fixture | null {
  if (key in cache) return cache[key];
  for (const seed of seeds) { const found = play(seed, pick); if (found) return cache[key] = found; }
  return null;
}
/** Seat 0's turn with the first contest season announced and a hall (id = the round). */
export const seasonFixture = () => first('season', [1, 2, 3, 4], view =>
  view.expansion?.contestSeasons?.category && view.expansion.contests?.own.halls.length ? view.round : undefined);
/** Seat 0's turn with a Max Raid den active (id = the round); null when no seed reaches one. */
export const raidFixture = () => first('raid', [1, 2, 3], view => view.expansion?.raids?.active ? view.round : undefined);
