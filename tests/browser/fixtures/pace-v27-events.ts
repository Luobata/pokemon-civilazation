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
import type { AiPersonality, Command, GameSetup, GameState, PlayerView } from '../../../src/core/model.ts';

// Real v27 games (pace-v27 events lane): the AI plays every seat (seat 0 is the human seat), nothing is patched, so saves replay exactly.
const setupFor = (seed: number, personality: AiPersonality, roundLimit: 100 | 200): GameSetup => ({ seed, width: 24, height: 16, roundLimit, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 27,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, ...[1, 2, 3].map(id => ({ id, controller: 'ai' as const, personality }))] });
export type V27Fixture = { state: GameState; save: string; seed: number };

function play(setup: GameSetup, pick: (view: PlayerView) => boolean): V27Fixture | null {
  const content = contentFor(setup);
  let state = createGame(setup, content);
  const commands: Command[] = [], memory: RejectedCitySite[] = [];
  while (!state.outcome && state.commandSeq < 100_000) {
    const view = observe(state, state.activePlayerId, content);
    if (state.activePlayerId === 0 && pick(view)) {
      const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
      return { state, save: serializeSave(state, log), seed: setup.seed };
    }
    let command = planNext(view, { ...RULE_QUERIES, content }, memory);
    let result = step(state, command, content);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command, content);
    }
    if (!result.ok) throw new Error(`v27 fixture rejected ${command.action.type}: ${result.reason}`);
    state = result.state; commands.push(command);
  }
  return null;
}
const cache: Record<string, V27Fixture | null> = {};
function first(key: string, setups: GameSetup[], pick: (view: PlayerView) => boolean): V27Fixture | null {
  if (key in cache) return cache[key];
  for (const setup of setups) { const found = play(setup, pick); if (found) return cache[key] = found; }
  return cache[key] = null;
}
/** Seat 0's turn with the first contest season announced and no contest hall (v27 ⑦: it may enter from any city). */
export const circuitFixture = () => first('circuit', [1, 2, 3].map(seed => setupFor(seed, 'conservative', 100)), view =>
  Boolean(view.expansion?.contestSeasons?.category && !view.expansion.contestSeasons.ownEntry && !view.expansion.contests?.own.halls.length));
/** Seat 0's turn the round before a Max raid den opens, the den explored by seat 0 (v27 ⑤). */
export const raidFixture = () => first('raid', [1, 2, 3, 4].map(seed => setupFor(seed, 'expansion', 200)), view => {
  const den = view.expansion?.raids?.pending;
  return Boolean(den && den.tileIndex !== null && den.round === view.round + 1);
});
