// Gameplay v24 B (docs/design/world-v24.md §3): neutral gym circuit — placement, ChallengeGym / ChallengeEliteFour, badges, view.
// Scaffolding: no ledger is written yet (placement arrives with feature B), so both commands are refused and no badges exist.
/* eslint-disable @typescript-eslint/no-unused-vars -- scaffolding signatures; feature B fills them in and removes this line. */
import type { EssenceId } from '../content/essences.ts';
import type { TypeId } from '../content/species.ts';
import type { Content } from '../content/units.ts';
import type { BattleTrace } from './civilization-systems.ts';
import type { Hex } from './hex.ts';
import type { EventPayload, GameState } from './model.ts';

export type GymCircuitAction = { type: 'ChallengeGym'; gymId: number; unitIds: number[] } | { type: 'ChallengeEliteFour'; unitIds: number[] };
export type GymSite = { id: number; tileIndex: number; position: Hex; essence: EssenceId; typeId: TypeId };
/** `badges`: per player, ids of the circuit gyms won (in winning order); `challengedAt`: per player, gym id -> last round. */
export type GymCircuitState = { gyms: GymSite[]; badges: Record<number, number[]>; challengedAt: Record<number, Record<number, number>>;
  eliteFour: Record<number, { lastRound: number; won: boolean }> };
export type GymCircuitView = { gyms: GymSite[]; badges: Record<number, number[]>; eliteFour: Record<number, { won: boolean }> };
export type GymCircuitEvent =
  | { type: 'GymChallenged'; public: true; playerId: number; gymId: number; victory: boolean; badges: number; battle: BattleTrace }
  | { type: 'EliteFourChallenged'; public: true; playerId: number; victory: boolean; battles: BattleTrace[] };

export const isGymCircuitAction = (action: { type: unknown }): action is GymCircuitAction => action.type === 'ChallengeGym' || action.type === 'ChallengeEliteFour';
/** Places the eight gyms (§3.1) when the content has the circuit. */
export function initializeGymCircuit(state: GameState, content: Content): void {
  if (!content.gymCircuit || !state.expansion) return;
}
export function validateGymCircuitAction(state: GameState, actorId: number, action: GymCircuitAction, content: Content): string | null {
  return state.expansion?.gymCircuit ? 'gym-unavailable' : 'gyms-unavailable';
}
export function applyGymCircuitAction(state: GameState, actorId: number, action: GymCircuitAction, content: Content): EventPayload[] {
  return [];
}
/** Gym sites on explored tiles; badges and Elite Four results are public (§3.6). */
export function observeGymCircuit(state: GameState, playerId: number): GymCircuitView | undefined {
  return undefined;
}
type CircuitSource = { gyms: readonly GymSite[]; badges: Record<number, readonly number[]> } | undefined;
const essencesOf = (circuit: CircuitSource, playerId: number): EssenceId[] =>
  circuit ? (circuit.badges[playerId] ?? []).flatMap(gymId => circuit.gyms.filter(gym => gym.id === gymId).map(gym => gym.essence)) : [];
/** Essences of the circuit badges a player holds (v19 final-form gate, §3.1); [] without the circuit. */
export const stateCircuitBadges = (state: { expansion?: { gymCircuit?: GymCircuitState } }, playerId: number): EssenceId[] =>
  essencesOf(state.expansion?.gymCircuit, playerId);
export const viewCircuitBadges = (view: { playerId: number; expansion?: { gymCircuit?: GymCircuitView } }): EssenceId[] =>
  essencesOf(view.expansion?.gymCircuit, view.playerId);
