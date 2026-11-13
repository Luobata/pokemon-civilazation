// Gameplay v26 C2 (docs/design/depth-v26.md §7.2, option 7A): one Pokémon and one logistics unit (settler, builder, trader) of the
// same owner may share a tile. Units pass through any own unit and stop only where their own layer is free; a logistics unit sharing a
// tile with an own Pokémon cannot be targeted (attacks and wild strikes hit the Pokémon). Every helper returns the pre-v26 rule
// (every unit blocks, nobody is protected) unless the content has `stacking`, so older games are unchanged.
import type { Content } from '../content/units.ts';
import { hexToIndex } from './hex.ts';
import type { GridSize, Hex } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { GameState, MapUnit } from './model.ts';

type Occupant = { kind: string; ownerId: number | null };
type Placed = Occupant & { id: number; position: Hex };
/** 'pokemon' or 'civilian' (logistics units): the two layers of a tile. */
export const stackLayer = (unit: { kind: string }) => unit.kind === 'pokemon' ? 'pokemon' : 'civilian';
/** Whether `mover` may enter (pass through) a tile `occupant` stands on: any own unit under the v26 rule, never before. */
export function tileShareAllowed(mover: Occupant, occupant: Occupant, content: Content): boolean {
  return Boolean(content.stacking) && mover.ownerId !== null && mover.ownerId === occupant.ownerId;
}
/** Whether `mover` may end its move on a tile holding `occupants` (itself excluded): at most one other, own, of the other layer. */
export function stackStopAllowed(mover: Occupant & { id: number }, occupants: readonly Placed[], content: Content): boolean {
  const others = occupants.filter(other => other.id !== mover.id);
  if (!others.length) return true;
  return Boolean(content.stacking) && others.length === 1 && others[0].ownerId === mover.ownerId && stackLayer(others[0]) !== stackLayer(mover);
}
/** Path search: drops the destinations where the mover may pass but not stop (only under the v26 rule). */
export function dropUnstoppable<T>(paths: Record<number, T>, mover: Occupant & { id: number }, units: readonly Placed[], map: GridSize, content: Content): Record<number, T> {
  if (!content.stacking) return paths;
  const byTile = new Map<number, Placed[]>();
  for (const unit of units) { const index = hexToIndex(unit.position, map); if (index !== null) byTile.set(index, [...byTile.get(index) ?? [], unit]); }
  for (const key of Object.keys(paths)) {
    const occupants = byTile.get(Number(key));
    if (occupants && !stackStopAllowed(mover, occupants, content)) delete paths[Number(key)];
  }
  return paths;
}
/** Authority's Move: the walked path shortened to its last tile the mover may stop on (unchanged before v26). */
export function trimToStop(path: Hex[], mover: MapUnit, state: GameState, content: Content): Hex[] {
  if (!content.stacking) return path;
  const units = Object.values(state.units).filter(isMapUnit);
  while (path.length > 1) {
    const index = hexToIndex(path[path.length - 1], state.map);
    if (stackStopAllowed(mover, units.filter(other => hexToIndex(other.position, state.map) === index), content)) break;
    path.pop();
  }
  return path;
}
/** A logistics unit sharing its tile with a Pokémon of its owner (v26): attacks and wild strikes cannot pick it. */
export function protectedCivilian(units: readonly Placed[], target: Placed, map: GridSize, content: Content): boolean {
  if (!content.stacking || target.kind === 'pokemon' || target.ownerId === null) return false;
  const tile = hexToIndex(target.position, map);
  return units.some(other => other.id !== target.id && other.kind === 'pokemon' && other.ownerId === target.ownerId && hexToIndex(other.position, map) === tile);
}
export const stateProtectedCivilian = (state: GameState, target: MapUnit, content: Content) =>
  protectedCivilian(Object.values(state.units).filter(isMapUnit), target, state.map, content);
/**
 * Tiles a new unit of `owner` with this identity may not be placed on: before v26 every unit's tile; under the v26 rule the tiles holding
 * another civilization's unit or an own unit of the same layer (cities are excluded by the callers as before).
 */
export function placementBlocked(state: GameState, identity: { kind: string }, ownerId: number, content: Content): Set<number> {
  const units = Object.values(state.units).filter(isMapUnit);
  if (!content.stacking) return new Set(units.map(unit => hexToIndex(unit.position, state.map)!));
  const byTile = new Map<number, MapUnit[]>();
  for (const unit of units) { const index = hexToIndex(unit.position, state.map)!; byTile.set(index, [...byTile.get(index) ?? [], unit]); }
  return new Set([...byTile].filter(([, occupants]) => !stackStopAllowed({ id: -1, kind: identity.kind, ownerId }, occupants, content)).map(([index]) => index));
}
