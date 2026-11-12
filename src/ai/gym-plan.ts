// Gameplay v24 B (docs/design/world-v24.md §3.4): AI gym challenges, team travel and the Elite Four — view-only, never a refused command.
// Scaffolding: no gyms exist yet, so the planner has nothing to do.
/* eslint-disable @typescript-eslint/no-unused-vars -- scaffolding signatures; feature B fills them in and removes this line. */
import type { Content } from '../content/units.ts';
import type { Hex } from '../core/hex.ts';
import type { Command, PlayerView } from '../core/model.ts';

/** A ChallengeGym / ChallengeEliteFour command when a ready team stands at a gym (or holds eight badges); otherwise null. */
export function planGymAction(view: PlayerView, content: Content): Command['action'] | null {
  if (!view.expansion?.gymCircuit) return null;
  return null;
}
/** Unit id -> the gym tile it is walking to (the planner scores moves toward it). */
export function gymMoveTargets(view: PlayerView, content: Content): Map<number, Hex> {
  return new Map();
}
