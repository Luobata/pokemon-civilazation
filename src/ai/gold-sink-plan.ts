// Gameplay v26 D (docs/design/depth-v26.md §5.1): AI gold sinks (rush defenders under threat, then buildings; Pokémon Center while at
// war; TMs before gyms and the conference; training near an evolution). Stub for the late-game lane: never issues a command.
import type { Content } from '../content/units.ts';
import type { Command, PlayerView } from '../core/model.ts';

export function planGoldSinkAction(view: PlayerView, content: Content): Command['action'] | null {
  void view; void content;
  return null;
}
