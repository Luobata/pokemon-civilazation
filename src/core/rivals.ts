// Gameplay v24 C (docs/design/world-v24.md §4): one rival trainer per civilization — warning, arrival, round-end actions, rewards, departure.
// Scaffolding: no ledger is written yet, so no rival ever appears and every query reports "not a rival".
/* eslint-disable @typescript-eslint/no-unused-vars -- scaffolding signatures; feature C fills them in and removes this line. */
import type { Content } from '../content/units.ts';
import type { EventPayload, GameState, PlayerView } from './model.ts';

export type RivalLedger = { name: string; encounter: number; pending?: { round: number; cityId: number; tileIndex: number };
  activeUnitIds: number[]; arrivedAtRound?: number };
/** `unitTargets`: rival unit id -> the civilization it hunts. */
export type RivalState = { byPlayer: Record<number, RivalLedger>; unitTargets: Record<number, number> };
/** Only the target sees its warning (§4.5); rival units themselves are ordinary visible map units. */
export type RivalView = { name: string; encounter: number; pending?: { round: number; cityId: number; tileIndex: number }; activeUnitIds: number[] };
export type RivalEvent =
  | { type: 'RivalAnnounced'; playerId: number; encounter: number; round: number; cityId: number; tileIndex: number }
  | { type: 'RivalArrived'; playerId: number; encounter: number; unitIds: number[] }
  | { type: 'RivalDefeated'; playerId: number; encounter: number }
  | { type: 'RivalDeparted'; playerId: number; encounter: number };

export function initializeRivals(state: GameState, content: Content): void {
  if (!content.rivals || !state.expansion) return;
}
/** Round end, right after the world's rampages: warnings, arrivals, rival moves and strikes, departures. */
export function resolveRivalRound(state: GameState, content: Content): EventPayload[] {
  if (!state.expansion?.rivals) return [];
  return [];
}
export const isRivalUnit = (state: Pick<GameState, 'expansion'>, unitId: number) => state.expansion?.rivals?.unitTargets[unitId] !== undefined;
/** A player's view only knows its own rival's units. */
export const viewIsRivalUnit = (view: Pick<PlayerView, 'expansion'>, unitId: number) => view.expansion?.rivals?.activeUnitIds.includes(unitId) ?? false;
export function observeRivals(state: GameState, playerId: number): RivalView | undefined {
  return undefined;
}
