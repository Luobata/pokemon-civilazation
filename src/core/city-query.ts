// Leaf city geometry, HP, counter-attack, base tile yield, and production-cost queries.
import { DISTRICTS } from '../content/districts.ts';
import type { Yield } from '../content/economy.ts';
import { leaderEffects } from '../content/leaders.ts';
import { legendCost } from '../content/legend-wonders.ts';
import { cityProjectCost } from '../content/pace-v27.ts';
import type { CityProjectId } from '../content/pace-v27.ts';
import { GAME_CONTENT } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import type { Hex } from './hex.ts';
import type { CityState, PlayerState, ProductionItem } from './model.ts';

export function createCity(id: number, ownerId: number, position: Hex, headquarters = false, content: Content = GAME_CONTENT): CityState {
  return { id, ownerId, position: { ...position }, hp: content.balance.city.baseHp, population: headquarters ? 2 : 1,
    food: headquarters ? 10 : 0, buildingIds: headquarters ? ['headquarters'] : [],
    queue: [], pendingDeployments: [], workedTileIds: [], lockedTileIds: [], capturedAtRound: null };
}
export const workRadius = (city: CityState) => 2 + Math.floor(city.population / 4);
export const growthThreshold = (city: CityState) => 20 + 10 * city.population;
export const maxCityHp = (city: CityState, content: Content = GAME_CONTENT) =>
  content.balance.city.baseHp + content.balance.city.buildingHp * city.buildingIds.filter(id => id !== 'headquarters').length;
export function cityCounterAttack(player: PlayerState | undefined, content: Content = GAME_CONTENT): number {
  if (!player) return 0;
  return (player.starterId === 'squirtle' ? content.balance.city.squirtleCounterAttack : content.balance.city.counterAttack)
    + leaderEffects(player.leaderId).cityCounterAttack;
}
export function tileYield(biome: keyof Content['biomes'], player: PlayerState, content: Content = GAME_CONTENT): Yield {
  const result = { ...content.biomes[biome] };
  if ((biome === 'snow' || biome === 'volcano') && player.research.unlockedIds.includes('meteorology')) result.research += content.balance.effects.meteorologyResearch;
  return result;
}
/** `projectsDone` (v27 ③): the civilization's completions per city project, which raise a project's cost. */
export function productionCost(item: ProductionItem, content: Content = GAME_CONTENT, trainingDiscountPercent = 0, settlerDiscountPercent = 0,
  projectsDone: Partial<Record<CityProjectId, number>> = {}): number {
  if (item.kind === 'project') return cityProjectCost(content, item.defId, projectsDone[item.defId] ?? 0);
  if (item.kind === 'district') return DISTRICTS[item.defId].cost;
  if (item.kind === 'legend') return legendCost(item.defId);
  if (item.kind === 'building') return content.buildings[item.defId].cost!;
  if (item.kind === 'logistics' && settlerDiscountPercent) return Math.max(1, Math.ceil(content.units[item.defId].trainCost * (100 - settlerDiscountPercent) / 100));
  const base = content.units[item.defId].trainCost;
  return item.kind === 'pokemon' && trainingDiscountPercent ? Math.max(1, Math.ceil(base * (100 - trainingDiscountPercent) / 100)) : base;
}
