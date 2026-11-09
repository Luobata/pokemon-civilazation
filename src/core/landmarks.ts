// Gameplay v24 A3 (docs/design/world-v24.md §2.5): natural landmarks — discovery, adjacent yields and essences, healing, Stardust Mere regrowth.
// Scaffolding: the ledger exists only once the map carries landmark sites (none yet), so every hook below is inert.
/* eslint-disable @typescript-eslint/no-unused-vars -- scaffolding signatures; feature A3 fills them in and removes this line. */
import type { LandmarkId } from '../content/terrain.ts';
import type { Content } from '../content/units.ts';
import type { EventPayload, GameState } from './model.ts';

/** Per player: landmarks seen so far; `first`: the first civilization in the world to see each one. */
export type LandmarkState = { discovered: Record<number, LandmarkId[]>; first: Partial<Record<LandmarkId, number>> };
export type LandmarkView = { discovered: LandmarkId[] };
export type LandmarkEvent = { type: 'LandmarkDiscovered'; playerId: number; landmarkId: LandmarkId; tileIndex: number; first: boolean };

/** Writes `expansion.landmarks` when the content has landmarks and the map has sites. */
export function initializeLandmarks(state: GameState, content: Content): void {
  if (!content.landmarks || !state.expansion || !state.map.features?.landmarks.length) return;
  state.expansion.landmarks = { discovered: Object.fromEntries(state.turnOrder.map(id => [id, []])), first: {} };
}
/** Per command (recordExpansion): discoveries from the current vision. */
export function recordLandmarks(state: GameState, events: readonly EventPayload[]): EventPayload[] {
  if (!state.expansion?.landmarks) return [];
  return [];
}
/** Round end (resolveExpansionRound): healing beside Elder Canopy / Tidesong Grotto, Stardust Mere moon-stone regrowth. */
export function resolveLandmarkRound(state: GameState, content: Content): EventPayload[] {
  if (!state.expansion?.landmarks) return [];
  return [];
}
export function observeLandmarks(state: GameState, playerId: number): LandmarkView | undefined {
  const ledger = state.expansion?.landmarks;
  return ledger ? { discovered: [...(ledger.discovered[playerId] ?? [])] } : undefined;
}
