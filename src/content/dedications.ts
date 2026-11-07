import type { EraMilestone } from './era-honors.ts';
import type { PolicyEffects } from './policies.ts';

/**
 * Gameplay v22 (`content.dedications`, docs/design/world-v22.md §C): era dedications. Entering a new era, a player
 * picks dedication cards by the new age (normal / dark / golden: 1, heroic = golden right after a dark age: 3).
 * Each card has a promise (in a normal or dark age, one kind of deed earns extra era score) and a golden effect
 * (only in a golden or heroic age). The mechanic follows Civilization 6; the cards, names and numbers are ours.
 */
export type DedicationId = 'pioneerTrail' | 'ballMaster' | 'evolutionLight' | 'townArchitect' | 'grandStage' | 'badgeQuest' | 'wildExpedition' | 'professorNotes';
/** Deeds a promise can reward: the era milestones plus a few deeds that only dedications count. */
export type DedicationTrigger = EraMilestone | 'techCompleted' | 'buildingCompleted' | 'enemyDefeated' | 'contestHeld' | 'cityConverted' | 'tradeRoute' | 'exploration';
export type DedicationDefinition = {
  name: string; style: string; dex: number; flavor: string;
  promise: { trigger: DedicationTrigger; points: number }[]; promiseText: string;
  golden: { policy: PolicyEffects; leaguePoints?: number; satisfaction?: number }; goldenText: string;
};

export const DEDICATION_TRIGGERS: Record<DedicationTrigger, string> = {
  documentedSpecies: '图鉴新记录物种', cityFounded: '建立新城市', evolution: '宝可梦进化', capture: '成功捕捉', charterAdopted: '确立联盟规章',
  districtCompleted: '建成设施区', nestCleared: '清除巢穴', sanctuaryEstablished: '建立圣所', guardianDefeated: '击败圣所守卫', faithFounded: '创立信仰',
  contestHallBuilt: '建成华丽馆', discovery: '图鉴发现', cityCaptured: '攻占城市', legendWonder: '建成传说奇观',
  techCompleted: '完成科技', buildingCompleted: '建成建筑', enemyDefeated: '击倒敌方文明的单位', contestHeld: '举办华丽大赛', cityConverted: '城市改宗本文明信仰',
  tradeRoute: '开通商路', exploration: '每新探索 15 格',
};
/** Newly explored tiles per `exploration` point. */
export const EXPLORATION_TILES = 15;

export const DEDICATIONS: Record<DedicationId, DedicationDefinition> = {
  pioneerTrail: { name: '开拓者的足迹', style: '扩张', dex: 128, flavor: '肯泰罗踏出的路，后来都成了城镇。',
    promise: [{ trigger: 'cityFounded', points: 2 }, { trigger: 'tradeRoute', points: 1 }], promiseText: '建立新城市 +2，开通商路 +1',
    golden: { policy: { cityFood: 1, workPointBonus: 1 } }, goldenText: '每座城市食物 +1，地块改良每次施工 +1' },
  ballMaster: { name: '精灵球大师', style: '捕捉', dex: 25, flavor: '每一颗精灵球都写着一段相遇。',
    promise: [{ trigger: 'capture', points: 1 }, { trigger: 'documentedSpecies', points: 1 }], promiseText: '成功捕捉 +1，图鉴新记录物种 +1',
    golden: { policy: { captureBonus: 10, ballDiscount: 5 } }, goldenText: '捕捉成功率 +10%，精灵球与超级球 −5 金' },
  evolutionLight: { name: '进化之光', style: '进化', dex: 133, flavor: '伊布身上的光，照亮了无数条进化之路。',
    promise: [{ trigger: 'evolution', points: 2 }], promiseText: '宝可梦进化 +2',
    golden: { policy: { trainedXp: 15, healing: 2 } }, goldenText: '新训练宝可梦经验 +15，所有宝可梦每轮额外恢复 2 HP' },
  townArchitect: { name: '城镇建筑师', style: '建造', dex: 66, flavor: '腕力扛起的第一根梁，撑起整座城。',
    promise: [{ trigger: 'buildingCompleted', points: 1 }, { trigger: 'districtCompleted', points: 2 }], promiseText: '建成建筑 +1，建成设施区 +2',
    golden: { policy: { cityProduction: 1 } }, goldenText: '每座城市生产 +1' },
  grandStage: { name: '华丽舞台', style: '信仰／华丽大赛', dex: 35, flavor: '月光下的舞台，皮皮的舞步传遍四方。',
    promise: [{ trigger: 'contestHeld', points: 1 }, { trigger: 'contestHallBuilt', points: 1 }, { trigger: 'faithFounded', points: 2 }, { trigger: 'cityConverted', points: 1 }],
    promiseText: '举办华丽大赛 +1，建成华丽馆 +1，创立信仰 +2，城市改宗本文明信仰 +1',
    golden: { policy: { cityGold: 1 }, leaguePoints: 2, satisfaction: 2 }, goldenText: '每座城市金币 +1，规章点每轮 +2，满意度每轮 +2' },
  badgeQuest: { name: '徽章征途', style: '战争', dex: 6, flavor: '喷火龙的火焰，为每一枚徽章而燃。',
    promise: [{ trigger: 'enemyDefeated', points: 1 }, { trigger: 'cityCaptured', points: 2 }, { trigger: 'guardianDefeated', points: 1 }],
    promiseText: '击倒敌方文明的单位 +1，攻占城市 +2，击败圣所守卫 +1',
    golden: { policy: { trainingDiscountPercent: 15, healing: 3 } }, goldenText: '训练宝可梦所需生产 −15%，所有宝可梦每轮额外恢复 3 HP' },
  wildExpedition: { name: '荒野探险', style: '探索', dex: 18, flavor: '比雕飞过的地方，地图上不再有空白。',
    promise: [{ trigger: 'exploration', points: 1 }, { trigger: 'nestCleared', points: 2 }, { trigger: 'sanctuaryEstablished', points: 2 }],
    promiseText: `每新探索 ${EXPLORATION_TILES} 格 +1，清除巢穴 +2，建立圣所 +2`,
    golden: { policy: { visionBonus: 1, upkeepReduction: 1 } }, goldenText: '城市视野 +1，宝可梦维护费每城 −1' },
  professorNotes: { name: '博士的笔记', style: '科研', dex: 63, flavor: '凯西瞬间移动带回的笔记，写满了新发现。',
    promise: [{ trigger: 'techCompleted', points: 1 }, { trigger: 'discovery', points: 1 }], promiseText: '完成科技 +1，图鉴发现 +1',
    golden: { policy: { cityResearch: 1 } }, goldenText: '每座城市科研 +1' },
};
export const DEDICATION_IDS = Object.keys(DEDICATIONS) as DedicationId[];
export const DEDICATION_RULES = {
  /** Cards chosen when an era begins, by its age. */
  picks: { normal: 1, dark: 1, golden: 1, heroic: 3 },
  /** v22 golden age: the base keeps its satisfaction; the fixed gold / league-point bonus is replaced by the chosen cards. */
  goldenDescription: '满意度每轮 +3；所选献礼的黄金效果生效（英雄世代 3 张都生效）。',
} as const;
