import type { BiomeId } from './rules.ts';
import type { TechId, Yield } from './economy.ts';
import type { TypeId } from './species.ts';

export type ImprovementId = 'berryFarm' | 'mine' | 'fishery' | 'observatoryCamp';
export type ImprovementDefinition = {
  name: string; mark: string; biomes: readonly BiomeId[];
  base: Yield; boostTech: TechId; boost: Yield;
  /** Species of these types are the matching work crew and build faster. */
  crewTypes: readonly TypeId[];
  description: string;
};
const y = (food = 0, production = 0, gold = 0, research = 0): Yield => ({ food, production, gold, research });

export const IMPROVEMENTS: Record<ImprovementId, ImprovementDefinition> = {
  berryFarm: { name: '树果田', mark: '田', biomes: ['grassland', 'forest'], base: y(1), boostTech: 'berryCultivation', boost: y(1),
    crewTypes: ['grass', 'bug', 'fairy'], description: '草原/森林：食物 +1，研究树果培育后再 +1。草、虫、妖精系是熟练工。' },
  mine: { name: '矿坑', mark: '矿', biomes: ['mountain', 'desert', 'volcano'], base: y(0, 1), boostTech: 'stoneCraft', boost: y(0, 1),
    crewTypes: ['rock', 'ground', 'fighting', 'steel'], description: '山地/荒漠/火山：生产 +1，研究碎石工艺后再 +1。岩石、地面、格斗、钢系是熟练工。' },
  fishery: { name: '渔场', mark: '渔', biomes: ['ocean'], base: y(1, 0, 1), boostTech: 'domestication', boost: y(0, 0, 1),
    crewTypes: ['water', 'ice'], description: '近岸海洋（站在相邻陆地即可施工）：食物 +1、金币 +1，研究驯化后金币再 +1。水、冰系是熟练工。' },
  observatoryCamp: { name: '观测站', mark: '站', biomes: ['snow', 'mountain', 'volcano'], base: y(0, 0, 0, 1), boostTech: 'fieldObservation', boost: y(0, 0, 0, 1),
    crewTypes: ['psychic', 'electric', 'ice'], description: '雪原/山地/火山：科研 +1，研究野外观察后再 +1。超能、电、冰系是熟练工。' },
};
export const IMPROVEMENT_IDS = Object.keys(IMPROVEMENTS) as ImprovementId[];
/** Work points per action: matching crew 2, any other Pokémon 1. Three points complete an improvement. */
export const IMPROVEMENT_WORK = { required: 3, crew: 2, other: 1 } as const;
