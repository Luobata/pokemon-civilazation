import { victoryTargets } from '../content/opening.ts';
import { FAITH_RULES, LEGENDS, LEGEND_IDS, TENETS } from '../content/faith-legends.ts';
import type { LegendId, TenetId } from '../content/faith-legends.ts';
import { gameplayAtLeast } from '../content/eras.ts';
import type { Content } from '../content/units.ts';
import { hexDistance } from './hex.ts';
import type { MapShape } from './hex.ts';
import { finishGame } from './victory.ts';
import type { EventPayload, GameState } from './model.ts';

/**
 * Gameplay v9: legend faiths. A civilization with enough lifetime offerings founds the faith of one legend,
 * then spreads it with offering points; nearby faithful cities spread passively. A city follows the faith with
 * the highest pressure once it reaches the conversion threshold. Holding the majority of all cities wins.
 */
export type Faith = { founderId: number; legend: LegendId; tenets: TenetId[]; foundedRound: number };
export type FaithState = { faiths: Record<number, Faith>; pressure: Record<number, Record<number, number>>; cityFaith: Record<number, number> };
export type FaithAction =
  | { type: 'FoundFaith'; legend: LegendId; tenets: TenetId[] }
  | { type: 'SpreadFaith'; cityId: number };
export type FaithEvent =
  | { type: 'FaithFounded'; playerId: number; legend: LegendId; tenets: TenetId[]; public: true }
  | { type: 'CityConverted'; playerId: number; cityId: number; legend: LegendId; public: true };
export type FaithView = { faiths: (Faith & { followers: number })[]; cityFaith: Record<number, number>; ownPressure: Record<number, number>; totalCities: number; winShare: number };

export const usesFaith = (state: Pick<GameState, 'setup' | 'expansion'>) => state.expansion !== undefined && gameplayAtLeast(state.setup, 9);
export function isFaithAction(action: { type: unknown }): action is FaithAction { return action.type === 'FoundFaith' || action.type === 'SpreadFaith'; }
export function initializeFaith(state: GameState): void {
  if (usesFaith(state)) state.expansion!.faith = { faiths: {}, pressure: {}, cityFaith: {} };
}
const offering = (state: GameState, playerId: number) => state.expansion!.civilization.players[playerId];
export function faithTenets(state: GameState, playerId: number | null): TenetId[] {
  if (playerId === null) return [];
  return state.expansion?.faith?.faiths[playerId]?.tenets ?? [];
}
/** Faith of a city (founder id), or null. */
export function cityFaith(state: GameState, cityId: number): number | null {
  const id = state.expansion?.faith?.cityFaith[cityId];
  return id === undefined ? null : id;
}
/** Yield additions for an owned city following its owner's faith. */
export function faithCityYield(state: GameState, city: { id: number; ownerId: number | null }): { food: number; production: number; gold: number; research: number } {
  const out = { food: 0, production: 0, gold: 0, research: 0 };
  const founder = city.ownerId === null ? null : cityFaith(state, city.id);
  if (founder === null) return out;
  const faith = state.expansion!.faith!.faiths[founder];
  if (faith.legend === 'lugia') out.research++;
  if (faith.legend === 'groudon') out.production++;
  if (faith.legend === 'kyogre') out.food++;
  if (founder === city.ownerId && faith.tenets.includes('shrineFood')) out.food++;
  if (founder === city.ownerId && faith.tenets.includes('shrineGold')) out.gold++;
  return out;
}
export function faithBond(state: GameState, cityId: number): number {
  const founder = cityFaith(state, cityId);
  return founder !== null && state.expansion!.faith!.faiths[founder].legend === 'rayquaza' ? 1 : 0;
}
export function faithKeepsCity(state: GameState, city: { id: number; ownerId: number | null }): boolean {
  const founder = cityFaith(state, city.id);
  return founder !== null && founder === city.ownerId && state.expansion!.faith!.faiths[founder].tenets.includes('harmony');
}
export function validateFaithAction(state: GameState, actorId: number, action: FaithAction): string | null {
  const faith = state.expansion?.faith;
  if (!usesFaith(state) || !faith || state.players[actorId].eliminated) return 'faith-unavailable';
  const mine = offering(state, actorId);
  if (action.type === 'FoundFaith') {
    if (faith.faiths[actorId]) return 'faith-founded';
    if (!LEGEND_IDS.includes(action.legend) || Object.values(faith.faiths).some(item => item.legend === action.legend)) return 'legend-taken';
    if (!Array.isArray(action.tenets) || action.tenets.length !== 2 || new Set(action.tenets).size !== 2 || action.tenets.some(id => !Object.hasOwn(TENETS, id))) return 'tenets-invalid';
    return mine.lifetimeOfferings >= FAITH_RULES.foundLifetime && mine.offeringPoints >= FAITH_RULES.foundCost ? null : 'faith-offering';
  }
  if (!faith.faiths[actorId]) return 'faith-missing';
  const city = state.cities[action.cityId];
  if (!city || city.ownerId === null || faith.cityFaith[city.id] === actorId) return 'spread-unavailable';
  if (!Object.values(state.cities).some(own => own.ownerId === actorId && hexDistance(own.position, city.position, state.map) <= FAITH_RULES.spreadRange)) return 'spread-range';
  return mine.offeringPoints >= spreadCost(state, actorId) ? null : 'faith-offering';
}
export const spreadCost = (state: GameState, actorId: number) => FAITH_RULES.spreadCost - (faithTenets(state, actorId).includes('missionaries') ? 5 : 0);
function addPressure(state: GameState, cityId: number, founder: number, amount: number): void {
  const faith = state.expansion!.faith!;
  const row = faith.pressure[cityId] ??= {};
  row[founder] = Math.min(FAITH_RULES.pressureCap, (row[founder] ?? 0) + amount);
}
/** The leading faith at or above the threshold takes the city; ties keep the current faith. */
function settleCity(state: GameState, cityId: number, events: EventPayload[]): void {
  const faith = state.expansion!.faith!, row = faith.pressure[cityId] ?? {};
  const current = faith.cityFaith[cityId];
  const best = Object.entries(row).map(([id, value]) => ({ id: Number(id), value })).sort((a, b) => b.value - a.value || a.id - b.id)[0];
  if (!best || best.value < FAITH_RULES.convertAt || best.id === current) return;
  if (current !== undefined && (row[current] ?? 0) >= best.value) return;
  faith.cityFaith[cityId] = best.id;
  events.push({ type: 'CityConverted', playerId: best.id, cityId, legend: faith.faiths[best.id].legend, public: true });
}
export function applyFaithAction(state: GameState, actorId: number, action: FaithAction): EventPayload[] {
  const faith = state.expansion!.faith!, mine = offering(state, actorId);
  if (action.type === 'FoundFaith') {
    mine.offeringPoints -= FAITH_RULES.foundCost;
    faith.faiths[actorId] = { founderId: actorId, legend: action.legend, tenets: [...action.tenets].sort(), foundedRound: state.round };
    const hq = state.players[actorId].headquartersCityId;
    if (state.cities[hq]?.ownerId === actorId) { (faith.pressure[hq] ??= {})[actorId] = FAITH_RULES.convertAt; faith.cityFaith[hq] = actorId; }
    return [{ type: 'FaithFounded', playerId: actorId, legend: action.legend, tenets: faith.faiths[actorId].tenets, public: true }];
  }
  mine.offeringPoints -= spreadCost(state, actorId);
  const events: EventPayload[] = [];
  addPressure(state, action.cityId, actorId, FAITH_RULES.spreadPressure + (faithTenets(state, actorId).includes('missionaries') ? 10 : 0));
  settleCity(state, action.cityId, events);
  return events;
}
export function resolveFaithRound(state: GameState, content: Content): EventPayload[] {
  const faith = state.expansion?.faith;
  if (!faith || state.outcome) return [];
  const events: EventPayload[] = [];
  // v25 fix 3: a city that turns neutral keeps the faith it followed (no pressure reaches it); before v25 it lost the faith.
  const keepsNeutral = gameplayAtLeast(state.setup, 25);
  for (const id of Object.keys(faith.cityFaith).map(Number)) if (!state.cities[id] || (state.cities[id].ownerId === null && !keepsNeutral)) { delete faith.cityFaith[id]; delete faith.pressure[id]; }
  const faithful = Object.values(state.cities).filter(city => city.ownerId !== null && faith.cityFaith[city.id] !== undefined).sort((a, b) => a.id - b.id);
  for (const source of faithful) {
    const founder = faith.cityFaith[source.id];
    for (const target of Object.values(state.cities).filter(city => city.ownerId !== null && city.id !== source.id && hexDistance(city.position, source.position, state.map) <= FAITH_RULES.passiveRange)) {
      addPressure(state, target.id, founder, FAITH_RULES.passivePressure);
    }
  }
  for (const city of Object.values(state.cities).filter(city => city.ownerId !== null).sort((a, b) => a.id - b.id)) settleCity(state, city.id, events);
  // Pilgrims tenet and harmony satisfaction.
  for (const [founderText, item] of Object.entries(faith.faiths)) {
    const founder = Number(founderText);
    if (state.players[founder].eliminated) continue;
    if (item.tenets.includes('pilgrims')) {
      const foreign = Object.values(state.cities).filter(city => city.ownerId !== null && city.ownerId !== founder && faith.cityFaith[city.id] === founder).length;
      offering(state, founder).offeringPoints += foreign;
    }
    if (item.tenets.includes('harmony') && state.expansion!.world.players[founder]) {
      state.expansion!.world.players[founder].satisfaction = Math.min(100, state.expansion!.world.players[founder].satisfaction + 1);
    }
  }
  const owned = Object.values(state.cities).filter(city => city.ownerId !== null), counted = faithCities(state);
  if (counted.length >= victoryTargets(state.setup).faithMinimumCities) {
    const winners = Object.keys(faith.faiths).map(Number).filter(founder => !state.players[founder].eliminated
      && counted.filter(city => faith.cityFaith[city.id] === founder).length >= Math.ceil(counted.length * FAITH_RULES.winShare)
      // Every living rival must follow it in at least one of their cities, so a faith cannot win by isolation.
      && state.turnOrder.filter(id => id !== founder && !state.players[id].eliminated).every(rival => owned.some(city => city.ownerId === rival && faith.cityFaith[city.id] === founder)));
    if (winners.length === 1) events.push(...finishGame(state, 'faith', winners, content));
  }
  return events;
}
/**
 * The cities the faith victory counts (minimum and share). v25 fix 3: every standing city, neutral ones included, and a neutral city keeps
 * the faith it followed, so eliminating a civilization (its cities turn neutral) changes neither the bar nor the followers. Before v25:
 * owned cities only (an elimination dropped its cities from the count).
 */
export function faithCities(state: Pick<GameState, 'cities' | 'setup'>): GameState['cities'][number][] {
  const cities = Object.values(state.cities);
  return gameplayAtLeast(state.setup, 25) ? cities : cities.filter(city => city.ownerId !== null);
}
export function observeFaith(state: GameState, playerId: number): FaithView | undefined {
  const faith = state.expansion?.faith;
  if (!faith) return undefined;
  const owned = faithCities(state);
  return {
    faiths: Object.values(faith.faiths).map(item => ({ ...item, tenets: [...item.tenets], followers: owned.filter(city => faith.cityFaith[city.id] === item.founderId).length })),
    cityFaith: { ...faith.cityFaith },
    ownPressure: Object.fromEntries(Object.entries(faith.pressure).map(([cityId, row]) => [Number(cityId), row[playerId] ?? 0])),
    totalCities: owned.length, winShare: FAITH_RULES.winShare,
  };
}
export const legendTypes = (legend: LegendId) => LEGENDS[legend].types;
/** Ho-Oh: fire/flying Pokémon near a faithful own city heal +3. */
export function faithHealing(state: GameState, unit: { kind: string; speciesId?: string; ownerId: number | null; position: { q: number; r: number } }, content: Content): number {
  const faith = state.expansion?.faith;
  if (!faith || unit.ownerId === null || unit.kind !== 'pokemon') return 0;
  const near = Object.values(state.cities).some(city => city.ownerId === unit.ownerId && faith.cityFaith[city.id] !== undefined
    && faith.faiths[faith.cityFaith[city.id]].legend === 'hooh' && hexDistance(city.position, unit.position, state.map) <= 2);
  if (!near) return 0;
  const species = content.species[unit.speciesId!];
  return LEGENDS.hooh.types.includes(species.typeId) || (species.secondaryTypeId !== undefined && LEGENDS.hooh.types.includes(species.secondaryTypeId)) ? 3 : 0;
}
/** Zealots tenet: +10% active attack within 3 tiles of an own faithful city. */
export function zealotMultiplier(state: Pick<GameState, 'expansion' | 'cities' | 'map'>, ownerId: number | null, position: { q: number; r: number }): number {
  const faith = state.expansion?.faith;
  if (!faith || ownerId === null || !faith.faiths[ownerId]?.tenets.includes('zealots')) return 1000;
  return Object.values(state.cities).some(city => city.ownerId === ownerId && faith.cityFaith[city.id] === ownerId && hexDistance(city.position, position, state.map) <= 3) ? 1100 : 1000;
}
/** Same as zealotMultiplier, from the player's observation (public city faith + own cities). */
export function viewZealotMultiplier(view: { playerId: number; map: MapShape; economy: { cities: { id: number; position: { q: number; r: number } }[] }; expansion?: { faith?: FaithView } }, position: { q: number; r: number }): number {
  const faith = view.expansion?.faith;
  const mine = faith?.faiths.find(item => item.founderId === view.playerId);
  if (!faith || !mine?.tenets.includes('zealots')) return 1000;
  return view.economy.cities.some(city => faith.cityFaith[city.id] === view.playerId && hexDistance(city.position, position, view.map) <= 3) ? 1100 : 1000;
}
