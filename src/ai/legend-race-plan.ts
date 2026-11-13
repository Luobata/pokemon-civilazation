// Gameplay v26 D (docs/design/depth-v26.md §5.3): the AI and the legend race, view-only. It does not start a legend another
// civilization has past half while its own estimate is over 10 rounds (over 3 once that rival is in the final stage), and drops a legend
// it has under half done once a rival reaches the final stage (otherwise it would only get half the production back as gold).
import { legendCost } from '../content/legend-wonders.ts';
import type { LegendWonderId } from '../content/legend-wonders.ts';
import type { Command, PlayerView } from '../core/model.ts';

/** Rounds the viewer's most productive city needs for this legend (Infinity without production). */
const ownEstimate = (view: PlayerView, legendId: LegendWonderId, progress = 0) => {
  const production = Math.max(0, ...view.economy.cities.map(city => city.yields.production));
  return production > 0 ? Math.ceil((legendCost(legendId) - progress) / production) : Infinity;
};
export function legendRaceVeto(view: PlayerView, legendId: LegendWonderId): boolean {
  const race = view.expansion?.legends?.race ?? [];
  const rivals = race.filter(entry => entry.legendId === legendId && entry.playerId !== view.playerId);
  if (!rivals.length) return false;
  const estimate = ownEstimate(view, legendId);
  return rivals.some(entry => (entry.stage === 'final' && estimate > 3) || (entry.stage === 'half' && estimate > 10));
}
/** Drops a lost race: own legend under 50% while a rival is in the final stage (null when nothing to drop or before v26). */
export function legendRaceSwitch(view: PlayerView): Command['action'] | null {
  const legends = view.expansion?.legends, race = legends?.race;
  if (!legends || !race?.length) return null;
  for (const item of legends.building) {
    if (item.progress * 2 >= item.cost || !race.some(entry => entry.legendId === item.legendId && entry.stage === 'final')) continue;
    // Same line as the veto (a final-stage rival and more than 3 rounds), so a dropped legend is never queued again at once.
    if (ownEstimate(view, item.legendId, item.progress) <= 3) continue;
    const city = view.economy.cities.find(own => own.id === item.cityId);
    if (!city) continue;
    return { type: 'SetProductionQueue', cityId: city.id, orders: city.queue.filter(order => !(order.item.kind === 'legend' && order.item.defId === item.legendId))
      .map(order => ({ orderId: order.id, item: order.item })) };
  }
  return null;
}
