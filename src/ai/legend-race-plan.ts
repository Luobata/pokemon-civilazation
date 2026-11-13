// Gameplay v26 D (docs/design/depth-v26.md §5.3): the AI does not start a legend another civilization has past half while its own
// estimate is over 10 rounds, and switches when a rival reaches the final stage. Stub for the late-game lane: never vetoes.
import type { LegendWonderId } from '../content/legend-wonders.ts';
import type { PlayerView } from '../core/model.ts';

export function legendRaceVeto(view: PlayerView, legendId: LegendWonderId): boolean {
  void view; void legendId;
  return false;
}
