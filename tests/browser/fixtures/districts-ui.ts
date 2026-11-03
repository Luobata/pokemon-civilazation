import { EXPANSION_CONTENT } from '../../../src/content/units.ts';
import { createGame } from '../../../src/core/game.ts';
import { districtSites } from '../../../src/core/districts.ts';
import { observe } from '../../../src/core/vision.ts';
import { step } from '../../../src/core/step.ts';
import { reachablePaths } from '../../../src/core/movement.ts';
import { hexDistance } from '../../../src/core/hex.ts';
import { canonicalSerialize } from '../../../src/core/snapshot.ts';
import { gameVersions } from '../../../src/core/versions.ts';
import { replay } from '../../../src/app/session.ts';
import type { CommandLog } from '../../../src/app/session.ts';
import { serializeSave } from '../../../src/app/save.ts';
import type { Command, GameSetup } from '../../../src/core/model.ts';

export type DistrictUiScenario = 'ready' | 'built' | 'harbor';

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
  const techId = scenario === 'harbor' ? 'domestication' : 'berryCultivation';
  issue({ type: 'SetResearch', techId });
  for (let guard = 0; guard < 30 && !state.players[0].research.unlockedIds.includes(techId); guard++) endRound();
  issue({ type: 'AssignWork', cityId, workedTileIds: originalWork, lockedTileIds: [] });
  if (scenario === 'harbor') {
    const site = districtSites(observe(state, 0, EXPANSION_CONTENT), cityId, 'harborDistrict').find(item => item.reason === 'harbor-needs-coast');
    if (!site) throw new Error('No unexplored coast in browser fixture');
    if (canonicalSerialize(replay(log)) !== canonicalSerialize(state)) throw new Error('Harbor fixture does not replay');
    return { state, log, save: serializeSave(state, log), cityId, tileIndex: site.tileIndex };
  }
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

export function foreignConstructionFixture(hidden = false) {
  const setup: GameSetup = { seed: 1, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, multiplayer: true,
    eraProgression: 'simple-v1', gameplayVersion: 10, players: [
      { id: 0, controller: 'human', starterId: 'bulbasaur' }, { id: 1, controller: 'human', starterId: 'squirtle' },
    ] };
  let state = createGame(setup, EXPANSION_CONTENT);
  const log: CommandLog = { version: 1, ...gameVersions(setup), contentVersion: state.contentVersion, setup, commands: [] };
  const issue = (action: Command['action']) => {
    const command = { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action };
    const result = step(state, command, EXPANSION_CONTENT);
    if (!result.ok) throw new Error(`Foreign construction fixture rejected ${action.type}: ${result.reason}`);
    state = result.state; log.commands.push(command);
  };
  const ownCityId = state.players[0].headquartersCityId, foreignCityId = state.players[1].headquartersCityId;
  for (const cityId of [ownCityId, foreignCityId]) {
    issue({ type: 'AssignWork', cityId, workedTileIds: state.cities[cityId].workedTileIds.slice(0, 1), lockedTileIds: [] });
    issue({ type: 'SetResearch', techId: 'berryCultivation' });
    issue({ type: 'EndTurn' });
  }
  const scout = Object.values(state.units).find(unit => unit.ownerId === 0 && unit.kind === 'pokemon' && unit.location === 'map');
  if (!scout) throw new Error('Missing foreign construction scout');
  const scoutId = scout.id;
  const moveToward = (target: { q: number; r: number }) => {
    const view = observe(state, 0, EXPANSION_CONTENT), paths = reachablePaths(view, scoutId);
    const destination = Object.values(paths).sort((a, b) => hexDistance(a.at(-1)!, target) - hexDistance(b.at(-1)!, target)
      || b.length - a.length || hexDistance(a.at(-1)!, target) - hexDistance(b.at(-1)!, target))[0]?.at(-1);
    if (destination) issue({ type: 'Move', unitId: scoutId, to: destination });
  };
  let tileIndex = -1;
  for (let guard = 0; guard < 100; guard++) {
    const foreignView = observe(state, 1, EXPANSION_CONTENT), ownView = observe(state, 0, EXPANSION_CONTENT);
    const visible = new Set(ownView.visibleTileIds), city = state.cities[foreignCityId];
    const site = districtSites(foreignView, foreignCityId, 'gardenDistrict')
      .find(item => item.reason === null && visible.has(item.tileIndex));
    if (site && city.queue.length === 0) {
      tileIndex = site.tileIndex;
      issue({ type: 'EndTurn' });
      issue({ type: 'SetProductionQueue', cityId: foreignCityId, orders: [{ item: { kind: 'district', defId: 'gardenDistrict', tileIndex } }] });
      issue({ type: 'EndTurn' });
      break;
    }
    moveToward(state.cities[foreignCityId].position);
    issue({ type: 'EndTurn' }); issue({ type: 'EndTurn' });
  }
  if (tileIndex < 0 || !observe(state, 0, EXPANSION_CONTENT).expansion?.districts?.constructionSites?.length) {
    throw new Error('Foreign construction never became visible');
  }
  if (hidden) {
    for (let guard = 0; guard < 30 && observe(state, 0, EXPANSION_CONTENT).expansion?.districts?.constructionSites?.length; guard++) {
      if (!state.cities[foreignCityId].queue.some(order => order.item.kind === 'district')) throw new Error('Foreign construction completed before hiding');
      moveToward(state.cities[ownCityId].position);
      issue({ type: 'EndTurn' }); issue({ type: 'EndTurn' });
    }
    if (observe(state, 0, EXPANSION_CONTENT).expansion?.districts?.constructionSites?.length) throw new Error('Foreign construction stayed visible after retreat');
  }
  if (canonicalSerialize(replay(log)) !== canonicalSerialize(state)) throw new Error('Foreign construction fixture does not replay');
  return { state, log, save: serializeSave(state, log), cityId: foreignCityId, tileIndex, scoutId };
}
