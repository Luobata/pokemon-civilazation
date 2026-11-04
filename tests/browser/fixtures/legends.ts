import { ROSTER_CONTENT } from '../../../src/content/units.ts';
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

// A real v15 simple-era game (the AI plays both seats; nothing is patched, so the save replays exactly).
const setupFor = (seed: number): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 15,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'ai', personality: 'expansion', leaderId: 'joy' }] });
export type LegendFixture = { state: GameState; save: string; seed: number };

/** Stops at the start of a player-0 command right after player 0's first wonder is completed. */
function search(seed: number): LegendFixture | null {
  let state = createGame(setupFor(seed), ROSTER_CONTENT);
  const commands: Command[] = [], memory: RejectedCitySite[] = [];
  while (!state.outcome && state.round < 98) {
    if (state.activePlayerId === 0 && Object.values(state.expansion!.legends!.wonders).some(wonder => wonder && state.cities[wonder.cityId]?.ownerId === 0)) {
      const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
      return { state, save: serializeSave(state, log), seed };
    }
    const view = observe(state, state.activePlayerId, ROSTER_CONTENT);
    let command = planNext(view, { ...RULE_QUERIES, content: ROSTER_CONTENT }, memory);
    let result = step(state, command, ROSTER_CONTENT);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command, ROSTER_CONTENT);
    }
    if (!result.ok) throw new Error(`Legend fixture rejected ${command.action.type}: ${result.reason}`);
    state = result.state; commands.push(command);
  }
  return null;
}
let cached: LegendFixture | undefined;
export function legendFixture(): LegendFixture {
  if (cached) return cached;
  for (const seed of Array.from({ length: 40 }, (_, i) => i + 1)) { const found = search(seed); if (found) return cached = found; }
  throw new Error('No seed reached a wonder built by player 0');
}
