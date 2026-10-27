import { CONTENT } from '../content/units.ts';
import type { Content, UnitIdentity } from '../content/units.ts';
import type { Hex } from './hex.ts';
import type { MapUnit, UnitState } from './model.ts';

export function maxUnitHp(unit: UnitIdentity, content: Content = CONTENT): number {
  return unit.kind === 'pokemon' ? content.species[unit.speciesId].maxHp : 30;
}
export function createMapUnit(identity: UnitIdentity, id: number, ownerId: number | null, position: Hex,
  content: Content = CONTENT, xp = 0, actionLeft: 0 | 1 = 0): MapUnit {
  return { ...identity, id, ownerId, position: { ...position }, location: 'map', xp, actionLeft,
    hp: maxUnitHp(identity, content), enraged: false, wildHome: ownerId === null ? { ...position } : null };
}
export function registerSpecies(state: { registeredSpeciesIds: string[] }, unit: UnitState): void {
  if (unit.kind === 'pokemon' && !state.registeredSpeciesIds.includes(unit.speciesId)) {
    state.registeredSpeciesIds.push(unit.speciesId); state.registeredSpeciesIds.sort();
  }
}
