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
};
