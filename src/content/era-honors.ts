import type { PolicyEffects } from './policies.ts';

/** Gameplay v12: era score milestones (Civilization era score) and the golden/dark ages they lead to. */
export type EraAge = 'normal' | 'golden' | 'dark';
export type EraMilestone = 'documentedSpecies' | 'cityFounded' | 'evolution' | 'capture' | 'charterAdopted' | 'districtCompleted'
  | 'nestCleared' | 'sanctuaryEstablished' | 'guardianDefeated' | 'faithFounded' | 'contestHallBuilt' | 'discovery' | 'cityCaptured' | 'legendWonder'
  | 'landmarkDiscovered';
export const ERA_MILESTONES: Record<EraMilestone, { name: string; points: number }> = {
  documentedSpecies: { name: '图鉴新记录物种', points: 1 },
  cityFounded: { name: '建立新城市', points: 3 },
  evolution: { name: '宝可梦进化', points: 2 },
  capture: { name: '成功捕捉', points: 1 },
  charterAdopted: { name: '确立联盟规章', points: 2 },
  districtCompleted: { name: '建成设施区', points: 2 },
  nestCleared: { name: '清除巢穴', points: 2 },
  sanctuaryEstablished: { name: '建立圣所', points: 3 },
  guardianDefeated: { name: '击败圣所守卫', points: 4 },
  faithFounded: { name: '创立信仰', points: 3 },
  contestHallBuilt: { name: '建成华丽馆', points: 1 },
  discovery: { name: '图鉴发现', points: 1 },
  cityCaptured: { name: '攻占城市', points: 3 },
  /** Gameplay v15 only (the event does not exist before). */
  legendWonder: { name: '建成传说奇观', points: 4 },
  /** Gameplay v24 only (world-v24 §2.5): each civilization's first sight of each natural landmark. */
  landmarkDiscovered: { name: '发现自然地标', points: 1 },
};
export const ERA_MILESTONE_IDS = Object.keys(ERA_MILESTONES) as EraMilestone[];
export const ERA_HONOR_RULES = {
  /** Average points per round in the finished era (permille, integer math). */
  goldenRatePermille: 800, darkRatePermille: 450,
  /** Eras shorter than this always lead to a normal age. */
  minimumRounds: 4,
} as const;
/** Gameplay v22 (with dedications): golden is a reward, normal the usual age. Measured on the fixed 48 games, v22 era rates
 *  have p20 ≈ 1.04 and p75 ≈ 1.53 points per round; the v12 lines (0.8 / 0.45) made 92% of eras golden, so promises never
 *  counted. These lines aim at roughly a quarter golden and a sixth dark. */
export const ERA_HONOR_RULES_V22 = { goldenRatePermille: 1500, darkRatePermille: 1000 } as const;
export type AgeLines = { goldenRatePermille: number; darkRatePermille: number };
export const ERA_AGES: Record<EraAge, { name: string; policy: PolicyEffects; satisfaction: number; leaguePoints: number; description: string }> = {
  normal: { name: '普通世代', policy: {}, satisfaction: 0, leaguePoints: 0, description: '没有额外效果。' },
  golden: { name: '黄金世代', policy: { cityGold: 1 }, satisfaction: 3, leaguePoints: 2, description: '每座城市金币 +1，满意度每轮 +3，规章点每轮 +2。' },
  dark: { name: '黑暗世代', policy: { trainingDiscountPercent: 20, healing: 3 }, satisfaction: -2, leaguePoints: 0,
    description: '满意度每轮 −2；逆境：训练宝可梦所需生产 −20%，所有宝可梦每轮额外恢复 3 HP。' },
};
