// Gameplay v24 D (docs/design/world-v24.md §5.3): capture preference when a capture completes a research task.
// Scaffolding: no research ledger yet, so no bonus.
/* eslint-disable @typescript-eslint/no-unused-vars -- scaffolding signatures; feature D fills them in and removes this line. */
import type { MapUnit, PlayerView } from '../core/model.ts';

/** Extra capture score for `target` (+15 in the spec when it completes task 3 or 5). */
export function researchCaptureScore(view: PlayerView, target: MapUnit): number {
  return 0;
}
