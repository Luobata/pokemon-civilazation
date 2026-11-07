import type { TechId, Yield } from './economy.ts';
import type { BiomeId } from './rules.ts';
import type { ImprovementId } from './improvements.ts';
import { TREE_DISTRICT_TECH } from './tech-tree.ts';

export type DistrictId = 'researchDistrict' | 'gymDistrict' | 'harborDistrict' | 'powerPlantDistrict' | 'gardenDistrict';
export type DistrictEffects = Yield & { trainedXp: number; bondPressure: number };
export type DistrictAdjacency = { id: string; label: string; effect: keyof DistrictEffects; perTile: number; cap: number;
  biomes?: readonly BiomeId[]; improvement?: ImprovementId; cityCenter?: true };
export type DistrictDefinition = { name: string; mark: string; requiredTech: TechId; cost: number;
  biomes: readonly BiomeId[]; coastal?: true; base: DistrictEffects; adjacency: readonly DistrictAdjacency[] };
export const emptyDistrictEffects = (): DistrictEffects => ({ food: 0, production: 0, gold: 0, research: 0, trainedXp: 0, bondPressure: 0 });
const land: readonly BiomeId[] = ['grassland', 'forest', 'mountain', 'desert', 'snow', 'volcano'];
export const DISTRICTS: Record<DistrictId, DistrictDefinition> = {
  researchDistrict: { name: '研究所区', mark: '研', requiredTech: 'fieldObservation', cost: 60, biomes: land,
    base: { ...emptyDistrictEffects(), research: 2 }, adjacency: [
      { id: 'terrain', label: '山地/雪原/火山', effect: 'research', perTile: 1, cap: 2, biomes: ['mountain', 'snow', 'volcano'] },
      { id: 'observatory', label: '已完成观测站', effect: 'research', perTile: 1, cap: 1, improvement: 'observatoryCamp' },
    ] },
  gymDistrict: { name: '道馆区', mark: '馆', requiredTech: 'training', cost: 70, biomes: land,
    base: { ...emptyDistrictEffects(), trainedXp: 20 }, adjacency: [
      { id: 'city', label: '城市中心', effect: 'trainedXp', perTile: 10, cap: 10, cityCenter: true },
      { id: 'mine', label: '已完成矿坑', effect: 'trainedXp', perTile: 10, cap: 20, improvement: 'mine' },
    ] },
  harborDistrict: { name: '港口', mark: '港', requiredTech: 'domestication', cost: 50, biomes: ['ocean'], coastal: true,
    base: { ...emptyDistrictEffects(), food: 1, gold: 1 }, adjacency: [
      { id: 'fishery', label: '已完成渔场', effect: 'gold', perTile: 1, cap: 2, improvement: 'fishery' },
      { id: 'terrain', label: '草原/森林', effect: 'food', perTile: 1, cap: 1, biomes: ['grassland', 'forest'] },
    ] },
  powerPlantDistrict: { name: '发电厂', mark: '电', requiredTech: 'typeResearch', cost: 60, biomes: ['mountain', 'desert', 'volcano'],
    base: { ...emptyDistrictEffects(), production: 2 }, adjacency: [
      { id: 'terrain', label: '荒漠/火山', effect: 'production', perTile: 1, cap: 2, biomes: ['desert', 'volcano'] },
      { id: 'mine', label: '已完成矿坑', effect: 'production', perTile: 1, cap: 2, improvement: 'mine' },
    ] },
  gardenDistrict: { name: '花园', mark: '园', requiredTech: 'berryCultivation', cost: 40, biomes: ['grassland', 'forest'],
    base: { ...emptyDistrictEffects(), food: 1, bondPressure: 1 }, adjacency: [
      { id: 'terrain', label: '草原/森林', effect: 'food', perTile: 1, cap: 2, biomes: ['grassland', 'forest'] },
      { id: 'berryFarm', label: '已完成树果田', effect: 'food', perTile: 1, cap: 1, improvement: 'berryFarm' },
    ] },
};
export const DISTRICT_IDS = (Object.keys(DISTRICTS) as DistrictId[]).sort();
/** The technology a district needs: v22's tree moves the harbour and the power plant onto their own technologies. */
export const districtTech = (id: DistrictId, tree: boolean): TechId => (tree ? TREE_DISTRICT_TECH[id] : undefined) ?? DISTRICTS[id].requiredTech;
