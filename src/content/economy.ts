import type { BiomeId } from './rules.ts';
import type { TechLine, TreeTechId } from './tech-tree.ts';

export type Yield = { food: number; production: number; gold: number; research: number };
const yields = (food = 0, production = 0, gold = 0, research = 0): Yield => ({ food, production, gold, research });
export const BIOME_YIELDS: Record<BiomeId, Yield> = {
  grassland: yields(2, 1), forest: yields(1, 2), mountain: yields(0, 2, 0, 1),
  ocean: yields(2, 0, 1), desert: yields(0, 1, 1), snow: yields(1, 0, 0, 1), volcano: yields(0, 2, 0, 2),
};
export const TECHS = {
  domestication: { name: '驯化', tier: 1, cost: 20 },
  berryCultivation: { name: '树果培育', tier: 1, cost: 20 },
  stoneCraft: { name: '碎石工艺', tier: 1, cost: 20 },
  ballCraft: { name: '精灵球工艺', tier: 2, cost: 40 },
  typeResearch: { name: '属性研究', tier: 2, cost: 40 },
  riding: { name: '骑行驯服', tier: 2, cost: 40 },
  fieldObservation: { name: '野外观察', tier: 2, cost: 40 },
  medicine: { name: '伤药调配', tier: 3, cost: 70 },
  training: { name: '特训法', tier: 3, cost: 70 },
  siegeCraft: { name: '投石改装', tier: 3, cost: 70 },
  leagueRules: { name: '联盟规章', tier: 3, cost: 70 },
  meteorology: { name: '气象观测', tier: 3, cost: 70 },
} as const;
/** The 12 technologies of every content before v22 (their tables keep exactly these keys). */
export type LegacyTechId = keyof typeof TECHS;
/** v22 adds 18 more on its tree (src/content/tech-tree.ts); older contents simply have no entry for them. */
export type TechId = LegacyTechId | TreeTechId;
/** `requires` / `line` only exist on the v22 tree; older contents use the tier rule. */
export type TechDefinition = { name: string; tier: number; cost: number; requires?: readonly TechId[]; line?: TechLine };
export type TechTable = { readonly [K in LegacyTechId]: TechDefinition } & { readonly [K in TreeTechId]?: TechDefinition };
export type BuildingId = 'headquarters' | 'pasture' | 'workshop' | 'meetingHall' | 'observatory' | 'trainingGround';
export type BuildingDef = { name: string; cost: number | null; yields: Yield; trainedXp: number; requiredTech?: TechId };
export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  headquarters: { name: '联盟总部', cost: null, yields: yields(), trainedXp: 0 },
  pasture: { name: '树果园', cost: 30, yields: yields(2), trainedXp: 0, requiredTech: 'berryCultivation' },
  workshop: { name: '精灵球工坊', cost: 40, yields: yields(0, 2), trainedXp: 0, requiredTech: 'stoneCraft' },
  meetingHall: { name: '友好商店', cost: 40, yields: yields(0, 0, 2), trainedXp: 0 },
  observatory: { name: '宝可梦研究所', cost: 50, yields: yields(0, 0, 0, 2), trainedXp: 0 },
  trainingGround: { name: '宝可梦中心', cost: 60, yields: yields(), trainedXp: 20 },
};
export const BALLS = {
  pokeBall: { name: '精灵球', goldCost: 20, requiredTech: 'domestication' },
  greatBall: { name: '超级球', goldCost: 45, requiredTech: 'ballCraft' },
} as const;
export type BallId = keyof typeof BALLS;
