// Gameplay v27 ⑤ AI (docs/design/pace-v27.md §6.3): the den Dynamax for the first top-stage damage dealer within 2 tiles of the den.
// View-only. Stub: the events lane fills it in (team roles and shield-phase attack scores go to src/ai/raid-plan.ts). Wired once in planNext.
import type { Content } from '../content/units.ts';
import type { Command, PlayerView } from '../core/model.ts';

export function planMaxRaidAction(_view: PlayerView, content: Content): Command['action'] | null {
  if (!content.maxRaids) return null;
  return null;
}
