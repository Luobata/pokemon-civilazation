import { doctrineEffects } from './leader-doctrines.ts';
import { worldCityYield } from './world-systems.ts';
import { leaderCityYield } from './leader-systems.ts';
import { EXPANSION_CONTENT, CONTENT } from '../content/units.ts';
import { leaderEffects } from '../content/leaders.ts';
import type { Content } from '../content/units.ts';
import type { Yield } from '../content/economy.ts';
import { hexDistance, hexToIndex, indexToHex } from './hex.ts';
import type { Hex } from './hex.ts';
import type { CityState, GameState, PlayerState, ProductionItem } from './model.ts';

export function createCity(id: number, ownerId: number, position: Hex, headquarters = false, content: Content = CONTENT): CityState {
  return { id, ownerId, position: { ...position }, hp: content.balance.city.baseHp, population: headquarters ? 2 : 1,
    food: headquarters ? 10 : 0, buildingIds: headquarters ? ['headquarters'] : [],
    queue: [], pendingDeployments: [], workedTileIds: [], lockedTileIds: [], capturedAtRound: null };
}
export const workRadius = (city: CityState) => 2 + Math.floor(city.population / 4);
export const growthThreshold = (city: CityState) => 20 + 10 * city.population;
export const maxCityHp = (city: CityState, content: Content = CONTENT) => content.balance.city.baseHp + content.balance.city.buildingHp * city.buildingIds.filter(id => id !== 'headquarters').length;
export function cityCounterAttack(player: PlayerState | undefined, content: Content = CONTENT): number {
  if (!player) return 0;
  return (player.starterId === 'squirtle' ? content.balance.city.squirtleCounterAttack : content.balance.city.counterAttack)
    + leaderEffects(player.leaderId).cityCounterAttack;
}
export function tileYield(biome: keyof Content['biomes'], player: PlayerState, content: Content = CONTENT): Yield {
  const result = { ...content.biomes[biome] };
  if ((biome === 'snow' || biome === 'volcano') && player.research.unlockedIds.includes('meteorology')) result.research += content.balance.effects.meteorologyResearch;
  return result;
}
// Best first; fixed row-major index is (r,q) order on this map.
export function compareWorkTiles(state: GameState, city: CityState, a: number, b: number, content: Content = state.setup.expansionVersion === 1 ? EXPANSION_CONTENT : CONTENT): number {
  if (city.ownerId === null) return a - b;
  const player = state.players[city.ownerId];
  const ya = tileYield(state.map.tiles[a], player, content), yb = tileYield(state.map.tiles[b], player, content);
  return yb.food - ya.food || yb.production - ya.production || yb.gold - ya.gold || yb.research - ya.research || a - b;
}
export function workCandidates(state: GameState, city: CityState, content: Content = state.setup.expansionVersion === 1 ? EXPANSION_CONTENT : CONTENT): number[] {
  if (city.ownerId === null) return [];
  const occupied = new Set(Object.values(state.cities).flatMap(other => [
    hexToIndex(other.position, state.map)!, ...(other.id === city.id ? [] : other.workedTileIds),
  ]));
  const weather = state.players[city.ownerId].research.unlockedIds.includes('meteorology');
  return state.map.tiles.flatMap((biome, index) => !occupied.has(index)
    && hexDistance(city.position, indexToHex(index, state.map)) <= workRadius(city)
    && (weather || (biome !== 'snow' && biome !== 'volcano')) ? [index] : [])
    .sort((a, b) => compareWorkTiles(state, city, a, b, content));
}
export function cleanWork(state: GameState, city: CityState, content: Content = state.setup.expansionVersion === 1 ? EXPANSION_CONTENT : CONTENT): void {
  const eligible = new Set(workCandidates(state, city, content));
  city.workedTileIds = city.workedTileIds.filter(id => eligible.has(id));
  city.lockedTileIds = city.lockedTileIds.filter(id => city.workedTileIds.includes(id));
  while (city.workedTileIds.length > city.population) releaseWorker(state, city, content);
}
export function releaseWorker(state: GameState, city: CityState, content: Content = state.setup.expansionVersion === 1 ? EXPANSION_CONTENT : CONTENT): void {
  const unlocked = city.workedTileIds.filter(id => !city.lockedTileIds.includes(id));
  const pool = unlocked.length ? unlocked : city.workedTileIds;
  const worst = [...pool].sort((a, b) => compareWorkTiles(state, city, a, b, content)).at(-1);
  city.workedTileIds = city.workedTileIds.filter(id => id !== worst);
  city.lockedTileIds = city.lockedTileIds.filter(id => id !== worst);
}
export function assignNewWorkers(state: GameState, city: CityState, count: number, content: Content = state.setup.expansionVersion === 1 ? EXPANSION_CONTENT : CONTENT): void {
  const available = workCandidates(state, city, content).filter(id => !city.workedTileIds.includes(id));
  city.workedTileIds.push(...available.slice(0, Math.min(count, city.population - city.workedTileIds.length)));
  city.workedTileIds.sort((a, b) => a - b);
}
export function cityYield(state: GameState, city: CityState, content: Content = state.setup.expansionVersion === 1 ? EXPANSION_CONTENT : CONTENT): Yield {
  if (city.ownerId === null || city.capturedAtRound === state.round) return { food: 0, production: 0, gold: 0, research: 0 };
  const player = state.players[city.ownerId];
  const result = { food: 2, production: 1, gold: 1, research: city.population - city.workedTileIds.length };
  for (const addition of [...city.workedTileIds.map(id => tileYield(state.map.tiles[id], player, content)),
    leaderCityYield(state, city.id), worldCityYield(state, city, content), ...city.buildingIds.map(id => content.buildings[id].yields)]) {
    for (const key of ['food', 'production', 'gold', 'research'] as const) result[key] += addition[key];
  }
  if (state.players[city.ownerId].starterId === 'bulbasaur') result.food = Math.floor(result.food * 1100 / 1000);
  result.research += doctrineEffects(player, state.setup.eraProgression).researchBonus;
  const leader = leaderEffects(player.leaderId);
  result.research += leader.cityResearch + (city.buildingIds.includes('observatory') ? leader.laboratoryResearch : 0);
  return result;
}
export function productionCost(item: ProductionItem, content: Content = CONTENT): number {
  return item.kind === 'building' ? content.buildings[item.defId].cost! : content.units[item.defId].trainCost;
}
