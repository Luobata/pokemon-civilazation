import { contentFor } from '../../../src/content/units.ts';
import { RULE_QUERIES } from '../../../src/ai/query.ts';
import { planNext } from '../../../src/ai/plan.ts';
import { rememberCityRejection } from '../../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../../src/ai/memory.ts';
import { createGame } from '../../../src/core/game.ts';
import { observe } from '../../../src/core/vision.ts';
import { step } from '../../../src/core/step.ts';
import { gameVersions } from '../../../src/core/versions.ts';
import { viewPillage } from '../../../src/core/pillage.ts';
import { serializeSave } from '../../../src/app/save.ts';
import type { CommandLog } from '../../../src/app/session.ts';
import type { Command, GameSetup, GameState, PlayerView } from '../../../src/core/model.ts';

// Real v23 games: the AI plays every seat (seat 0 is the human seat), nothing is patched, so saves replay exactly.
const setupFor = (seed: number): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 23,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, ...[1, 2, 3].map(id => ({ id, controller: 'ai' as const, personality: 'aggressive' as const }))] });
export type V23Fixture = { state: GameState; save: string; unitId: number };

/** Plays until seat 0's turn satisfies `pick` (returns a unit id), then saves. */
function play(seed: number, pick: (view: PlayerView) => number | undefined): V23Fixture | null {
  const setup = setupFor(seed), content = contentFor(setup);
  let state = createGame(setup, content);
  const commands: Command[] = [], memory: RejectedCitySite[] = [];
  while (!state.outcome && state.round < 100) {
    const view = observe(state, state.activePlayerId, content);
    const unitId = state.activePlayerId === 0 ? pick(view) : undefined;
    if (unitId !== undefined) {
      const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
      return { state, save: serializeSave(state, log), unitId };
    }
    let command = planNext(view, { ...RULE_QUERIES, content }, memory);
    let result = step(state, command, content);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command, content);
    }
    if (!result.ok) throw new Error(`v23 fixture rejected ${command.action.type}: ${result.reason}`);
    state = result.state; commands.push(command);
  }
  return null;
}
const cache: Record<string, V23Fixture> = {};
function first(key: string, seeds: number[], pick: (view: PlayerView) => number | undefined): V23Fixture {
  if (cache[key]) return cache[key];
  for (const seed of seeds) { const found = play(seed, pick); if (found) return cache[key] = found; }
  throw new Error(`No seed reached the ${key} moment`);
}
/** Seat 0 has a 工匠 that was trained with an escort. */
export const escortedBuilderFixture = () => first('escort', [1, 4, 5], view =>
  view.units.find(unit => unit.ownerId === 0 && unit.kind === 'logistics' && unit.role === 'builder' && unit.escortId)?.id);
/** Seat 0 has a Pokémon standing on an enemy improvement while at war. */
export const pillageFixture = () => first('pillage', [3, 6], view =>
  view.units.find(unit => unit.ownerId === 0 && unit.kind === 'pokemon' && unit.actionLeft && viewPillage(view, unit.id))?.id);
