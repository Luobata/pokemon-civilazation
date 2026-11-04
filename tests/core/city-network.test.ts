import { expect, test } from 'vitest';
import { ROSTER_CONTENT } from '../../src/content/units.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';
import { CITY_NETWORK_RULES } from '../../src/content/city-network.ts';
import { RULE_QUERIES } from '../../src/ai/query.ts';
import { planNext } from '../../src/ai/plan.ts';
import { rememberCityRejection } from '../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../src/ai/memory.ts';
import { replay } from '../../src/app/session.ts';
import type { CommandLog } from '../../src/app/session.ts';
import { createGame } from '../../src/core/game.ts';
import { createCity } from '../../src/core/city.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { districtEffects } from '../../src/core/districts.ts';
import { cityNetworkBonuses, cityNetworkYield, networkHealing } from '../../src/core/city-network.ts';
import { hexToIndex } from '../../src/core/hex.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { gameVersions } from '../../src/core/versions.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import type { Command, GameSetup, GameState, MapUnit } from '../../src/core/model.ts';

const duel = (gameplayVersion: GameplayVersion): GameSetup => ({ seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1', gameplayVersion,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'misty' }] });
const act = (state: GameState, action: Command['action']) => step(state, { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action });
/** Open grassland; player 0 owns its capital at (4,4) and a second city at (10,4). */
function network(version: GameplayVersion = 17): GameState {
  const state = createGame(duel(version));
  state.map.tiles.fill('grassland'); state.units = {};
  const capital = state.cities[state.players[0].headquartersCityId];
  capital.position = { q: 4, r: 4 }; capital.workedTileIds = []; capital.lockedTileIds = [];
  state.cities[state.players[1].headquartersCityId].position = { q: 20, r: 12 };
  state.cities[500] = createCity(500, 0, { q: 10, r: 4 }, false, ROSTER_CONTENT);
  refreshKnowledge(state);
  return state;
}
const capitalId = (state: GameState) => state.players[0].headquartersCityId;

test('the city network exists only from v17', () => {
  expect(createGame(duel(16)).expansion).not.toHaveProperty('cityNetwork');
  expect(createGame(duel(17)).expansion!.cityNetwork).toEqual({ routes: [] });
  expect(gameVersions({ gameplayVersion: 17 })).toEqual({ schemaVersion: 12, rulesVersion: 'cities-v17' });
});

test('a settler’s escort gives the new city its head start; traders need the market and only v17 allows them', () => {
  const state = network();
  state.units[900] = { ...createMapUnit({ kind: 'logistics', role: 'settler', escortId: 'geodude' }, 900, 0, { q: 4, r: 10 }, ROSTER_CONTENT, 0, 1) };
  const founded = act(state, { type: 'FoundCity', unitId: 900 });
  expect(founded.ok).toBe(true);
  if (!founded.ok) return;
  const city = Object.values(founded.state.cities).find(item => item.position.q === 4 && item.position.r === 10)!;
  expect(founded.events.map(event => event.payload)).toContainEqual({ type: 'EscortBonus', playerId: 0, cityId: city.id, escortId: 'geodude', kind: 'production' });
  expect(founded.state.expansion!.civilization.pendingProductionByCity[city.id]).toEqual({ playerId: 0, amount: 15 });
  // Traders: the city needs a 友好商店; escorts must be registered species.
  const queue = (s: GameState, item: object) => act(s, { type: 'SetProductionQueue', cityId: capitalId(s), orders: [{ item: item as never }] });
  expect(queue(network(), { kind: 'logistics', defId: 'trader' }).ok).toBe(false);
  const market = network(); market.cities[capitalId(market)].buildingIds.push('meetingHall');
  expect(queue(market, { kind: 'logistics', defId: 'trader', escortId: 'bulbasaur' }).ok).toBe(true);
  expect(queue(market, { kind: 'logistics', defId: 'trader', escortId: 'dragonite' }).ok).toBe(false);
  expect(queue(network(16), { kind: 'logistics', defId: 'settler', escortId: 'bulbasaur' }).ok).toBe(false);
  // A trader cannot found a city.
  const trader = network();
  trader.units[901] = createMapUnit({ kind: 'logistics', role: 'trader', homeCityId: capitalId(trader) }, 901, 0, { q: 4, r: 10 }, ROSTER_CONTENT, 0, 1);
  expect(act(trader, { type: 'FoundCity', unitId: 901 }).ok).toBe(false);
});

test('a trader that reaches another own city opens a route; the route pays both cities and ends if a city is lost', () => {
  const state = network();
  const home = capitalId(state);
  state.units[901] = createMapUnit({ kind: 'logistics', role: 'trader', escortId: 'pidgey', homeCityId: home }, 901, 0, { q: 7, r: 4 }, ROSTER_CONTENT, 0, 1);
  refreshKnowledge(state);
  expect(act(state, { type: 'EstablishTradeRoute', unitId: 901, toCityId: 500 }).ok).toBe(false); // not arrived
  (state.units[901] as MapUnit).position = { q: 9, r: 4 };
  const opened = act(state, { type: 'EstablishTradeRoute', unitId: 901, toCityId: 500 });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  expect(opened.state.units[901]).toBeUndefined();
  expect(cityNetworkYield(opened.state, opened.state.cities[500])).toMatchObject(CITY_NETWORK_RULES.route.destination);
  expect(cityNetworkYield(opened.state, opened.state.cities[home]).gold).toBe(CITY_NETWORK_RULES.route.origin.gold);
  expect(observe(opened.state, 0).expansion!.cityNetwork!.routes).toHaveLength(1);
  expect(observe(opened.state, 1).expansion!.cityNetwork!.routes).toHaveLength(0);
  // The destination changes hands: the route ends at the next round.
  const lost = opened.state; lost.cities[500].ownerId = 1;
  let next = lost;
  for (let turn = 0; turn < 2; turn++) { const result = act(next, { type: 'EndTurn' }); if (!result.ok) throw new Error(result.reason); next = result.state; }
  expect(next.expansion!.cityNetwork!.routes).toEqual([]);
});

test('v17 districts reward neighbouring districts and themed combos; v16 does not', () => {
  const state = network();
  const research = hexToIndex({ q: 5, r: 4 }, state.map)!, power = hexToIndex({ q: 6, r: 4 }, state.map)!;
  const completed = [{ cityId: capitalId(state), kind: 'powerPlantDistrict' as const, tileIndex: power, builtAtRound: 0 }];
  const input = { map: state.map, cities: Object.values(state.cities), improvements: [], completed };
  const v17 = districtEffects({ ...input, gameplayVersion: 17 }, 'researchDistrict', research);
  const v16 = districtEffects({ ...input, gameplayVersion: 16 }, 'researchDistrict', research);
  expect(v17.total.research - v16.total.research).toBe(2); // +1 adjacent district, +1 供电实验室
  expect(v17.adjacency.map(item => item.id)).toEqual(expect.arrayContaining(['district', 'combo-powerPlantDistrict']));
});

test('regional districts, type-city alliances and the Pokémon Center network reach own cities within range', () => {
  const state = network();
  const capital = state.cities[capitalId(state)];
  state.expansion!.districts!.tiles[hexToIndex({ q: 11, r: 5 }, state.map)!] = { cityId: 500, kind: 'powerPlantDistrict', tileIndex: hexToIndex({ q: 11, r: 5 }, state.map)!, builtAtRound: 0 };
  state.expansion!.essences!.gyms[capital.id] = 'sylvan';
  state.expansion!.essences!.gyms[500] = 'tide';
  const labels = cityNetworkBonuses(state, capital).map(bonus => bonus.label);
  expect(labels.some(label => label.startsWith('发电厂输电'))).toBe(true);
  expect(labels).toContain('森灵 × 潮汐：灌溉');
  expect(cityNetworkYield(state, capital)).toMatchObject({ production: 1, food: 1 });
  state.expansion!.essences!.gyms[500] = 'sylvan';
  expect(cityNetworkBonuses(state, capital).map(bonus => bonus.label)).toContain('属性城市联盟（同属性 1 城）');
  // 宝可梦中心 heals own Pokémon near any own city that has one.
  const pokemon = createMapUnit({ kind: 'pokemon', speciesId: 'rattata' }, 950, 0, { q: 12, r: 6 }, ROSTER_CONTENT);
  expect(networkHealing(state, pokemon)).toBe(0);
  state.cities[500].buildingIds.push('trainingGround');
  expect(networkHealing(state, pokemon)).toBe(CITY_NETWORK_RULES.centreHealing);
});

test('a real v17 AI game uses escorts and trade routes and replays exactly', () => {
  const setup: GameSetup = { seed: 31, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 17, players: [
    { id: 0, controller: 'ai', personality: 'expansion', leaderId: 'oak' }, { id: 1, controller: 'ai', personality: 'conservative', leaderId: 'joy' },
    { id: 2, controller: 'ai', personality: 'aggressive', leaderId: 'lance' }] };
  let state = createGame(setup);
  const commands: Command[] = [], memory: RejectedCitySite[] = [];
  let escorts = 0, routes = 0;
  while (!state.outcome && state.round < 80) {
    const view = observe(state, state.activePlayerId);
    let command = planNext(view, { ...RULE_QUERIES, content: ROSTER_CONTENT }, memory);
    let result = step(state, command);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command);
    }
    if (!result.ok) throw new Error(result.reason);
    escorts += result.events.filter(event => event.payload.type === 'EscortBonus').length;
    routes += result.events.filter(event => event.payload.type === 'TradeRouteEstablished').length;
    state = result.state; commands.push(command);
  }
  expect(escorts).toBeGreaterThan(0);
  expect(routes).toBeGreaterThan(0);
  const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
  expect(state.schemaVersion).toBe(12);
  expect(canonicalSerialize(replay(log))).toBe(canonicalSerialize(state));
}, 120_000);
