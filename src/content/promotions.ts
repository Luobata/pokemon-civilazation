/** Gameplay v13: battle merit and trait promotions (Civilization unit promotions). */
export type PromotionTrait = 'breacher' | 'assault' | 'bulwark' | 'swift' | 'regenerate';
export const PROMOTION_TRAITS: Record<PromotionTrait, { name: string; summary: string }> = {
  breacher: { name: '破城', summary: '攻击城市伤害 +25%' },
  assault: { name: '猛攻', summary: '主动攻击宝可梦伤害 +15%' },
  bulwark: { name: '坚守', summary: '受到宝可梦的伤害 −15%（被攻击和吃反击）' },
  swift: { name: '疾行', summary: '移动力 +1' },
  regenerate: { name: '再生', summary: '每轮额外恢复 5 HP，在哪里都生效' },
};
export const PROMOTION_TRAIT_IDS = Object.keys(PROMOTION_TRAITS) as PromotionTrait[];
export const PROMOTION_RULES = {
  merit: { attack: 2, counter: 1, knockdown: 3, cityCaptured: 3 },
  /** Merit needed for the 1st, 2nd and 3rd promotion. */
  thresholds: [6, 14, 24],
  /** Permille multipliers. */
  breacherCityDamage: 1250, assaultDamage: 1150, bulwarkDamageTaken: 850,
  swiftMovement: 1, regenerateHealing: 5,
} as const;
