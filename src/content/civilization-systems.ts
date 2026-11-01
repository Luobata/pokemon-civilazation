import { EXPANSION_CONTENT } from './units.ts';
import type { Content } from './units.ts';
import type { SpeciesId } from './species.ts';

export type PhantomCategory = 'scientist' | 'engineer' | 'merchant' | 'general' | 'artist';
export type OfferingResource = 'food' | 'gold';
export type SanctuaryContent = {
  id: string;
  name: string;
  tabletId: string;
  tabletName: string;
  guardianName: string;
  guardianSpeciesId: SpeciesId;
  challengePower: number;
};
export type PhantomContent = {
  id: PhantomCategory;
  name: string;
  names: readonly string[];
  summonCost: number;
  description: string;
};

export type CivilizationContent = {
  version: string;
  world: Content;
  offering: {
    foodCost: number;
    goldCost: number;
    points: number;
  };
  phantoms: {
    firstSummonCost: number;
    summonCostStep: number;
    researchBonus: number;
    productionBonus: number;
    goldBonus: number;
    experienceBonus: number;
    foodBonus: number;
    maximumGeneralUnits: number;
    definitions: readonly PhantomContent[];
  };
  sanctuaries: {
    establishmentCost: number;
    maximumChallengeUnits: number;
    definitions: readonly SanctuaryContent[];
  };
  championship: {
    firstSeasonRound: number;
    intervalRounds: number;
    entrantCount: number;
    teamSize: number;
    npcBasePower: number;
    npcSeasonPower: number;
    npcSlotPower: number;
    titlesNeededForVictory: number;
  };
  diplomacy: {
    proposalExpiryRounds: number;
    rejectionCooldownRounds: number;
    tradeIncome: number;
    tradeIntervalRounds: number;
    trustStep: number;
    maximumTrust: number;
    betrayalGoldCost: number;
    betrayalTrust: number;
    betrayalCooldownRounds: number;
  };
};

export const CIVILIZATION_CONTENT: CivilizationContent = {
  version: 'civilization-v1',
  world: EXPANSION_CONTENT,
  offering: { foodCost: 10, goldCost: 20, points: 5 },
  phantoms: {
    firstSummonCost: 30,
    summonCostStep: 15,
    researchBonus: 40,
    productionBonus: 40,
    goldBonus: 60,
    experienceBonus: 20,
    foodBonus: 40,
    maximumGeneralUnits: 6,
    definitions: [
      { id: 'scientist', name: '科学家幻影', names: ['尼尔森', '艾琳', '索菲亚', '居里'], summonCost: 0, description: '当前研究 +40。' },
      { id: 'engineer', name: '工程师幻影', names: ['布朗', '林登', '梅卡', '伊桑'], summonCost: 0, description: '指定城市下一次生产结算 +40。' },
      { id: 'merchant', name: '商人幻影', names: ['奥黛丽', '哈桑', '维塔', '马可'], summonCost: 0, description: '获得 60 金币。' },
      { id: 'general', name: '将军幻影', names: ['凯撒琳', '渡边', '巴顿娜', '雅典娜'], summonCost: 0, description: '至多 6 只宝可梦各 +20 经验。' },
      { id: 'artist', name: '大艺术家幻影', names: ['米娅', '卡拉瓦', '织姬', '阿黛尔'], summonCost: 0, description: '指定城市 +40 食物。' },
    ],
  },
  sanctuaries: {
    establishmentCost: 80,
    maximumChallengeUnits: 3,
    definitions: [
      { id: 'lake-shrine', name: '湖畔圣所', tabletId: 'lake-tablet', tabletName: '湖泊石板', guardianName: '深渊守卫', guardianSpeciesId: 'lapras', challengePower: 620 },
      { id: 'sky-shrine', name: '天空圣所', tabletId: 'sky-tablet', tabletName: '天空石板', guardianName: '苍穹守卫', guardianSpeciesId: 'dragonite', challengePower: 700 },
      { id: 'spirit-shrine', name: '灵界圣所', tabletId: 'spirit-tablet', tabletName: '灵界石板', guardianName: '幽影守卫', guardianSpeciesId: 'gengar', challengePower: 780 },
      { id: 'strength-shrine', name: '斗技圣所', tabletId: 'strength-tablet', tabletName: '斗技石板', guardianName: '山岳守卫', guardianSpeciesId: 'machamp', challengePower: 860 },
    ],
  },
  championship: {
    firstSeasonRound: 40,
    intervalRounds: 20,
    entrantCount: 6,
    teamSize: 6,
    npcBasePower: 850,
    npcSeasonPower: 15,
    npcSlotPower: 10,
    titlesNeededForVictory: 2,
  },
  diplomacy: {
    proposalExpiryRounds: 5,
    rejectionCooldownRounds: 10,
    tradeIncome: 4,
    tradeIntervalRounds: 5,
    trustStep: 1,
    maximumTrust: 100,
    betrayalGoldCost: 20,
    betrayalTrust: -50,
    betrayalCooldownRounds: 10,
  },
};
