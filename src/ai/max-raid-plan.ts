// Gameplay v27 ⑤ AI (docs/design/pace-v27.md §6.3), view-only:
// - the den Dynamax: the highest-stage damage dealer within 2 tiles of the boss (else the highest-stage Pokémon there) uses it at once;
// - attacks on a Max boss are military work (300 + the hit while the raid team may go, else 150, so a unit beside the den strikes instead
//   of wandering off but a defence against enemies still comes first), with the role bonus: while shields stand breakers and
//   super-effective hits +40, once they are down damage dealers +40.
// Team building and the walk to the den are in src/ai/raid-plan.ts. Nothing here runs before v27.
import type { Content } from '../content/units.ts';
import type { AttackPreview } from '../core/preview.ts';
import { hexDistance } from '../core/hex.ts';
import type { Command, MapUnit, PlayerView } from '../core/model.ts';
import { eventsTuning } from '../content/pace-v27.ts';
import { raidRole, viewRaidDynamaxBlocker } from '../core/max-raids.ts';
import { raidAttackBonus } from './raid-plan.ts';

type Pokemon = Extract<MapUnit, { kind: 'pokemon' }>;
export function planMaxRaidAction(view: PlayerView, content: Content): Command['action'] | null {
  const active = view.expansion?.raids?.active;
  if (!content.maxRaids || !active?.max || active.max.dynamaxUsed || active.unitId === null) return null;
  const boss = view.units.find(unit => unit.id === active.unitId);
  if (!boss) return null;
  const near = view.units.filter((unit): unit is Pokemon => unit.ownerId === view.playerId && unit.kind === 'pokemon'
    && hexDistance(unit.position, boss.position, view.map) <= eventsTuning(content).dynamaxRange && viewRaidDynamaxBlocker(view, unit.id, content) === null);
  const pick = near.sort((a, b) => Number(raidRole(content.species[b.speciesId].role) === 'dealer') - Number(raidRole(content.species[a.speciesId].role) === 'dealer')
    || content.species[b.speciesId].stage - content.species[a.speciesId].stage || a.id - b.id)[0];
  return pick ? { type: 'RaidDynamax', unitId: pick.id } : null;
}
/** Military score of an attack on the Max boss (null = not a Max boss, or the attack does nothing). */
export function maxRaidAttackScore(view: PlayerView, unit: MapUnit, target: MapUnit, preview: AttackPreview, content: Content): number | null {
  const active = view.expansion?.raids?.active;
  if (!content.maxRaids || !active?.max || active.unitId !== target.id || unit.kind !== 'pokemon' || !preview.ok) return null;
  const shields = active.max.shields ?? 0, role = raidRole(content.species[unit.speciesId].role);
  const broken = preview.maxRaid?.shields ?? 0;
  if (preview.damage.min <= 0 && broken <= 0) return null;
  const bonus = shields > 0 ? (role === 'breaker' || broken >= eventsTuning(content).breakerShields ? 40 : 0) : role === 'dealer' ? 40 : 0;
  return (raidAttackBonus(view, target) > 0 ? 300 : 150) + preview.damage.min + eventsTuning(content).shieldPoints * broken - preview.counter.damage + bonus;
}
