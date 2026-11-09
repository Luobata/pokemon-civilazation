import { ROLE_POKEMON } from '../content/roles.ts';
import { LEGEND_WONDERS } from '../content/legend-wonders.ts';
import { legendEffectText } from './legend-panel.ts';
import { stoneEvolutionsFor } from '../content/roster.ts';
import { promotionMovement } from '../core/promotions.ts';
// Describes one map tile from the viewing player's knowledge only (PlayerView): terrain, yields,
// ownership and everything standing on it, each with a relation tone and a short "what can I do".
// Pure (no DOM): shared by the hover tooltip and the click inspector, and tested in Node.
import { promotionLine } from './promotion-panel.ts';
import { DISTRICTS } from '../content/districts.ts';
import { ESSENCES, BIOME_ESSENCE } from '../content/essences.ts';
import { CREW_SPECIALTIES, IMPROVEMENTS } from '../content/improvements.ts';
import { LEADERS } from '../content/leaders.ts';
import { RARE_BERRIES, RARE_BERRY_RULES } from '../content/rare-berries.ts';
import type { RareBerryId } from '../content/rare-berries.ts';
import { SPECIES_NAMES } from '../content/species.ts';
import type { TypeId } from '../content/species.ts';
import { TYPE_NAMES } from '../content/type-names.ts';
import { unitDefinition, contentForView } from '../content/units.ts';
import { WORLD_DEFINITIONS } from '../content/world-systems.ts';
import type { BerryId, StoneId } from '../content/world-systems.ts';
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import { civAside } from '../content/civ-glossary.ts';
import { hexDistance, hexToIndex, indexToHex } from '../core/hex.ts';
import type { PlayerView } from '../core/model.ts';
import { maxUnitHp } from '../core/unit.ts';
import type { Yield } from '../content/economy.ts';
import { BIOME_DISPLAY } from './canvas.ts';
import { tileYieldReader } from './tile-yields.ts';

/** own = yours; ally/peace/enemy = another civilization by relation; wild = wild Pokémon; neutral = no owner. */
export type Tone = 'own' | 'peace' | 'enemy' | 'neutral' | 'wild' | 'info';
export type TileEntity = { kind: 'city' | 'unit' | 'resource' | 'luxury' | 'nest' | 'overlord' | 'sanctuary' | 'legend' | 'improvement' | 'district' | 'construction';
  tone: Tone; title: string; subtitle: string; lines: string[]; hint?: string; unitId?: number; cityId?: number };
export type TileInfo = {
  index: number;
  /** null: never explored. */
  terrain: { name: string; moveCost: number; defense: string | null; essence: string; access: string } | null;
  visible: boolean;
  yields: Yield | null; workable: boolean;
  territory: { tone: Tone; text: string };
  workedBy: number | null;
  entities: TileEntity[];
};

const civName = (view: PlayerView, id: number) => {
  const leader = view.civilizations.find(civ => civ.id === id)?.leaderId;
  return `文明 ${id + 1}${leader ? `（${LEADERS[leader].name}）` : ''}`;
};
export function relationTone(view: PlayerView, ownerId: number | null): Tone {
  if (ownerId === null) return 'neutral';
  if (ownerId === view.playerId) return 'own';
  const pair = view.diplomacy.find(item => item.a === Math.min(ownerId, view.playerId) && item.b === Math.max(ownerId, view.playerId));
  return pair?.status === 'war' ? 'enemy' : 'peace';
}
const RELATION_TEXT: Record<Tone, string> = { own: '你的', peace: '和平', enemy: '交战中', neutral: '中立', wild: '野生', info: '' };
const typeText = (types: readonly (TypeId | undefined)[]) => types.filter((type): type is TypeId => !!type).map(type => TYPE_NAMES[type]).join(' / ');
const ROLE_NAMES = { ranged: '远程', melee: '近战', scout: '侦察', fast: '快速', siege: '攻城', naval: '水面', air: '飞行' } as const;

export function describeTile(view: PlayerView, index: number): TileInfo {
  const content = contentForView(view);
  const biome = view.map.tiles[index] ?? null;
  const visible = view.visibleTileIds.includes(index);
  const hex = indexToHex(index, view.map);
  const at = (position: { q: number; r: number }) => hexToIndex(position, view.map) === index;
  const empty: TileInfo = { index, terrain: null, visible: false, yields: null, workable: false,
    territory: { tone: 'info', text: '尚未探索' }, workedBy: null, entities: [] };
  if (!biome) return empty;

  const essence = ESSENCES[BIOME_ESSENCE[biome]];
  const defense = biome === 'forest' || biome === 'mountain' ? `防守方受伤 ×0.8${biome === 'mountain' ? '；从山地出手 ×1.2' : ''}` : null;
  const access = biome === 'ocean' ? '水面、杰尼龟一系和飞行宝可梦可进入' : biome === 'volcano' ? '火系与飞行宝可梦可进入，开拓队不能' : '陆地单位和开拓队可进入';
  const terrain = { name: BIOME_DISPLAY[biome].label, moveCost: content.moveCosts[biome], defense,
    essence: `${essence.name}精华（${essence.types.map(type => TYPE_NAMES[type]).join('、')}系在此防守受伤 ×0.9）`, access };
  const yieldInfo = tileYieldReader(view)(index);

  const owners = view.territoryOwnerIds[index];
  const territory: TileInfo['territory'] = owners === null ? { tone: 'info', text: '领土情况未知' }
    : !owners.length ? { tone: 'neutral', text: '无主之地' }
    : owners.includes(view.playerId) ? { tone: 'own', text: owners.length > 1 ? '你的领土（与他国重叠）' : '你的领土' }
    : { tone: relationTone(view, owners[0]), text: `${owners.map(id => civName(view, id)).join('、')} 的领土` };
  const workedBy = view.economy.cities.find(city => city.workedTileIds.includes(index))?.id ?? null;

  const entities: TileEntity[] = [];
  const city = view.cities.find(item => at(item.position));
  if (city) {
    const tone = relationTone(view, city.ownerId), own = view.economy.cities.find(item => item.id === city.id);
    const capital = city.headquartersOf !== undefined && city.headquartersOf !== null;
    const combat = view.combat.cities[city.id];
    if (city.ownerId === null) {
      entities.push({ kind: 'city', tone, cityId: city.id, title: `中立营地 ${city.id}`, subtitle: `脱离了原文明的城市${civAside('neutralCamp')}`,
        lines: [`HP ${combat?.hp ?? '未知'}`, '不属于任何文明，不产出也不能工作。'],
        hint: view.expansion?.bonds ? '在己方城市 6 格内可花 80 金和平收复；也可以攻打占领。' : '可以攻打占领。' });
    } else if (own) {
      entities.push({ kind: 'city', tone, cityId: city.id, title: `城市 ${city.id}${capital ? ' · 首都' : ''}`, subtitle: '你的城市',
        lines: [`人口 ${own.population} · HP ${own.hp}`, `每轮 食物 ${own.yields.food} · 生产 ${own.yields.production} · 金币 ${own.yields.gold} · 科研 ${own.yields.research}`],
        hint: '点击城市打开生产与地块管理。' });
    } else {
      entities.push({ kind: 'city', tone, cityId: city.id, title: `城市 ${city.id}${capital ? ' · 首都' : ''}`, subtitle: `${civName(view, city.ownerId)} · ${RELATION_TEXT[tone]}`,
        lines: [`HP ${combat?.hp ?? '未知'}${combat ? ` · 反击攻击力 ${combat.counterAttack}` : ''}`, ...(capital ? ['首都被占领，该文明即出局。'] : [])],
        hint: tone === 'enemy' ? '交战中：可以用宝可梦攻击这座城市。' : '和平：需先在外交页面宣战才能攻击。' });
    }
  }
  const rampaging = new Set(view.expansion?.world.rampagingUnitIds ?? []);
  for (const unit of view.units.filter(item => at(item.position))) {
    const definition = unitDefinition(unit, content);
    const tone: Tone = unit.ownerId === null ? 'wild' : relationTone(view, unit.ownerId);
    if (unit.kind === 'logistics') {
      entities.push({ kind: 'unit', tone, unitId: unit.id, title: definition.name, subtitle: (unit.ownerId === null ? '野生' : unit.ownerId === view.playerId ? '你的单位' : `${civName(view, unit.ownerId)} · ${RELATION_TEXT[tone]}`) + civAside(unit.role),
        lines: [`${ROLE_POKEMON[unit.role].unitName}（${ROLE_POKEMON[unit.role].species}）：${ROLE_POKEMON[unit.role].job}，不能战斗。${unit.role === 'builder' && unit.charges !== undefined && unit.ownerId === view.playerId ? `还能建 ${unit.charges} 处。` : ''}`],
        hint: unit.ownerId === view.playerId ? { settler: '选中后点“建立城市”，或移动到别处。', builder: '选中后站到己方地块上，点改良按钮。', trader: '选中后走到另一座己方城市旁，开通商路。' }[unit.role] : tone === 'enemy' ? '交战中：没有战斗力，可以攻击。' : undefined });
      continue;
    }
    const species = content.species[unit.speciesId];
    const lines = [`${typeText([species.typeId, species.secondaryTypeId])} · ${ROLE_NAMES[species.role]} · 第 ${species.stage} 阶段`,
      `HP ${unit.hp}/${maxUnitHp(unit, content)} · 攻 ${species.attack} · 防 ${species.defense} · 移动 ${species.move + promotionMovement(view, unit.id)} · 射程 ${species.range}`];
    if (unit.enraged) lines.push('被激怒：下一次攻击伤害 ×1.2');
    const promotion = promotionLine(view, unit.id);
    if (promotion) lines.push(promotion);
    let subtitle: string, hint: string | undefined;
    if (unit.ownerId === null) {
      subtitle = rampaging.has(unit.id) ? `暴走宝可梦 · 来自巢穴${civAside('rampaging')}` : '野生宝可梦';
      hint = rampaging.has(unit.id) ? '会主动攻击任何文明附近的单位和城市。击倒或捕捉它。'
        : `相邻时可用精灵球捕捉，HP 越低越容易${species.rare ? '（稀有，成功率减半）' : ''}；也可以攻击。`;
    } else if (unit.ownerId === view.playerId) {
      subtitle = '你的宝可梦'; hint = unit.actionLeft ? '本回合还能行动：点击选中它。' : '本回合已行动。';
    } else {
      subtitle = `${civName(view, unit.ownerId)} · ${RELATION_TEXT[tone]}`;
      hint = tone === 'enemy' ? '交战中：可以攻击；近战/快速型会阻挡你的移动。' : '和平：不能攻击，需先宣战。';
    }
    entities.push({ kind: 'unit', tone, unitId: unit.id, title: SPECIES_NAMES[unit.speciesId] + (unit.uniqueLeader ? ' · 领袖专属' : ''), subtitle, lines, hint });
  }

  const expansion = view.expansion;
  const luxury = expansion?.rareBerries?.deposits.find(item => item.tileIndex === index);
  if (luxury) {
    const berry = RARE_BERRIES[luxury.berry as RareBerryId], owned = (expansion!.rareBerries!.owned[luxury.berry as RareBerryId] ?? 0) > 0;
    entities.push({ kind: 'luxury', tone: 'info', title: `${berry.name} · 稀有树果`, subtitle: '奢侈品资源',
      lines: [`每拥有一种：满意度 +${RARE_BERRY_RULES.satisfactionPerType}/轮，所有城市羁绊 +${RARE_BERRY_RULES.bondPerType}/轮。`, `拥有 ${RARE_BERRY_RULES.festivalTypes} 种以上：每城食物 +1（庆典）。`, owned ? '你已拥有这种树果。' : '你还没有这种树果。'],
      hint: '让城市耕作这一格就算拥有。设施区不能建在这里。' });
  }
  const resource = expansion?.world.resources.find(item => item.tileIndex === index);
  if (resource?.kind === 'berry') {
    const berry = WORLD_DEFINITIONS.berries[resource.definitionId as BerryId];
    entities.push({ kind: 'resource', tone: 'info', title: berry.name, subtitle: '树果丛',
      lines: [`采集：食物 +${berry.food}（送到最近城市），满意度 +${berry.satisfaction}`, `剩余 ${resource.remaining}/${resource.maximum} 次${resource.regrowsAtRound ? ` · 第 ${resource.regrowsAtRound} 轮再生` : ''}`, `城市耕作这一格：食物 +${Math.max(1, Math.floor(berry.food / 4))}`],
      hint: '单位站在上面、3 格内有你的城市时可以采集。' });
  } else if (resource?.kind === 'stone') {
    const stone = WORLD_DEFINITIONS.stones[resource.definitionId as StoneId];
    const uses = stoneEvolutionsFor(content).filter(path => path.stoneId === resource.definitionId).map(path => `${SPECIES_NAMES[path.fromSpeciesId]} → ${SPECIES_NAMES[path.intoSpeciesId]}`);
    entities.push({ kind: 'resource', tone: 'info', title: stone.name, subtitle: resource.remaining ? '进化石矿脉' : '已采空的矿脉',
      lines: [`用途：${uses.join('、')}`, '城市耕作这一格：生产 +1'], hint: resource.remaining ? '宝可梦站在上面可以采集，只能采一次。' : undefined });
  }
  const nest = expansion?.world.nests.find(item => item.tileIndex === index);
  if (nest) entities.push({ kind: 'nest', tone: 'wild', title: `${SPECIES_NAMES[nest.speciesId]}巢穴`, subtitle: `威胁${civAside('nest')}`,
    lines: [...(nest.nextSpawnRound <= view.round + 1 ? ['⚠ 下一轮就会派出暴走宝可梦！把开拓队和工匠撤离，或派宝可梦守住。'] : []), `HP ${nest.hp}/${nest.maxHp} · 第 ${nest.nextSpawnRound} 轮刷出下一只`, `每 ${WORLD_DEFINITIONS.nests.spawnIntervalRounds} 轮刷出暴走宝可梦，它们会攻击所有文明。`],
    hint: `宝可梦在射程内攻击巢穴可清除，奖励 ${WORLD_DEFINITIONS.nests.clearGoldReward} 金 + ${WORLD_DEFINITIONS.nests.clearSatisfactionReward} 满意度。` });
  const ball = expansion?.opening?.itemBalls.find(item => item.tileIndex === index);
  if (ball) entities.push({ kind: 'resource', tone: 'info', title: '道具球', subtitle: `探索奖励${civAside('itemBall')}`,
    lines: ['里面装着一件随机道具：金币、科研、精灵球、树果或学习装置。'], hint: '任何己方单位走到这一格就会捡起来，先到先得。' });
  const overlord = expansion?.world.overlords.find(item => item.tileIndex === index);
  if (overlord) {
    const rules = WORLD_DEFINITIONS.overlords;
    const tier = overlord.bond >= rules.tier3Bond ? 3 : overlord.bond >= rules.tier2Bond ? 2 : overlord.bond >= rules.tier1Bond ? 1 : 0;
    const next = [rules.tier1Bond, rules.tier2Bond, rules.tier3Bond][tier];
    entities.push({ kind: 'overlord', tone: 'neutral', title: `霸主 · ${SPECIES_NAMES[overlord.speciesId]}`, subtitle: `中立势力${civAside('overlord')}`,
      lines: [`你的羁绊 ${overlord.bond}${next !== undefined ? ` / 下一级 ${next}` : '（已满级）'} · 当前 ${tier} 级`,
        `1 级：周围 ${rules.tier1VisionRadius} 格视野；2 级：3 格内城市 食物/生产/金币 +1；3 级：再加金币 +1、科研 +1。`],
      hint: `你的城市在 ${rules.reach} 格内时可供奉（${rules.foodCost} 食物或 ${rules.goldCost} 金），每次羁绊 +${rules.bondPerOffering}。` });
  }
  const sanctuary = expansion?.civilization.sanctuaries.find(item => at(item.position));
  if (sanctuary && visible) {
    const owner = sanctuary.ownerId;
    entities.push({ kind: 'sanctuary', tone: owner === null ? 'neutral' : relationTone(view, owner), title: sanctuary.name, subtitle: owner === null ? '无主圣所' : owner === view.playerId ? '你的圣所' : `${civName(view, owner)} 的圣所`,
      lines: [`守卫：${sanctuary.guardianName}（${SPECIES_NAMES[sanctuary.guardianSpeciesId]}）${sanctuary.guardianDefeated ? ' · 已击败' : ''}`, `击败守卫获得${sanctuary.tabletName}；集齐 ${CIVILIZATION_CONTENT.sanctuaries.definitions.length} 块即起源胜利。`],
      hint: owner === null ? `单位站在上面花 ${CIVILIZATION_CONTENT.sanctuaries.establishmentCost} 金即可建立，永久归你。` : owner === view.playerId && !sanctuary.guardianDefeated ? '带 1–3 只宝可梦（2 格内）挑战守卫。' : undefined });
  }
  // v15: a legend's trace site (shared by everyone; walking a Pokémon onto it yields that civilization's clue).
  const trace = expansion?.legends?.sites.find(site => site.tileIndex === index);
  if (trace && !expansion!.legends!.wonders.some(wonder => wonder.legendId === trace.legendId)) {
    const legends = expansion!.legends!, legend = LEGEND_WONDERS[trace.legendId], hasClue = legends.clues.includes(trace.legendId);
    const observing = view.economy.player.research.unlockedIds.includes('fieldObservation');
    entities.push({ kind: 'legend', tone: 'info', title: `传说踪迹 · ${legend.name}`, subtitle: `第 ${legend.generation} 世代 · ${legend.wonderName}`,
      lines: [hasClue ? '你已经得到这条线索，可以在合适的城市建造奇观。' : '派一只宝可梦站到这里，就能得到这位传说的线索（剧情第一章）。',
        `奇观效果：${legendEffectText(trace.legendId)}`],
      hint: hasClue ? '打开顶栏「传说」查看剧情与可建造的城市。' : observing ? '任何宝可梦走到这一格，回合内即可记录。' : '需要先研究「野外观察」。' });
  }
  const improvement = expansion?.improvements?.tiles.find(item => item.tileIndex === index);
  if (improvement) {
    const definition = IMPROVEMENTS[improvement.kind];
    const crew = improvement.crew ? CREW_SPECIALTIES[improvement.crew] : undefined;
    entities.push({ kind: 'improvement', tone: 'info', title: `${definition.name}${improvement.damaged ? '（已损坏）' : ''}`, subtitle: `地块改良${civAside('improvement')}`,
      lines: [definition.description, ...(crew ? [`随行特长「${crew.name}」：${crew.label}`] : []),
        ...(improvement.damaged ? [`第 ${improvement.damagedAtRound} 轮被掠夺，修好之前没有产出；己方工匠站上去即可修复（不消耗次数）。`] : [])] });
  }
  const project = expansion?.improvements?.projects.find(item => item.tileIndex === index);
  if (project) entities.push({ kind: 'construction', tone: 'own', title: `${IMPROVEMENTS[project.kind].name}（施工中）`, subtitle: '你的改良工程', lines: [`进度 ${project.progress}/3`] });
  const district = expansion?.districts?.tiles.find(item => item.tileIndex === index);
  if (district) {
    const tone = relationTone(view, district.ownerId);
    entities.push({ kind: 'district', tone, title: DISTRICTS[district.kind].name, subtitle: (district.ownerId === null ? '停用的设施区（中立）' : district.ownerId === view.playerId ? `城市 ${district.cityId} 的设施区` : `${civName(view, district.ownerId)} 的设施区`) + civAside('district'),
      lines: [`占用整格，不能耕作。${!visible && district.ownerId !== view.playerId ? `（第 ${district.lastSeenRound} 轮所见）` : ''}`] });
  }
  const districtProject = expansion?.districts?.projects.find(item => item.tileIndex === index);
  if (districtProject) entities.push({ kind: 'construction', tone: 'own', title: `${DISTRICTS[districtProject.kind].name}（建造中）`, subtitle: `城市 ${districtProject.cityId} 的生产队列`,
    lines: [`进度 ${districtProject.progress}/${DISTRICTS[districtProject.kind].cost}`] });
  const site = expansion?.districts?.constructionSites?.find(item => item.tileIndex === index);
  if (site) entities.push({ kind: 'construction', tone: relationTone(view, site.ownerId), title: '施工中', subtitle: civName(view, site.ownerId),
    lines: [site.category === 'district' ? '他国正在建造设施区。' : '他国正在修建改良。'], hint: '这一格暂时不能建设施区。' });

  // Nearest own city tells the player whether this tile can join their territory.
  if (!workedBy && territory.tone === 'neutral') {
    const near = view.economy.cities.map(item => hexDistance(item.position, hex, view.map)).sort((a, b) => a - b)[0];
    if (near !== undefined && near <= 3) territory.text += `（离你的城市 ${near} 格，城市长大后可纳入）`;
  }
  return { index, terrain, visible, yields: yieldInfo?.yields ?? null, workable: yieldInfo?.workable ?? false, territory, workedBy, entities };
}

/** One-line hover text: the most important thing on the tile, then the terrain. */
export function tileSummary(info: TileInfo): string {
  if (!info.terrain) return '未探索区域';
  const top = info.entities[0];
  const terrain = `${info.terrain.name}${info.visible ? '' : '（记忆）'}`;
  return top ? `${top.title} · ${top.subtitle} — ${terrain}` : `${terrain} · ${info.territory.text}`;
}
