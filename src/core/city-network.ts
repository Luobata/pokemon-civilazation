// Gameplay v17 city network (docs/design/city-network-v17.md). Everything here is a no-op unless
// `state.expansion.cityNetwork` exists, so v<=16 games, logs and replays are unchanged.
import { ALLIANCE_YIELD, CITY_NETWORK_RULES, COMPLEMENTS, ESCORT_BONUSES, REGIONAL_DISTRICTS, escortBonusKind } from '../content/city-network.ts';
import type { EscortBonusKind } from '../content/city-network.ts';
import type { Yield } from '../content/economy.ts';
import { gameplayAtLeast } from '../content/eras.ts';
import type { Content, SpeciesId } from '../content/units.ts';
import { hexDistance } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { CityState, EventPayload, GameState, MapUnit, PlayerView } from './model.ts';

export type TradeRoute = { ownerId: number; fromCityId: number; toCityId: number; sinceRound: number };
export type CityNetworkState = { routes: TradeRoute[] };
export type NetworkBonus = { label: string; yield: Partial<Yield> };
export type CityNetworkView = { routes: TradeRoute[]; bonuses: Record<number, NetworkBonus[]> };
export type CityNetworkAction = { type: 'EstablishTradeRoute'; unitId: number; toCityId: number };
export type CityNetworkEvent =
  | { type: 'TradeRouteEstablished'; playerId: number; fromCityId: number; toCityId: number }
  | { type: 'TradeRouteLost'; playerId: number; fromCityId: number; toCityId: number }
  | { type: 'EscortBonus'; playerId: number; cityId: number; escortId: SpeciesId; kind: EscortBonusKind };

export const usesCityNetwork = (source: { setup?: { gameplayVersion?: number }; gameplayVersion?: number }) =>
  gameplayAtLeast({ gameplayVersion: (source.setup?.gameplayVersion ?? source.gameplayVersion) as never }, 17);
export function initializeCityNetwork(state: GameState): void {
  if (state.expansion && usesCityNetwork(state)) state.expansion.cityNetwork = { routes: [] };
}
export function isCityNetworkAction(action: { type: unknown }): action is CityNetworkAction { return action.type === 'EstablishTradeRoute'; }

type NetworkHost = Pick<GameState, 'cities' | 'expansion' | 'map'>;
const ownCitiesNear = (state: Pick<GameState, 'cities' | 'map'>, city: Pick<CityState, 'id' | 'ownerId' | 'position'>) => Object.values(state.cities)
  .filter(other => other.id !== city.id && other.ownerId === city.ownerId && hexDistance(other.position, city.position, state.map) <= CITY_NETWORK_RULES.regionRadius)
  .sort((a, b) => a.id - b.id);

/** Every network bonus a city receives (regional districts, type alliances, complements, trade routes), labelled for the UI. */
export function cityNetworkBonuses(state: NetworkHost, city: Pick<CityState, 'id' | 'ownerId' | 'position'>): NetworkBonus[] {
  const network = state.expansion?.cityNetwork;
  if (!network || city.ownerId === null) return [];
  const bonuses: NetworkBonus[] = [], near = ownCitiesNear(state, city);
  // Regional districts in other own cities within range.
  const districts = Object.values(state.expansion?.districts?.tiles ?? {});
  for (const [kind, rule] of Object.entries(REGIONAL_DISTRICTS)) {
    const sources = near.filter(other => districts.some(tile => tile.cityId === other.id && tile.kind === kind)).length;
    if (sources) bonuses.push({ label: `${rule!.label}（周围 ${sources} 城）`, yield: { [rule!.yield]: Math.min(CITY_NETWORK_RULES.regionalCap, sources) } });
  }
  // Type-city alliances and complementary pairs.
  const gyms = state.expansion?.essences?.gyms ?? {}, own = gyms[city.id];
  if (own) {
    const allies = near.filter(other => gyms[other.id] === own).length;
    if (allies) bonuses.push({ label: `属性城市联盟（同属性 ${allies} 城）`, yield: { [ALLIANCE_YIELD[own]]: Math.min(CITY_NETWORK_RULES.allianceCap, allies) } });
    let complements = 0;
    for (const rule of COMPLEMENTS) {
      if (complements >= CITY_NETWORK_RULES.complementCap || !rule.pair.includes(own)) continue;
      const partner = rule.pair[0] === own ? rule.pair[1] : rule.pair[0];
      if (near.some(other => gyms[other.id] === partner)) { bonuses.push({ label: rule.label, yield: { [rule.yield]: 1 } }); complements++; }
    }
  }
  // Domestic trade routes.
  for (const route of network.routes.filter(item => item.ownerId === city.ownerId).sort((a, b) => a.fromCityId - b.fromCityId || a.toCityId - b.toCityId)) {
    if (route.toCityId === city.id) bonuses.push({ label: `商路：来自城市 ${route.fromCityId}`, yield: { ...CITY_NETWORK_RULES.route.destination } });
    if (route.fromCityId === city.id) bonuses.push({ label: `商路：通往城市 ${route.toCityId}`, yield: { ...CITY_NETWORK_RULES.route.origin } });
  }
  return bonuses;
}
export function cityNetworkYield(state: NetworkHost, city: Pick<CityState, 'id' | 'ownerId' | 'position'>): Yield {
  const total: Yield = { food: 0, production: 0, gold: 0, research: 0 };
  for (const bonus of cityNetworkBonuses(state, city)) for (const [key, value] of Object.entries(bonus.yield) as [keyof Yield, number][]) total[key] += value;
  return total;
}
/** 宝可梦中心 network: extra healing for own Pokémon within range of any own city that has one. */
export function networkHealing(state: Pick<GameState, 'cities' | 'expansion' | 'map'>, unit: MapUnit): number {
  if (!state.expansion?.cityNetwork || unit.ownerId === null || unit.kind !== 'pokemon') return 0;
  return Object.values(state.cities).some(city => city.ownerId === unit.ownerId && city.buildingIds.includes('trainingGround')
    && hexDistance(city.position, unit.position, state.map) <= CITY_NETWORK_RULES.regionRadius) ? CITY_NETWORK_RULES.centreHealing : 0;
}

// ---------- settler escort ----------
/** Applies the escort's bonus to a newly founded city (v17 only). */
export function applyEscortBonus(state: GameState, playerId: number, city: CityState, escortId: SpeciesId | undefined, content: Content): EventPayload[] {
  if (!state.expansion?.cityNetwork || !escortId || !content.species[escortId]) return [];
  const kind = escortBonusKind(content.species[escortId].typeId), amounts = ESCORT_BONUSES[kind].amounts, player = state.players[playerId];
  if (amounts.food) city.food += amounts.food;
  if (amounts.gold) player.gold += amounts.gold;
  if (amounts.research) player.research.reserve += amounts.research;
  if (amounts.production) state.expansion.civilization.pendingProductionByCity[city.id] = { playerId, amount: amounts.production };
  return [{ type: 'EscortBonus', playerId, cityId: city.id, escortId, kind }];
}

// ---------- trade routes ----------
const routeBetween = (routes: readonly TradeRoute[], ownerId: number, a: number, b: number) =>
  routes.some(route => route.ownerId === ownerId && ((route.fromCityId === a && route.toCityId === b) || (route.fromCityId === b && route.toCityId === a)));
export const maxRoutes = (state: Pick<GameState, 'cities'>, playerId: number) => Object.values(state.cities).filter(city => city.ownerId === playerId).length;

export function validateCityNetworkAction(state: GameState, actorId: number, action: CityNetworkAction): string | null {
  const network = state.expansion?.cityNetwork, unit = state.units[action.unitId], to = state.cities[action.toCityId];
  if (!network) return 'network-unavailable';
  if (!unit || unit.ownerId !== actorId || !isMapUnit(unit) || unit.kind !== 'logistics' || unit.role !== 'trader' || !unit.actionLeft) return 'unit-unavailable';
  const home = unit.homeCityId === undefined ? undefined : state.cities[unit.homeCityId];
  if (!home || home.ownerId !== actorId || !to || to.ownerId !== actorId || to.id === home.id) return 'route-city-unavailable';
  if (hexDistance(unit.position, to.position, state.map) > 1) return 'route-not-arrived';
  if (hexDistance(home.position, to.position, state.map) > CITY_NETWORK_RULES.trader.maxRouteDistance) return 'route-too-long';
  if (routeBetween(network.routes, actorId, home.id, to.id)) return 'route-exists';
  if (network.routes.filter(route => route.ownerId === actorId).length >= maxRoutes(state, actorId)) return 'route-limit';
  return null;
}
export function applyCityNetworkAction(state: GameState, actorId: number, action: CityNetworkAction): EventPayload[] {
  const unit = state.units[action.unitId] as MapUnit & { kind: 'logistics' };
  const route = { ownerId: actorId, fromCityId: unit.homeCityId!, toCityId: action.toCityId, sinceRound: state.round };
  state.expansion!.cityNetwork!.routes.push(route);
  delete state.units[unit.id];
  return [{ type: 'TradeRouteEstablished', playerId: actorId, fromCityId: route.fromCityId, toCityId: route.toCityId }];
}
/** Round upkeep: routes whose cities changed hands end. */
export function resolveCityNetworkRound(state: GameState): EventPayload[] {
  const network = state.expansion?.cityNetwork;
  if (!network) return [];
  const events: EventPayload[] = [];
  network.routes = network.routes.filter(route => {
    const alive = state.cities[route.fromCityId]?.ownerId === route.ownerId && state.cities[route.toCityId]?.ownerId === route.ownerId && !state.players[route.ownerId].eliminated;
    if (!alive) events.push({ type: 'TradeRouteLost', playerId: route.ownerId, fromCityId: route.fromCityId, toCityId: route.toCityId });
    return alive;
  });
  return events;
}
export function observeCityNetwork(state: GameState, playerId: number): CityNetworkView | undefined {
  const network = state.expansion?.cityNetwork;
  if (!network) return undefined;
  const bonuses: Record<number, NetworkBonus[]> = {};
  for (const city of Object.values(state.cities).filter(item => item.ownerId === playerId).sort((a, b) => a.id - b.id)) bonuses[city.id] = cityNetworkBonuses(state, city);
  return { routes: network.routes.filter(route => route.ownerId === playerId).map(route => ({ ...route })), bonuses };
}
/** View-side: own cities this trader may open a route to, with the reason for the others. */
export function tradeDestinations(view: PlayerView, unitId: number): { cityId: number; reason: string | null }[] {
  const network = view.expansion?.cityNetwork, unit = view.units.find(item => item.id === unitId && item.ownerId === view.playerId);
  if (!network || !unit || unit.kind !== 'logistics' || unit.role !== 'trader') return [];
  const home = view.economy.cities.find(city => city.id === unit.homeCityId);
  return view.economy.cities.filter(city => city.id !== unit.homeCityId).sort((a, b) => a.id - b.id).map(city => ({ cityId: city.id,
    reason: !home ? '出发城市已失去' : !unit.actionLeft ? '本轮已行动' : routeBetween(network.routes, view.playerId, home.id, city.id) ? '两城之间已有商路'
      : network.routes.length >= view.economy.cities.length ? `商路已达上限（${view.economy.cities.length} 条 = 城市数）`
      : hexDistance(home.position, city.position, view.map) > CITY_NETWORK_RULES.trader.maxRouteDistance ? `距离超过 ${CITY_NETWORK_RULES.trader.maxRouteDistance} 格`
      : hexDistance(unit.position, city.position, view.map) > 1 ? '先把商队移动到这座城市旁边' : null }));
}
