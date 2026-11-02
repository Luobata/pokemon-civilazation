import type { EssenceId } from './essences.ts';
import type { TypeId } from './species.ts';

/**
 * Gameplay v5: era abilities. Each Pokémon generation the player reaches unlocks one ability.
 * Simple mode stops at generation 3 (day/night, then weather); full mode continues to generation 9.
 */
export type WeatherId = 'rain' | 'sun' | 'sand' | 'hail';
export type EraAbilityId = 'dayNight' | 'weather' | 'mega' | 'zMove' | 'dynamax' | 'tera';
export const ERA_ABILITIES: Record<EraAbilityId, { name: string; generation: number; era: string; description: string }> = {
  dayNight: { name: '昼夜与亲密度', generation: 2, era: '金银', description: '夜晚（每 4 轮中的后 2 轮）恶、幽灵系主动攻击 +15%（所有文明共享天象）；己方领地内的宝可梦每轮亲密度经验 +3。' },
  weather: { name: '天气', generation: 3, era: '宝石', description: '消耗 10 点对应精华，在己方城市周围 3 格召唤天气 3 轮：下雨水 +30%/火 −30%，大晴天火 +30%/水 −30%，沙暴岩石/地面/钢 +20%，冰雹冰 +30%。冷却 8 轮。' },
  mega: { name: 'Mega 进化', generation: 6, era: 'XY', description: '消耗 20 点本属性精华，让一只最终形态宝可梦 Mega 进化：造成伤害 +25%、受到伤害 −20%。同时只能有一只。' },
  zMove: { name: 'Z 招式', generation: 7, era: '日月', description: '消耗 10 点本属性精华，让一只宝可梦下一次主动攻击伤害 ×2。冷却 10 轮。' },
  dynamax: { name: '极巨化', generation: 8, era: '剑盾', description: '消耗 15 点本属性精华，3 轮内造成伤害 +30%（攻城 +50%）、受到伤害 −30%。冷却 12 轮。' },
  tera: { name: '太晶化', generation: 9, era: '朱紫', description: '消耗 20 点目标属性精华，把一只宝可梦的防守属性改为单一太晶属性；与自身攻击属性相同时伤害 +20%。同时只能有一只。' },
};
export const ERA_ABILITY_IDS = Object.keys(ERA_ABILITIES) as EraAbilityId[];
export const WEATHERS: Record<WeatherId, { name: string; mark: string; essence: EssenceId; color: string; boost: readonly TypeId[]; weaken: readonly TypeId[]; boostPermille: number }> = {
  rain: { name: '下雨', mark: '雨', essence: 'tide', color: '#4E86C2', boost: ['water'], weaken: ['fire'], boostPermille: 1300 },
  sun: { name: '大晴天', mark: '晴', essence: 'blaze', color: '#E39B3D', boost: ['fire'], weaken: ['water'], boostPermille: 1300 },
  sand: { name: '沙暴', mark: '沙', essence: 'earth', color: '#B8925A', boost: ['rock', 'ground', 'steel'], weaken: [], boostPermille: 1200 },
  hail: { name: '冰雹', mark: '雹', essence: 'mind', color: '#A9D4E6', boost: ['ice'], weaken: [], boostPermille: 1300 },
};
export const WEATHER_IDS = Object.keys(WEATHERS) as WeatherId[];
export const ERA_ABILITY_RULES = {
  nightAttack: 1150, friendshipXp: 3,
  weatherCost: 10, weatherRadius: 3, weatherRounds: 3, weatherCooldown: 8,
  megaCost: 20, megaAttack: 1250, megaDefense: 800,
  zCost: 10, zAttack: 2000, zCooldown: 10,
  dynamaxCost: 15, dynamaxRounds: 3, dynamaxAttack: 1300, dynamaxCity: 1500, dynamaxDefense: 700, dynamaxCooldown: 12,
  teraCost: 20, teraStab: 1200,
} as const;
/** Day for two rounds, night for two. */
export const isNight = (round: number) => Math.floor((round - 1) / 2) % 2 === 1;
