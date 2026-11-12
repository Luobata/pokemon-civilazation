// Gameplay v24 C (docs/design/world-v24.md §4.3): AI response to its own rival — warned and attacked cities count as threatened.
// Scaffolding: no rival ledger yet, so nothing is threatened.
import type { PlayerView } from '../core/model.ts';

/** Own city ids under a rival warning, or within 4 tiles of a rival unit. */
export function rivalThreatenedCityIds(view: PlayerView): number[] {
  return view.expansion?.rivals?.pending ? [view.expansion.rivals.pending.cityId] : [];
}
