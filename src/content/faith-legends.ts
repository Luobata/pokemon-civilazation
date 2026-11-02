import type { TypeId } from '../content/species.ts';

/** Gameplay v9: legend faiths (Civilization religions). Each founder picks one unclaimed legend and two tenets. */
export type LegendId = 'hooh' | 'lugia' | 'groudon' | 'kyogre' | 'rayquaza';
export type TenetId = 'pilgrims' | 'shrineFood' | 'shrineGold' | 'zealots' | 'missionaries' | 'harmony';
export const LEGENDS: Record<LegendId, { name: string; mark: string; color: string; types: readonly TypeId[]; blessing: string }> = {
  hooh: { name: '凤王', mark: '凤', color: '#E2793B', types: ['fire', 'flying'], blessing: '信仰城市的火、飞行系宝可梦恢复 +3' },
  lugia: { name: '洛奇亚', mark: '洛', color: '#7FA6D8', types: ['psychic', 'flying'], blessing: '信仰城市科研 +1' },
  groudon: { name: '固拉多', mark: '固', color: '#B4513C', types: ['ground', 'fire'], blessing: '信仰城市生产 +1' },
  kyogre: { name: '盖欧卡', mark: '盖', color: '#3C6EB4', types: ['water'], blessing: '信仰城市食物 +1' },
  rayquaza: { name: '烈空坐', mark: '烈', color: '#4E9A5A', types: ['dragon', 'flying'], blessing: '信仰城市羁绊每轮 +1' },
};
export const LEGEND_IDS = Object.keys(LEGENDS) as LegendId[];
export const TENETS: Record<TenetId, { name: string; description: string }> = {
  pilgrims: { name: '朝圣', description: '每座信仰己方传说的外国城市，每轮给创立者 +1 供奉点' },
  shrineFood: { name: '树果祭坛', description: '己方信仰城市食物 +1' },
  shrineGold: { name: '香火', description: '己方信仰城市金币 +1' },
  zealots: { name: '狂信', description: '己方宝可梦在信仰城市 3 格内主动攻击 +10%' },
  missionaries: { name: '传教士', description: '传播所需供奉点 −5，传播强度 +10' },
  harmony: { name: '和谐', description: '信仰城市满意度每轮额外 +1（文明整体），并且不会因羁绊归零脱离' },
};
export const TENET_IDS = Object.keys(TENETS) as TenetId[];
export const FAITH_RULES = {
  /** Lifetime offerings needed before founding. */
  foundLifetime: 25, foundCost: 20,
  /** Spreading: offering points spent on a target city within range of an owned city. */
  spreadCost: 20, spreadRange: 8, spreadPressure: 40,
  /** Passive pressure from each owned faithful city to cities within `passiveRange`, per round. */
  passiveRange: 4, passivePressure: 3,
  /** A city converts once pressure for a faith reaches this, and is held while it leads. */
  convertAt: 100, pressureCap: 150,
  /** Faith victory: the founding faith is the majority in every living civilization's capital... simplified to share of all cities. */
  winShare: 0.6, winMinimumCities: 6,
} as const;
