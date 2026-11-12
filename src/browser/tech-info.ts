// Player-facing description of what each technology does, shared by the research tree
// and the handbook. Rule effects that live in src/core are summarised here by hand;
// unlocked buildings, districts and recruits are derived from content.
import { CLASS_NAMES, classHms } from '../content/unit-classes.ts';
import type { UnitClass } from '../content/unit-classes.ts';
import type { Content } from '../content/units.ts';
import { DISTRICTS, DISTRICT_IDS, districtTech } from '../content/districts.ts';
import { BUILDINGS, TECHS } from '../content/economy.ts';
import type { LegacyTechId, TechId } from '../content/economy.ts';
import { TREE_RULES } from '../content/tech-tree.ts';
import type { TreeTechId } from '../content/tech-tree.ts';
import { BUILDER_RULES } from '../content/roles.ts';
import { SPECIES_NAMES } from '../content/species.ts';
import { IMPROVEMENTS, IMPROVEMENT_IDS_V23 } from '../content/improvements.ts';
import { EMBARK_TECHS } from '../content/terrain.ts';
import { ERA_SIEGE_TECH_MULTIPLIER, ERA_TECH_RECRUITS } from '../core/role-tactics.ts';

export const TECH_EFFECTS: Record<LegacyTechId, string> = {
  domestication: '可购买精灵球并捕捉；渔场 +1 金币',
  berryCultivation: '树果田 +1 食物',
  stoneCraft: '矿坑 +1 生产',
  ballCraft: '可购买超级球（捕捉率 ×1.5）',
  typeResearch: '效果拔群从 ×2 提升为 ×2.2',
  riding: '可训练快速型宝可梦',
  fieldObservation: '捕捉成功率 +10；观测站 +1 科研',
  medicine: '领地内每轮恢复从 5 提升到 10 HP',
  training: '战斗经验 ×1.25；可进行第二段进化；可招募领袖专属宝可梦',
  siegeCraft: `攻城型攻击城市倍率提升到 ×${ERA_SIEGE_TECH_MULTIPLIER / 1000}`,
  leagueRules: '计分 ×1.2；停战后冷却从 10 轮缩短到 5 轮',
  meteorology: '雪原、火山可耕作，并各 +1 科研',
};

/**
 * v22 tree: rule effects of the new technologies, and of older ones whose v22 role changed. Buildings, districts, HMs
 * and recruits are derived from content below; an empty text means the tech only unlocks those.
 */
export const TREE_TECH_EFFECTS: Record<TreeTechId, string> & Partial<Record<LegacyTechId, string>> = {
  typeResearch: '效果拔群从 ×2 提升为 ×2.2；可建造属性道馆',
  seafaring: '', masonry: '', commerce: '可在有友好商店的城市训练商队',
  lureCraft: '捕捉成功率 +10',
  electricity: '', contestArts: '可建造华丽大赛会馆', aviation: '', laboratory: '',
  urbanPlanning: `新训练的工匠可建 ${BUILDER_RULES.charges + TREE_RULES.builderExtraCharges} 处改良（原来 ${BUILDER_RULES.charges}）`,
  oceanography: '', eliteTraining: '城市可训练最终形态宝可梦（仍需对应徽章）；新训练宝可梦经验 +10',
  breeding: '', cartography: '城市视野 +1', legendLore: '每座城市科研 +1', steelworks: '每座城市生产 +1',
  masterBallTheory: '捕捉成功率 +15；精灵球、超级球每个便宜 10 金',
  dragonLore: '', championLeague: `计分再 ×${TREE_RULES.championScorePermille / 1000}（与联盟规章叠乘）`,
};
const effectText = (id: TechId, tree: boolean): string => (tree ? TREE_TECH_EFFECTS[id as TreeTechId] : undefined) ?? TECH_EFFECTS[id as LegacyTechId] ?? '';

export type TechUnlock = { kind: 'effect' | 'building' | 'district' | 'recruit' | 'class' | 'improvement'; text: string };
export function techUnlocks(id: TechId, content?: Content, gameplayVersion?: number): TechUnlock[] {
  const tree = Boolean(content?.techTree);
  const hm = (gameplayVersion ?? 0) >= 19 ? (Object.entries(classHms(content ?? {})) as [UnitClass, { hm: string; techId: TechId }][]).find(([, item]) => item.techId === id) : undefined;
  const recruit = (content?.roster?.techRecruits ?? ERA_TECH_RECRUITS)[id];
  const effect = effectText(id, tree);
  return [
    ...(effect ? [{ kind: 'effect' as const, text: effect }] : []),
    ...Object.values(content?.buildings ?? BUILDINGS).filter(building => building.requiredTech === id).map(building => ({ kind: 'building' as const, text: `建筑「${building.name}」` })),
    ...DISTRICT_IDS.filter(district => districtTech(district, tree) === id).map(district => ({ kind: 'district' as const, text: `设施区「${DISTRICTS[district].name}」` })),
    ...(hm ? [{ kind: 'class' as const, text: `学会秘传「${hm[1].hm}」：可训练${CLASS_NAMES[hm[0]]}宝可梦` }] : []),
    ...(recruit ? [{ kind: 'recruit' as const, text: `各城可招募${SPECIES_NAMES[recruit]}` }] : []),
    // v24 A2: the two water-access technologies (from content.embark).
    ...(content?.embark && id === EMBARK_TECHS.shallow ? [{ kind: 'effect' as const, text: '乘浪：陆地单位可下浅海与湖（下水 / 上岸结束移动，防守 −10，不能攻击）' }] : []),
    ...(content?.embark && id === EMBARK_TECHS.deep ? [{ kind: 'effect' as const, text: '远洋冲浪：陆地单位可下深海' }] : []),
    // v23: improvements that need this technology, and the new improvements it boosts.
    ...(content?.resourceImprovements ? IMPROVEMENT_IDS_V23.filter(kind => IMPROVEMENTS[kind].requiredTech === id).map(kind => ({ kind: 'improvement' as const, text: `可建改良「${IMPROVEMENTS[kind].name}」` })) : []),
    ...(content?.resourceImprovements ? IMPROVEMENT_IDS_V23.filter(kind => IMPROVEMENTS[kind].requiredTech && IMPROVEMENTS[kind].boostTech === id)
      .map(kind => ({ kind: 'improvement' as const, text: `${IMPROVEMENTS[kind].name}再加${Object.entries(IMPROVEMENTS[kind].boost!).filter(([, v]) => v > 0).map(([k, v]) => `${({ food: '食物', production: '生产', gold: '金币', research: '科研' } as const)[k as 'food']} +${v}`).join('、')}` })) : []),
  ];
}
export const TECH_TIERS = [1, 2, 3] as const;
export const techsInTier = (tier: number) => (Object.keys(TECHS) as LegacyTechId[]).filter(id => TECHS[id].tier === tier);
