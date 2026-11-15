// Gameplay v27 ① (docs/design/pace-v27.md §2, option 1A): opening safety.
// - Startled civilians (R1): a non-wandering wild Pokémon whose end-of-round strike would hit a logistics unit (settler, builder, trader; one
//   sharing its tile with an own Pokémon is never a target, v26) scares it away instead: the civilian moves to the free tile next to it that is
//   2 tiles from the wild Pokémon and that it may enter (the lowest tile index), and the wild Pokémon strikes no one else this round. With no
//   such tile the strike happens as before. Wild Pokémon only (rivals, civilizations and raid bosses unchanged). Authority state only, no
//   random draws; the move is an ordinary `Moved` (seen like any move) plus `CivilianFled` for the owner.
// - Faith compensation (R4): the faith victory needs `faithWinSharePercent` (70) percent of the counted cities (v26: 60%).
// The AI's near city sites (R2) live in src/ai/query.ts.
import { FAITH_RULES } from '../content/faith-legends.ts';
import { openingTuning } from '../content/pace-v27.ts';
import type { Content } from '../content/units.ts';
import type { SpeciesId } from '../content/species.ts';
import { hexDistance, hexToIndex, neighbors } from './hex.ts';
import type { Hex } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { EventPayload, GameState, MapUnit } from './model.ts';
import { canEnterTile } from './movement.ts';

export type OpeningSafetyEvent = { type: 'CivilianFled'; playerId: number; unitId: number; from: Hex; to: Hex; wildId: number; wildSpeciesId: SpeciesId };

/** The tile a civilian flees to from `wild`, or null (strike as before). */
export function fleeTile(state: GameState, wild: MapUnit, civilian: MapUnit, content: Content): Hex | null {
  if (!content.openingSafety || civilian.kind !== 'logistics' || wild.ownerId !== null) return null;
  const taken = new Set([...Object.values(state.units).filter(isMapUnit), ...Object.values(state.cities)].map(item => hexToIndex(item.position, state.map)));
  return neighbors(civilian.position, state.map).map(hex => ({ hex, index: hexToIndex(hex, state.map) }))
    .filter((item): item is { hex: Hex; index: number } => item.index !== null && !taken.has(item.index) && canEnterTile(civilian, state.map, item.index, content)
      && hexDistance(item.hex, wild.position, state.map) === 2)
    .sort((a, b) => a.index - b.index)[0]?.hex ?? null;
}
/** Scares `civilian` away from `wild` when it can flee; the events, or null when the strike should happen. */
export function startleCivilian(state: GameState, wild: MapUnit, civilian: MapUnit, content: Content): EventPayload[] | null {
  const to = fleeTile(state, wild, civilian, content);
  if (!to || civilian.ownerId === null || wild.kind !== 'pokemon') return null;
  const from = { ...civilian.position };
  civilian.position = { ...to };
  return [{ type: 'Moved', unitId: civilian.id, path: [from, { ...to }] },
    { type: 'CivilianFled', playerId: civilian.ownerId, unitId: civilian.id, from, to: { ...to }, wildId: wild.id, wildSpeciesId: wild.speciesId }];
}

/** Followers a faith needs among `counted` cities (integers in v27; the v26 share before). */
export function faithWinCount(counted: number, content: Content): number {
  if (!content.openingSafety) return Math.ceil(counted * FAITH_RULES.winShare);
  return Math.floor((counted * openingTuning(content).faithWinSharePercent + 99) / 100);
}
/** The share the view shows (a fraction, as before) and, in v27, the exact percent the authority uses. */
export function faithWinShareView(content: Content): { winShare: number; winSharePercent?: number } {
  if (!content.openingSafety) return { winShare: FAITH_RULES.winShare };
  const percent = openingTuning(content).faithWinSharePercent;
  return { winShare: percent / 100, winSharePercent: percent };
}
/** The view mirror of `faithWinCount`. */
export function viewFaithWinCount(faith: { totalCities: number; winShare: number; winSharePercent?: number }): number {
  return faith.winSharePercent === undefined ? Math.ceil(faith.totalCities * faith.winShare) : Math.floor((faith.totalCities * faith.winSharePercent + 99) / 100);
}
