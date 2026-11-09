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
import { hexToIndex } from '../../../src/core/hex.ts';
import type { CommandLog } from '../../../src/app/session.ts';
import type { Command, GameSetup, GameState, PlayerView } from '../../../src/core/model.ts';

// A real v23 game: the AI plays every seat (seat 0 is the human seat), nothing is patched, so the save replays exactly.
const setupFor = (seed: number): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 23,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, ...[1, 2, 3].map(id => ({ id, controller: 'ai' as const, personality: 'expansion' as const }))] });

/** Visible nests with nothing else on the tile, so the map hover line leads with the nest. */
export const bareNestTiles = (view: PlayerView): number[] => (view.expansion?.world.nests ?? []).map(nest => nest.tileIndex)
  .filter(index => view.visibleTileIds.includes(index)
    && !view.units.some(unit => hexToIndex(unit.position, view.map) === index) && !view.cities.some(city => hexToIndex(city.position, view.map) === index));

export type GlossaryFixture = { state: GameState; save: string; nestTiles: number[] };
let cached: GlossaryFixture | undefined;

/** Seat 0's turn after round 8 with a city, an adopted charter in progress and a bare nest in sight. */
export function glossaryFixture(): GlossaryFixture {
  if (cached) return cached;
  for (const seed of [2, 3, 5, 7, 11]) {
    const setup = setupFor(seed), content = contentFor(setup);
    let state = createGame(setup, content);
    const commands: Command[] = [], memory: RejectedCitySite[] = [];
    while (!state.outcome && state.round < 60) {
      const view = observe(state, state.activePlayerId, content);
      if (state.activePlayerId === 0 && state.round >= 8 && view.economy.cities.length && view.expansion?.policies && bareNestTiles(view).length) {
        const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
        return cached = { state, save: serializeSave(state, log), nestTiles: bareNestTiles(view) };
      }
      let command = planNext(view, { ...RULE_QUERIES, content }, memory);
      let result = step(state, command, content);
      if (!result.ok) {
        rememberCityRejection(memory, view, command, result.reason);
        command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
        result = step(state, command, content);
      }
      if (!result.ok) throw new Error(`glossary fixture rejected ${command.action.type}: ${result.reason}`);
      state = result.state; commands.push(command);
    }
  }
  throw new Error('No seed showed seat 0 a bare nest');
}
