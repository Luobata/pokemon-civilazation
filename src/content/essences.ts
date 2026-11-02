import type { BiomeId } from './rules.ts';
import type { TypeId } from './species.ts';

/**
 * Gameplay v4: type essences. Each terrain yields one essence; 18 types are grouped into 7 essences.
 * Food / production / gold / research stay as the core economy; essences add city specialisation.
 */
export type EssenceId = 'life' | 'sylvan' | 'earth' | 'tide' | 'spark' | 'mind' | 'blaze';
export const ESSENCE_IDS: readonly EssenceId[] = ['life', 'sylvan', 'earth', 'tide', 'spark', 'mind', 'blaze'];
export const ESSENCES: Record<EssenceId, { name: string; mark: string; color: string; biome: BiomeId; types: readonly TypeId[] }> = {
  life: { name: '生机', mark: '生', color: '#B8C46A', biome: 'grassland', types: ['normal', 'flying'] },
  sylvan: { name: '森灵', mark: '森', color: '#5FA36A', biome: 'forest', types: ['grass', 'bug', 'poison'] },
  earth: { name: '大地', mark: '地', color: '#B98A55', biome: 'mountain', types: ['rock', 'ground', 'fighting'] },
  tide: { name: '潮汐', mark: '潮', color: '#5B9BD0', biome: 'ocean', types: ['water', 'ice'] },
  spark: { name: '雷金', mark: '雷', color: '#E3C34F', biome: 'desert', types: ['electric', 'steel'] },
  mind: { name: '灵识', mark: '灵', color: '#B58AD6', biome: 'snow', types: ['psychic', 'fairy', 'dragon'] },
  blaze: { name: '炎', mark: '炎', color: '#E07A4F', biome: 'volcano', types: ['fire', 'ghost', 'dark'] },
};
export const BIOME_ESSENCE: Record<BiomeId, EssenceId> = Object.fromEntries(ESSENCE_IDS.map(id => [ESSENCES[id].biome, id])) as Record<BiomeId, EssenceId>;
export const TYPE_ESSENCE: Record<TypeId, EssenceId> = Object.fromEntries(ESSENCE_IDS.flatMap(id => ESSENCES[id].types.map(type => [type, id]))) as Record<TypeId, EssenceId>;
export const ESSENCE_RULES = {
  /** Stock cap per essence; surplus is lost at settlement. */
  cap: 50,
  /** Each round, a Pokémon training order consumes this much matching essence for extra progress. */
  trainingSpend: 2, trainingBoost: 2, gymTrainingBoost: 4,
  gymEssenceCost: 15, gymGoldCost: 40, gymTrainedXp: 20, gymEssenceYield: 1,
  /** Defender on a terrain whose essence matches one of its types takes this permille damage. */
  homeDefense: 900,
} as const;
