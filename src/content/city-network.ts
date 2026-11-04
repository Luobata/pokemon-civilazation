// Gameplay v17 "city network" (docs/design/city-network-v17.md): settler escorts, district-to-district adjacency,
// regional effects, type-city alliances and domestic trade routes.
import type { DistrictId } from './districts.ts';
import type { EssenceId } from './essences.ts';
import type { Yield } from './economy.ts';
import type { TypeId } from './species.ts';

export const CITY_NETWORK_RULES = {
  /** Regional effects and alliances reach own cities within this many tiles. */
  regionRadius: 6,
  /** Each regional source / alliance kind adds at most this much to one city. */
  regionalCap: 2, allianceCap: 2, complementCap: 2,
  /** Districts: +perAdjacent of their main output per adjacent district, up to cap. */
  districtAdjacencyCap: 2,
  /** 宝可梦中心 (trainingGround) heals own Pokémon near any own city that has one. */
  centreHealing: 3,
  trader: { cost: 35, building: 'meetingHall', maxRouteDistance: 14 },
  route: { destination: { food: 2, production: 1 } as Partial<Yield>, origin: { gold: 3 } as Partial<Yield> },
} as const;

/** Districts that radiate a yield to other own cities in range (Civilization's regional buildings). */
export const REGIONAL_DISTRICTS: Partial<Record<DistrictId, { yield: keyof Yield; label: string }>> = {
  powerPlantDistrict: { yield: 'production', label: '发电厂输电' },
  gardenDistrict: { yield: 'food', label: '花园供菜' },
};

/** Districts gain these combos (cap 1 each) when adjacent to the named district kind. */
export const DISTRICT_COMBOS: { district: DistrictId; with: DistrictId; effect: 'research' | 'food' | 'production' | 'gold' | 'trainedXp'; amount: number; label: string }[] = [
  { district: 'researchDistrict', with: 'powerPlantDistrict', effect: 'research', amount: 1, label: '供电实验室（相邻发电厂）' },
  { district: 'harborDistrict', with: 'gardenDistrict', effect: 'food', amount: 1, label: '鱼菜共生（相邻花园）' },
  { district: 'gymDistrict', with: 'researchDistrict', effect: 'trainedXp', amount: 10, label: '科学训练（相邻研究所区）' },
  { district: 'powerPlantDistrict', with: 'harborDistrict', effect: 'gold', amount: 1, label: '港口电力（相邻港口）' },
];

/** A city with a type gym is an "X-type city": same-type cities ally, complementary pairs help each other. */
export const ALLIANCE_YIELD: Record<EssenceId, keyof Yield> = {
  life: 'gold', sylvan: 'food', earth: 'production', tide: 'food', spark: 'research', mind: 'research', blaze: 'production',
};
export const COMPLEMENTS: { pair: [EssenceId, EssenceId]; yield: keyof Yield; label: string }[] = [
  { pair: ['sylvan', 'tide'], yield: 'food', label: '森灵 × 潮汐：灌溉' },
  { pair: ['earth', 'blaze'], yield: 'production', label: '大地 × 炎：冶炼' },
  { pair: ['spark', 'mind'], yield: 'research', label: '雷金 × 灵识：电子研究' },
  { pair: ['life', 'spark'], yield: 'gold', label: '生机 × 雷金：集市' },
  { pair: ['life', 'sylvan'], yield: 'food', label: '生机 × 森灵：牧场' },
  { pair: ['mind', 'tide'], yield: 'gold', label: '灵识 × 潮汐：观光' },
];

/** What the settler's escort Pokémon brings to the new city, by its primary type. */
export type EscortBonusKind = 'food' | 'tide' | 'production' | 'research' | 'gold';
export const ESCORT_BONUSES: Record<EscortBonusKind, { types: readonly TypeId[]; label: string; amounts: { food?: number; gold?: number; production?: number; research?: number } }> = {
  food: { types: ['grass', 'bug', 'normal', 'flying'], label: '开垦：城市存粮 +15', amounts: { food: 15 } },
  tide: { types: ['water', 'ice'], label: '引水：城市存粮 +10，金币 +10', amounts: { food: 10, gold: 10 } },
  production: { types: ['fire', 'electric', 'fighting', 'rock', 'ground', 'steel'], label: '筑城：首项生产 +15', amounts: { production: 15 } },
  research: { types: ['psychic', 'fairy', 'dragon', 'ghost'], label: '勘察：科研 +15', amounts: { research: 15 } },
  gold: { types: ['poison', 'dark'], label: '集资：金币 +25', amounts: { gold: 25 } },
};
export const escortBonusKind = (typeId: TypeId): EscortBonusKind =>
  (Object.keys(ESCORT_BONUSES) as EscortBonusKind[]).find(kind => ESCORT_BONUSES[kind].types.includes(typeId)) ?? 'gold';
