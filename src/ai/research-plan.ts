// Gameplay v24 D (docs/design/world-v24.md §5.3): capture preference when a capture completes a research task.
import { RESEARCH_TASK_RULES_V24, researchSpecialFor } from '../content/research-tasks.ts';
import { contentForView } from '../content/units.ts';
import { hexToIndex } from '../core/hex.ts';
import type { MapUnit, PlayerView } from '../core/model.ts';
import { hasTask, inResearchHabitat } from '../core/research-tasks.ts';

/** Extra capture score for `target`: +15 when capturing it completes task 3 (capture) or task 5 (capture in its habitat). Reads only the view. */
export function researchCaptureScore(view: PlayerView, target: MapUnit): number {
  const book = view.expansion?.researchTasks;
  if (!book || target.kind !== 'pokemon') return 0;
  const card = book[target.speciesId], content = contentForView(view);
  if (!hasTask(card, 'captured')) return RESEARCH_TASK_RULES_V24.aiCaptureScore;
  const index = hexToIndex(target.position, view.map);
  if (hasTask(card, 'special') || researchSpecialFor(content.species[target.speciesId].typeId).kind !== 'habitat' || index === null) return 0;
  return inResearchHabitat(view.map, content, target.speciesId, index) ? RESEARCH_TASK_RULES_V24.aiCaptureScore : 0;
}
