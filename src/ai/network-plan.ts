// Gameplay v17 AI: settler escorts, trader production and trade routes (PlayerView only).
import { ESCORT_BONUSES, escortBonusKind } from '../content/city-network.ts';
import type { EscortBonusKind } from '../content/city-network.ts';
import type { Content, SpeciesId } from '../content/units.ts';
import { CITY_NETWORK_RULES } from '../content/city-network.ts';
import { tradeDestinations } from '../core/city-network.ts';
import { hexDistance } from '../core/hex.ts';
import type { Hex } from '../core/hex.ts';
import type { Command, MapUnit, PlayerView } from '../core/model.ts';

const ESCORT_PRIORITY: readonly EscortBonusKind[] = ['production', 'food', 'tide', 'research', 'gold'];
/** The registered species whose escort bonus the AI values most (ties: lowest species id). */
export function pickEscort(view: PlayerView, content: Content): SpeciesId | undefined {
  if (!view.expansion?.cityNetwork) return undefined;
  const ids = [...view.economy.player.registeredSpeciesIds].filter(id => content.species[id]).sort();
  for (const kind of ESCORT_PRIORITY) {
    const found = ids.find(id => escortBonusKind(content.species[id].typeId) === kind && ESCORT_BONUSES[kind]);
    if (found) return found;
  }
  return ids[0];
}
/** Whether this city should queue a trader now: it has the market, and routes + traders stay under the city count. */
export function wantsTrader(view: PlayerView, cityId: number): boolean {
  const network = view.expansion?.cityNetwork, city = view.economy.cities.find(item => item.id === cityId);
  if (!network || !city || !city.buildingIds.includes(CITY_NETWORK_RULES.trader.building) || view.economy.cities.length < 2) return false;
  const traders = view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'logistics' && unit.role === 'trader').length
    + view.economy.cities.reduce((sum, item) => sum + [...item.queue, ...item.pendingDeployments].filter(order => order.item.kind === 'logistics' && order.item.defId === 'trader').length, 0);
  return network.routes.length + traders < view.economy.cities.length;
}
/** A ready route action, or the city this trader should walk to. */
export function traderPlan(view: PlayerView, unit: MapUnit): { action: Command['action'] | null; destination: Hex | null } {
  if (unit.kind !== 'logistics' || unit.role !== 'trader') return { action: null, destination: null };
  const options = tradeDestinations(view, unit.id);
  const ready = options.find(option => option.reason === null);
  if (ready) return { action: { type: 'EstablishTradeRoute', unitId: unit.id, toCityId: ready.cityId }, destination: null };
  const walkable = options.filter(option => option.reason === '先把商队移动到这座城市旁边')
    .map(option => view.economy.cities.find(city => city.id === option.cityId)!)
    .sort((a, b) => hexDistance(unit.position, a.position, view.map) - hexDistance(unit.position, b.position, view.map) || a.id - b.id)[0];
  return { action: null, destination: walkable?.position ?? null };
}
