import type { BiomeId } from './rules.ts';

/** Gameplay v7: rare berries (Civilization luxury resources). One deposit type per terrain. */
export type RareBerryId = 'liechi' | 'ganlon' | 'salac' | 'petaya' | 'apicot' | 'lansat';
export const RARE_BERRIES: Record<RareBerryId, { name: string; biome: BiomeId; mark: string }> = {
  liechi: { name: '枝荔果', biome: 'forest', mark: '荔' },
  ganlon: { name: '龙睛果', biome: 'mountain', mark: '龙' },
  salac: { name: '沙鳞果', biome: 'desert', mark: '沙' },
  petaya: { name: '龙火果', biome: 'grassland', mark: '火' },
  apicot: { name: '杏仔果', biome: 'snow', mark: '杏' },
  lansat: { name: '兰萨果', biome: 'ocean', mark: '兰' },
};
export const RARE_BERRY_IDS = Object.keys(RARE_BERRIES) as RareBerryId[];
export const RARE_BERRY_RULES = {
  /** Deposits per type, placed deterministically from the map seed (not the game RNG). */
  depositsPerType: 2,
  /** Per distinct owned type, every round. */
  /** Satisfaction decays 4/round; each kind offsets 2 of it, so 2+ kinds keep a civilization content. */
  satisfactionPerType: 2, bondPerType: 1,
  /** A gift of one surplus copy (the second or later of a kind) through an active trade. */
  giftTrust: 10, giftGold: 15, giftCooldown: 5,
  /** Owning 4 distinct kinds counts as a "festival": every city +1 food. */
  festivalTypes: 4,
} as const;
