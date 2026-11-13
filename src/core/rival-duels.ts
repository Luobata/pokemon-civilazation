// Gameplay v26 P3 (docs/design/depth-v26.md §3, option 3A): ChallengeRival — a relay duel against the own rival's team on the map, friendly
// (spar) or serious stakes, at the city gate too. Scaffolding: the command is declared and refused.
import type { Content } from '../content/units.ts';
import type { EventPayload, GameState } from './model.ts';

export type RivalDuelStake = 'spar' | 'serious';
export type RivalDuelAction = { type: 'ChallengeRival'; unitIds: number[]; stake: RivalDuelStake };
export type RivalDuelEvent = never;
export const isRivalDuelAction = (action: { type: unknown }): action is RivalDuelAction => action.type === 'ChallengeRival';
export function validateRivalDuelAction(state: GameState, actorId: number, action: RivalDuelAction, content: Content): string | null {
  void state; void actorId; void action;
  return content.rivalDuels ? 'not-implemented' : 'rival-duels-unavailable';
}
export function applyRivalDuelAction(state: GameState, actorId: number, action: RivalDuelAction, content: Content): EventPayload[] {
  const reason = validateRivalDuelAction(state, actorId, action, content);
  if (reason) throw new Error(reason);
  return [];
}
