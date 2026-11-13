// Gameplay v26 O (docs/design/depth-v26.md §8, option 8A): the professor's gift — three Poké Balls when domestication is researched.
// Stub for the opening lane: called once from recordExpansion after every command, does nothing yet.
import type { Content } from '../content/units.ts';
import type { EventPayload, GameState } from './model.ts';

export type OpeningGiftEvent = never;
export function recordOpeningGift(before: GameState, after: GameState, events: readonly EventPayload[], content: Content): EventPayload[] {
  void before; void after; void events; void content;
  return [];
}
