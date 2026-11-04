import { legendCityYield } from './legends.ts';
import { legendCost } from '../content/legend-wonders.ts';
import { DISTRICTS } from '../content/districts.ts';
import { cityDistrictEffects, districtOccupiedTiles } from './districts.ts';
import { faithCityYield } from './faith-legends.ts';
import { rareBerryCityFood } from './rare-berries.ts';
import { gameplayAtLeast } from '../content/eras.ts';
import { doctrineEffects } from './leader-doctrines.ts';
import { tileImprovementYield } from './improvements.ts';
import { playerPolicyEffects } from './policies.ts';
import { worldCityYield } from './world-systems.ts';
import { leaderCityYield } from './leader-systems.ts';
import { CONTENT, contentFor } from '../content/units.ts';
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
/** Biome yield plus any completed improvement (gameplay v2); identical to tileYield otherwise. */
export function workedTileYield(state: GameState, index: number, player: PlayerState, content: Content = CONTENT): Yield {
  const result = tileYield(state.map.tiles[index], player, content), bonus = tileImprovementYield(state, index, player);
  if (bonus) for (const key of ['food', 'production', 'gold', 'research'] as const) result[key] += bonus[key];
  return result;
}
// Best first; fixed row-major index is (r,q) order on this map.
export function compareWorkTiles(state: GameState, city: CityState, a: number, b: number, content: Content = contentFor(state.setup)): number {
  if (city.ownerId === null) return a - b;
  const player = state.players[city.ownerId];
  const ya = workedTileYield(state, a, player, content), yb = workedTileYield(state, b, player, content);
  const deposits = state.expansion?.rareBerries?.deposits;
  if (deposits) {
    const ra = deposits[a] ? 1 : 0, rb = deposits[b] ? 1 : 0;
    if (ra !== rb) return rb - ra;
  }
  return yb.food - ya.food || yb.production - ya.production || yb.gold - ya.gold || yb.research - ya.research || a - b;
}
export function workCandidates(state: GameState, city: CityState, content: Content = contentFor(state.setup)): number[] {
  if (city.ownerId === null) return [];
  const occupied = new Set(Object.values(state.cities).flatMap(other => [
    hexToIndex(other.position, state.map)!, ...(other.id === city.id ? [] : other.workedTileIds),
  ]));
  for (const index of districtOccupiedTiles(state)) occupied.add(index);
  const weather = state.players[city.ownerId].research.unlockedIds.includes('meteorology');
  return state.map.tiles.flatMap((biome, index) => !occupied.has(index)
    && hexDistance(city.position, indexToHex(index, state.map)) <= workRadius(city)
    && (weather || (biome !== 'snow' && biome !== 'volcano')) ? [index] : [])
    .sort((a, b) => compareWorkTiles(state, city, a, b, content));
}
export function cleanWork(state: GameState, city: CityState, content: Content = contentFor(state.setup)): void {
  const eligible = new Set(workCandidates(state, city, content));
  city.workedTileIds = city.workedTileIds.filter(id => eligible.has(id));
  city.lockedTileIds = city.lockedTileIds.filter(id => city.workedTileIds.includes(id));
  while (city.workedTileIds.length > city.population) releaseWorker(state, city, content);
}
export function releaseWorker(state: GameState, city: CityState, content: Content = contentFor(state.setup)): void {
  const unlocked = city.workedTileIds.filter(id => !city.lockedTileIds.includes(id));
  const pool = unlocked.length ? unlocked : city.workedTileIds;
  const worst = [...pool].sort((a, b) => compareWorkTiles(state, city, a, b, content)).at(-1);
  city.workedTileIds = city.workedTileIds.filter(id => id !== worst);
  city.lockedTileIds = city.lockedTileIds.filter(id => id !== worst);
}
export function assignNewWorkers(state: GameState, city: CityState, count: number, content: Content = contentFor(state.setup)): void {
  const available = workCandidates(state, city, content).filter(id => !city.workedTileIds.includes(id));
  const slots = Math.min(count, city.population - city.workedTileIds.length);
  if (gameplayAtLeast(state.setup, 5)) {
    // Gameplay v5: every third worker prefers a biome (essence) the city does not work yet, if one is in range.
    for (let i = 0; i < slots; i++) {
      const pool = available.filter(id => !city.workedTileIds.includes(id));
      const biomes = new Set(city.workedTileIds.map(id => state.map.tiles[id]));
      const fresh = city.workedTileIds.length % 3 === 2 ? pool.find(id => !biomes.has(state.map.tiles[id])) : undefined;
      const pick = fresh ?? pool[0];
      if (pick === undefined) break;
      city.workedTileIds.push(pick);
    }
  } else city.workedTileIds.push(...available.slice(0, slots));
  city.workedTileIds.sort((a, b) => a - b);
}
export function cityYield(state: GameState, city: CityState, content: Content = contentFor(state.setup)): Yield {
  if (city.ownerId === null || city.capturedAtRound === state.round) return { food: 0, production: 0, gold: 0, research: 0 };
  const player = state.players[city.ownerId];
  const result = { food: 2, production: 1, gold: 1, research: city.population - city.workedTileIds.length };
  for (const addition of [...city.workedTileIds.map(id => workedTileYield(state, id, player, content)),
    leaderCityYield(state, city.id), worldCityYield(state, city, content), ...city.buildingIds.map(id => content.buildings[id].yields)]) {
    for (const key of ['food', 'production', 'gold', 'research'] as const) result[key] += addition[key];
  }
  if (state.players[city.ownerId].starterId === 'bulbasaur') result.food = Math.floor(result.food * 1100 / 1000);
  result.research += doctrineEffects(player, state.setup.eraProgression).researchBonus;
  const policy = playerPolicyEffects(state, city.ownerId);
  const faithYield = faithCityYield(state, city);
  result.food += policy.cityFood + rareBerryCityFood(state, city.ownerId) + faithYield.food;
  result.production += faithYield.production; result.gold += faithYield.gold; result.research += faithYield.research; result.production += policy.cityProduction;
  if (state.expansion?.legends) for (const [key, value] of Object.entries(legendCityYield(state, city.id)) as [keyof Yield, number][]) result[key] += value; result.gold += policy.cityGold; result.research += policy.cityResearch;
  const leader = leaderEffects(player.leaderId);
  result.research += leader.cityResearch + (city.buildingIds.includes('observatory') ? leader.laboratoryResearch : 0);
  result.gold += city.population >= 3 ? leader.cityGold : 0;
  const district = cityDistrictEffects(state, city.id);
  for (const key of ['food', 'production', 'gold', 'research'] as const) result[key] += district[key];
  return result;
}
export function productionCost(item: ProductionItem, content: Content = CONTENT, trainingDiscountPercent = 0, settlerDiscountPercent = 0): number {
  if (item.kind === 'district') return DISTRICTS[item.defId].cost;
  if (item.kind === 'legend') return legendCost(item.defId);
  if (item.kind === 'building') return content.buildings[item.defId].cost!;
  if (item.kind === 'logistics' && settlerDiscountPercent) return Math.max(1, Math.ceil(content.units[item.defId].trainCost * (100 - settlerDiscountPercent) / 100));
  const base = content.units[item.defId].trainCost;
  return item.kind === 'pokemon' && trainingDiscountPercent ? Math.max(1, Math.ceil(base * (100 - trainingDiscountPercent) / 100)) : base;
}
