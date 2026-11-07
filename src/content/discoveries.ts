import type { TechId } from './economy.ts';

/** Pokédex discoveries (Civilization "eureka"): one milestone per technology, 40% of its cost once. */
export const DISCOVERY_PERCENT = 40;
export const DISCOVERIES: Record<TechId, { name: string; hint: string }> = {
  domestication: { name: '初次收服', hint: '成功捕捉一只野生宝可梦' },
  berryCultivation: { name: '树果丰收', hint: '采集树果或建成树果田' },
  stoneCraft: { name: '开山取石', hint: '采集矿脉或建成矿坑' },
  ballCraft: { name: '图鉴初成', hint: '登记 4 种宝可梦' },
  typeResearch: { name: '效果拔群', hint: '以克制属性击倒一只宝可梦' },
  riding: { name: '开疆拓土', hint: '拥有 3 座城市' },
  fieldObservation: { name: '博物学家', hint: '图鉴观察到 10 种宝可梦或建成观测站' },
  medicine: { name: '康复归队', hint: '一只宝可梦休养后归队' },
  training: { name: '首次进化', hint: '一只宝可梦进化' },
  siegeCraft: { name: '兵临城下', hint: '攻击一座敌方城市' },
  leagueRules: { name: '联盟之约', hint: '与其他文明结盟或缔结贸易' },
  meteorology: { name: '雪山火山', hint: '让一只宝可梦抵达雪原或火山' },
  // Gameplay v22 tree (only these games can reach them).
  seafaring: { name: '望海', hint: '拥有一座沿海城市，或建成一处渔场' },
  masonry: { name: '第一块基石', hint: '城市建成一座建筑' },
  commerce: { name: '小有积蓄', hint: '金币达到 100' },
  lureCraft: { name: '差一点', hint: '一次捕捉失败' },
  electricity: { name: '十万伏特', hint: '拥有或登记一种电属性宝可梦' },
  contestArts: { name: '人气城市', hint: '一座城市人口达到 4' },
  aviation: { name: '振翅', hint: '拥有或登记一种飞行属性宝可梦' },
  laboratory: { name: '设施落成', hint: '建成一座设施区' },
  urbanPlanning: { name: '城邦', hint: '拥有 4 座城市' },
  oceanography: { name: '扬帆', hint: '拥有一只水面型宝可梦' },
  eliteTraining: { name: '最终进化', hint: '一只宝可梦进化到最终形态' },
  breeding: { name: '大家庭', hint: '同时拥有 8 只宝可梦' },
  cartography: { name: '踏遍四方', hint: '探索 30% 的地图' },
  legendLore: { name: '传说的足迹', hint: '获得一条传说线索，或创立信仰' },
  steelworks: { name: '钢铁之躯', hint: '拥有或登记一种钢属性宝可梦' },
  masterBallTheory: { name: '图鉴达人', hint: '登记 15 种宝可梦' },
  dragonLore: { name: '龙之血脉', hint: '拥有或登记一种龙属性宝可梦' },
  championLeague: { name: '百战之师', hint: '累计击倒 15 只宝可梦' },
};

/** Gameplay v21 hint overrides (the trigger changed). */
export const DISCOVERY_HINTS_V21: Partial<Record<TechId, { name: string; hint: string }>> = { domestication: { name: '初次交手', hint: '和一只野生宝可梦交战' } };
export const discoveryText = (id: TechId, opening: boolean) => (opening ? DISCOVERY_HINTS_V21[id] : undefined) ?? DISCOVERIES[id];
