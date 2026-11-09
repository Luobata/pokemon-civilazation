import type { BiomeId } from './rules.ts';
import type { TechId, Yield } from './economy.ts';
import type { TypeId } from './species.ts';

/** The four improvements of gameplay v2–v22; v23 (docs/design/improvements-v23.md) adds three tile and three resource improvements. */
export type LegacyImprovementId = 'berryFarm' | 'mine' | 'fishery' | 'observatoryCamp';
export type ImprovementId = LegacyImprovementId | 'ranch' | 'honeyHive' | 'pearlBed' | 'berryGrove' | 'stoneQuarry' | 'plantation';
/** v23: the map resource a resource improvement develops (world berry bush / evolution-stone vein, or a rare-berry deposit). */
export type ImprovementResource = 'berry' | 'stone' | 'rare';
export type ImprovementDefinition = {
  name: string; mark: string; biomes: readonly BiomeId[];
  base: Yield;
  /** Absent for v23 resource improvements, which have no later boost. */
  boostTech?: TechId; boost?: Yield;
  /** Species of these types are the matching work crew and build faster (v≤17). */
  crewTypes: readonly TypeId[];
  /** v23 only: research needed before a builder may build it (the four legacy improvements need none). */
  requiredTech?: TechId;
  /** v23 only: builds only on a tile with this resource (any biome); every other improvement is barred from resource tiles. */
  resource?: ImprovementResource;
  description: string;
};
const y = (food = 0, production = 0, gold = 0, research = 0): Yield => ({ food, production, gold, research });
const ALL_BIOMES: readonly BiomeId[] = ['grassland', 'forest', 'mountain', 'desert', 'snow', 'volcano', 'ocean'];

export const IMPROVEMENTS: Record<ImprovementId, ImprovementDefinition> = {
  berryFarm: { name: '树果田', mark: '田', biomes: ['grassland', 'forest'], base: y(1), boostTech: 'berryCultivation', boost: y(1),
    crewTypes: ['grass', 'bug', 'fairy'], description: '草原/森林：食物 +1，研究树果培育后再 +1。草、虫、妖精系是熟练工。' },
  mine: { name: '矿坑', mark: '矿', biomes: ['mountain', 'desert', 'volcano'], base: y(0, 1), boostTech: 'stoneCraft', boost: y(0, 1),
    crewTypes: ['rock', 'ground', 'fighting', 'steel'], description: '山地/荒漠/火山：生产 +1，研究碎石工艺后再 +1。岩石、地面、格斗、钢系是熟练工。' },
  fishery: { name: '渔场', mark: '渔', biomes: ['ocean'], base: y(1, 0, 1), boostTech: 'domestication', boost: y(0, 0, 1),
    crewTypes: ['water', 'ice'], description: '近岸海洋（站在相邻陆地即可施工）：食物 +1、金币 +1，研究驯化后金币再 +1。水、冰系是熟练工。' },
  observatoryCamp: { name: '观测站', mark: '站', biomes: ['snow', 'mountain', 'volcano'], base: y(0, 0, 0, 1), boostTech: 'fieldObservation', boost: y(0, 0, 0, 1),
    crewTypes: ['psychic', 'electric', 'ice'], description: '雪原/山地/火山：科研 +1，研究野外观察后再 +1。超能、电、冰系是熟练工。' },
  ranch: { name: '牧场', mark: '牧', biomes: ['grassland'], base: y(0, 1), boostTech: 'breeding', boost: y(1), requiredTech: 'riding',
    crewTypes: ['normal', 'flying'], description: '草原：生产 +1（需骑行驯服），研究培育屋后食物再 +1。' },
  honeyHive: { name: '甜蜜蜂巢', mark: '蜜', biomes: ['forest'], base: y(1, 0, 1), boostTech: 'contestArts', boost: y(0, 0, 1), requiredTech: 'lureCraft',
    crewTypes: ['grass', 'bug', 'fairy'], description: '森林：食物 +1、金币 +1（需诱饵配方），研究华丽大赛后金币再 +1。' },
  pearlBed: { name: '珍珠贝场', mark: '珠', biomes: ['ocean'], base: y(0, 0, 2), boostTech: 'cartography', boost: y(0, 0, 0, 1), requiredTech: 'oceanography',
    crewTypes: ['water', 'ice'], description: '近岸海洋（站在相邻陆地施工）：金币 +2（需远洋航行），研究地图测绘后科研再 +1。' },
  berryGrove: { name: '树果林', mark: '林', biomes: ALL_BIOMES, base: y(1, 0, 1), requiredTech: 'berryCultivation', resource: 'berry',
    crewTypes: ['grass', 'bug', 'fairy'], description: '只建在树果丛上（需树果培育）：食物 +1、金币 +1；被耕作时这种树果算已开发，每种已开发的树果每轮满意度 +1。' },
  stoneQuarry: { name: '进化石矿场', mark: '石', biomes: ALL_BIOMES, base: y(0, 1), requiredTech: 'stoneCraft', resource: 'stone',
    crewTypes: ['rock', 'ground', 'fighting', 'steel'], description: '只建在进化石矿脉上（需碎石工艺）：生产 +1；建成时得到矿脉里的进化石，之后被耕作期间每 20 轮再得 1 颗。' },
  plantation: { name: '种植园', mark: '园', biomes: ALL_BIOMES, base: y(0, 0, 2), requiredTech: 'commerce', resource: 'rare',
    crewTypes: ['grass', 'bug', 'fairy'], description: '只建在稀有树果上（需以物易物）：金币 +2；被耕作时这种稀有树果算 2 份（多出的 1 份可赠送）。' },
};
/** v2–v22 improvement ids, in the order older AI and UI iterate them (unchanged). */
export const IMPROVEMENT_IDS: readonly LegacyImprovementId[] = ['berryFarm', 'mine', 'fishery', 'observatoryCamp'];
/** v23: the legacy four, the three tile improvements the user chose, then the three resource improvements. */
export const IMPROVEMENT_IDS_V23: readonly ImprovementId[] = [...IMPROVEMENT_IDS, 'ranch', 'honeyHive', 'pearlBed', 'berryGrove', 'stoneQuarry', 'plantation'];
/** Improvement ids a game of this version knows. */
export const improvementIdsFor = (source: { setup?: { gameplayVersion?: number }; gameplayVersion?: number }): readonly ImprovementId[] =>
  ((source.setup?.gameplayVersion ?? source.gameplayVersion) ?? 0) >= 23 ? IMPROVEMENT_IDS_V23 : IMPROVEMENT_IDS;
/** Resource improvement for each map resource (v23). */
export const RESOURCE_IMPROVEMENT: Record<ImprovementResource, ImprovementId> = { berry: 'berryGrove', stone: 'stoneQuarry', rare: 'plantation' };
/** Work points per action: matching crew 2, any other Pokémon 1. Three points complete an improvement. */
export const IMPROVEMENT_WORK = { required: 3, crew: 2, other: 1 } as const;

/** v23 numbers (integers only). */
export const IMPROVEMENT_RULES_V23 = {
  /** A worked, intact 进化石矿场 yields one more stone every this many rounds after it was built (or repaired). */
  quarryInterval: 20,
  /** Satisfaction per round for each distinct berry kind developed by a worked, intact 树果林. */
  groveSatisfactionPerKind: 1,
  /** A worked, intact 种植园 counts this many copies of its rare berry. */
  plantationCopies: 2,
  /** One-off pillage reward, by the improvement's main output. */
  pillage: { food: 15, production: 15, gold: 20, research: 15, fallbackGold: 15 },
  /** 开荒 (fire crew): production added to the nearest own city on each build. */
  clearingProduction: 10,
  /** 引水 (water/ice crew): ocean improvements may be built from this many tiles away. */
  irrigationReach: 2,
} as const;
/** What a pillaged improvement gives (v23). */
export const PILLAGE_REWARD: Record<ImprovementId, 'food' | 'production' | 'gold' | 'research'> = {
  berryFarm: 'food', berryGrove: 'food', ranch: 'food', honeyHive: 'food',
  mine: 'production', stoneQuarry: 'production',
  fishery: 'gold', pearlBed: 'gold', plantation: 'gold',
  observatoryCamp: 'research',
};

/** v23 builder escorts: the escort's primary type gives the builder a specialty recorded on every tile it builds. */
export type CrewSpecialty = 'garden' | 'mining' | 'irrigation' | 'observation' | 'herding' | 'clearing' | 'handy';
export const CREW_SPECIALTIES: Record<CrewSpecialty, { name: string; types: readonly TypeId[]; kinds: readonly ImprovementId[] | 'ocean' | 'all' | 'repair';
  bonus?: Partial<Yield>; label: string }> = {
  garden: { name: '园艺', types: ['grass', 'bug', 'fairy'], kinds: ['berryFarm', 'berryGrove', 'plantation', 'honeyHive'], bonus: { food: 1 }, label: '树果田、树果林、种植园、甜蜜蜂巢 食物 +1' },
  mining: { name: '开矿', types: ['rock', 'ground', 'fighting', 'steel'], kinds: ['mine', 'stoneQuarry'], bonus: { production: 1 }, label: '矿坑、进化石矿场 生产 +1' },
  irrigation: { name: '引水', types: ['water', 'ice'], kinds: 'ocean', bonus: { gold: 1 }, label: '海上改良 金币 +1，可隔 2 格施工' },
  observation: { name: '观测', types: ['psychic', 'electric'], kinds: ['observatoryCamp'], bonus: { research: 1 }, label: '观测站 科研 +1' },
  herding: { name: '牧养', types: ['normal', 'flying'], kinds: ['ranch'], bonus: { production: 1 }, label: '牧场 生产 +1' },
  clearing: { name: '开荒', types: ['fire'], kinds: 'all', label: '每建成一处改良，最近的己方城市生产 +10' },
  handy: { name: '巧手', types: ['poison', 'dark', 'ghost', 'dragon'], kinds: 'repair', label: '修复改良不占行动' },
};
export const CREW_SPECIALTY_IDS = Object.keys(CREW_SPECIALTIES) as CrewSpecialty[];
export const crewSpecialtyFor = (typeId: TypeId): CrewSpecialty => CREW_SPECIALTY_IDS.find(id => CREW_SPECIALTIES[id].types.includes(typeId))!;
