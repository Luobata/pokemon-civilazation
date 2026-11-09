// What a battle looks like, derived in the browser from the presented BattleResolved event and the
// viewer's PlayerView only (no rule state, no damage recomputation): attack types, range, the type
// matchup for the "super effective" hint, and who goes down. The event itself is unchanged.
import { contentForView } from '../content/units.ts';
import type { TypeId } from '../content/species.ts';
import { dualEffectiveness, effectiveness } from '../core/combat-math.ts';
import { teraTypes, viewCombatContext } from '../core/era-abilities.ts';
import { hexDistance, hexToIndex } from '../core/hex.ts';
import type { PlayerView, VisibleEvent } from '../core/model.ts';
import type { UnitMarkIdentity } from './render/scene.ts';

type BattlePayload = Extract<VisibleEvent['payload'], { type: 'BattleResolved' }>;
export type BattleLook = {
  /** Attacker identity when known (to draw its lunge / knockdown ghost). */
  attacker?: UnitMarkIdentity;
  /** Target unit identity when the target is a unit and known. */
  target?: UnitMarkIdentity;
  attackType: TypeId | null;
  /** Type of the counter-attack (the defending Pokémon's type); null for a city or none. */
  counterType: TypeId | null;
  /** Fought from two or more tiles away: the hit (and the counter) fly as projectiles. */
  ranged: boolean;
  /** Percent, 100 = neutral; null when not a Pokémon-vs-Pokémon matchup or unknown. */
  effectiveness: number | null;
  targetDown: boolean; attackerDown: boolean;
  /** Tag under a knocked-down civilization Pokémon (it recovers in a city) or a removed wild / logistics unit. */
  targetTag: '休养' | '击倒'; attackerTag: '休养' | '击倒';
  /** For a captured city: its owner before (undefined when unknown) and after. */
  city?: { id: number; tile: number; previousOwner: number | null | undefined; ownerId: number | null };
};

const tag = (ownerId: number | null | undefined, kind: string | undefined): '休养' | '击倒' => ownerId !== null && ownerId !== undefined && kind === 'pokemon' ? '休养' : '击倒';

/** `known`: identities seen at earlier refreshes (units removed by the battle are no longer in the view). */
export function battleLook(payload: BattlePayload, view: PlayerView, known: ReadonlyMap<number, UnitMarkIdentity>, knownCityOwners: ReadonlyMap<number, number | null> = new Map()): BattleLook {
  const content = contentForView(view);
  const identity = (id: number): UnitMarkIdentity | undefined => view.units.find(unit => unit.id === id) ?? view.recoveringUnits.find(unit => unit.id === id) ?? known.get(id);
  const attacker = identity(payload.attackerId);
  const target = payload.target.kind === 'unit' ? identity(payload.target.id) : undefined;
  const records = payload.knockdowns ?? [];
  // Unknown identity: the knockdown records still carry each fallen or striking Pokémon's type.
  const recordType = (id: number): TypeId | null => {
    for (const record of records) for (const side of [record.source, record.target]) if (side.id === id && side.kind !== 'city') return side.typeId;
    return null;
  };
  const typeOf = (unit: UnitMarkIdentity | undefined, id: number): TypeId | null =>
    unit?.kind === 'pokemon' ? content.species[unit.speciesId]?.typeId ?? null : recordType(id);
  const attackType = typeOf(attacker, payload.attackerId);
  const counterType = payload.target.kind === 'unit' && payload.counterDamage ? typeOf(target, payload.target.id) : null;
  const ranged = hexDistance(payload.positions[0], payload.positions[1], view.map) > 1;

  let matchup: number | null = records.find(record => !record.counter && record.source.id === payload.attackerId && record.target.kind !== 'city')?.effectiveness ?? null;
  if (matchup === null && attackType && target?.kind === 'pokemon') {
    const species = content.species[target.speciesId];
    if (species) {
      const researched = view.combat.units[payload.attackerId]?.typeResearch ?? false;
      matchup = view.expansion
        ? dualEffectiveness(attackType, teraTypes(viewCombatContext(view), target.id) ?? [species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])], researched)
        : effectiveness(attackType, species.typeId, species.immunities, researched);
    }
  }

  const down = (id: number) => payload.knockedDownUnitIds.includes(id);
  const recordOf = (id: number) => records.find(record => record.target.id === id && record.target.kind !== 'city')?.target;
  const look: BattleLook = { attackType, counterType, ranged, effectiveness: matchup,
    targetDown: payload.target.kind === 'unit' && down(payload.target.id), attackerDown: down(payload.attackerId),
    targetTag: payload.target.kind === 'unit' ? tag(target?.ownerId ?? recordOf(payload.target.id)?.ownerId, target?.kind ?? recordOf(payload.target.id)?.kind) : '击倒',
    attackerTag: tag(attacker?.ownerId ?? recordOf(payload.attackerId)?.ownerId, attacker?.kind ?? recordOf(payload.attackerId)?.kind),
    ...(attacker ? { attacker } : {}), ...(target ? { target } : {}) };
  if (payload.capturedCity && payload.target.kind === 'city') {
    const city = view.cities.find(item => item.id === payload.target.id);
    const tile = city ? hexToIndex(city.position, view.map) : hexToIndex(payload.positions[1], view.map);
    if (tile !== null) look.city = { id: payload.target.id, tile, previousOwner: knownCityOwners.get(payload.target.id), ownerId: city?.ownerId ?? attacker?.ownerId ?? null };
  }
  return look;
}
