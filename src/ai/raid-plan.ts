// Gameplay v26 D (docs/design/depth-v26.md §5.4.1): AI raid participation, view-only. With at least two healthy own Pokémon within 8
// tiles of a den the viewer knows, and no war, up to three of them walk to the den and attacks on the boss score +60.
import { hexDistance, indexToHex } from '../core/hex.ts';
import type { Hex } from '../core/hex.ts';
import type { MapUnit, PlayerView } from '../core/model.ts';
import { contentForView } from '../content/units.ts';

const RAID_REACH = 8, RAID_TEAM = 3;
type Pokemon = Extract<MapUnit, { kind: 'pokemon' }>;
function raidTeam(view: PlayerView): { den: Hex; team: Pokemon[] } | null {
  const active = view.expansion?.raids?.active;
  if (!active || active.tileIndex === null || view.round > active.endsAtRound) return null;
  if (view.diplomacy.some(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId))) return null;
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
