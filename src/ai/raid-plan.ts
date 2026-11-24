// Gameplay v26 D (docs/design/depth-v26.md §5.4.1): AI raid participation, view-only. With at least two healthy own Pokémon within 10
// tiles (the spec's 8 left most dens unvisited in the sweep) of a den the viewer knows, and no enemy at war near its cities, up to three of them walk to the den and attacks on the boss score +60.
import { hexDistance, indexToHex } from '../core/hex.ts';
import type { Hex } from '../core/hex.ts';
import type { MapUnit, PlayerView } from '../core/model.ts';
import { contentForView } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import { estimatedRaidStrike, raidRole } from '../core/max-raids.ts';
import type { RaidRole } from '../core/max-raids.ts';

const RAID_TEAM = 3;
type Pokemon = Extract<MapUnit, { kind: 'pokemon' }>;
function raidTeam(view: PlayerView): { den: Hex; team: Pokemon[] } | null {
  // The open den, or the announced one (5 rounds of notice to walk there).
  const raids = view.expansion?.raids, active = raids?.active ?? raids?.pending;
  if (!active || active.tileIndex === null) return null;
  // At war only while no enemy Pokémon is in sight within 5 tiles of an own city (the spec's "not fighting a neighbour").
  const enemies = new Set(view.diplomacy.filter(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId)).map(pair => pair.a === view.playerId ? pair.b : pair.a));
  const den = indexToHex(active.tileIndex, view.map), content = contentForView(view);
  const homeFront = 3;
  if (view.units.some(unit => unit.ownerId !== null && enemies.has(unit.ownerId) && view.economy.cities.some(city => hexDistance(city.position, unit.position, view.map) <= homeFront))) return null;
  return maxRaidTeam(view, den, content);
}
/**
 * v27 ⑤ (pace-v27 §6.3): the team by role — the nearest breaker, then damage dealers, one support when there is a scout (a fourth member
 * when the three are fighters) — from healthy
 * Pokémon within `MAX_RAID_REACH`, kept out of a garrison: an own city keeps one Pokémon in or next to it. It goes (alone too) only if its
 * estimated contribution over the rounds left would be at least 10% of the ledger (`raidPreview` numbers, view-only).
 */
const MAX_RAID_REACH = 12;
function maxRaidTeam(view: PlayerView, den: Hex, content: Content): { den: Hex; team: Pokemon[] } | null {
  const raids = view.expansion!.raids!, open = raids.active;
  const distance = (unit: Pokemon) => hexDistance(unit.position, den, view.map);
  const own = view.units.filter((unit): unit is Pokemon => unit.ownerId === view.playerId && unit.kind === 'pokemon');
  // A city's last defender stays home.
  const keep = new Set(view.economy.cities.map(city => own.filter(unit => hexDistance(unit.position, city.position, view.map) <= 1).sort((a, b) => a.id - b.id))
    .filter(guards => guards.length === 1).map(guards => guards[0].id));
  const pool = own.filter(unit => !keep.has(unit.id) && unit.hp * 2 >= content.species[unit.speciesId].maxHp && distance(unit) <= MAX_RAID_REACH)
    .sort((a, b) => distance(a) - distance(b) || a.id - b.id);
  const role = (unit: Pokemon): RaidRole => raidRole(content.species[unit.speciesId].role);
  const team: Pokemon[] = [];
  const take = (unit: Pokemon | undefined) => { if (unit && !team.includes(unit) && team.length < RAID_TEAM) team.push(unit); };
  take(pool.find(unit => role(unit) === 'breaker'));
  for (const unit of pool.filter(unit => role(unit) === 'dealer')) if (team.length < RAID_TEAM - 1) take(unit);
  take(pool.find(unit => role(unit) === 'support'));
  for (const unit of pool) take(unit);
  // A support rides along as a fourth member when the three are fighters.
  const support = pool.find(unit => role(unit) === 'support' && !team.includes(unit));
  if (support) team.push(support);
  if (!team.length) return null;
  // The preview gate: the team's estimated contribution over the rounds left against the ledger so far.
  const ledger = open?.max?.contribution ?? {}, total = Object.values(ledger).reduce((sum, value) => sum + value, 0), mine = ledger[view.playerId] ?? 0;
  const rounds = open ? Math.max(1, open.endsAtRound - view.round + 1) : 3;
  const shields = open?.max?.shields ?? 0;
  const estimate = team.reduce((sum, unit) => sum + estimatedRaidStrike(content, unit.speciesId, shields), 0) * rounds;
  return (mine + estimate) * 100 >= 10 * (total + estimate) ? { den, team } : null;
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
