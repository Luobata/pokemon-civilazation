import type { EraProgression, GameplayVersion } from '../content/eras.ts';
import type { Content, SpeciesId, UnitIdentity } from '../content/units.ts';
import type { TechId } from '../content/economy.ts';
import type { DoctrinePlayer, UnitRole } from './leader-doctrines.ts';
import { doctrineEffects } from './leader-doctrines.ts';

/**
 * Era-mode city assault doctrine. Legacy games (no eraProgression) keep the original
 * single siege multiplier, so saves and replays without an era mode are unchanged.
 * Values are permille and multiply the base city damage once.
 */
export const ROLE_CITY_ASSAULT: Readonly<Record<UnitRole, { label: string; adjacent: number; distant: number; note: string }>> = {
  siege: { label: '攻城', adjacent: 1300, distant: 1300, note: '破城主力；研究投石改装后提升至 ×1.75' },
  melee: { label: '近战', adjacent: 1250, distant: 1000, note: '贴城突入 ×1.25' },
  fast: { label: '快速', adjacent: 1200, distant: 1000, note: '贴城突入 ×1.2' },
  ranged: { label: '远程', adjacent: 900, distant: 900, note: '城墙压制，攻城 ×0.9' },
  air: { label: '飞行', adjacent: 900, distant: 900, note: '空袭城市 ×0.9' },
  naval: { label: '水面', adjacent: 1000, distant: 1000, note: '沿岸攻城 ×1.0' },
  scout: { label: '侦察', adjacent: 600, distant: 600, note: '不擅攻城 ×0.6' },
};

export const ERA_SIEGE_TECH_MULTIPLIER = 1750;

/** Combined role × leader-window multiplier for attacking a city; null in legacy games. */
export function cityAssaultMultiplier(player: DoctrinePlayer | undefined, mode: EraProgression | undefined, gameplay: GameplayVersion | undefined,
  identity: UnitIdentity, content: Content, distance: number, siegeTech: boolean): number | null {
  if (mode === undefined || gameplay === undefined || identity.kind !== 'pokemon') return null;
  const role = content.species[identity.speciesId].role;
  const table = ROLE_CITY_ASSAULT[role];
  const base = role === 'siege' && siegeTech ? ERA_SIEGE_TECH_MULTIPLIER : distance <= 1 ? table.adjacent : table.distant;
  const doctrine = player ? doctrineEffects(player, mode, identity, content).cityDamageBonus : 0;
  return Math.floor(base * (1000 + doctrine) / 1000);
}

/**
 * Era-mode garrison recruits: researching a technology lets every city train one
 * regional species of a role the starter lines cannot fill. Games without a gameplay
 * pack keep the registered-species-only rule.
 */
export const ERA_TECH_RECRUITS: Readonly<Partial<Record<TechId, SpeciesId>>> = {
  domestication: 'rattata',
  stoneCraft: 'geodude',
  riding: 'ponyta',
  training: 'machop',
};

export function trainableSpeciesIds(player: { registeredSpeciesIds: readonly SpeciesId[]; research: { unlockedIds: readonly TechId[] } },
  gameplay: GameplayVersion | undefined): SpeciesId[] {
  const ids = new Set(player.registeredSpeciesIds);
  if (gameplay !== undefined) for (const [techId, speciesId] of Object.entries(ERA_TECH_RECRUITS) as [TechId, SpeciesId][]) {
    if (player.research.unlockedIds.includes(techId)) ids.add(speciesId);
  }
  return [...ids].sort();
}
