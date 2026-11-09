// Gameplay v17 AI: settler escorts, trader production and trade routes (PlayerView only).
import { ESCORT_BONUSES, escortBonusKind } from '../content/city-network.ts';
import type { EscortBonusKind } from '../content/city-network.ts';
import type { Content, SpeciesId } from '../content/units.ts';
import { CITY_NETWORK_RULES } from '../content/city-network.ts';
import { tradeDestinations } from '../core/city-network.ts';
import { hexDistance, indexToHex } from '../core/hex.ts';
import { crewApplies, resourceLookup, usesImprovementsV23 } from '../core/improvements.ts';
import { workRadius } from '../core/city.ts';
import { IMPROVEMENTS, RESOURCE_IMPROVEMENT, crewSpecialtyFor, improvementIdsFor } from '../content/improvements.ts';
import type { CrewSpecialty } from '../content/improvements.ts';
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
/**
 * v23: the escort for a new 工匠 — the specialty with the most unimproved, researched-buildable tiles around this city
 * (garden / mining / irrigation / observation / herding), else a fire type (开荒), else none. Ties: lowest species id.
 */
export function pickBuilderEscort(view: PlayerView, cityId: number, content: Content): SpeciesId | undefined {
  if (!usesImprovementsV23(view) || !content.builderCrews) return undefined;
  const city = view.economy.cities.find(item => item.id === cityId), improvements = view.expansion?.improvements;
  if (!city || !improvements) return undefined;
  const ids = [...view.economy.player.registeredSpeciesIds].filter(id => content.species[id]).sort();
  const done = new Set(improvements.tiles.map(tile => tile.tileIndex)), unlocked = view.economy.player.research.unlockedIds;
  const resourceAt = resourceLookup(view.expansion?.world.resources ?? [], (view.expansion?.rareBerries?.deposits ?? []).map(item => item.tileIndex));
  const counts = new Map<CrewSpecialty, number>();
  for (const [index, biome] of view.map.tiles.entries()) {
    const distance = hexDistance(city.position, indexToHex(index, view.map), view.map);
    if (!biome || distance === 0 || distance > workRadius(city) || done.has(index)) continue;
    const resource = resourceAt(index);
    const kinds = resource ? [RESOURCE_IMPROVEMENT[resource]] : improvementIdsFor(view).filter(kind => !IMPROVEMENTS[kind].resource && IMPROVEMENTS[kind].biomes.includes(biome as never));
    for (const crew of ['garden', 'mining', 'irrigation', 'observation', 'herding'] as const) {
      if (kinds.some(kind => (!IMPROVEMENTS[kind].requiredTech || unlocked.includes(IMPROVEMENTS[kind].requiredTech!)) && crewApplies(crew, kind, biome))) counts.set(crew, (counts.get(crew) ?? 0) + 1);
    }
  }
  const best = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  return (best ? ids.find(id => crewSpecialtyFor(content.species[id].typeId) === best) : undefined)
    ?? ids.find(id => crewSpecialtyFor(content.species[id].typeId) === 'clearing');
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
