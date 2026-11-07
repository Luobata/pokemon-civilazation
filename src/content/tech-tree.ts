// Gameplay v22 branching tech tree (docs/design/world-v22.md §B): 30 technologies in 6 era columns. Each has explicit
// prerequisites (all required). The 12 older ids keep their meaning and are rewired; 18 new ids hang off existing systems
// (buildings, districts, HMs, recruits, gyms, contest halls, final-stage training, builders, score) or add a small
// PolicyEffects bonus. Older games never read this file's rules: they keep `TECHS` and the "any tech of the previous tier" rule.
import type { BuildingId, LegacyTechId, TechId } from './economy.ts';
import type { DistrictId } from './districts.ts';
import type { PolicyEffects } from './policies.ts';
import type { SpeciesId } from './species.ts';
import type { UnitClass } from './unit-classes.ts';

export const TREE_NEW_TECH_IDS = ['seafaring', 'masonry', 'commerce', 'lureCraft', 'electricity', 'contestArts', 'aviation', 'laboratory',
  'urbanPlanning', 'oceanography', 'eliteTraining', 'breeding', 'cartography', 'legendLore', 'steelworks', 'masterBallTheory', 'dragonLore',
  'championLeague'] as const;
export type TreeTechId = (typeof TREE_NEW_TECH_IDS)[number];

export type TechLine = 'capture' | 'raising' | 'science' | 'cities' | 'exploration' | 'league';
export const TECH_LINES: Record<TechLine, { name: string; color: string }> = {
  capture: { name: '捕捉', color: '#D9534F' },
  raising: { name: '育成与进化', color: '#E0A030' },
  science: { name: '属性与科研', color: '#7B68C8' },
  cities: { name: '建造与城市', color: '#8A6D3B' },
  exploration: { name: '探索与航行', color: '#3C8DBC' },
  league: { name: '联盟与外交', color: '#3E9A5A' },
};
export const TECH_LINE_IDS = Object.keys(TECH_LINES) as TechLine[];

export type TreeTechDefinition = { name: string; tier: number; cost: number; requires: readonly TechId[]; line: TechLine };
/** Cost of a technology by era column (tier). */
export const TREE_COLUMN_COSTS = [20, 50, 100, 200, 450, 750] as const;
export const TREE_COLUMNS = TREE_COLUMN_COSTS.length;
const t = (name: string, tier: number, line: TechLine, requires: readonly TechId[] = []): TreeTechDefinition =>
  ({ name, tier, cost: TREE_COLUMN_COSTS[tier - 1], requires, line });

/** Declaration order is the display order inside a column (top to bottom) and the AI's stable tie-break. */
export const TREE_TECHS: Record<TechId, TreeTechDefinition> = {
  // Column 1: roots.
  domestication: t('驯化', 1, 'capture'),
  berryCultivation: t('树果培育', 1, 'cities'),
  stoneCraft: t('碎石工艺', 1, 'cities'),
  seafaring: t('近海航行', 1, 'exploration'),
  // Column 2.
  ballCraft: t('精灵球工艺', 2, 'capture', ['domestication']),
  riding: t('骑行驯服', 2, 'exploration', ['domestication']),
  typeResearch: t('属性研究', 2, 'science', ['domestication', 'stoneCraft']),
  fieldObservation: t('野外观察', 2, 'science', ['berryCultivation']),
  masonry: t('筑城术', 2, 'cities', ['stoneCraft']),
  commerce: t('以物易物', 2, 'league', ['berryCultivation', 'seafaring']),
  // Column 3.
  lureCraft: t('诱饵配方', 3, 'capture', ['ballCraft', 'berryCultivation']),
  medicine: t('伤药调配', 3, 'raising', ['fieldObservation']),
  electricity: t('电气工学', 3, 'science', ['typeResearch', 'masonry']),
  siegeCraft: t('投石改装', 3, 'cities', ['masonry', 'riding']),
  meteorology: t('气象观测', 3, 'exploration', ['fieldObservation', 'seafaring']),
  contestArts: t('华丽大赛', 3, 'league', ['commerce', 'ballCraft']),
  // Column 4.
  training: t('特训法', 4, 'raising', ['medicine', 'typeResearch']),
  laboratory: t('科学实验', 4, 'science', ['electricity', 'fieldObservation']),
  urbanPlanning: t('城市规划', 4, 'cities', ['electricity', 'commerce']),
  aviation: t('飞行训练', 4, 'exploration', ['riding', 'meteorology']),
  oceanography: t('远洋航行', 4, 'exploration', ['meteorology', 'commerce']),
  leagueRules: t('联盟规章', 4, 'league', ['commerce', 'typeResearch']),
  // Column 5.
  breeding: t('培育屋', 5, 'raising', ['training', 'lureCraft']),
  eliteTraining: t('精英特训', 5, 'raising', ['training', 'leagueRules']),
  legendLore: t('传说考据', 5, 'science', ['laboratory', 'contestArts']),
  steelworks: t('钢铁工艺', 5, 'cities', ['urbanPlanning', 'siegeCraft']),
  cartography: t('地图测绘', 5, 'exploration', ['aviation', 'oceanography']),
  // Column 6.
  masterBallTheory: t('大师球理论', 6, 'capture', ['breeding', 'laboratory']),
  dragonLore: t('龙之秘传', 6, 'raising', ['eliteTraining', 'legendLore']),
  championLeague: t('冠军联盟', 6, 'league', ['eliteTraining', 'cartography']),
};
export const TREE_TECH_IDS = Object.keys(TREE_TECHS) as TechId[];
export const isLegacyTech = (id: TechId): id is LegacyTechId => !(TREE_NEW_TECH_IDS as readonly string[]).includes(id);

/** v22 rewiring of what older content attaches to a technology (absent = unchanged). */
export const TREE_BUILDING_TECH: Partial<Record<BuildingId, TechId>> = {
  workshop: 'masonry', meetingHall: 'commerce', trainingGround: 'medicine', observatory: 'laboratory',
};
export const TREE_DISTRICT_TECH: Partial<Record<DistrictId, TechId>> = { harborDistrict: 'seafaring', powerPlantDistrict: 'electricity' };
export const TREE_CLASS_HMS: Partial<Record<UnitClass, { hm: string; techId: TechId }>> = {
  naval: { hm: '冲浪', techId: 'seafaring' },
  siege: { hm: '怪力', techId: 'stoneCraft' },
  fast: { hm: '骑乘', techId: 'riding' },
  air: { hm: '飞翔', techId: 'aviation' },
};
/** Every city may train this species once the technology is known (replaces the v14 roster recruit table in v22). */
export const TREE_RECRUITS: Partial<Record<TechId, SpeciesId>> = {
  domestication: 'rattata', stoneCraft: 'geodude', seafaring: 'magikarp', riding: 'ponyta', typeResearch: 'magnemite', fieldObservation: 'zubat',
  electricity: 'pikachu', meteorology: 'swinub', training: 'machop', laboratory: 'abra', aviation: 'pidgey', oceanography: 'horsea',
  breeding: 'eevee', steelworks: 'beldum', dragonLore: 'dratini',
};
/** Standing bonuses, merged into the player's PolicyEffects (city yields per city, capture, XP, vision, ball price). */
export const TREE_EFFECTS: Partial<Record<TechId, PolicyEffects>> = {
  lureCraft: { captureBonus: 10 },
  eliteTraining: { trainedXp: 10 },
  cartography: { visionBonus: 1 },
  legendLore: { cityResearch: 1 },
  steelworks: { cityProduction: 1 },
  masterBallTheory: { captureBonus: 15, ballDiscount: 10 },
};
/** Rule gates that only exist in v22 games. */
export const TREE_GATES = {
  /** Building a type gym (BuildGym). */
  gym: 'typeResearch',
  /** Building a contest hall (BuildContestHall). */
  contestHall: 'contestArts',
  /** Cities training final-stage (stage 3) Pokémon; the gym badge is still required. */
  finalStage: 'eliteTraining',
  /** Builders trained after this carry one more charge. */
  builderCharge: 'urbanPlanning',
  /** Score multiplier on top of 联盟规章 (permille). */
  championScore: 'championLeague',
} as const satisfies Record<string, TechId>;
export const TREE_RULES = { builderExtraCharges: 1, championScorePermille: 1100 } as const;

/** v22 era thresholds (completed techs) — same era order as the older tracks, spread over 30 techs. */
export const TREE_ERA_THRESHOLDS = { 'simple-v1': [0, 7, 16], 'full-v1': [0, 2, 4, 7, 10, 14, 18, 23, 28] } as const;
