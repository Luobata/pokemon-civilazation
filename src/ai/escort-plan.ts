// Gameplay v26 C2 (docs/design/depth-v26.md §7.2): AI settler escorts under the tile-sharing rule, view-only. While the civilization has
// fewer than `escortMaxCities` cities, each settler on the map gets the nearest free own Pokémon (within 6 tiles) as its escort: the
// escort walks onto the settler's tile and then follows it (the settler moves first, the escort joins it), so the settler cannot be
// targeted. A settler with an escort near may step beside one striking wild Pokémon (never two).
import { lateTuning } from '../content/depth-v26.ts';
import type { Content } from '../content/units.ts';
import { hexDistance } from '../core/hex.ts';
import type { Hex } from '../core/hex.ts';
import type { MapUnit, PlayerView } from '../core/model.ts';

export type StackEscort = { settlerId: number; position: Hex; settlerReady: boolean; joined: boolean };
const ESCORT_REACH = 6;
/** Pokémon id -> the settler it escorts (empty before v26 or from `escortMaxCities` cities). */
export function stackEscorts(view: PlayerView, content: Content, busy: (unit: MapUnit) => boolean): Map<number, StackEscort> {
  const escorts = new Map<number, StackEscort>();
  if (!content.stacking || view.economy.cities.length >= lateTuning(content).escortMaxCities) return escorts;
  const own = view.units.filter(unit => unit.ownerId === view.playerId);
  const settlers = own.filter(unit => unit.kind === 'logistics' && unit.role === 'settler').sort((a, b) => a.id - b.id);
  const ready = (settler: MapUnit) => settler.actionLeft === 1 && !(settler.movesSpent ?? 0);
  for (const settler of settlers) {
    const joined = own.find(unit => unit.kind === 'pokemon' && hexDistance(unit.position, settler.position, view.map) === 0);
    if (joined) { escorts.set(joined.id, { settlerId: settler.id, position: settler.position, settlerReady: ready(settler), joined: true }); continue; }
    const pick = own.filter(unit => unit.kind === 'pokemon' && unit.actionLeft && !escorts.has(unit.id) && !busy(unit) && hexDistance(unit.position, settler.position, view.map) <= ESCORT_REACH)
      .sort((a, b) => hexDistance(a.position, settler.position, view.map) - hexDistance(b.position, settler.position, view.map) || a.id - b.id)[0];
    if (pick) escorts.set(pick.id, { settlerId: settler.id, position: settler.position, settlerReady: ready(settler), joined: false });
  }
  return escorts;
}
/** Whether this settler has an escort within 2 tiles (it may then step beside a single striking wild Pokémon). */
export const escortedSettler = (escorts: ReadonlyMap<number, StackEscort>, view: PlayerView, settlerId: number) =>
  [...escorts].some(([id, escort]) => escort.settlerId === settlerId && hexDistance(view.units.find(unit => unit.id === id)!.position, escort.position, view.map) <= 2);
