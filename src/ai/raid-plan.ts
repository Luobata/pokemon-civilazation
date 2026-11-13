// Gameplay v26 D (docs/design/depth-v26.md §5.4.1): AI raid participation, view-only. With at least two healthy own Pokémon within 10
// tiles (the spec's 8 left most dens unvisited in the sweep) of a den the viewer knows, and no enemy at war near its cities, up to three of them walk to the den and attacks on the boss score +60.
import { hexDistance, indexToHex } from '../core/hex.ts';
import type { Hex } from '../core/hex.ts';
import type { MapUnit, PlayerView } from '../core/model.ts';
import { contentForView } from '../content/units.ts';

const RAID_REACH = 10, RAID_TEAM = 3;
type Pokemon = Extract<MapUnit, { kind: 'pokemon' }>;
function raidTeam(view: PlayerView): { den: Hex; team: Pokemon[] } | null {
  // The open den, or the announced one (5 rounds of notice to walk there).
  const raids = view.expansion?.raids, active = raids?.active ?? raids?.pending;
  if (!active || active.tileIndex === null) return null;
  // At war only while no enemy Pokémon is in sight within 5 tiles of an own city (the spec's "not fighting a neighbour").
  const enemies = new Set(view.diplomacy.filter(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId)).map(pair => pair.a === view.playerId ? pair.b : pair.a));
  if (view.units.some(unit => unit.ownerId !== null && enemies.has(unit.ownerId) && view.economy.cities.some(city => hexDistance(city.position, unit.position, view.map) <= 5))) return null;
  const den = indexToHex(active.tileIndex, view.map), content = contentForView(view);
  const team = view.units.filter((unit): unit is Pokemon => unit.ownerId === view.playerId && unit.kind === 'pokemon'
    && unit.hp * 2 >= content.species[unit.speciesId].maxHp && hexDistance(unit.position, den, view.map) <= RAID_REACH)
    .sort((a, b) => hexDistance(a.position, den, view.map) - hexDistance(b.position, den, view.map) || a.id - b.id).slice(0, RAID_TEAM);
  return team.length >= 2 ? { den, team } : null;
}
/** Extra attack score against a raid boss (0 = not a raid boss / not worth it). */
export function raidAttackBonus(view: PlayerView, target: MapUnit): number {
  const active = view.expansion?.raids?.active;
  if (!active || active.unitId !== target.id) return 0;
  return raidTeam(view) ? 60 : 0;
}
/** Unit id -> the raid tile it walks to. */
export function raidMoveTargets(view: PlayerView): Map<number, Hex> {
  const plan = raidTeam(view);
  return plan ? new Map(plan.team.filter(unit => hexDistance(unit.position, plan.den, view.map) > 1).map(unit => [unit.id, plan.den])) : new Map();
}
