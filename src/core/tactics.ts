import { gameplayAtLeast } from '../content/eras.ts';
import type { GameplayVersion } from '../content/eras.ts';
import type { Content, UnitIdentity } from '../content/units.ts';
import { hexDistance } from './hex.ts';
import type { Hex, MapShape } from './hex.ts';
import type { Diplomacy, MapUnit } from './model.ts';

/** Gameplay v2 field tactics: zones of control and flanking. Legacy and v1 games are unchanged. */
export const FLANK_PER_UNIT = 100;
export const FLANK_MAX = 300;
type Source = { gameplayVersion?: GameplayVersion };
export const usesTactics = (source: Source) => gameplayAtLeast(source, 2);

export function exertsZoc(unit: UnitIdentity, content: Content): boolean {
  if (unit.kind !== 'pokemon') return false;
  const role = content.species[unit.speciesId].role;
  return role === 'melee' || role === 'fast';
}
export function ignoresZoc(unit: UnitIdentity, content: Content): boolean {
  if (unit.kind !== 'pokemon') return true;
  const species = content.species[unit.speciesId];
  return species.role === 'scout' || species.role === 'air' || species.typeId === 'ghost' || species.secondaryTypeId === 'ghost';
}
const atWar = (diplomacy: readonly Diplomacy[], a: number, b: number) => diplomacy.some(pair => pair.status === 'war'
  && pair.a === Math.min(a, b) && pair.b === Math.max(a, b));
/** Tiles adjacent to any hostile ZOC unit among `units` (callers pass only what the mover can see). */
export function zocTiles(mover: MapUnit, units: readonly MapUnit[], diplomacy: readonly Diplomacy[], content: Content): Hex[] {
  if (mover.ownerId === null || ignoresZoc(mover, content)) return [];
  return units.filter(other => other.id !== mover.id && other.ownerId !== null && other.ownerId !== mover.ownerId
    && atWar(diplomacy, mover.ownerId!, other.ownerId) && exertsZoc(other, content)).map(other => other.position);
}
export function inZoc(position: Hex, sources: readonly Hex[], map: MapShape): boolean {
  return sources.some(source => hexDistance(source, position, map) === 1);
}
/** Permille bonus for a unit attack: other own Pokémon adjacent to the defender. */
export function flankBonus(source: Source, attacker: MapUnit, defender: MapUnit, units: readonly MapUnit[], map: MapShape): number {
  if (!usesTactics(source) || attacker.ownerId === null) return 0;
  const helpers = units.filter(unit => unit.id !== attacker.id && unit.ownerId === attacker.ownerId && unit.kind === 'pokemon'
    && hexDistance(unit.position, defender.position, map) === 1).length;
  return Math.min(FLANK_MAX, helpers * FLANK_PER_UNIT);
}
