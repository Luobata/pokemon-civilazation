// Gameplay v26 P3 (docs/design/depth-v26.md §3.3): AI rival duels (serious at ≥ 60% estimated, friendly at 35–60% near the target city,
// at the gate at ≥ 50%). Scaffolding: never issues a command.
import type { Content } from '../content/units.ts';
import type { Command, PlayerView } from '../core/model.ts';

export function planRivalDuel(view: PlayerView, content: Content): Command['action'] | null {
  void view; void content;
  return null;
}
