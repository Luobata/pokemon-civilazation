// Gameplay v15: legendary Pokémon as world wonders with a three-chapter story (docs/design/legend-collection-v15.md).
import type { Yield } from './economy.ts';
import type { PolicyEffects } from './policies.ts';
import type { BiomeId } from './rules.ts';
import type { TypeId } from './species.ts';

export type LegendWonderId = 'articuno' | 'zapdos' | 'moltres' | 'mewtwo' | 'mew' | 'raikou' | 'entei' | 'suicune' | 'lugia' | 'hooh' | 'celebi'
  | 'regirock' | 'regice' | 'registeel' | 'latias' | 'latios' | 'kyogre' | 'groudon' | 'rayquaza' | 'jirachi' | 'deoxys'
  | 'uxie' | 'mesprit' | 'azelf' | 'dialga' | 'palkia' | 'giratina' | 'darkrai' | 'arceus' | 'reshiram' | 'zekrom' | 'kyurem'
  | 'xerneas' | 'yveltal' | 'zygarde' | 'solgaleo' | 'lunala' | 'necrozma' | 'zacian' | 'zamazenta' | 'eternatus' | 'koraidon' | 'miraidon';

/** How a civilization finds a legend's clue (chapter 1). All are deterministic and read only its own state or its own events. */
export type LegendClue =
  | { kind: 'trace'; biomes: readonly BiomeId[]; coastal?: true }
  | { kind: 'tablet'; tabletId: string; tabletName: string }
  | { kind: 'faith' }
  | { kind: 'techDistrict'; techId: 'training'; districtId: 'researchDistrict' }
  | { kind: 'documented'; count: number }
  | { kind: 'goldenAge' } | { kind: 'darkAge'; minGeneration: number }
  | { kind: 'contestAppeal'; count: number }
  | { kind: 'districtKinds'; count: number }
  | { kind: 'discoveries'; count: number }
  | { kind: 'rareBerries'; count: number }
  | { kind: 'traits'; count: number } | { kind: 'traitPair'; traits: readonly [string, string] }
  | { kind: 'generation'; generation: number }
  | { kind: 'explored'; percent: number }
  | { kind: 'nightKnockdown' | 'dayKnockdown'; typeId: TypeId }
  | { kind: 'speciesTypes'; count: number }
  | { kind: 'allCharters' } | { kind: 'tierTwoGovernment' }
  | { kind: 'population'; count: number } | { kind: 'knockdowns'; count: number } | { kind: 'improvements'; count: number }
  | { kind: 'eraAbility'; ability: 'zMove' | 'dynamax' | 'tera' };

export type LegendWonder = {
  name: string; wonderName: string; dex: number; generation: number; clue: LegendClue;
  /** Site rule: the city's work radius must contain this biome (trace legends use their placed biome instead). */
  site?: BiomeId;
  cityYield: Partial<Yield>; effects: PolicyEffects;
};

const t = (biomes: BiomeId[], coastal?: true): LegendClue => ({ kind: 'trace', biomes, ...(coastal ? { coastal } : {}) });
export const LEGEND_WONDERS: Record<LegendWonderId, LegendWonder> = {
  articuno: { name: '急冻鸟', wonderName: '冰封神殿', dex: 144, generation: 1, clue: t(['snow', 'mountain']), cityYield: { research: 2, food: 1 }, effects: { visionBonus: 1 } },
  zapdos: { name: '闪电鸟', wonderName: '雷鸣高塔', dex: 145, generation: 1, clue: t(['mountain', 'desert']), cityYield: { production: 2, research: 1 }, effects: { trainedXp: 10 } },
  moltres: { name: '火焰鸟', wonderName: '焰羽祭坛', dex: 146, generation: 1, clue: t(['volcano', 'mountain']), cityYield: { production: 2, gold: 1 }, effects: { healing: 2 } },
  mewtwo: { name: '超梦', wonderName: '基因研究所', dex: 150, generation: 1, clue: { kind: 'techDistrict', techId: 'training', districtId: 'researchDistrict' }, cityYield: { research: 3 }, effects: { trainedXp: 10 } },
  mew: { name: '梦幻', wonderName: '幻之遗迹', dex: 151, generation: 1, clue: { kind: 'documented', count: 15 }, cityYield: { research: 1, gold: 2 }, effects: { captureBonus: 5 } },
  raikou: { name: '雷公', wonderName: '雷鸣原野', dex: 243, generation: 2, clue: t(['grassland']), cityYield: { gold: 2, production: 1 }, effects: { trainingDiscountPercent: 10 } },
  entei: { name: '炎帝', wonderName: '炎之塔', dex: 244, generation: 2, clue: t(['desert', 'volcano']), cityYield: { production: 3 }, effects: { healing: 2 } },
  suicune: { name: '水君', wonderName: '清泉神社', dex: 245, generation: 2, clue: t(['grassland', 'forest', 'mountain', 'desert', 'snow'], true), site: 'ocean', cityYield: { food: 2, gold: 1 }, effects: { healing: 2 } },
  lugia: { name: '洛奇亚', wonderName: '漩涡岛神殿', dex: 249, generation: 2, clue: { kind: 'faith' }, site: 'ocean', cityYield: { food: 2, research: 1 }, effects: { cityFood: 1 } },
  hooh: { name: '凤王', wonderName: '铃铛塔', dex: 250, generation: 2, clue: { kind: 'faith' }, cityYield: { gold: 2, research: 1 }, effects: { cityGold: 1 } },
  celebi: { name: '时拉比', wonderName: '时空神龛', dex: 251, generation: 2, clue: { kind: 'goldenAge' }, site: 'forest', cityYield: { research: 2, food: 1 }, effects: { trainedXp: 10 } },
  regirock: { name: '雷吉洛克', wonderName: '岩之石室', dex: 377, generation: 3, clue: { kind: 'tablet', tabletId: 'strength-tablet', tabletName: '斗技石板' }, site: 'mountain', cityYield: { production: 3 }, effects: { cityProduction: 1 } },
  regice: { name: '雷吉艾斯', wonderName: '冰之石室', dex: 378, generation: 3, clue: { kind: 'tablet', tabletId: 'lake-tablet', tabletName: '湖泊石板' }, site: 'snow', cityYield: { research: 2, production: 1 }, effects: { visionBonus: 1 } },
  registeel: { name: '雷吉斯奇鲁', wonderName: '钢之石室', dex: 379, generation: 3, clue: { kind: 'tablet', tabletId: 'spirit-tablet', tabletName: '灵界石板' }, cityYield: { production: 2, gold: 1 }, effects: { trainingDiscountPercent: 10 } },
  latias: { name: '拉帝亚斯', wonderName: '南方孤岛', dex: 380, generation: 3, clue: t(['forest']), cityYield: { food: 2, gold: 1 }, effects: { captureBonus: 5 } },
  latios: { name: '拉帝欧斯', wonderName: '心之水都', dex: 381, generation: 3, clue: { kind: 'tablet', tabletId: 'sky-tablet', tabletName: '天空石板' }, cityYield: { gold: 2, research: 1 }, effects: { visionBonus: 1 } },
  kyogre: { name: '盖欧卡', wonderName: '海底洞窟', dex: 382, generation: 3, clue: { kind: 'faith' }, site: 'ocean', cityYield: { food: 3 }, effects: { cityFood: 1 } },
  groudon: { name: '固拉多', wonderName: '熔岩洞窟', dex: 383, generation: 3, clue: { kind: 'faith' }, cityYield: { production: 3 }, effects: { cityProduction: 1 } },
  rayquaza: { name: '烈空坐', wonderName: '天空之柱', dex: 384, generation: 3, clue: { kind: 'faith' }, cityYield: { research: 3 }, effects: { cityResearch: 1 } },
  jirachi: { name: '基拉祈', wonderName: '千年之愿', dex: 385, generation: 3, clue: { kind: 'contestAppeal', count: 150 }, cityYield: { gold: 3 }, effects: { cityGold: 1 } },
  deoxys: { name: '代欧奇希斯', wonderName: '天外陨坑', dex: 386, generation: 3, clue: { kind: 'districtKinds', count: 4 }, cityYield: { research: 3 }, effects: { trainedXp: 10 } },
  uxie: { name: '由克希', wonderName: '睿智之湖', dex: 480, generation: 4, clue: { kind: 'discoveries', count: 8 }, cityYield: { research: 3 }, effects: { cityResearch: 1 } },
  mesprit: { name: '艾姆利多', wonderName: '心灵之湖', dex: 481, generation: 4, clue: { kind: 'rareBerries', count: 3 }, cityYield: { food: 2, gold: 1 }, effects: { captureBonus: 5 } },
  azelf: { name: '亚克诺姆', wonderName: '意志之湖', dex: 482, generation: 4, clue: { kind: 'traits', count: 3 }, cityYield: { production: 2, research: 1 }, effects: { trainedXp: 10 } },
  dialga: { name: '帝牙卢卡', wonderName: '时间神殿', dex: 483, generation: 4, clue: { kind: 'generation', generation: 4 }, cityYield: { research: 2, production: 1 }, effects: { trainingDiscountPercent: 10 } },
  palkia: { name: '帕路奇亚', wonderName: '空间神殿', dex: 484, generation: 4, clue: { kind: 'explored', percent: 50 }, cityYield: { gold: 2, research: 1 }, effects: { visionBonus: 1 } },
  giratina: { name: '骑拉帝纳', wonderName: '毁坏的世界', dex: 487, generation: 4, clue: { kind: 'darkAge', minGeneration: 4 }, cityYield: { production: 3 }, effects: { healing: 2 } },
  darkrai: { name: '达克莱伊', wonderName: '新月岛', dex: 491, generation: 4, clue: { kind: 'nightKnockdown', typeId: 'dark' }, cityYield: { gold: 3 }, effects: { captureBonus: 5 } },
  arceus: { name: '阿尔宙斯', wonderName: '创世之殿', dex: 493, generation: 4, clue: { kind: 'speciesTypes', count: 12 }, cityYield: { research: 2, production: 2 }, effects: { cityResearch: 1 } },
  reshiram: { name: '莱希拉姆', wonderName: '真实之塔', dex: 643, generation: 5, clue: { kind: 'allCharters' }, cityYield: { research: 3 }, effects: { cityResearch: 1 } },
  zekrom: { name: '捷克罗姆', wonderName: '理想之塔', dex: 644, generation: 5, clue: { kind: 'tierTwoGovernment' }, cityYield: { production: 3 }, effects: { cityProduction: 1 } },
  kyurem: { name: '酋雷姆', wonderName: '巨人冰窟', dex: 646, generation: 5, clue: t(['snow', 'mountain']), cityYield: { research: 2, production: 1 }, effects: { visionBonus: 1 } },
  xerneas: { name: '哲尔尼亚斯', wonderName: '生命之树', dex: 716, generation: 6, clue: { kind: 'population', count: 25 }, cityYield: { food: 3 }, effects: { cityFood: 1 } },
  yveltal: { name: '伊裴尔塔尔', wonderName: '毁灭之茧', dex: 717, generation: 6, clue: { kind: 'knockdowns', count: 30 }, cityYield: { production: 2, gold: 1 }, effects: { trainingDiscountPercent: 10 } },
  zygarde: { name: '基格尔德', wonderName: '秩序终洞', dex: 718, generation: 6, clue: { kind: 'improvements', count: 10 }, cityYield: { food: 2, production: 1 }, effects: { cityProduction: 1 } },
  solgaleo: { name: '索尔迦雷欧', wonderName: '日轮祭坛', dex: 791, generation: 7, clue: { kind: 'dayKnockdown', typeId: 'steel' }, cityYield: { research: 2, gold: 2 }, effects: { visionBonus: 1 } },
  lunala: { name: '露奈雅拉', wonderName: '月轮祭坛', dex: 792, generation: 7, clue: { kind: 'nightKnockdown', typeId: 'ghost' }, cityYield: { research: 2, gold: 2 }, effects: { healing: 2 } },
  necrozma: { name: '奈克洛兹玛', wonderName: '光辉之顶', dex: 800, generation: 7, clue: { kind: 'eraAbility', ability: 'zMove' }, cityYield: { research: 4 }, effects: { trainedXp: 10 } },
  zacian: { name: '苍响', wonderName: '剑之祠', dex: 888, generation: 8, clue: { kind: 'traitPair', traits: ['assault', 'breacher'] }, cityYield: { production: 3 }, effects: { trainedXp: 10 } },
  zamazenta: { name: '藏玛然特', wonderName: '盾之祠', dex: 889, generation: 8, clue: { kind: 'traitPair', traits: ['bulwark', 'regenerate'] }, cityYield: { production: 2, food: 1 }, effects: { healing: 2 } },
  eternatus: { name: '无极汰那', wonderName: '能量塔', dex: 890, generation: 8, clue: { kind: 'eraAbility', ability: 'dynamax' }, cityYield: { production: 4 }, effects: { cityProduction: 1 } },
  koraidon: { name: '故勒顿', wonderName: '零之秘宝（古）', dex: 1007, generation: 9, clue: { kind: 'eraAbility', ability: 'tera' }, cityYield: { production: 2, research: 2 }, effects: { trainingDiscountPercent: 10 } },
  miraidon: { name: '密勒顿', wonderName: '零之秘宝（未来）', dex: 1008, generation: 9, clue: { kind: 'generation', generation: 9 }, cityYield: { research: 2, gold: 2 }, effects: { cityGold: 1 } },
};
export const LEGEND_WONDER_IDS = (Object.keys(LEGEND_WONDERS) as LegendWonderId[]).sort((a, b) => LEGEND_WONDERS[a].dex - LEGEND_WONDERS[b].dex);
export const LEGEND_RULES = {
  /** Production cost by generation tier (1–3, 4–6, 7–9). */
  cost: [110, 150, 190] as const,
  /** Share of a lost wonder's progress refunded as gold (permille). */
  lostRefundPermille: 500,
  eraScore: 4,
  /** Trace sites keep this distance from starting cities and from each other. */
  siteCityDistance: 5, siteSpacing: 3,
} as const;
export const legendCost = (id: LegendWonderId) => LEGEND_RULES.cost[Math.min(2, Math.floor((LEGEND_WONDERS[id].generation - 1) / 3))];
export const LEGEND_CLUE_TEXT = (clue: LegendClue): string => {
  switch (clue.kind) {
    case 'trace': return '研究「野外观察」后，派宝可梦踏上它的踪迹';
    case 'tablet': return `取得${clue.tabletName}`;
    case 'faith': return '以它创立信仰';
    case 'techDistrict': return '研究「特训法」并建成研究所区';
    case 'documented': return `图鉴记录 ${clue.count} 种`;
    case 'goldenAge': return '处于黄金世代';
    case 'darkAge': return `第 ${clue.minGeneration} 世代以后处于黑暗世代`;
    case 'contestAppeal': return `华丽大赛累计魅力 ${clue.count}`;
    case 'districtKinds': return `建成 ${clue.count} 种设施区`;
    case 'discoveries': return `达成 ${clue.count} 个图鉴发现`;
    case 'rareBerries': return `拥有 ${clue.count} 种稀有树果`;
    case 'traits': return `一只宝可梦拥有 ${clue.count} 个特性`;
    case 'traitPair': return '一只宝可梦同时拥有两种指定特性';
    case 'generation': return `进入第 ${clue.generation} 时代`;
    case 'explored': return `探索地图 ${clue.percent}%`;
    case 'nightKnockdown': return '夜晚，用指定属性的宝可梦主动击倒一个单位';
    case 'dayKnockdown': return '白天，用指定属性的宝可梦主动击倒一个单位';
    case 'speciesTypes': return `登记的物种覆盖 ${clue.count} 种属性`;
    case 'allCharters': return '确立全部联盟规章';
    case 'tierTwoGovernment': return '采用第二层体制';
    case 'population': return `城市总人口 ${clue.count}`;
    case 'knockdowns': return `累计击倒 ${clue.count}`;
    case 'improvements': return `建成 ${clue.count} 处地块改良`;
    case 'eraAbility': return `首次使用${({ zMove: 'Z 招式', dynamax: '极巨化', tera: '太晶化' } as const)[clue.ability]}`;
  }
};
