// Gameplay v27 ③ AI (docs/design/pace-v27.md §4.2): what an idle city queues when nothing else is worth building (drill when at war or a
// rival is announced, rehearsal before a contest season, festival under 50 satisfaction, else research / hatch in turn). View-only.
// Stub: the economy lane fills it in. Wired once in planNext (src/ai/plan.ts), in the per-city production loop.
import type { Content } from '../content/units.ts';
import type { PlayerView, ProductionItem } from '../core/model.ts';

/** Production candidates (item, benefit) for an idle city; [] before v27. */
export function cityProjectCandidates(_view: PlayerView, _cityId: number, content: Content): { item: ProductionItem; benefit: number }[] {
  if (!content.cityProjects) return [];
  return [];
}
