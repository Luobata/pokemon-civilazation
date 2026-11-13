// Gameplay v26 P2 (docs/design/depth-v26.md §4.2): evolution goals — a Rare Candy evolution scores +1 instead of +2, and a "final
// evolution" milestone (+1 per civilization per line, at most 3 per era). Stub for the evolution lane: the era score asks it once per
// recorded batch of events; [] = the pre-v26 milestones only.
import type { EraMilestone } from '../content/era-honors.ts';
import type { EventPayload, GameState } from './model.ts';

export function evolutionGoalMilestones(before: GameState, after: GameState, events: readonly EventPayload[]): [number, EraMilestone][] {
  void before; void after; void events;
  return [];
}
