// Gameplay v27 ④ (docs/design/pace-v27.md §5, option 4A): legend favour — "the legends do not all favour one trainer". A legend wonder
// costs stock × (100 + 15 × k) / 100 (floored), k = the legends the civilization owns now (wonders standing in its cities; they follow a
// captured city). k is read every round, so a legend under way costs more once another one is finished (progress is kept). A lost race
// (another civilization finished the legend first) still refunds half the progress as gold (v26) and also carries 25% of it to the next
// legend queued in that city (the legend trail, kept in the city-project ledger). Integers only; k is private (rivals see the v26 race
// stages, computed against the builder's own cost). Wired in resolveEconomy (cost), completeLegendWonder (trail) and the legend view.
import { legendCost } from '../content/legend-wonders.ts';
import type { LegendWonderId } from '../content/legend-wonders.ts';
import { economyTuning, legendFavorCostPercent } from '../content/pace-v27.ts';
import type { Content } from '../content/units.ts';
import { addLegendTrail } from './city-projects.ts';
import type { GameState, PlayerView, ProductionItem } from './model.ts';

/** Legends `playerId` owns now (the authority). */
export const ownedLegends = (state: GameState, playerId: number): number =>
  Object.values(state.expansion?.legends?.wonders ?? {}).filter(record => record && state.cities[record.cityId]?.ownerId === playerId).length;
/** Legends the viewer owns (built wonders are public with their current owner). */
export const viewOwnedLegends = (view: PlayerView): number => (view.expansion?.legends?.wonders ?? []).filter(wonder => wonder.ownerId === view.playerId).length;
const favored = (cost: number, owned: number, content: Content) => Math.floor(cost * legendFavorCostPercent(content, owned) / 100);

/** The production cost of `item` for `playerId` given its stock cost (= `cost` unless the item is a legend and the content has legend favour). */
export function legendFavorCost(state: GameState, playerId: number, item: ProductionItem, cost: number, content: Content): number {
  if (item.kind !== 'legend') return cost;
  return favored(cost, ownedLegends(state, playerId), content);
}
/** View mirror: the viewer's cost for `legendId` (the stock cost before v27). */
export function viewLegendCost(view: PlayerView, legendId: LegendWonderId, content: Content): number {
  return favored(legendCost(legendId), viewOwnedLegends(view), content);
}
/** The viewer's next-legend cost percent (100 before v27): the wonder tab's multiplier chip. */
export const viewLegendFavorPercent = (view: PlayerView, content: Content): number => legendFavorCostPercent(content, viewOwnedLegends(view));
/** A lost race: the city's legend trail grows by `legendTrailPercent`% of the lost progress (nothing before v27). Returns the amount. */
export function recordLegendTrail(state: GameState, cityId: number, progress: number, content: Content): number {
  const amount = Math.floor(progress * economyTuning(content).legendTrailPercent / 100);
  addLegendTrail(state, cityId, amount);
  return amount;
}
