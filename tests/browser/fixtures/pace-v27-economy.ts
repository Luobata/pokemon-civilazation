// Gameplay v27 economy lane: a save of a real v27 AI game (every seat, seat 0 included, is played by the shipped AI; nothing is
// patched, so the save replays exactly), stopped at the first seat-0 turn where a city has an empty queue and every building it could
// build is built (so the idle-city quick fill offers a city project).
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
import type { BuildingId } from '../../../src/content/economy.ts';

export const PACE_SETUP: GameSetup = { seed: 3, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 27,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, ...[1, 2, 3].map(id => ({ id, controller: 'ai' as const, personality: 'expansion' as const }))] };
export type PaceFixture = { state: GameState; save: string; cityId: number };

/** A seat-0 city with an empty queue and no building left to build (the moment the city would idle). */
function idleCity(view: PlayerView): number | undefined {
  if (view.round < 15) return undefined;
  const content = contentFor(PACE_SETUP), player = view.economy.player;
  return view.economy.cities.find(city => !city.queue.length && !city.pendingDeployments.length && (Object.keys(content.buildings) as BuildingId[]).every(id => {
    const building = content.buildings[id];
    return building.cost === null || city.buildingIds.includes(id) || Boolean(building.requiredTech && !player.research.unlockedIds.includes(building.requiredTech));
  }))?.id;
}
let cached: PaceFixture | null = null;
export function idleCityFixture(): PaceFixture {
  if (cached) return cached;
  const content = contentFor(PACE_SETUP);
  let state = createGame(PACE_SETUP, content);
  const commands: Command[] = [], memory: RejectedCitySite[] = [];
  while (!state.outcome && state.round < 100) {
    const view = observe(state, state.activePlayerId, content);
    if (state.activePlayerId === 0) {
      const cityId = idleCity(view);
      if (cityId !== undefined) {
        const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
        return cached = { state, save: serializeSave(state, log), cityId };
      }
    }
    let command = planNext(view, { ...RULE_QUERIES, content }, memory);
    let result = step(state, command, content);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command, content);
    }
    if (!result.ok) throw new Error(`pace fixture rejected ${command.action.type}: ${result.reason}`);
    state = result.state; commands.push(command);
  }
  throw new Error('No v27 game reached an idle city');
}
