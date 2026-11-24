import { OPENING_RULES } from '../content/opening.ts';
import { cityNetworkYield } from './city-network.ts';
import { legendCityYield } from './legend-effects.ts';
import { cityDistrictEffects, districtOccupiedTiles } from './districts.ts';
import { faithCityYield } from './faith-legends.ts';
import { rareBerryCityFood } from './rare-berries.ts';
import { doctrineEffects } from './leader-doctrines.ts';
import { tileImprovementYield } from './improvements.ts';
import { applyFeatureYield, freshWater, workableFeature } from './terrain.ts';
import { applyLandmarkYield } from './landmarks.ts';
import { TERRAIN_RULES_V24 } from '../content/terrain.ts';
import { playerPolicyEffects } from './policies.ts';
import { worldCityYield } from './world-model.ts';
import { leaderCityYield } from './state-queries.ts';
import { GAME_CONTENT, contentFor } from '../content/units.ts';
import { leaderEffects } from '../content/leaders.ts';
import type { Content } from '../content/units.ts';
import type { Yield } from '../content/economy.ts';
import { hexDistance, hexToIndex, indexToHex } from './hex.ts';
import type { CityState, GameState, PlayerState } from './model.ts';
import { cityCounterAttack, createCity, growthThreshold, maxCityHp, productionCost, tileYield, workRadius } from './city-query.ts';
export { cityCounterAttack, createCity, growthThreshold, maxCityHp, productionCost, tileYield, workRadius };
/** Biome yield, terrain features (deep water, hills, rivers) and any completed improvement. */
export function workedTileYield(state: GameState, index: number, player: PlayerState, content: Content = GAME_CONTENT): Yield {
  const result = applyLandmarkYield(state.map, index, applyFeatureYield(state.map, index, tileYield(state.map.tiles[index], player, content))), bonus = tileImprovementYield(state, index, player);
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
  const occupied = new Set<number>();
  for (const other of Object.values(state.cities)) {
    occupied.add(hexToIndex(other.position, state.map)!);
    if (other.id !== city.id) for (const id of other.workedTileIds) occupied.add(id);
  }
  for (const index of districtOccupiedTiles(state)) occupied.add(index);
  const player = state.players[city.ownerId];
  const weather = player.research.unlockedIds.includes('meteorology');
  const map = state.map, width = map.width, height = map.height, wrap = Boolean(map.wrap);
  const radius = workRadius(city), pos = city.position;
  const deposits = state.expansion?.rareBerries?.deposits;
  const entries: { index: number; rare: number; food: number; production: number; gold: number; research: number }[] = [];
  const consider = (index: number) => {
    if (occupied.has(index)) return;
    const biome = map.tiles[index];
    if (!weather && (biome === 'snow' || biome === 'volcano')) return;
    if (!workableFeature(map, index)) return;
    const y = workedTileYield(state, index, player, content);
    entries.push({ index, rare: deposits && deposits[index] ? 1 : 0, food: y.food, production: y.production, gold: y.gold, research: y.research });
  };
  if (width > radius * 2) {
    const rMin = Math.max(0, pos.r - radius), rMax = Math.min(height - 1, pos.r + radius);
    for (let r = rMin; r <= rMax; r++) {
      const dr = r - pos.r;
      const dqMin = Math.max(-radius, -dr - radius), dqMax = Math.min(radius, -dr + radius);
      const halfRow = Math.floor(r / 2), rowBase = r * width;
      for (let dq = dqMin; dq <= dqMax; dq++) {
        let col = pos.q + dq + halfRow;
        if (wrap) col = ((col % width) + width) % width;
        else if (col < 0 || col >= width) continue;
        consider(rowBase + col);
      }
    }
  } else {
    for (let index = 0; index < map.tiles.length; index++) {
      if (hexDistance(pos, indexToHex(index, map), map) <= radius) consider(index);
    }
  }
  entries.sort((a, b) => (deposits ? b.rare - a.rare : 0) || b.food - a.food || b.production - a.production || b.gold - a.gold || b.research - a.research || a.index - b.index);
  return entries.map(entry => entry.index);
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
  for (let i = 0; i < slots; i++) {
    const pool = available.filter(id => !city.workedTileIds.includes(id));
    const biomes = new Set(city.workedTileIds.map(id => state.map.tiles[id]));
    const fresh = city.workedTileIds.length % 3 === 2 ? pool.find(id => !biomes.has(state.map.tiles[id])) : undefined;
    const pick = fresh ?? pool[0];
    if (pick === undefined) break;
    city.workedTileIds.push(pick);
  }
  city.workedTileIds.sort((a, b) => a - b);
}
export function cityYield(state: GameState, city: CityState, content: Content = contentFor(state.setup)): Yield {
  if (city.ownerId === null || city.capturedAtRound === state.round) return { food: 0, production: 0, gold: 0, research: 0 };
  const player = state.players[city.ownerId];
  const capital = state.players[city.ownerId].headquartersCityId === city.id;
  const result = { food: 2 + (freshWater(state.map, city.position) ? TERRAIN_RULES_V24.freshWaterFood : 0), production: 1 + (capital ? OPENING_RULES.capitalProduction : 0), gold: 1, research: city.population - city.workedTileIds.length
    + (capital ? OPENING_RULES.capitalResearch : OPENING_RULES.cityResearch) };
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
  if (state.expansion?.legends) for (const [key, value] of Object.entries(legendCityYield(state, city.id)) as [keyof Yield, number][]) result[key] += value;
  if (state.expansion?.cityNetwork) for (const [key, value] of Object.entries(cityNetworkYield(state, city)) as [keyof Yield, number][]) result[key] += value; result.gold += policy.cityGold; result.research += policy.cityResearch;
  const leader = leaderEffects(player.leaderId);
  result.research += leader.cityResearch + (city.buildingIds.includes('observatory') ? leader.laboratoryResearch : 0);
  result.gold += city.population >= 3 ? leader.cityGold : 0;
  const district = cityDistrictEffects(state, city.id);
  for (const key of ['food', 'production', 'gold', 'research'] as const) result[key] += district[key];
  return result;
}
