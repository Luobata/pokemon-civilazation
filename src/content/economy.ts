import type { BiomeId } from './rules.ts';
import { TREE_TECHS } from './tech-tree.ts';
import type { TechLine, TreeTechDefinition, TreeTechId } from './tech-tree.ts';

export type Yield = { food: number; production: number; gold: number; research: number };
const yields = (food = 0, production = 0, gold = 0, research = 0): Yield => ({ food, production, gold, research });
export const BIOME_YIELDS: Record<BiomeId, Yield> = {
  grassland: yields(2, 1), forest: yields(1, 2), mountain: yields(0, 2, 0, 1),
  ocean: yields(2, 0, 1), desert: yields(0, 1, 1), snow: yields(1, 0, 0, 1), volcano: yields(0, 2, 0, 2),
};
export type LegacyTechId =
  | 'domestication' | 'berryCultivation' | 'stoneCraft' | 'ballCraft' | 'typeResearch' | 'riding'
  | 'fieldObservation' | 'medicine' | 'training' | 'siegeCraft' | 'leagueRules' | 'meteorology';
export type TechId = LegacyTechId | TreeTechId;
export type TechDefinition = { name: string; tier: number; cost: number; requires: readonly TechId[]; line: TechLine };
export type TechTable = Record<TechId, TreeTechDefinition>;
export const TECHS: TechTable = TREE_TECHS;
export type BuildingId = 'headquarters' | 'pasture' | 'workshop' | 'meetingHall' | 'observatory' | 'trainingGround';
export type BuildingDef = { name: string; cost: number | null; yields: Yield; trainedXp: number; requiredTech?: TechId };
export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  headquarters: { name: '联盟总部', cost: null, yields: yields(), trainedXp: 0 },
  pasture: { name: '树果园', cost: 30, yields: yields(2), trainedXp: 0, requiredTech: 'berryCultivation' },
  workshop: { name: '精灵球工坊', cost: 40, yields: yields(0, 2), trainedXp: 0, requiredTech: 'masonry' },
  meetingHall: { name: '友好商店', cost: 40, yields: yields(0, 0, 2), trainedXp: 0, requiredTech: 'commerce' },
  observatory: { name: '宝可梦研究所', cost: 50, yields: yields(0, 0, 0, 2), trainedXp: 0, requiredTech: 'laboratory' },
  trainingGround: { name: '宝可梦中心', cost: 60, yields: yields(), trainedXp: 20, requiredTech: 'medicine' },
};
export const BALLS = {
  pokeBall: { name: '精灵球', goldCost: 20, requiredTech: 'domestication' },
  greatBall: { name: '超级球', goldCost: 45, requiredTech: 'ballCraft' },
} as const;
export type BallId = keyof typeof BALLS;
