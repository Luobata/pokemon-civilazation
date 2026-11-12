// Gameplay v24 C (docs/design/world-v24.md §4.3): AI response to its own rival — warned and attacked cities count as threatened,
// its Pokémon are worth attacking (a reward waits), other civilizations' rivals are ignored, training leans to the rival's counter.
// View-only: the warning and the sightings come from PlayerView.
import { RIVAL_COUNTERS, RIVAL_RULES_V24 } from '../content/rivals.ts';
import type { Content } from '../content/units.ts';
import type { SpeciesId } from '../content/species.ts';
import { dualEffectiveness } from '../core/combat-math.ts';
import type { MapUnit, PlayerView } from '../core/model.ts';
import { travelDistance, walkerTravel } from './travel.ts';
import { hexToIndex } from '../core/hex.ts';
import { isEmbarked } from '../core/terrain.ts';
import { strengthDamage, unitStrengthBreakdown } from '../core/strength.ts';

const ownSightings = (view: PlayerView) => view.expansion?.rivals?.sightings.filter(sighting => sighting.targetPlayerId === view.playerId) ?? [];
/** The own rival's Pokémon in sight within reach of an own city (worth walking to). Distances are the rival's own land travel (v24). */
export function ownRivalHunters(view: PlayerView): MapUnit[] {
  return ownSightings(view).flatMap(sighting => view.units.filter(unit => unit.id === sighting.unitId))
    .filter(unit => walkerTravel(view, unit, unit.position, view.economy.cities.map(city => city.position)) <= RIVAL_RULES_V24.threatRadius + 2);
}
/** Own city ids under a rival warning, or within 4 travel of a rival Pokémon hunting this civilization (it walks, never embarks). */
export function rivalThreatenedCityIds(view: PlayerView): number[] {
  const rivals = view.expansion?.rivals;
  if (!rivals) return [];
  const hunters = ownSightings(view).flatMap(sighting => view.units.filter(unit => unit.id === sighting.unitId));
  const ids = view.economy.cities.filter(city => city.id === rivals.pending?.cityId
    || hunters.some(unit => walkerTravel(view, unit, unit.position, [city.position]) <= RIVAL_RULES_V24.threatRadius)).map(city => city.id);
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
/**
 * v24 AI (rival chasing): the own Pokémon sent after the own rival's visible Pokémon that threaten own cities (within threatRadius + 6 of
 * one by the rival's land travel), only with a favourable matchup — the estimated strike on the rival (type chart, strength, its 劲敌气势)
 * hurts at least 4/5 as much as the rival's strike back, and the unit keeps more than 1.5 times that HP — and within RESPONSE_REACH travel.
 * Per rival unit the best matchups are taken until two strikes each would cover its HP; at most half of the own Pokémon go in all, and
 * `busy` units (another front, an escort) stay where they are. Empty before v24 (no terrain features or no rivals).
 */
export const RESPONSE_REACH = 10;
export function rivalResponseTeam(view: PlayerView, content: Content, busy: (unit: MapUnit) => boolean): Map<number, MapUnit> {
  const team = new Map<number, MapUnit>();
  if (!content.rivals || !view.map.features || content.combat !== 'strength' || !view.economy.cities.length) return team;
  const homes = view.economy.cities.map(city => city.position), map = view.map;
  const rivals = ownSightings(view).flatMap(sighting => view.units.filter(unit => unit.id === sighting.unitId && unit.kind === 'pokemon').map(unit => ({ unit, spirit: sighting.spirit })))
    .filter(rival => walkerTravel(view, rival.unit, rival.unit.position, homes, content) <= RIVAL_RULES_V24.threatRadius + 6);
  if (!rivals.length) return team;
  const own = view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon');
  const cap = Math.max(1, Math.floor(own.length / 2)), researched = view.economy.player.research.unlockedIds.includes('typeResearch');
  const biome = (unit: MapUnit) => map.tiles[hexToIndex(unit.position, map)!] ?? 'grassland';
  for (const rival of rivals) {
    const ground = biome(rival.unit);
    const options = own.filter(unit => !team.has(unit.id) && !busy(unit) && !isEmbarked(unit, map, content)).flatMap(unit => {
      const strike = unitStrengthBreakdown(unit, rival.unit, biome(unit), ground, researched, content, [], null, [], { attacker: 0, defender: rival.spirit });
      const back = unitStrengthBreakdown(rival.unit, unit, ground, biome(unit), researched, content, [], null, [], { attacker: rival.spirit, defender: 0 });
      const dealt = strengthDamage(strike, 92, false, rival.unit.hp), taken = strengthDamage(back, 92, false, unit.hp);
      const distance = travelDistance(view, unit, unit.position, rival.unit.position);
      return dealt * 5 >= taken * 4 && unit.hp * 2 > taken * 3 && distance <= RESPONSE_REACH ? [{ unit, dealt, edge: dealt - taken, distance }] : [];
    }).sort((a, b) => b.edge - a.edge || a.distance - b.distance || a.unit.id - b.unit.id);
    let damage = 0;
    for (const option of options) {
      if (damage >= rival.unit.hp || team.size >= cap) break;
      team.set(option.unit.id, rival.unit);
      damage += option.dealt * 2;
    }
  }
  return team;
}
