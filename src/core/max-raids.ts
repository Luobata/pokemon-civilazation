// Gameplay v27 ⑤ (docs/design/pace-v27.md §6, option 5A): Max raids — Max shields (damage through them ×25%, a hit breaks 1, a breaker's
// or a super-effective hit 2), two phases (≤ 50% HP: shields return, the Max wave reaches 2 tiles), one free den Dynamax per civilization
// (RaidDynamax), roles by class, contribution = damage + 15 × shields + support healing, catch chances for every share ≥ 10%, the reward
// preview. Stub: the events lane fills it in. Wired once each: the RaidDynamax command (src/core/expansion.ts and expansion-commands.ts,
// refused), the strike on a raid boss (src/core/combat.ts unitStrike), and the AI (src/ai/max-raid-plan.ts from planNext).
import type { Content } from '../content/units.ts';
import type { EventPayload, GameState, MapUnit } from './model.ts';

export type MaxRaidAction = { type: 'RaidDynamax'; unitId: number };
export const isMaxRaidAction = (action: { type: unknown }): action is MaxRaidAction => action.type === 'RaidDynamax';
export function validateMaxRaidAction(_state: GameState, _actorId: number, _action: MaxRaidAction, content: Content): string | null {
  if (!content.maxRaids) return 'max-raids-unavailable';
  return 'max-raids-unavailable';
}
export function applyMaxRaidAction(state: GameState, actorId: number, action: MaxRaidAction, content: Content): EventPayload[] {
  const reason = validateMaxRaidAction(state, actorId, action, content);
  if (reason) throw new Error(reason);
  return [];
}
/** The damage a strike deals after the Max shields (= `hit` unless the defender is a raid boss of a Max-raid game). */
export function maxRaidHit(_state: GameState, _attacker: MapUnit, _defender: MapUnit, hit: number, content: Content): number {
  if (!content.maxRaids) return hit;
  return hit;
}
