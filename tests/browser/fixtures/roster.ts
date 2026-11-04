import { ROSTER_CONTENT } from '../../../src/content/units.ts';
import type { SpeciesId } from '../../../src/content/units.ts';
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

// A real v14 full-era game (the AI plays both seats; nothing is patched, so the save replays exactly).
const setupFor = (seed: number): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'full-v1', gameplayVersion: 14,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'ai', personality: 'expansion', leaderId: 'misty' }] });
export type RosterFixture = { state: GameState; save: string; unitId: number; seed: number };

/** Stops at the start of a player-0 command when a deployed own Pokémon matches `wanted`. */
function search(seed: number, wanted: (speciesId: SpeciesId) => boolean): RosterFixture | null {
  let state = createGame(setupFor(seed), ROSTER_CONTENT);
  const commands: Command[] = [], memory: RejectedCitySite[] = [];
  while (!state.outcome && state.round < 95) {
    if (state.activePlayerId === 0) {
      const unit = Object.values(state.units).find(item => item.ownerId === 0 && item.location === 'map' && item.kind === 'pokemon' && wanted(item.speciesId));
      if (unit) {
        const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
        return { state, save: serializeSave(state, log), unitId: unit.id, seed };
      }
    }
    const view = observe(state, state.activePlayerId, ROSTER_CONTENT);
    let command = planNext(view, { ...RULE_QUERIES, content: ROSTER_CONTENT }, memory);
    let result = step(state, command, ROSTER_CONTENT);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command, ROSTER_CONTENT);
    }
    if (!result.ok) throw new Error(`Roster fixture rejected ${command.action.type}: ${result.reason}`);
    state = result.state; commands.push(command);
  }
  return null;
}
const cache = new Map<string, RosterFixture>();
export function rosterFixture(kind: 'eevee' | 'late-generation'): RosterFixture {
  const cached = cache.get(kind);
  if (cached) return cached;
  const wanted = kind === 'eevee' ? (id: SpeciesId) => id === 'eevee' : (id: SpeciesId) => (ROSTER_CONTENT.species[id].dex ?? 0) > 649;
  // Pinned seeds first (found by search); the scan is a fallback if rules change the trajectories.
  for (const seed of [kind === 'eevee' ? 6 : 1, ...Array.from({ length: 40 }, (_, i) => i + 1)]) {
    const found = search(seed, wanted);
    if (found) { cache.set(kind, found); return found; }
  }
  throw new Error(`No seed reached a deployed ${kind} Pokémon for player 0`);
}
