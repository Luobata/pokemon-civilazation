// Gameplay v26 D (docs/design/depth-v26.md §5.1, option 4A): gold sinks — RushProduction, RushRecovery (Pokémon Center),
// SpecialTraining and TeachMove (TMs; the team battles read the taught type through `taughtMoveType`). Stub for the late-game lane:
// the commands are declared and refused; every hook is wired once (expansion dispatch, round end, view, AI) and does nothing yet.
import type { TypeId } from '../content/species.ts';
import type { Content } from '../content/units.ts';
import type { EventPayload, GameState, PlayerView } from './model.ts';

export type GoldSinkAction =
  | { type: 'RushProduction'; cityId: number }
  | { type: 'RushRecovery'; unitId: number }
  | { type: 'SpecialTraining'; unitId: number }
  | { type: 'TeachMove'; unitId: number; typeId: TypeId };
/** Per player: the round of each unit's last special training; unit id -> the TM type it carries (battle layer only). */
export type GoldSinkState = { trainedAt: Record<number, Record<number, number>>; moves: Record<number, TypeId> };
export type GoldSinkView = { moves: Record<number, TypeId> };
export type GoldSinkEvent = never;
const TYPES = ['RushProduction', 'RushRecovery', 'SpecialTraining', 'TeachMove'] as const;
export const isGoldSinkAction = (action: { type: unknown }): action is GoldSinkAction => (TYPES as readonly unknown[]).includes(action.type);
export function validateGoldSinkAction(state: GameState, actorId: number, action: GoldSinkAction, content: Content): string | null {
  void state; void actorId; void action;
  return content.goldSinks ? 'not-implemented' : 'gold-sinks-unavailable';
}
export function applyGoldSinkAction(state: GameState, actorId: number, action: GoldSinkAction, content: Content): EventPayload[] {
  const reason = validateGoldSinkAction(state, actorId, action, content);
  if (reason) throw new Error(reason);
  return [];
}
/** Round end (rushed production completes with the normal production). */
export function resolveGoldSinkRound(state: GameState, content: Content): EventPayload[] {
  void state; void content;
  return [];
}
/** The TM type a unit carries in battle (undefined = none). */
export const taughtMoveType = (state: Pick<GameState, 'expansion'>, unitId: number): TypeId | undefined => state.expansion?.goldSinks?.moves[unitId];
export function observeGoldSinks(state: GameState, playerId: number): GoldSinkView | undefined {
  void playerId;
  return state.expansion?.goldSinks ? { moves: {} } : undefined;
}
/** Same as `taughtMoveType`, for the viewer's own units (the preview and the AI). */
export const viewTaughtMoveType = (view: Pick<PlayerView, 'expansion'>, unitId: number): TypeId | undefined => view.expansion?.goldSinks?.moves[unitId];
