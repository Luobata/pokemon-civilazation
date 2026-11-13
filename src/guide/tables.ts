import { LANDMARKS, LANDMARK_IDS, TERRAIN_RULES_V24 } from '../content/terrain.ts';
import { discoveryText } from '../content/discoveries.ts';
import { ITEM_BALLS, ITEM_BALL_KINDS, OBJECTIVES, OBJECTIVE_IDS, OPENING_RULES, regionalPokedexTarget, victoryTargets } from '../content/opening.ts';
import { REGIONAL_DEX_RULES } from '../content/regional-dex.ts';
import { RECRUIT_SLOTS } from '../content/recruit-slots.ts';
import { SPECIES_TAGS } from '../content/species-tags.ts';
import { STRENGTH_RULES, strengthFromPermille } from '../core/strength.ts';
import { CLASS_COUNTERS, CLASS_HMS, CLASS_IDS, CLASS_NAMES, CLASS_NATIVE_TYPES, CLASS_RULES } from '../content/unit-classes.ts';
import { hasAffinity } from '../core/unit-classes.ts';
import { BUILDER_RULES, ROLE_IDS, ROLE_POKEMON } from '../content/roles.ts';
import type { RoleId } from '../content/roles.ts';
import { CITY_NETWORK_RULES, COMPLEMENTS, DISTRICT_COMBOS, ESCORT_BONUSES } from '../content/city-network.ts';
import { LEGEND_CLUE_TEXT, LEGEND_WONDERS, LEGEND_WONDER_IDS, legendCost } from '../content/legend-wonders.ts';
import { legendEffectText, legendSprite } from '../browser/legend-panel.ts';
import { leaderUnitFor, spawnWeightsFor, stoneEvolutionsFor } from '../content/roster.ts';
import { evolutionOptions } from '../core/roster.ts';
import type { EvolutionOption } from '../content/species.ts';
import { LATEST_GAMEPLAY_VERSION } from '../content/eras.ts';
import { gymTeamPower } from '../content/world24-tuning.ts';
// Handbook tables are rendered from the live content modules, so numbers cannot drift from the rules.
// Only the default new-game setup (expansion v1 + era mode + LATEST_GAMEPLAY_VERSION) is described.
import { FULL_TYPE_CHART } from '../content/combat.ts';
import { TYPE_COLORS } from '../content/type-colors.ts';
import { DISCOVERY_PERCENT } from '../content/discoveries.ts';
import { DISTRICTS, DISTRICT_IDS } from '../content/districts.ts';
import type { DistrictEffects } from '../content/districts.ts';
import { BALLS, BIOME_YIELDS, BUILDINGS, TECHS } from '../content/economy.ts';
import type { LegacyTechId, TechId, Yield } from '../content/economy.ts';
import { TECH_LINES, TECH_LINE_IDS, TREE_COLUMN_COSTS, TREE_COLUMNS, TREE_ERA_THRESHOLDS, TREE_NEW_TECH_IDS, TREE_TECHS } from '../content/tech-tree.ts';
import { ERA_ABILITIES, ERA_ABILITY_IDS, WEATHERS, WEATHER_IDS } from '../content/era-abilities.ts';
import { ERA_DEFINITIONS } from '../content/eras.ts';
import { ESSENCES, ESSENCE_IDS, ESSENCE_RULES } from '../content/essences.ts';
import { LEGENDS, LEGEND_IDS, TENETS, TENET_IDS, FAITH_RULES } from '../content/faith-legends.ts';
import { CREW_SPECIALTIES, CREW_SPECIALTY_IDS, IMPROVEMENTS, IMPROVEMENT_IDS, IMPROVEMENT_IDS_V23, IMPROVEMENT_RULES_V23, IMPROVEMENT_WORK, PILLAGE_REWARD } from '../content/improvements.ts';
import { crewApplies } from '../core/improvements.ts';
import { LEADERS, LEADER_IDS } from '../content/leaders.ts';
import type { LeaderId } from '../content/leaders.ts';
import { CHARTERS, CHARTER_IDS, GOVERNMENTS, GOVERNMENT_IDS, GOVERNMENT_SWAP_GOLD, LEADER_GOVERNMENT_AFFINITY, LEADER_POLICY_AFFINITY, POLICIES, POLICY_IDS, POLICY_SWAP_GOLD } from '../content/policies.ts';
import { RARE_BERRIES, RARE_BERRY_IDS, RARE_BERRY_RULES } from '../content/rare-berries.ts';
import { BIOME_WEIGHTS } from '../content/rules.ts';
import type { BiomeId } from '../content/rules.ts';
import { SPECIES_NAMES } from '../content/species.ts';
import type { SpeciesDefinition, SpeciesId, TypeId } from '../content/species.ts';
import { TYPE_NAMES } from '../content/type-names.ts';
import { RESEARCH_TASK_RULES_V24, researchSpecialLabel } from '../content/research-tasks.ts';
import { contentFor, WORLD_CONTENT } from '../content/units.ts';
import { SPAWN_WEIGHTS } from '../content/wild.ts';
import { WORLD_DEFINITIONS } from '../content/world-systems.ts';
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import { LEADER_DOCTRINES } from '../core/leader-doctrines.ts';
import { LEADER_KITS } from '../core/leader-systems.ts';
import { ROLE_CITY_ASSAULT, ERA_TECH_RECRUITS } from '../core/role-tactics.ts';
import { pokemonSpritePath } from '../browser/sprites.ts';
import { ERA_AGES, ERA_HONOR_RULES, ERA_HONOR_RULES_V22, ERA_MILESTONES, ERA_MILESTONE_IDS } from '../content/era-honors.ts';
import { DEDICATION_IDS, DEDICATION_RULES, DEDICATIONS } from '../content/dedications.ts';
import { PROMOTION_RULES, PROMOTION_TRAITS, PROMOTION_TRAIT_IDS } from '../content/promotions.ts';
import { techUnlocks } from '../browser/tech-info.ts';
import { ELITE_FOUR, GYM_LEADERS, GYM_LEADER_ORDER, GYM_RULES_V24, GYM_TYPES, HOME_GYMS, STAGE_NAMES } from '../content/gym-circuit.ts';
import { RIVAL_COUNTERS, RIVAL_RULES_V24, RIVAL_RULES_V25, RIVAL_TEAMS } from '../content/rivals.ts';

const content = contentFor({ expansionVersion: 1, gameplayVersion: LATEST_GAMEPLAY_VERSION });

export const escape = (text: string | number) => String(text).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);
export function table(headers: readonly string[], rows: readonly (readonly string[])[], numeric: readonly number[] = [], className = ''): string {
  const head = headers.map((label, index) => `<th${numeric.includes(index) ? ' class="num"' : ''}>${label}</th>`).join('');
  const body = rows.map(row => `<tr>${row.map((cell, index) => `<td${numeric.includes(index) ? ' class="num"' : index === 0 ? ' class="name"' : ''}>${cell}</td>`).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table class="${className}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

export const BIOME_NAMES: Record<BiomeId, string> = {
  grassland: '草原', forest: '森林', mountain: '山地', ocean: '海洋', desert: '荒漠', snow: '雪原', volcano: '火山',
};
const BIOME_ORDER: readonly BiomeId[] = ['grassland', 'forest', 'mountain', 'ocean', 'desert', 'snow', 'volcano'];
const TYPE_ORDER: readonly TypeId[] = ['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
  'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'];
const ROLE_NAMES: Record<SpeciesDefinition['role'], string> = {
  ranged: '远程', melee: '近战', scout: '侦察', fast: '快速', siege: '攻城', naval: '水面', air: '飞行',
};
const typeChip = (type: TypeId) => `<span class="chip type" style="background:${TYPE_COLORS[type]}">${TYPE_NAMES[type]}</span>`;
const biomeList = (biomes: readonly BiomeId[]) => biomes.map(biome => BIOME_NAMES[biome]).join('、');
const speciesName = (id: SpeciesId) => SPECIES_NAMES[id];
const techName = (id: TechId) => TREE_TECHS[id].name;
export function yieldText(value: Partial<Yield & DistrictEffects>): string {
  const parts: string[] = [];
  const labels: [keyof (Yield & DistrictEffects), string][] = [['food', '食物'], ['production', '生产'], ['gold', '金币'], ['research', '科研'],
    ['trainedXp', '训练经验'], ['bondPressure', '羁绊']];
  for (const [key, label] of labels) if (value[key]) parts.push(`${label} +${value[key]}`);
  return parts.length ? parts.join('，') : '—';
}

// ---------- Map ----------
/** v24 terrain features (world-v24 §2.2). */
export function terrainFeatureTable(): string {
  const r = TERRAIN_RULES_V24;
  return table(['要素', '产出', '移动', '战斗', '其他'], [
    ['丘陵（叠在草原/森林/荒漠/雪原上）', `生产 +${r.hillProduction}`, `花费 +${r.hillMoveCost}`, `防守 +${r.hillDefense}「丘陵掩护」（不与森林/山地 +5 叠加）；丘陵上的城市 +${r.hillCityDefense}「高地城池」`, '站在上面视野 +1'],
    ['高山', '不可耕作', '不可通行（飞行宝可梦除外）', '—', '山脊上的一部分；不会把大陆切成两半'],
    ['河流（记在格子上）', `金币 +${r.riverGold}`, `从无河格进入 +${r.riverCrossingCost}（沿河不加）`, `近战/快速从无河格攻击河上目标 ${r.riverCrossingAttack}「渡河」`, `城市中心在河上或挨着河/湖 = 淡水城市：食物 +${r.freshWaterFood}`],
    ['湖', '同浅海 2/0/1/0', '同浅海', '—', '淡水'],
    ['浅海（挨着陆地）', '2/0/1/0', '陆地单位要「近海航行」', '乘浪单位防守 ' + r.embarkedDefense, '渔场、珍珠贝场、港口照旧'],
    ['深海', `${r.deepOcean.food}/${r.deepOcean.production}/${r.deepOcean.gold}/${r.deepOcean.research}`, '陆地单位要「远洋航行」', '同上', '最外一行是极地冰海（深海、不可耕作）'],
    ['自然地标', '本格不可耕作', '不可通行', '—', '效果给城市耕作的相邻格'],
  ]);
}
/** v24 landmarks (world-v24 §2.5). */
export function landmarkTable(): string {
  const site = { desert: '荒漠', lake: '湖', forest: '森林', grasslandHill: '草原丘陵', mountain: '内陆山地', coastalMountain: '海岸山地', snow: '雪原', volcano: '火山' } as const;
  return table(['地标', '地形', '效果', '常驻物种（附近刷新 ×5）'], LANDMARK_IDS.map(id => [LANDMARKS[id].name, site[LANDMARKS[id].site], LANDMARKS[id].effect,
    LANDMARKS[id].residents.map(species => SPECIES_NAMES[species]).join('、')]));
}
export function biomeTable(): string {
  const total = BIOME_WEIGHTS.reduce((sum, item) => sum + item.weight, 0);
  const weight = (biome: BiomeId) => BIOME_WEIGHTS.find(item => item.id === biome)?.weight;
  const essence = (biome: BiomeId) => ESSENCE_IDS.find(id => ESSENCES[id].biome === biome);
  const berry = (biome: BiomeId) => RARE_BERRY_IDS.find(id => RARE_BERRIES[id].biome === biome);
  const combat = (biome: BiomeId) => biome === 'forest' || biome === 'mountain' ? '防守方战斗力 +5' + (biome === 'mountain' ? '；从山地出手 +5' : '') : '—';
  return table(['群系', '出现权重', '基础产出', '移动消耗', '战斗地形', '属性精华', '稀有树果', '可建改良', '野生宝可梦（权重）'],
    BIOME_ORDER.map(biome => {
      const essenceId = essence(biome), berryId = berry(biome);
      const improvements = IMPROVEMENT_IDS.filter(id => IMPROVEMENTS[id].biomes.includes(biome)).map(id => IMPROVEMENTS[id].name);
      const spawns = Object.entries(SPAWN_WEIGHTS[biome]).map(([id, w]) => `${speciesName(id as SpeciesId)} ${w}`).join('、');
      return [BIOME_NAMES[biome], weight(biome) === undefined ? '边缘火山簇约 2%' : `${weight(biome)} / ${total}`,
        yieldText(BIOME_YIELDS[biome]), String(content.moveCosts[biome]), combat(biome),
        essenceId ? `${ESSENCES[essenceId].name}（${ESSENCES[essenceId].types.map(typeChip).join('')}）` : '—',
        berryId ? RARE_BERRIES[berryId].name : '—', improvements.join('、') || '—', spawns];
    }), [1, 3]);
}

// ---------- Techs, eras, buildings ----------
export function techTable(): string {
  const ids = Object.keys(TECHS) as LegacyTechId[];
  return table(['科技', '层级', '花费', '效果与解锁', '图鉴发现（立减 ' + DISCOVERY_PERCENT + '%）'],
    ids.map(id => {
      return [techName(id), String(TECHS[id].tier), String(TECHS[id].cost), techUnlocks(id, content, LATEST_GAMEPLAY_VERSION).map(item => item.text).join('；'),
        `<strong>${discoveryText(id, Boolean(content.opening)).name}</strong>：${discoveryText(id, Boolean(content.opening)).hint}`];
    }), [1, 2]);
}
// ---------- v22 tech tree (generated from WORLD_CONTENT) ----------
const isNewTech = (id: TechId) => (TREE_NEW_TECH_IDS as readonly string[]).includes(id);
const lineChip = (id: TechId) => { const line = TECH_LINES[TREE_TECHS[id].line]; return `<span class="chip" style="background:${line.color};color:#fff">${line.name}</span>`; };
/** Lines × columns: where each technology sits, so the routes and their cross-links read at a glance. */
export function techTreeDiagram(): string {
  return table(['路线', ...Array.from({ length: TREE_COLUMNS }, (_, index) => `第 ${index + 1} 列 · ${TREE_COLUMN_COSTS[index]}`)],
    TECH_LINE_IDS.map(line => [`<span class="chip" style="background:${TECH_LINES[line].color};color:#fff">${TECH_LINES[line].name}</span>`,
      ...Array.from({ length: TREE_COLUMNS }, (_, index) => (Object.keys(TREE_TECHS) as TechId[]).filter(id => TREE_TECHS[id].line === line && TREE_TECHS[id].tier === index + 1)
        .map(id => isNewTech(id) ? `<strong>${techName(id)}</strong>` : techName(id)).join('<br>') || '—')]), [], 'tech-tree-diagram');
}
export function techTreeTable(): string {
  const ids = Object.keys(TREE_TECHS) as TechId[];
  return table(['科技', '列', '路线', '花费', '前置（全部完成）', '效果与解锁', '图鉴发现（立减 ' + DISCOVERY_PERCENT + '%）'],
    ids.map(id => [`${techName(id)}${isNewTech(id) ? ' <span class="chip">v22 新增</span>' : ''}`, String(TREE_TECHS[id].tier), lineChip(id), String(TREE_TECHS[id].cost),
      TREE_TECHS[id].requires.map(techName).join('、') || '—', techUnlocks(id, WORLD_CONTENT, 22).map(item => item.text).join('；'),
      `<strong>${discoveryText(id, true).name}</strong>：${discoveryText(id, true).hint}`]), [1, 3]);
}
export function treeEraTable(): string {
  return table(['进程', '时代', '进入条件（v22 科技树）'], (['simple-v1', 'full-v1'] as const).flatMap(mode => ERA_DEFINITIONS[mode].map((era, index) => [
    mode === 'simple-v1' ? '精简' : '完整', era.name, `已完成 ${TREE_ERA_THRESHOLDS[mode][index]} 项科技（旧版 ${era.threshold}）`])));
}
export function eraTable(): string {
  const rows = (['simple-v1', 'full-v1'] as const).flatMap(mode => ERA_DEFINITIONS[mode].map(era => [
    mode === 'simple-v1' ? '精简' : '完整', era.name, `已完成 ${era.threshold} 项科技`,
    ERA_ABILITY_IDS.filter(id => ERA_ABILITIES[id].generation === Number(era.id.split('-')[1])).map(id => ERA_ABILITIES[id].name).join('、') || '—',
  ]));
  return table(['进程', '时代', '进入条件', '解锁时代能力'], rows);
}
export function buildingTable(): string {
  return table(['建筑', '花费', '产出', '前置科技'], Object.values(BUILDINGS).map(b => [b.name, b.cost === null ? '首都自带' : String(b.cost),
    b.trainedXp ? `本城训练的宝可梦经验 +${b.trainedXp}；解锁本城训练宝可梦` : yieldText(b.yields), b.requiredTech ? techName(b.requiredTech) : '—']), [1]);
}
export function ballTable(): string {
  return table(['道具', '价格', '前置科技', '捕捉倍率'], Object.values(BALLS).map(ball => [ball.name, `${ball.goldCost} 金`, techName(ball.requiredTech),
    ball.name === '超级球' ? '×1.5' : '×1.0']), [1]);
}

// ---------- Pokémon ----------
export function speciesTable(): string {
  const stones = new Map(stoneEvolutionsFor(content).map(path => [path.fromSpeciesId, path]));
  const spawnText = (id: SpeciesId) => {
    const biomes = BIOME_ORDER.filter(biome => spawnWeightsFor(content, biome)[id]);
    return biomes.length ? biomeList(biomes) : '—';
  };
  const ids = Object.keys(content.species) as SpeciesId[];
  const recruits = content.roster?.techRecruits ?? ERA_TECH_RECRUITS;
  const recruitTech = (id: SpeciesId) => (Object.entries(recruits) as [TechId, SpeciesId][]).find(([, s]) => s === id)?.[0];
  const generationRecruit = (id: SpeciesId) => Object.entries(content.roster?.generationRecruits ?? {}).find(([, s]) => s === id)?.[0];
  const leaderOf = (id: SpeciesId) => LEADER_IDS.find(leader => leaderUnitFor(content, leader, LEADER_KITS[leader].unit) === id);
  const dex = (id: SpeciesId) => Number(/(\d+)\.png$/.exec(pokemonSpritePath(id))![1]);
  const conditionText = (option: EvolutionOption) => [option.minGeneration && option.minGeneration > 1 ? `第 ${option.minGeneration} 时代起` : '',
    option.time === 'day' ? '白天' : option.time === 'night' ? '夜晚' : '', option.biome ? `站在${biomeList([option.biome])}` : ''].filter(Boolean).join('、');
  ids.sort((a, b) => dex(a) - dex(b));
  return table(['#', '宝可梦', '属性', '阶段', '定位', 'HP', '攻', '防', '移动', '射程', '视野', '训练', '维护', '原作世代', '野外出没', '进化 / 获取'],
    ids.map(id => {
      const s = content.species[id];
      const stone = stones.get(id);
      // Expansion games forbid XP evolution into a stone path's target (src/core/combat.ts).
      const options = evolutionOptions(content, id).filter(option => option.speciesId !== stone?.intoSpeciesId);
      const evolution = [stone ? `→ ${speciesName(stone.intoSpeciesId)}（只能用${WORLD_DEFINITIONS.stones[stone.stoneId].name}，需 ${stone.requiredXp} 经验，不花金币）` : '',
        ...options.map(option => `→ ${speciesName(option.speciesId)}（${option.xp} 经验 + ${option.gold} 金${option.requiresTraining ? '，需特训法' : ''}${conditionText(option) ? `，${conditionText(option)}` : ''}）`)].filter(Boolean).join('；');
      const sources = [evolution,
        recruitTech(id) ? `研究${techName(recruitTech(id)!)}后各城可招募` : '', generationRecruit(id) ? `进入第 ${generationRecruit(id)} 时代后各城可招募` : '',
        leaderOf(id) ? `${LEADERS[leaderOf(id)!].name}的专属宝可梦` : '',
        s.rare ? '稀有（出现率 ×0.25，捕捉率减半）' : ''].filter(Boolean);
      return [String(dex(id)).padStart(3, '0'), `<img class="sprite" loading="lazy" src="${pokemonSpritePath(id)}" alt=""> ${s.name}`,
        [s.typeId, s.secondaryTypeId].filter((t): t is TypeId => !!t).map(typeChip).join(''), String(s.stage), ROLE_NAMES[s.role],
        String(s.maxHp), String(s.attack), String(s.defense), String(s.move), String(s.range), String(s.vision), String(s.trainCost), String(s.upkeep),
        String(s.generation ?? 1), spawnText(id), sources.join('；') || '—'];
    }), [3, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
}
/** v14: one recruit per reached generation. */
export function generationRecruitTable(): string {
  return table(['进入时代', '各城可招募'], Object.entries(content.roster?.generationRecruits ?? {}).map(([generation, id]) => [`第 ${generation} 时代`, speciesName(id!)]), [0]);
}
export function roleTable(): string {
  const roles = Object.keys(ROLE_CITY_ASSAULT) as (keyof typeof ROLE_CITY_ASSAULT)[];
  const zoc = (role: string) => role === 'melee' || role === 'fast' ? '施加控制区' : role === 'scout' || role === 'air' ? '无视控制区' : '—';
  return table(['定位', '攻城（贴身）', '攻城（远处）', '控制区', '说明'], roles.map(role => [ROLE_NAMES[role],
    `×${ROLE_CITY_ASSAULT[role].adjacent / 1000}`, `×${ROLE_CITY_ASSAULT[role].distant / 1000}`, zoc(role), ROLE_CITY_ASSAULT[role].note]), [1, 2]);
}
export function typeChart(): string {
  const head = `<th class="row-head">攻 \\ 防</th>${TYPE_ORDER.map(t => `<th title="${TYPE_NAMES[t]}">${TYPE_NAMES[t].slice(0, 2)}</th>`).join('')}`;
  const rows = TYPE_ORDER.map(attack => `<tr><th class="row-head">${typeChip(attack)}</th>${TYPE_ORDER.map(defense => {
    const value = FULL_TYPE_CHART[attack][defense] ?? 1000;
    const [cls, label] = value === 2000 ? ['eff-2', '2'] : value === 500 ? ['eff-05', '½'] : value === 0 ? ['eff-0', '0'] : ['', ''];
    return `<td class="${cls}" title="${TYPE_NAMES[attack]} → ${TYPE_NAMES[defense]}：×${value / 1000}">${label}</td>`;
  }).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table class="type-chart"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---------- Leaders ----------
/** Unique-building yields as applied by leaderCityYield (src/core/leader-systems.ts). */
const LEADER_BUILDING_YIELD: Record<LeaderId, string> = {
  oak: '科研 +2', lance: '生产 +2', jenny: '金币 +2，本城视野 +1', joy: '食物 +2', brock: '生产 +2',
  misty: '食物 +2', steven: '科研 +2', jasmine: '金币 +2', giovanni: '金币 +2',
};
export function leaderCards(tips: Record<LeaderId, string>): string {
  const phaseNames = { early: '前期', middle: '中期', late: '后期' } as const;
  return `<div class="leader-grid">${LEADER_IDS.map(id => {
    const leader = LEADERS[id], kit = LEADER_KITS[id], doctrine = LEADER_DOCTRINES[id];
    const doctrines = (['early', 'middle', 'late'] as const).map(phase => `<strong>${phaseNames[phase]}</strong> ${escape(doctrine[phase].description)}`).join('<br>');
    const affinity = LEADER_POLICY_AFFINITY[id].map(policy => POLICIES[policy].name).join('、');
    const unit = content.species[kit.unit];
    return `<article class="leader-card" data-search="${escape([leader.name, leader.title, leader.specialty, leader.ability, kit.active, speciesName(kit.unit), kit.building].join(' '))}">
      <header><img src="/leaders/${id}.svg" alt="${escape(leader.name)}"><div><h3>${escape(leader.name)}</h3><small>${escape(leader.title)} · 擅长${escape(leader.specialty)}</small></div></header>
      <dl>
        <dt>被动</dt><dd><strong>${escape(leader.ability)}</strong>：${escape(leader.description)}</dd>
        <dt>主动</dt><dd><strong>${escape(kit.active)}</strong>：${escape(kit.description)}</dd>
        <dt>专属宝可梦</dt><dd><img class="sprite" src="${pokemonSpritePath(kit.unit)}" alt=""> ${escape(unit.name)}（${ROLE_NAMES[unit.role]}）：100 金招募，需特训法，最多 3 只；出生经验 20，视野 +1</dd>
        <dt>专属建筑</dt><dd><strong>${escape(kit.building)}</strong>：90 金，每城 1 座，${LEADER_BUILDING_YIELD[id]}</dd>
        <dt>时代方针</dt><dd>${doctrines}</dd>
        <dt>方针亲和</dt><dd>${escape(affinity)}（装备时数值效果 +50%）</dd>
        <dt>偏好体制</dt><dd>${escape(GOVERNMENTS[LEADER_GOVERNMENT_AFFINITY[id]].name)}（采用时常驻加成 +50%，v11）</dd>
      </dl>
      <p class="leader-tip">${escape(tips[id])}</p>
    </article>`;
  }).join('')}</div>`;
}

// ---------- League charters & policies ----------
export function charterTable(): string {
  const slots = (grants: Partial<Record<string, number>>) => Object.entries(grants).map(([kind, n]) => `${({ military: '军事', economic: '经济', wild: '通配' })[kind]}槽 +${n}`).join('，');
  return table(['规章', '联盟点', '前置', '开放槽位', '解锁方针卡'], CHARTER_IDS.map(id => [CHARTERS[id].name, String(CHARTERS[id].cost),
    CHARTERS[id].requires.map(r => CHARTERS[r].name).join('、') || '—', slots(CHARTERS[id].grantsSlots),
    CHARTERS[id].unlocks.map(p => POLICIES[p].name).join('、') || '—']), [1]);
}
export function policyTable(): string {
  return table(['方针卡', '槽位', '效果', '亲和领袖'], POLICY_IDS.map(id => [POLICIES[id].name, POLICIES[id].slot === 'military' ? '军事' : '经济',
    POLICIES[id].description, LEADER_IDS.filter(l => LEADER_POLICY_AFFINITY[l].includes(id)).map(l => LEADERS[l].name).join('、')]));
}
export const policySwapGold = POLICY_SWAP_GOLD;
export const governmentSwapGold = GOVERNMENT_SWAP_GOLD;
export function legendWonderTable(): string {
  return table(['#', '传说 · 奇观', '时代', '线索', '造价', '效果'], LEGEND_WONDER_IDS.map(id => {
    const legend = LEGEND_WONDERS[id];
    return [String(legend.dex).padStart(3, '0'), `<img class="sprite" loading="lazy" src="${legendSprite(id)}" alt=""> ${legend.name} · ${legend.wonderName}`, String(legend.generation),
      LEGEND_CLUE_TEXT(legend.clue) + (legend.clue.kind === 'trace' ? `（${legend.clue.coastal ? '海边' : biomeList(legend.clue.biomes.slice(0, 1))}）` : ''), String(legendCost(id)), legendEffectText(id)];
  }), [2, 4]);
}
export const networkRules = CITY_NETWORK_RULES;
export const builderCharges = BUILDER_RULES.charges;
export const classRules = CLASS_RULES;
/** v20: the flat strength bonuses a player meets most, computed from the same conversion the rules use. */
export function strengthTable(): string {
  const row = (label: string, value: string, note: string) => [label, value, note];
  const s = (permille: number) => { const v = strengthFromPermille(permille); return `${v >= 0 ? '+' : '−'}${Math.abs(v)}`; };
  return table(['加成', '战斗力', '说明'], [
    row('属性克制（每个“效果拔群”）', `+${STRENGTH_RULES.typeStep}`, `研究属性研究后 +${STRENGTH_RULES.researchedTypeStep}；双属性两个都克则叠加`),
    row('效果不好（每个）', `−${STRENGTH_RULES.typeStep}`, '属性无效时不造成伤害'),
    row('森林 / 山地掩护', `防守方 +${STRENGTH_RULES.cover}`, '防守方站在森林或山地'),
    row('居高临下', `+${STRENGTH_RULES.highGround}`, '从山地出手，且对方不在掩护地形'),
    row('兵种克制', s(CLASS_RULES.counter), '见「兵种与属性契合」'),
    row('攻城打宝可梦', s(CLASS_RULES.siegeVsUnits), '攻城宝可梦只擅长破城'),
    row('属性契合', s(CLASS_RULES.affinity), '属性和兵种对路'),
    row('夹击（1 / 2 / 3 只友军相邻）', `${s(1100)} / ${s(1200)} / ${s(1300)}`, '只对主动攻击宝可梦'),
    row('主场防守', `防守方 ${s(900).replace('−', '+')}`, '站在本属性精华群系'),
    row('激怒', s(1200), '捕捉失败后被激怒的野生宝可梦'),
    row('领袖专属单位', `+${STRENGTH_RULES.uniqueLeader}`, '攻防都算'),
  ]);
}
/** v19: one row per class: what it counters, what counters it, native types, the HM it needs, and its Pokémon by generation. */
export function unitClassTable(): string {
  return table(['兵种', '克制（战斗力 +5）', '怕', '契合属性（战斗力 +3）', '训练需要', '这类宝可梦（★ = 属性契合）'], CLASS_IDS.map(role => {
    const beatenBy = CLASS_IDS.filter(other => CLASS_COUNTERS[other].beats.includes(role));
    const hm = CLASS_HMS[role];
    const members = (Object.keys(content.species) as SpeciesId[]).filter(id => content.species[id].role === role)
      .sort((a, b) => (content.species[a].generation ?? 1) - (content.species[b].generation ?? 1) || content.species[a].stage - content.species[b].stage || (a < b ? -1 : 1))
      .map(id => `${content.species[id].name}${hasAffinity({ kind: 'pokemon', speciesId: id }, content) ? '★' : ''}`);
    return [CLASS_NAMES[role], CLASS_COUNTERS[role].beats.length ? `${CLASS_COUNTERS[role].beats.map(other => CLASS_NAMES[other]).join('、')}（${CLASS_COUNTERS[role].note}）` : CLASS_COUNTERS[role].note,
      beatenBy.map(other => CLASS_NAMES[other]).join('、') || '—', CLASS_NATIVE_TYPES[role].map(typeChip).join(''),
      hm ? `秘传「${hm.hm}」（${techName(hm.techId)}）` : '一开始就能训练', members.join('、')];
  }));
}
export function roleUnitTable(): string {
  const unit = (role: RoleId) => content.units[role];
  const since: Record<RoleId, string> = { settler: '一直都有', builder: 'v18 新增', trader: 'v17 新增（需要友好商店）' };
  return table(['职能', '宝可梦', '职责', '训练', '移动', '维护', '版本', '为什么是它'], ROLE_IDS.map(role => [ROLE_POKEMON[role].unitName,
    `<img class="sprite" loading="lazy" src="${ROLE_POKEMON[role].sprite}" alt=""> ${ROLE_POKEMON[role].species}`, ROLE_POKEMON[role].job + (role === 'builder' ? `，每个 ${BUILDER_RULES.charges} 处` : ''),
    `${unit(role).trainCost} 生产`, String(unit(role).move), `${unit(role).upkeep} 金`, since[role], ROLE_POKEMON[role].why]), [3, 4, 5]);
}
export function districtComboTable(): string {
  return table(['设施区', '相邻', '加成'], DISTRICT_COMBOS.map(combo => [DISTRICTS[combo.district].name, DISTRICTS[combo.with].name,
    `${combo.label.replace(/（.*$/, '')}：${({ research: '科研', food: '食物', production: '生产', gold: '金币', trainedXp: '出场经验' })[combo.effect]} +${combo.amount}`]));
}
export function complementTable(): string {
  return table(['互补属性城市', '加成'], COMPLEMENTS.map(rule => [rule.label.split('：')[0], `${rule.label.split('：')[1]}：两城各 ${({ research: '科研', food: '食物', production: '生产', gold: '金币' })[rule.yield]} +1`]));
}
export function escortTable(): string {
  return table(['随行宝可梦属性', '新城开局'], Object.values(ESCORT_BONUSES).map(bonus => [bonus.types.map(typeChip).join(''), bonus.label]));
}
export const promotionThresholds = PROMOTION_RULES.thresholds.join(' / ');
export function promotionMeritTable(): string {
  const m = PROMOTION_RULES.merit;
  return table(['战斗行为', '战功'], [['主动攻击并造成伤害', `+${m.attack}`], ['反击并造成伤害', `+${m.counter}`], ['击倒一个单位', `+${m.knockdown}`], ['攻下一座城市', `+${m.cityCaptured}`]], [1]);
}
export function promotionTraitTable(): string {
  return table(['特性', '效果'], PROMOTION_TRAIT_IDS.map(id => [PROMOTION_TRAITS[id].name, PROMOTION_TRAITS[id].summary]));
}
export function eraMilestoneTable(): string {
  return table(['里程碑', '世代分'], ERA_MILESTONE_IDS.map(id => [ERA_MILESTONES[id].name, `+${ERA_MILESTONES[id].points}`]), [1]);
}
export function eraAgeTable(): string {
  const line = (age: 'golden' | 'normal' | 'dark') => age === 'golden' ? `≥ ${ERA_HONOR_RULES_V22.goldenRatePermille / 1000}（v≤21：≥ ${ERA_HONOR_RULES.goldenRatePermille / 1000}）`
    : age === 'dark' ? `< ${ERA_HONOR_RULES_V22.darkRatePermille / 1000}（v≤21：< ${ERA_HONOR_RULES.darkRatePermille / 1000}）` : '介于两者之间，或上一世代不足 4 轮';
  return table(['世代', '条件（上一世代平均每轮得分）', '效果'], (['golden', 'normal', 'dark'] as const).map(age => [ERA_AGES[age].name, line(age), ERA_AGES[age].description]));
}
/** v22: era dedications, generated from src/content/dedications.ts. */
export function dedicationTable(): string {
  return table(['献礼', '玩法', '承诺（普通 / 黑暗世代：额外世代分）', '黄金效果（黄金 / 英雄世代）'], DEDICATION_IDS.map(id => [DEDICATIONS[id].name, DEDICATIONS[id].style, DEDICATIONS[id].promiseText, DEDICATIONS[id].goldenText]));
}
export const dedicationRules = DEDICATION_RULES;
export function governmentTable(): string {
  const slots = (grants: Partial<Record<string, number>>) => Object.entries(grants).map(([kind, n]) => `${({ military: '军事', economic: '经济', wild: '通配' })[kind]}槽 +${n}`).join('，');
  return table(['体制', '层', '解锁规章', '额外槽位', '常驻加成', '偏好领袖'], GOVERNMENT_IDS.map(id => [GOVERNMENTS[id].name, String(GOVERNMENTS[id].tier),
    CHARTERS[GOVERNMENTS[id].requires].name, slots(GOVERNMENTS[id].grantsSlots), GOVERNMENTS[id].description,
    LEADER_IDS.filter(l => LEADER_GOVERNMENT_AFFINITY[l] === id).map(l => LEADERS[l].name).join('、') || '—']), [1]);
}

// ---------- Improvements & districts ----------
export function improvementTable(): string {
  return table(['改良', '可建群系', '基础', '强化科技', '强化后再加', '熟练工属性'], IMPROVEMENT_IDS.map(id => {
    const item = IMPROVEMENTS[id];
    return [item.name, biomeList(item.biomes), yieldText(item.base), techName(item.boostTech!), yieldText(item.boost!), item.crewTypes.map(typeChip).join('')];
  }));
}
export const improvementWork = IMPROVEMENT_WORK;
/** v23: every improvement with its technology, resource, pillage reward and crew specialty (generated from content). */
export function improvementTableV23(): string {
  const resourceName = { berry: '树果丛', stone: '进化石矿脉', rare: '稀有树果' } as const;
  const rewardName = { food: '食物', production: '生产', gold: '金币', research: '科研' } as const;
  return table(['改良', '建在', '基础', '需要科技', '强化', '掠夺所得', '随行特长'], IMPROVEMENT_IDS_V23.map(id => {
    const item = IMPROVEMENTS[id], reward = PILLAGE_REWARD[id];
    const crews = CREW_SPECIALTY_IDS.filter(crew => crewApplies(crew, id, item.biomes.length === 1 ? item.biomes[0] : null)).map(crew => CREW_SPECIALTIES[crew].name);
    return [item.name, item.resource ? `${resourceName[item.resource]}（任何地形）` : biomeList(item.biomes), yieldText(item.base), item.requiredTech ? techName(item.requiredTech) : '—',
      item.boostTech ? `${techName(item.boostTech)}：${yieldText(item.boost!)}` : '—', `${rewardName[reward]} +${IMPROVEMENT_RULES_V23.pillage[reward]}`, crews.join('、') || '—'];
  }));
}
export function crewSpecialtyTable(): string {
  return table(['特长', '随行宝可梦第一属性', '效果（记在这只工匠建成的地块上）'], CREW_SPECIALTY_IDS.map(id => [CREW_SPECIALTIES[id].name, CREW_SPECIALTIES[id].types.map(typeChip).join(''), CREW_SPECIALTIES[id].label]));
}
export const improvementRulesV23 = IMPROVEMENT_RULES_V23;
export function districtTable(): string {
  return table(['设施区', '前置科技', '生产花费', '可建群系', '基础效果', '相邻加成（每格 / 上限）'], DISTRICT_IDS.map(id => {
    const d = DISTRICTS[id];
    const adjacency = d.adjacency.map(a => `${a.label}：${yieldText({ [a.effect]: a.perTile })}（上限 ${a.cap}）`).join('<br>');
    return [d.name, techName(d.requiredTech), String(d.cost), d.coastal ? '海洋（需与城市陆地相邻）' : biomeList(d.biomes), yieldText(d.base), adjacency];
  }), [2]);
}

// ---------- Essences, era abilities ----------
export function essenceTable(): string {
  return table(['精华', '来源群系', '对应属性'], ESSENCE_IDS.map(id => [ESSENCES[id].name, BIOME_NAMES[ESSENCES[id].biome], ESSENCES[id].types.map(typeChip).join('')]));
}
export const essenceRules = ESSENCE_RULES;
export function eraAbilityTable(): string {
  return table(['能力', '解锁时代', '效果'], ERA_ABILITY_IDS.map(id => [ERA_ABILITIES[id].name, `第 ${ERA_ABILITIES[id].generation} 时代（${ERA_ABILITIES[id].era}）`, ERA_ABILITIES[id].description]));
}
export function weatherTable(): string {
  return table(['天气', '消耗精华', '增强', '削弱'], WEATHER_IDS.map(id => {
    const w = WEATHERS[id];
    return [w.name, ESSENCES[w.essence].name, `${w.boost.map(typeChip).join('')} ×${w.boostPermille / 1000}`, w.weaken.length ? `${w.weaken.map(typeChip).join('')} ×0.7` : '—'];
  }));
}

// ---------- Rare berries, faith ----------
export function rareBerryTable(): string {
  return table(['稀有树果', '产地', '每种矿点数'], RARE_BERRY_IDS.map(id => [RARE_BERRIES[id].name, BIOME_NAMES[RARE_BERRIES[id].biome], String(RARE_BERRY_RULES.depositsPerType)]), [2]);
}
export const rareBerryRules = RARE_BERRY_RULES;
export function legendTable(): string {
  return table(['传说', '属性', '祝福'], LEGEND_IDS.map(id => [LEGENDS[id].name, LEGENDS[id].types.map(typeChip).join(''), LEGENDS[id].blessing]));
}
export function tenetTable(): string {
  return table(['信条', '效果'], TENET_IDS.map(id => [TENETS[id].name, TENETS[id].description]));
}
export const faithRules = FAITH_RULES;

// ---------- World & civilization systems ----------
export function berryTable(): string {
  return table(['树果', '食物', '满意度', '可采次数', '再生轮数'], Object.values(WORLD_DEFINITIONS.berries).map(b => [b.name, String(b.food), String(b.satisfaction), String(b.uses), String(b.regrowthRounds)]), [1, 2, 3, 4]);
}
export function stoneTable(): string {
  return table(['进化石', '矿点数', '用途'], Object.values(WORLD_DEFINITIONS.stones).map(stone => [stone.name, String(stone.deposits),
    WORLD_DEFINITIONS.stoneEvolutions.filter(p => p.stoneId === stone.id).map(p => `${speciesName(p.fromSpeciesId)} → ${speciesName(p.intoSpeciesId)}（${p.requiredXp} 经验）`).join('、')]), [1]);
}
export function phantomTable(): string {
  return table(['幻影', '候选名字', '效果'], CIVILIZATION_CONTENT.phantoms.definitions.map(p => [p.name, p.names.join('、'), p.description]));
}
export function sanctuaryTable(): string {
  return table(['圣所', '石板', '守卫', '守卫宝可梦', '挑战强度'], CIVILIZATION_CONTENT.sanctuaries.definitions.map(s => [s.name, s.tabletName, s.guardianName,
    speciesName(s.guardianSpeciesId), String(s.challengePower)]), [4]);
}
export const world = WORLD_DEFINITIONS;
export const civilization = CIVILIZATION_CONTENT;

/** v21: opening objectives, item balls and round-limit victory targets, read from src/content/opening.ts. */
export const openingRules = OPENING_RULES;
export function objectiveTable(): string {
  const reward = (r: { gold?: number; research?: number; pokeBalls?: number }) => [r.gold ? `金币 +${r.gold}` : '', r.research ? `科研 +${r.research}` : '', r.pokeBalls ? `精灵球 +${r.pokeBalls}` : ''].filter(Boolean).join('、');
  return table(['目标', '条件', '奖励'], OBJECTIVE_IDS.map(id => [OBJECTIVES[id].name, OBJECTIVES[id].hint, reward(OBJECTIVES[id].reward)]));
}
export function itemBallTable(): string {
  return table(['道具球', '效果'], ITEM_BALL_KINDS.map(kind => [ITEM_BALLS[kind].name, ITEM_BALLS[kind].text]));
}
export function victoryTargetTable(): string {
  const rows = [100, 200, 300].map(roundLimit => { const v = victoryTargets({ gameplayVersion: 21, roundLimit }); return [`${roundLimit} 轮`, String(v.contestMinimum), `${v.faithMinimumCities} 座`, `${v.championshipTitles} 次`, `+${v.pokedexBonus} 种`]; });
  return table(['轮上限', '华丽大赛魅力', '信仰：有主城市至少', '冠军赛', '图鉴目标'], rows, [1, 2, 3, 4]);
}

/** v24 D: research cards — task 5 by first type, and the rewards (src/content/research-tasks.ts). */
export function researchSpecialTable(): string {
  const types = TYPE_ORDER;
  const groups = new Map<string, TypeId[]>();
  for (const type of types) groups.set(researchSpecialLabel(type), [...(groups.get(researchSpecialLabel(type)) ?? []), type]);
  return table(['第 5 项（特别条件）', '第一属性'], [...groups].map(([label, list]) => [label, list.map(type => TYPE_NAMES[type]).join('、')]));
}
export function researchRewardTable(): string {
  const R = RESEARCH_TASK_RULES_V24;
  return table(['完成项数', '奖励（每张卡一次）'], [
    [String(R.notesAt), `调查笔记：科研 +${R.notesResearch}`],
    [String(R.captureAt), `你对这个物种的捕捉率 +${R.captureBonus}（捕捉预览与实际一致）`],
    [String(R.completeAt), `调查完成：金币 +${R.completeGold}、世代分 +${R.completeEraScore}（每世代最多 ${R.eraScoreCapPerEra} 次）`],
  ], [0]);
}
// ---------- v24 B gym circuit / C rival trainers (docs/design/world-v24.md §3, §4) ----------
export const gymRules = GYM_RULES_V24;
export const rivalRules = RIVAL_RULES_V24;
export const rivalRulesV25 = RIVAL_RULES_V25;
/** v25 regional Pokédex (roster-v25 §2–§3): size, coverage constraints, recruit slots and the scaled Pokédex target. */
export const regionalDexRules = REGIONAL_DEX_RULES;
export function regionalDexConstraintTable(): string {
  const rows: [string, string, string][] = [
    ['兵种 × 阶段', '物种池里有属性契合候选的格子，图鉴至少 1 种契合的；只有不契合候选的格子，至少 1 种', '每个兵种在每个阶段都有可选的宝可梦'],
    ['属性', '池里出现的每种属性（主或副）至少 1 种；抽取时任一属性不超过目标的 25%', '属性克制是主轴，又不让一种属性挤满'],
    ['世代', '第 2 世代起，每个世代都有一 / 二阶的该世代物种', '世代招募总有对象'],
    ['群系刷新', `每种群系至少 ${REGIONAL_DEX_RULES.biomeSpawns} 种第 1 世代的野生宝可梦`, '开局每种地形都有可抓的'],
    ['巢穴与稀有', `至少 ${REGIONAL_DEX_RULES.nests} 种巢穴物种；稀有物种 ${REGIONAL_DEX_RULES.rareMin}–${REGIONAL_DEX_RULES.rareMax} 种（锚定线可能超出上限）`, '巢穴、霸主有候选'],
    ['水面', `至少 ${REGIONAL_DEX_RULES.navalLines} 条含水面兵种的进化线`, '近海 / 远洋航行与小霞'],
    ['核心招募槽', '驯化、碎石工艺、近海航行、骑行驯服、特训法、飞行训练和各世代招募不能空', '秘传与开局招募不落空'],
  ];
  return table(['约束', '规则', '为什么'], rows);
}
export function recruitSlotTable(): string {
  return table(['招募槽', '首选', '兵种', '属性', '核心'], RECRUIT_SLOTS.map(slot => [slot.techId ? TREE_TECHS[slot.techId]?.name ?? slot.id : `第 ${slot.generation} 世代`,
    speciesName(slot.preferred), slot.role ? ROLE_NAMES[slot.role] ?? slot.role : '—', slot.types?.map(type => TYPE_NAMES[type]).join(' / ') ?? '—', slot.core ? '✓' : '']));
}
/** v25 species tags (src/content/species-tags.ts): the one row per species that the regional tables are generated from. */
export function speciesTagTable(): string {
  const habitat = (id: string) => Object.entries(SPECIES_TAGS[id].habitat ?? {}).map(([key, weight]) => `${(BIOME_NAMES as Record<string, string>)[key] ?? ({ hill: '丘陵', river: '河流', peakside: '高峰旁' } as Record<string, string>)[key]} ${weight}`).join('、');
  const slotName = (slot: string) => { const item = RECRUIT_SLOTS.find(entry => entry.id === slot)!; return item.techId ? TREE_TECHS[item.techId]?.name ?? slot : `第 ${item.generation} 世代`; };
  const rarity = { common: '常见', uncommon: '少见', rare: '稀有' } as const;
  return table(['宝可梦', '野外栖息地（权重）', '稀有度', '首选招募槽', '巢穴', '其他'], (Object.keys(SPECIES_TAGS).sort() as SpeciesId[]).filter(id => content.species[id]).map(id => {
    const tags = SPECIES_TAGS[id];
    return [speciesName(id), habitat(id) || '—', rarity[tags.rarity], (tags.recruit ?? []).map(slotName).join('、') || '—', tags.nest ? `权重 ${tags.nest}` : '—',
      [tags.iconic === 'anchor' ? '每局必有' : tags.iconic === 'favored' ? '抽取 2 票' : '', tags.draw ? `抽取 ${tags.draw} 票` : '', tags.wanderer ? '游荡' : '',
        tags.leader?.length ? `领袖专属（${tags.leader.map(leader => LEADERS[leader].name).join('、')}）` : ''].filter(Boolean).join('、') || '—'];
  }));
}
/** Stone evolutions of the latest content, for the prose ("皮卡丘、妙蛙草、…"). */
export const stoneEvolutionNames = (): string => stoneEvolutionsFor(content).map(path => speciesName(path.fromSpeciesId)).join('、');
export function regionalTargetTable(): string {
  const base = (roundLimit: 100 | 200 | 300) => Math.min(105, 18 + 3 + 5 + victoryTargets({ gameplayVersion: 25, roundLimit }).pokedexBonus);
  return table(['轮上限', 'v24 目标', '精简 48 种（池 71）', '完整 60 种（池 105）'], ([100, 200, 300] as const).map(roundLimit => [`${roundLimit} 轮`, String(base(roundLimit)),
    String(regionalPokedexTarget(base(roundLimit), REGIONAL_DEX_RULES.size['simple-v1'], 71)), String(regionalPokedexTarget(base(roundLimit), REGIONAL_DEX_RULES.size['full-v1'], 105))]), [1, 2, 3]);
}
export function gymLeaderTable(): string {
  return table(['精华', '馆主', '属性（按种子在组内选一种）', '家门口道馆'], GYM_LEADER_ORDER.map(id => [id === 'dragon' ? '（第 8 座）' : ESSENCES[id].name, GYM_LEADERS[id].name,
    GYM_TYPES[id].map(type => TYPE_NAMES[type]).join(' / '),
    (Object.entries(HOME_GYMS) as [SpeciesId, { leader: string; typeId: TypeId }][]).filter(([, home]) => home.leader === id).map(([starter, home]) => `${SPECIES_NAMES[starter]}开局（${TYPE_NAMES[home.typeId]}）`).join('、') || '—']));
}
export function gymTeamTable(): string {
  return table(['挑战者已有徽章', '馆主队伍', '队伍总战力', '胜利奖励金币'], GYM_RULES_V24.teams.map((row, badges) => [String(badges), `${row.members} 只${STAGE_NAMES[row.stage]}`, String(gymTeamPower(undefined, badges)),
    String(GYM_RULES_V24.reward.goldPerBadge * (badges + 1))]), [0, 2, 3]);
}
export function eliteFourTable(): string {
  return table(['场次', '对手', '属性', '队伍', '战力'], ELITE_FOUR.map((member, index) => [String(index + 1), `${member.title} ${member.name}`, member.typeIds.map(type => TYPE_NAMES[type]).join(' / '),
    `${member.members} 只三阶`, String(member.power)]), [0, 4]);
}
export function rivalTable(): string {
  return table(['登场', '轮次（提前 2 轮预告）', '队伍', '劲敌气势偏移', '击退奖励'], RIVAL_RULES_V24.arrivals.map((round, index) => {
    const reward = RIVAL_RULES_V24.rewards[index] as { gold: number; pokeBalls?: number; research?: number; xp?: number; eraScore: number };
    return [`第 ${index + 1} 次`, `第 ${round} 轮`, RIVAL_TEAMS[index].map(slot => `${slot.list === 'primary' ? '主克制' : '副克制'}${STAGE_NAMES[slot.stage]}`).join(' + '),
      `${RIVAL_RULES_V24.strengthOffsets[index] > 0 ? '+' : ''}${RIVAL_RULES_V24.strengthOffsets[index]}`,
      [`金币 ${reward.gold}`, reward.pokeBalls ? `精灵球 +${reward.pokeBalls}` : '', reward.research ? `科研 +${reward.research}` : '', reward.xp ? `参战宝可梦经验 +${reward.xp}` : '', `世代分 +${reward.eraScore}`].filter(Boolean).join('、')];
  }));
}
export function rivalCounterTable(): string {
  return table(['你的御三家', '主克制', '副克制'], (Object.entries(RIVAL_COUNTERS) as [SpeciesId, { primary: readonly SpeciesId[]; secondary: readonly SpeciesId[] }][]).map(([starter, counters]) =>
    [SPECIES_NAMES[starter], counters.primary.map(id => SPECIES_NAMES[id]).join('、'), counters.secondary.map(id => SPECIES_NAMES[id]).join('、')]));
}
