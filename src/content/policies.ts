import type { LeaderId } from './leaders.ts';

/**
 * Gameplay v3: League charters (civics) and training policy cards (Civilization 6 civics + policies).
 * League points per round = 1 + 1 per city + 1 per 3 population + 1 per 2 completed improvements + 2 if satisfaction >= 50.
 */
export type CharterId = 'gymCode' | 'rangerCharter' | 'tradeGuild' | 'breederAssociation' | 'pokemonLeague' | 'eliteFour';
export type PolicyId = 'gymChallenge' | 'fieldDrill' | 'conscription' | 'rangerPatrol' | 'harvestFestival' | 'masterBuilders'
  | 'marketDay' | 'pokeMart' | 'researchGrant' | 'professorNetwork' | 'nurseCorps' | 'safariZone';
export type SlotKind = 'military' | 'economic' | 'wild';
export type PolicyEffects = {
  trainedXp?: number; trainingDiscountPercent?: number; cityProduction?: number; cityFood?: number; cityGold?: number; cityResearch?: number;
  workPointBonus?: number; captureBonus?: number; healing?: number; ballDiscount?: number; upkeepReduction?: number; visionBonus?: number;
};
export type CharterDefinition = { name: string; cost: number; requires: readonly CharterId[]; grantsSlots: Partial<Record<SlotKind, number>>; unlocks: readonly PolicyId[]; description: string };
export type PolicyDefinition = { name: string; slot: Exclude<SlotKind, 'wild'>; effects: PolicyEffects; description: string };

export const CHARTERS: Record<CharterId, CharterDefinition> = {
  gymCode: { name: '道馆守则', cost: 30, requires: [], grantsSlots: { military: 1, economic: 1 }, unlocks: ['gymChallenge', 'harvestFestival', 'researchGrant'],
    description: '开放 1 个军事槽、1 个经济槽。' },
  rangerCharter: { name: '巡护员章程', cost: 80, requires: ['gymCode'], grantsSlots: { military: 1 }, unlocks: ['rangerPatrol', 'safariZone', 'nurseCorps'],
    description: '再开 1 个军事槽，解锁野外巡护与护理。' },
  tradeGuild: { name: '商会公约', cost: 80, requires: ['gymCode'], grantsSlots: { economic: 1 }, unlocks: ['marketDay', 'pokeMart', 'masterBuilders'],
    description: '再开 1 个经济槽，解锁商贸与工程。' },
  breederAssociation: { name: '培育家协会', cost: 130, requires: ['rangerCharter'], grantsSlots: { wild: 1 }, unlocks: ['fieldDrill', 'professorNetwork'],
    description: '开放 1 个通配槽，可放任意方针。' },
  pokemonLeague: { name: '宝可梦联盟', cost: 150, requires: ['tradeGuild', 'rangerCharter'], grantsSlots: { military: 1, economic: 1 }, unlocks: ['conscription'],
    description: '各再开 1 个军事、经济槽。' },
  eliteFour: { name: '四天王制度', cost: 200, requires: ['pokemonLeague', 'breederAssociation'], grantsSlots: { wild: 1 }, unlocks: [],
    description: '再开 1 个通配槽。' },
};
export const CHARTER_IDS = Object.keys(CHARTERS) as CharterId[];

export const POLICIES: Record<PolicyId, PolicyDefinition> = {
  gymChallenge: { name: '道馆挑战制', slot: 'military', effects: { trainedXp: 15 }, description: '新训练的宝可梦经验 +15。' },
  fieldDrill: { name: '野外演习', slot: 'military', effects: { trainingDiscountPercent: 20 }, description: '训练宝可梦所需生产 −20%。' },
  conscription: { name: '联盟征召', slot: 'military', effects: { upkeepReduction: 1 }, description: '宝可梦总维护费 −1（每城 1 点，最多减到 0）。' },
  rangerPatrol: { name: '巡护员巡逻', slot: 'military', effects: { visionBonus: 1 }, description: '城市视野 +1。' },
  nurseCorps: { name: '护理队随行', slot: 'military', effects: { healing: 3 }, description: '所有宝可梦每轮额外恢复 3 HP。' },
  safariZone: { name: '狩猎地带', slot: 'military', effects: { captureBonus: 10 }, description: '捕捉成功率 +10%。' },
  harvestFestival: { name: '丰收祭', slot: 'economic', effects: { cityFood: 1 }, description: '每座城市食物 +1。' },
  masterBuilders: { name: '工匠联盟', slot: 'economic', effects: { workPointBonus: 1 }, description: '地块改良每次施工额外 +1 点。' },
  marketDay: { name: '集市日', slot: 'economic', effects: { cityGold: 1 }, description: '每座城市金币 +1。' },
  pokeMart: { name: '友好商店连锁', slot: 'economic', effects: { ballDiscount: 5 }, description: '精灵球与超级球价格 −5 金。' },
  researchGrant: { name: '研究经费', slot: 'economic', effects: { cityResearch: 1 }, description: '每座城市科研 +1。' },
  professorNetwork: { name: '博士网络', slot: 'economic', effects: { cityProduction: 1 }, description: '每座城市生产 +1。' },
};
export const POLICY_IDS = Object.keys(POLICIES) as PolicyId[];
/** Leader affinity: a matching card gets +50% of its numeric effect (floored, minimum +1). */
export const LEADER_POLICY_AFFINITY: Record<LeaderId, readonly PolicyId[]> = {
  oak: ['researchGrant', 'safariZone', 'professorNetwork'],
  lance: ['gymChallenge', 'fieldDrill', 'conscription'],
  jenny: ['rangerPatrol', 'masterBuilders', 'conscription'],
  joy: ['nurseCorps', 'harvestFestival', 'marketDay'],
  brock: ['masterBuilders', 'professorNetwork', 'harvestFestival'],
  misty: ['rangerPatrol', 'nurseCorps', 'marketDay'],
  steven: ['gymChallenge', 'researchGrant', 'professorNetwork'],
  jasmine: ['marketDay', 'pokeMart', 'conscription'],
  giovanni: ['safariZone', 'pokeMart', 'fieldDrill'],
};
/** Policies can be changed for free when a charter completes or the era changes; otherwise each change costs gold. */
export const POLICY_SWAP_GOLD = 30;

/**
 * Gameplay v11: League governments (Civilization governments). One at a time; each adds policy slots
 * and a standing bonus expressed with the same effect keys as policy cards. Unlocked by charters.
 */
export type GovernmentId = 'gymLeague' | 'researchSociety' | 'ranchCommons' | 'championCouncil' | 'breederRepublic' | 'merchantAssembly';
export type GovernmentDefinition = { name: string; tier: 1 | 2; requires: CharterId; grantsSlots: Partial<Record<SlotKind, number>>; effects: PolicyEffects; description: string };
export const GOVERNMENTS: Record<GovernmentId, GovernmentDefinition> = {
  gymLeague: { name: '道馆联盟', tier: 1, requires: 'gymCode', grantsSlots: { military: 1 }, effects: { trainedXp: 10, trainingDiscountPercent: 10 },
    description: '新训练宝可梦经验 +10，训练所需生产 −10%。' },
  researchSociety: { name: '研究会', tier: 1, requires: 'gymCode', grantsSlots: { economic: 1 }, effects: { cityResearch: 1 },
    description: '每座城市科研 +1。' },
  ranchCommons: { name: '牧场共同体', tier: 1, requires: 'gymCode', grantsSlots: { economic: 1 }, effects: { cityFood: 1 },
    description: '每座城市食物 +1。' },
  championCouncil: { name: '冠军议会', tier: 2, requires: 'pokemonLeague', grantsSlots: { military: 1, wild: 1 }, effects: { trainedXp: 20, healing: 3, upkeepReduction: 1 },
    description: '新训练宝可梦经验 +20，所有宝可梦每轮恢复 +3，维护费每城 −1。' },
  breederRepublic: { name: '培育者共和', tier: 2, requires: 'breederAssociation', grantsSlots: { economic: 1, wild: 1 }, effects: { cityFood: 1, cityProduction: 1 },
    description: '每座城市食物 +1、生产 +1。' },
  merchantAssembly: { name: '商人议会', tier: 2, requires: 'tradeGuild', grantsSlots: { economic: 1, wild: 1 }, effects: { cityGold: 2, ballDiscount: 5 },
    description: '每座城市金币 +2，精灵球与超级球价格 −5 金。' },
};
export const GOVERNMENT_IDS = Object.keys(GOVERNMENTS) as GovernmentId[];
/** Leader preference: the government's numeric effects get +50% (floored, minimum +1), like affinity cards. */
export const LEADER_GOVERNMENT_AFFINITY: Record<LeaderId, GovernmentId> = {
  oak: 'researchSociety', lance: 'championCouncil', jenny: 'gymLeague', joy: 'ranchCommons', brock: 'breederRepublic',
  misty: 'gymLeague', steven: 'championCouncil', jasmine: 'merchantAssembly', giovanni: 'merchantAssembly',
};
/** Changing government outside a free window costs gold; a new government unlocking grants one free change. */
export const GOVERNMENT_SWAP_GOLD = 60;
