import { BOND_RECLAIM } from '../core/bonds.ts';
import { hexDistance, hexToIndex } from '../core/hex.ts';
import type { Command, PlayerView } from '../core/model.ts';

/** Reclaim a visible neutral camp near own cities when gold allows; pure observation. */
export function planBondAction(view: PlayerView): Command['action'] | null {
  if (!view.expansion?.bonds || view.economy.player.gold < BOND_RECLAIM.gold + 40) return null;
  const visible = new Set(view.visibleTileIds);
  const target = view.cities.filter(city => city.ownerId === null
    && visible.has(hexToIndex(city.position, view.map) ?? -1)
    && view.economy.cities.some(own => hexDistance(own.position, city.position, view.map) <= BOND_RECLAIM.range))
    .sort((a, b) => a.id - b.id)[0];
  return target ? { type: 'ReclaimCity', cityId: target.id } : null;
}
/** Cities whose bond is falling; the planner adds garrison moves and Pokémon Center builds for them. */
export function threatenedCityIds(view: PlayerView): number[] {
  const bonds = view.expansion?.bonds;
  if (!bonds) return [];
  return Object.entries(bonds).filter(([, info]) => info.pressure.total < 0 && info.bond < 70).map(([id]) => Number(id)).sort((a, b) => a - b);
}
