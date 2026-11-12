import { contentFor } from '../../../src/content/units.ts';
import { RULE_QUERIES } from '../../../src/ai/query.ts';
import { planNext } from '../../../src/ai/plan.ts';
import { rememberCityRejection } from '../../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../../src/ai/memory.ts';
import { createGame } from '../../../src/core/game.ts';
import { hexDistance } from '../../../src/core/hex.ts';
import type { Hex } from '../../../src/core/hex.ts';
import { observe } from '../../../src/core/vision.ts';
import { step } from '../../../src/core/step.ts';
import { gameVersions } from '../../../src/core/versions.ts';
import { serializeSave } from '../../../src/app/save.ts';
import type { CommandLog } from '../../../src/app/session.ts';
import type { SpeciesId } from '../../../src/content/species.ts';
import type { Command, GameSetup, GameState } from '../../../src/core/model.ts';

// Real v24 games: the AI plays every seat (seat 0 is the human seat), nothing is patched, so saves replay exactly.
const setupFor = (seed: number): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 24,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, ...[1, 2, 3].map(id => ({ id, controller: 'ai' as const, personality: 'aggressive' as const }))] });
export type ResearchFixture = { state: GameState; save: string; unitId: number; targetId: number; targetPosition: Hex; speciesId: SpeciesId };

/**
 * Plays until seat 0's turn has an own Pokémon next to a wild one whose knockout (by the real rules, same RNG) completes
 * the "knock out 2" task on seat 0's card, then saves before that attack.
 */
function play(seed: number): ResearchFixture | null {
  const setup = setupFor(seed), content = contentFor(setup);
  let state = createGame(setup, content);
  const commands: Command[] = [], memory: RejectedCitySite[] = [];
  while (!state.outcome && state.round < 60) {
    const view = observe(state, state.activePlayerId, content);
    if (state.activePlayerId === 0) {
      for (const unit of view.units.filter(unit => unit.ownerId === 0 && unit.kind === 'pokemon' && unit.actionLeft).sort((a, b) => a.id - b.id)) {
        for (const target of view.units.filter(other => other.ownerId === null && other.kind === 'pokemon' && hexDistance(other.position, unit.position, view.map) === 1)) {
          if (target.kind !== 'pokemon') continue;
          const tried = step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'Attack', unitId: unit.id, target: { kind: 'unit', id: target.id } } }, content);
          if (!tried.ok || !tried.events.some(event => event.payload.type === 'ResearchTaskCompleted' && event.payload.playerId === 0 && event.payload.task === 'knockouts')) continue;
          const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
          return { state, save: serializeSave(state, log), unitId: unit.id, targetId: target.id, targetPosition: { ...target.position }, speciesId: target.speciesId };
        }
      }
    }
    let command = planNext(view, { ...RULE_QUERIES, content }, memory);
    let result = step(state, command, content);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command, content);
    }
    if (!result.ok) throw new Error(`v24 fixture rejected ${command.action.type}: ${result.reason}`);
    state = result.state; commands.push(command);
  }
  return null;
}
let cached: ResearchFixture | undefined;
/** Seat 0 can finish "knock out 2" on a wild species with one attack. */
export function knockoutTaskFixture(): ResearchFixture {
  if (cached) return cached;
  for (const seed of [2, 1, 3, 4, 5, 6]) { const found = play(seed); if (found) return cached = found; }
  throw new Error('No seed reached the research knockout moment');
}
