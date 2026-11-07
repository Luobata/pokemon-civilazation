import type { DoctrinePhase, EraProgression, EraState } from '../content/eras.ts';
import { eraState } from '../content/eras.ts';
import type { LeaderId } from '../content/leaders.ts';
import type { TypeId } from '../content/species.ts';
import type { Content, UnitIdentity } from '../content/units.ts';
import type { PlayerState } from './model.ts';

export type DoctrineEffects = {
  researchBonus: number;
  movementBonus: number;
  trainedXpBonus: number;
  territoryHealingBonus: number;
  fieldHealing: number;
  /** Permille added to city damage for favored units in this window. */
  cityDamageBonus: number;
};

export type UnitRole = 'ranged' | 'melee' | 'scout' | 'fast' | 'siege' | 'naval' | 'air';

export type DoctrineDefinition = DoctrineEffects & {
  phase: DoctrinePhase;
  description: string;
  favoredRoles: readonly UnitRole[];
  favoredTypes: readonly TypeId[];
};

export type LeaderDoctrine = Record<DoctrinePhase, DoctrineDefinition>;

export type DoctrinePlayer = {
  leaderId?: PlayerState['leaderId'];
  research: Pick<PlayerState['research'], 'unlockedIds' | 'tree'>;
};

const NO_EFFECTS: Readonly<DoctrineEffects> = {
  researchBonus: 0,
  movementBonus: 0,
  trainedXpBonus: 0,
  territoryHealingBonus: 0,
  fieldHealing: 0,
  cityDamageBonus: 0,
};

const noEffects = (phase: DoctrinePhase, description: string): DoctrineDefinition => ({
  ...NO_EFFECTS,
  phase,
  description,
  favoredRoles: [],
  favoredTypes: [],
});

export const LEADER_DOCTRINES: Record<LeaderId, LeaderDoctrine> = {
  oak: {
    early: {
      ...NO_EFFECTS,
      phase: 'early',
      researchBonus: 1,
      movementBonus: 1,
      description: '早中期科研起步：每城科研 +1，侦察兵移动力 +1。',
      favoredRoles: ['scout'],
      favoredTypes: [],
    },
    middle: {
      ...NO_EFFECTS,
      phase: 'middle',
      trainedXpBonus: 15,
      description: '研究所成果转化：远程与侦察兵训练经验 +15。',
      favoredRoles: ['ranged', 'scout'],
      favoredTypes: [],
    },
    late: noEffects('late', '科研体系成熟后，早期侦察优势让位给常规军队。'),
  },
  lance: {
    early: noEffects('early', '龙系军团仍在集结，尚未形成机动优势。'),
    middle: {
      ...NO_EFFECTS,
      phase: 'middle',
      movementBonus: 1,
      trainedXpBonus: 15,
      description: '快速压制：快速、飞行或龙系宝可梦移动力 +1、训练经验 +15。',
      favoredRoles: ['fast', 'air'],
      favoredTypes: ['dragon'],
    },
    late: {
      ...NO_EFFECTS,
      phase: 'late',
      movementBonus: 1,
      trainedXpBonus: 25,
      cityDamageBonus: 150,
      description: '终盘突击：快速、飞行或龙系宝可梦移动力 +1、训练经验 +25、攻击城市 +15%。',
      favoredRoles: ['fast', 'air'],
      favoredTypes: ['dragon'],
    },
  },
  jenny: {
    early: {
      ...NO_EFFECTS,
      phase: 'early',
      trainedXpBonus: 10,
      territoryHealingBonus: 2,
      description: '边境防线：近战与攻城兵种训练经验 +10，领地内恢复 +2。',
      favoredRoles: ['melee', 'siege'],
      favoredTypes: [],
    },
    middle: {
      ...NO_EFFECTS,
      phase: 'middle',
      cityDamageBonus: 200,
      trainedXpBonus: 10,
      description: '警备队破门：攻城兵种攻击城市 +20%、训练经验 +10。',
      favoredRoles: ['siege'],
      favoredTypes: [],
    },
    late: {
      ...NO_EFFECTS,
      phase: 'late',
      cityDamageBonus: 200,
      description: '全面突入：近战与攻城兵种攻击城市 +20%。',
      favoredRoles: ['melee', 'siege'],
      favoredTypes: [],
    },
  },
  joy: {
    early: noEffects('early', '野外护理车队尚未成形，早期仍依赖领地恢复。'),
    middle: {
      ...NO_EFFECTS,
      phase: 'middle',
      fieldHealing: 4,
      description: '远征护理：草、水或妖精系宝可梦可在领地外恢复 4 HP。',
      favoredRoles: [],
      favoredTypes: ['grass', 'water', 'fairy'],
    },
    late: {
      ...NO_EFFECTS,
      phase: 'late',
      fieldHealing: 6,
      description: '深度远征：草、水或妖精系宝可梦可在领地外恢复 6 HP。',
      favoredRoles: [],
      favoredTypes: ['grass', 'water', 'fairy'],
    },
  },
} as Partial<Record<LeaderId, LeaderDoctrine>> as Record<LeaderId, LeaderDoctrine>;


LEADER_DOCTRINES.brock = {
  early: { ...NO_EFFECTS, phase: 'early', trainedXpBonus: 15, territoryHealingBonus: 2,
    description: '开疆筑城：岩石、地面系训练经验 +15、领地内恢复 +2。', favoredRoles: [], favoredTypes: ['rock', 'ground'] },
  middle: { ...NO_EFFECTS, phase: 'middle', cityDamageBonus: 150,
    description: '岩崩攻势：攻城兵种攻击城市 +15%。', favoredRoles: ['siege'], favoredTypes: [] },
  late: noEffects('late', '城池已稳，后期依靠前期积累的建设与人口。'),
};
LEADER_DOCTRINES.misty = {
  early: { ...NO_EFFECTS, phase: 'early', movementBonus: 1, fieldHealing: 3,
    description: '激流开局：水系与水面宝可梦移动力 +1、野外恢复 3 HP。', favoredRoles: ['naval'], favoredTypes: ['water'] },
  middle: { ...NO_EFFECTS, phase: 'middle', trainedXpBonus: 15,
    description: '水系特训：水、冰系训练经验 +15。', favoredRoles: [], favoredTypes: ['water', 'ice'] },
  late: noEffects('late', '海域已定，后期优势让位给陆上强国。'),
};
LEADER_DOCTRINES.steven = {
  early: noEffects('early', '还在各地寻找石头，早期没有额外效果。'),
  middle: { ...NO_EFFECTS, phase: 'middle', trainedXpBonus: 15,
    description: '钢铁收藏：钢、岩石系训练经验 +15。', favoredRoles: [], favoredTypes: ['steel', 'rock'] },
  late: { ...NO_EFFECTS, phase: 'late', trainedXpBonus: 25, cityDamageBonus: 200, territoryHealingBonus: 3,
    description: '冠军之力：钢、岩石、龙系训练经验 +25、攻击城市 +20%、领地恢复 +3。', favoredRoles: [], favoredTypes: ['steel', 'rock', 'dragon'] },
};
LEADER_DOCTRINES.jasmine = {
  early: noEffects('early', '灯塔仍在修缮，早期依靠贸易被动。'),
  middle: { ...NO_EFFECTS, phase: 'middle', researchBonus: 1, territoryHealingBonus: 3,
    description: '灯塔航路：每城科研 +1，领地内恢复 +3。', favoredRoles: [], favoredTypes: ['steel', 'electric'] },
  late: { ...NO_EFFECTS, phase: 'late', trainedXpBonus: 20, territoryHealingBonus: 4,
    description: '钢之守护：钢、电系训练经验 +20，领地内恢复 +4。', favoredRoles: [], favoredTypes: ['steel', 'electric'] },
};
LEADER_DOCTRINES.giovanni = {
  early: { ...NO_EFFECTS, phase: 'early', movementBonus: 1,
    description: '组织扩张：侦察与快速宝可梦移动力 +1，便于搜捕。', favoredRoles: ['scout', 'fast'], favoredTypes: [] },
  middle: { ...NO_EFFECTS, phase: 'middle', trainedXpBonus: 20, cityDamageBonus: 150,
    description: '地面压制：地面、毒、恶系训练经验 +20、攻击城市 +15%。', favoredRoles: [], favoredTypes: ['ground', 'poison', 'dark'] },
  late: noEffects('late', '组织已膨胀，后期没有额外窗口。'),
};

function addEffects(base: DoctrineEffects, addition: Partial<DoctrineEffects>): DoctrineEffects {
  return {
    researchBonus: base.researchBonus + (addition.researchBonus ?? 0),
    movementBonus: base.movementBonus + (addition.movementBonus ?? 0),
    trainedXpBonus: base.trainedXpBonus + (addition.trainedXpBonus ?? 0),
    territoryHealingBonus: base.territoryHealingBonus + (addition.territoryHealingBonus ?? 0),
    fieldHealing: base.fieldHealing + (addition.fieldHealing ?? 0),
    cityDamageBonus: base.cityDamageBonus + (addition.cityDamageBonus ?? 0),
  };
}

function matchesDoctrine(
  identity: UnitIdentity,
  content: Content,
  definition: DoctrineDefinition,
): boolean {
  if (identity.kind !== 'pokemon') return false;
  const species = content.species[identity.speciesId];
  if (!species) return false;
  return definition.favoredRoles.includes(species.role)
    || definition.favoredTypes.includes(species.typeId)
    || (species.secondaryTypeId !== undefined && definition.favoredTypes.includes(species.secondaryTypeId));
}

export function doctrineEffects(
  player: DoctrinePlayer,
  mode?: EraProgression,
  identity?: UnitIdentity,
  content?: Content,
): DoctrineEffects {
  const state = eraState(player, mode);
  if (state === null || player.leaderId === undefined) return { ...NO_EFFECTS };
  const definition = LEADER_DOCTRINES[player.leaderId][state.phase];
  const unconditional: Partial<DoctrineEffects> = {
    researchBonus: definition.researchBonus,
  };
  if (identity === undefined || content === undefined || !matchesDoctrine(identity, content, definition)) return addEffects({ ...NO_EFFECTS }, unconditional);
  return addEffects({ ...NO_EFFECTS }, definition);
}

export function activeDoctrine(player: DoctrinePlayer, mode?: EraProgression): { state: EraState; definition: DoctrineDefinition } | null {
  const state = eraState(player, mode);
  if (state === null || player.leaderId === undefined) return null;
  return { state, definition: LEADER_DOCTRINES[player.leaderId][state.phase] };
}

export function isDoctrineTarget(
  identity: UnitIdentity,
  content: Content,
  definition: DoctrineDefinition,
): boolean {
  return matchesDoctrine(identity, content, definition);
}
