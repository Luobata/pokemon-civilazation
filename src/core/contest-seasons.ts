// Gameplay v26 D (docs/design/depth-v26.md §5.2, option 5A): contest seasons — every 15 rounds from round 45, a category announced
// 5 rounds earlier, EnterContest with one Pokémon, placings give appeal and ribbons. Stub for the late-game lane: EnterContest is
// declared and refused, the round hook and the view do nothing yet.
import type { Content } from '../content/units.ts';
import type { EventPayload, GameState } from './model.ts';

export type ContestSeasonAction = { type: 'EnterContest'; unitId: number };
export type ContestSeasonState = { entries: Record<number, number>; ribbons: Record<number, number> };
export type ContestSeasonView = { nextRound: number | null; category: string | null; ribbons: Record<number, number> };
export type ContestSeasonEvent = never;
export const isContestSeasonAction = (action: { type: unknown }): action is ContestSeasonAction => action.type === 'EnterContest';
export function validateContestSeasonAction(state: GameState, actorId: number, action: ContestSeasonAction, content: Content): string | null {
  void state; void actorId; void action;
  return content.contestSeasons ? 'not-implemented' : 'contest-seasons-unavailable';
}
export function applyContestSeasonAction(state: GameState, actorId: number, action: ContestSeasonAction, content: Content): EventPayload[] {
  const reason = validateContestSeasonAction(state, actorId, action, content);
  if (reason) throw new Error(reason);
  return [];
}
/** Round end: announce the next category, judge a season. */
export function resolveContestSeasonRound(state: GameState, content: Content): EventPayload[] {
  void state; void content;
  return [];
}
export function observeContestSeasons(state: GameState, playerId: number): ContestSeasonView | undefined {
  void playerId;
  return state.expansion?.contestSeasons ? { nextRound: null, category: null, ribbons: {} } : undefined;
}
