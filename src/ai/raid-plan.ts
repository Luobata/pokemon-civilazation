// Gameplay v26 D (docs/design/depth-v26.md §5.4.1): AI raid participation (+60 attack score with two idle Pokémon within 8 travel, not
// while at war with a neighbour). Stub for the late-game lane.
import type { Hex } from '../core/hex.ts';
import type { MapUnit, PlayerView } from '../core/model.ts';

/** Extra attack score against a raid boss (0 = not a raid boss / not worth it). */
export function raidAttackBonus(view: PlayerView, target: MapUnit): number {
  void view; void target;
  return 0;
}
/** Unit id -> the raid tile it walks to. */
export function raidMoveTargets(view: PlayerView): Map<number, Hex> {
  void view;
  return new Map();
}
