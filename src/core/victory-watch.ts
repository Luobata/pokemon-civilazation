// Gameplay v26 D (docs/design/depth-v26.md §5.5, option 9A): a public warning when any civilization reaches 75% of a victory route.
// Stub for the late-game lane: the round-end hook does nothing yet.
import type { Content } from '../content/units.ts';
import type { EventPayload, GameState } from './model.ts';

export type VictoryWatchEvent = never;
export function resolveVictoryWatchRound(state: GameState, content: Content): EventPayload[] {
  void state; void content;
  return [];
}
