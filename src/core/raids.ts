// Gameplay v26 D (docs/design/depth-v26.md §5.4.1): Max Raid dens — from round 90 every 20 rounds a regional stage-3 or rare species at a
// public site, fought with ordinary attacks; the top damage dealer gets it. Stub for the late-game lane.
import type { Content } from '../content/units.ts';
import type { EventPayload, GameState } from './model.ts';

export type RaidState = { active: { unitId: number; tileIndex: number; endsAtRound: number; damage: Record<number, number> } | null; held: number };
export type RaidView = { active: { unitId: number; tileIndex: number | null; endsAtRound: number; damage: Record<number, number> } | null };
export type RaidEvent = never;
export function initializeRaids(state: GameState, content: Content): void {
  void state; void content;
}
/** Round end: spawn, strike adjacent units, award or leave. */
export function resolveRaidRound(state: GameState, content: Content): EventPayload[] {
  void state; void content;
  return [];
}
/** After every command: the damage ledger and a knocked-out raid boss. */
export function recordRaids(before: GameState, after: GameState, events: readonly EventPayload[]): EventPayload[] {
  void before; void after; void events;
  return [];
}
export function observeRaids(state: GameState, playerId: number): RaidView | undefined {
  void playerId;
  return state.expansion?.raids ? { active: null } : undefined;
}
