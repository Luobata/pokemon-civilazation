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

// A real v17 game (the AI plays both seats; nothing is patched, so the save replays exactly).
const setupFor = (seed: number): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 17,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'ai', personality: 'expansion', leaderId: 'joy' }] });
export type NetworkFixture = { state: GameState; save: string; seed: number; traderId: number | null };

/** Stops on player 0's turn once it owns a trade route and a deployed trader (or, failing that, any trade route). */
function search(seed: number): NetworkFixture | null {
  let state = createGame(setupFor(seed), ROSTER_CONTENT);
  const commands: Command[] = [], memory: RejectedCitySite[] = [];
  while (!state.outcome && state.round < 98) {
    if (state.activePlayerId === 0 && state.expansion!.cityNetwork!.routes.some(route => route.ownerId === 0)) {
      const trader = Object.values(state.units).find(unit => unit.ownerId === 0 && unit.kind === 'logistics' && unit.role === 'trader' && unit.location === 'map');
      const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
      if (trader) return { state, save: serializeSave(state, log), seed, traderId: trader.id };
    }
    const view = observe(state, state.activePlayerId, ROSTER_CONTENT);
    let command = planNext(view, { ...RULE_QUERIES, content: ROSTER_CONTENT }, memory);
    let result = step(state, command, ROSTER_CONTENT);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command, ROSTER_CONTENT);
    }
    if (!result.ok) throw new Error(`Network fixture rejected ${command.action.type}: ${result.reason}`);
    state = result.state; commands.push(command);
  }
  return null;
}
let cached: NetworkFixture | undefined;
export function networkFixture(): NetworkFixture {
  if (cached) return cached;
  for (let seed = 1; seed <= 40; seed++) { const found = search(seed); if (found) return cached = found; }
  throw new Error('No seed reached a trade route plus a trader for player 0');
}
