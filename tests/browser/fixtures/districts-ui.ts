import { EXPANSION_CONTENT } from '../../../src/content/units.ts';
import { createGame } from '../../../src/core/game.ts';
import { districtSites } from '../../../src/core/districts.ts';
import { observe } from '../../../src/core/vision.ts';
import { step } from '../../../src/core/step.ts';
import { canonicalSerialize } from '../../../src/core/snapshot.ts';
import { gameVersions } from '../../../src/core/versions.ts';
import { replay } from '../../../src/app/session.ts';
import type { CommandLog } from '../../../src/app/session.ts';
import { serializeSave } from '../../../src/app/save.ts';
import type { Command, GameSetup } from '../../../src/core/model.ts';

export type DistrictUiScenario = 'ready' | 'built';

export function districtUiFixture(scenario: DistrictUiScenario) {
  const setup: GameSetup = { seed: 1, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, multiplayer: true,
    eraProgression: 'simple-v1', gameplayVersion: 10, players: [
      { id: 0, controller: 'human', starterId: 'bulbasaur' }, { id: 1, controller: 'human', starterId: 'squirtle' },
    ] };
  let state = createGame(setup, EXPANSION_CONTENT);
  const log: CommandLog = { version: 1, ...gameVersions(setup), contentVersion: state.contentVersion, setup, commands: [] };
  const issue = (action: Command['action']) => {
    const command = { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action };
    const result = step(state, command, EXPANSION_CONTENT);
    if (!result.ok) throw new Error(`District UI fixture rejected ${action.type}: ${result.reason}`);
    state = result.state; log.commands.push(command);
  };
  const endRound = () => { const round = state.round; do issue({ type: 'EndTurn' }); while (state.round === round); };
  const cityId = state.players[0].headquartersCityId, originalWork = [...state.cities[cityId].workedTileIds];
  issue({ type: 'AssignWork', cityId, workedTileIds: originalWork.slice(0, 1), lockedTileIds: [] });
  issue({ type: 'SetResearch', techId: 'berryCultivation' });
  for (let guard = 0; guard < 30 && !state.players[0].research.unlockedIds.includes('berryCultivation'); guard++) endRound();
  issue({ type: 'AssignWork', cityId, workedTileIds: originalWork, lockedTileIds: [] });
  const legal = districtSites(observe(state, 0, EXPANSION_CONTENT), cityId, 'gardenDistrict')
    .filter(site => site.reason === null)
    .sort((a, b) => Number(b.releasesWork) - Number(a.releasesWork) || b.effects.total.food - a.effects.total.food || a.tileIndex - b.tileIndex);
  const site = legal[0];
  if (!site) throw new Error('No legal garden district site in browser fixture');
  if (scenario === 'built') {
    const city = state.cities[cityId];
    issue({ type: 'SetProductionQueue', cityId, orders: [{ item: { kind: 'district', defId: 'gardenDistrict', tileIndex: site.tileIndex } }] });
    for (let guard = 0; guard < 60 && !state.expansion?.districts?.tiles[site.tileIndex]; guard++) endRound();
    if (!state.expansion?.districts?.tiles[site.tileIndex]) throw new Error('District did not complete in browser fixture');
    if (city.queue.length !== 0) throw new Error('Unexpected remaining production in browser fixture');
  }
  if (canonicalSerialize(replay(log)) !== canonicalSerialize(state)) throw new Error('District UI fixture does not replay');
  return { state, log, save: serializeSave(state, log), cityId, tileIndex: site.tileIndex };
}
