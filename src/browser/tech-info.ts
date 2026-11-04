// Player-facing description of what each technology does, shared by the research tree
// and the handbook. Rule effects that live in src/core are summarised here by hand;
// unlocked buildings, districts and recruits are derived from content.
import type { Content } from '../content/units.ts';
import { DISTRICTS, DISTRICT_IDS } from '../content/districts.ts';
import { BUILDINGS, TECHS } from '../content/economy.ts';
import type { TechId } from '../content/economy.ts';
import { SPECIES_NAMES } from '../content/species.ts';
import { ERA_SIEGE_TECH_MULTIPLIER, ERA_TECH_RECRUITS } from '../core/role-tactics.ts';

export const TECH_EFFECTS: Record<TechId, string> = {
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

export type TechUnlock = { kind: 'effect' | 'building' | 'district' | 'recruit'; text: string };
export function techUnlocks(id: TechId, content?: Content): TechUnlock[] {
  const recruit = (content?.roster?.techRecruits ?? ERA_TECH_RECRUITS)[id];
  return [
    { kind: 'effect', text: TECH_EFFECTS[id] },
    ...Object.values(BUILDINGS).filter(building => building.requiredTech === id).map(building => ({ kind: 'building' as const, text: `建筑「${building.name}」` })),
    ...DISTRICT_IDS.filter(district => DISTRICTS[district].requiredTech === id).map(district => ({ kind: 'district' as const, text: `设施区「${DISTRICTS[district].name}」` })),
    ...(recruit ? [{ kind: 'recruit' as const, text: `各城可招募${SPECIES_NAMES[recruit]}` }] : []),
  ];
}
export const TECH_TIERS = [1, 2, 3] as const;
export const techsInTier = (tier: number) => (Object.keys(TECHS) as TechId[]).filter(id => TECHS[id].tier === tier);
