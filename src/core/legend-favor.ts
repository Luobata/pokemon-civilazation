// Gameplay v27 ④ (docs/design/pace-v27.md §5, option 4A): a legend wonder costs +15% per legend the civilization already owns
// (`economyTuning(content).legendFavorPercent`), and a lost race carries 25% of its production to the city's next legend. Stub: the
// economy lane fills it in. Wired once in resolveEconomy (src/core/economy.ts) around the order's production cost.
import type { Content } from '../content/units.ts';
import type { GameState, ProductionItem } from './model.ts';

/** The production cost of `item` for `playerId` given its stock cost (= `cost` unless the item is a legend and the content has legend favour). */
export function legendFavorCost(_state: GameState, _playerId: number, item: ProductionItem, cost: number, content: Content): number {
  if (!content.legendFavor || item.kind !== 'legend') return cost;
  return cost;
}
