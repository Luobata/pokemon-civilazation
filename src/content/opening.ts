// Gameplay v21 opening pace (docs/design/opening-v21.md): opening objectives and item balls.
export type ObjectiveId = 'firstTech' | 'secondCity' | 'firstImprovement' | 'firstCapture' | 'firstBuilding' | 'thirdCity' | 'firstDistrict' | 'firstEvolution';
export type ObjectiveReward = { gold?: number; research?: number; pokeBalls?: number };
export const OBJECTIVES: Record<ObjectiveId, { name: string; hint: string; reward: ObjectiveReward }> = {
  firstTech: { name: '第一项研究', hint: '完成任意一项科技', reward: { gold: 15 } },
  secondCity: { name: '开拓第二城', hint: '让开拓队（肯泰罗）建立第二座城市', reward: { gold: 25 } },
  firstImprovement: { name: '第一块良田', hint: '让工匠（搬运小匠）建成一处地块改良', reward: { research: 10 } },
  firstCapture: { name: '第一次收服', hint: '用精灵球捕捉一只野生宝可梦', reward: { pokeBalls: 2 } },
  firstBuilding: { name: '第一座建筑', hint: '在城市里建成任意一座建筑', reward: { gold: 20 } },
  thirdCity: { name: '三城鼎立', hint: '拥有 3 座城市', reward: { research: 20 } },
  firstDistrict: { name: '第一个设施区', hint: '建成任意一个设施区', reward: { gold: 30 } },
  firstEvolution: { name: '第一次进化', hint: '让一只宝可梦进化', reward: { research: 20 } },
};
export const OBJECTIVE_IDS = Object.keys(OBJECTIVES) as ObjectiveId[];

/** 道具球: the Pokémon take on Civilization's goody huts. Any own unit ending a command on the tile picks it up. */
export type ItemBallKind = 'gold' | 'research' | 'balls' | 'food' | 'xp';
export const ITEM_BALLS: Record<ItemBallKind, { name: string; text: string; amount: number }> = {
  gold: { name: '金珠', text: '金币 +25', amount: 25 },
  research: { name: '古代图鉴残页', text: '科研 +15', amount: 15 },
  balls: { name: '一袋精灵球', text: '精灵球 +2', amount: 2 },
  food: { name: '树果篮', text: '最近的城市存粮 +15', amount: 15 },
  xp: { name: '学习装置', text: '捡到的宝可梦经验 +40（职能单位改为金币 +15）', amount: 40 },
};
export const ITEM_BALL_KINDS = Object.keys(ITEM_BALLS) as ItemBallKind[];
export const OPENING_RULES = {
  /** One item ball per this many land tiles; kept this far from starting cities and from each other. */
  landTilesPerBall: 70, ballCityDistance: 3, ballSpacing: 4,
  /** City-centre research: capital and other cities. */
  capitalResearch: 2, cityResearch: 1, capitalProduction: 2,
  /** Cities heal each round; walls add defense strength as the game goes on. */
  cityHealing: 5, wallRounds: 20, wallStep: 3, wallMax: 15, capitalDefense: 6,
} as const;

/** v21: victory targets scale with the round limit (a 200-round game asks twice as much as a 100-round one). Older rules: fixed. */
export function victoryTargets(source: { gameplayVersion?: number; roundLimit?: number }) {
  const scale = (source.gameplayVersion ?? 0) >= 21 ? Math.max(1, (source.roundLimit ?? 100) / 100) : 1;
  return { contestMinimum: scale === 1 ? 500 : Math.round(1000 * scale), faithMinimumCities: Math.round(6 + 2 * (scale - 1)), championshipTitles: Math.round(2 + (scale - 1)),
    pokedexBonus: Math.round(16 * (scale - 1)) };
}
