// Gameplay v26 D (docs/design/depth-v26.md §5.2): AI contest entries and cultural defence (every personality builds a hall after round
// 60 or its third city; more halls and holding on cooldown once a rival reaches 60% of its appeal target). Stub for the late-game lane.
import type { Content } from '../content/units.ts';
import type { Command, PlayerView } from '../core/model.ts';

export function planContestSeasonAction(view: PlayerView, content: Content): Command['action'] | null {
  void view; void content;
  return null;
}
