// Gameplay v24 C (docs/design/world-v24.md §4.3): AI response to its own rival — warned and attacked cities count as threatened,
// its Pokémon are worth attacking (a reward waits), other civilizations' rivals are ignored, training leans to the rival's counter.
// View-only: the warning and the sightings come from PlayerView.
import { RIVAL_COUNTERS, RIVAL_RULES_V24 } from '../content/rivals.ts';
import type { Content } from '../content/units.ts';
import type { SpeciesId } from '../content/species.ts';
import { dualEffectiveness } from '../core/combat-math.ts';
import { hexDistance } from '../core/hex.ts';
import type { MapUnit, PlayerView } from '../core/model.ts';

const ownSightings = (view: PlayerView) => view.expansion?.rivals?.sightings.filter(sighting => sighting.targetPlayerId === view.playerId) ?? [];
/** The own rival's Pokémon in sight within reach of an own city (worth walking to). */
export function ownRivalHunters(view: PlayerView): MapUnit[] {
  return ownSightings(view).flatMap(sighting => view.units.filter(unit => unit.id === sighting.unitId))
    .filter(unit => view.economy.cities.some(city => hexDistance(unit.position, city.position, view.map) <= RIVAL_RULES_V24.threatRadius + 2));
}
/** Own city ids under a rival warning, or within 4 tiles of a rival Pokémon hunting this civilization. */
export function rivalThreatenedCityIds(view: PlayerView): number[] {
  const rivals = view.expansion?.rivals;
  if (!rivals) return [];
  const hunters = ownSightings(view).flatMap(sighting => view.units.filter(unit => unit.id === sighting.unitId));
  const ids = view.economy.cities.filter(city => city.id === rivals.pending?.cityId
    || hunters.some(unit => hexDistance(unit.position, city.position, view.map) <= RIVAL_RULES_V24.threatRadius)).map(city => city.id);
  return ids.sort((a, b) => a - b);
}
/** A rival's warning or visit is under way for this civilization (gym teams stay home). */
export const rivalActive = (view: PlayerView) => Boolean(view.expansion?.rivals?.pending || view.expansion?.rivals?.activeUnitIds.length);
/** Extra attack benefit: +50 against the own rival (a reward), null = leave another civilization's rival alone. */
export function rivalAttackBonus(view: PlayerView, target: MapUnit): number | null {
  const sighting = view.expansion?.rivals?.sightings.find(item => item.unitId === target.id);
  if (!sighting) return 0;
  return sighting.targetPlayerId === view.playerId ? 50 : null;
}
/** Training bonus while warned or visited: +20 for a species that hits the rival's main counter type super-effectively. */
export function rivalTrainingBonus(view: PlayerView, speciesId: SpeciesId, content: Content): number {
  if (!rivalActive(view)) return 0;
  const primary = RIVAL_COUNTERS[view.economy.player.starterId].primary[0], species = content.species[speciesId];
  return species && dualEffectiveness(species.typeId, [content.species[primary].typeId]) > 100 ? 20 : 0;
}
