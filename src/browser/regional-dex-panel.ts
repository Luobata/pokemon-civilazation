// Gameplay v25 regional Pokédex (docs/design/roster-v25.md §2.8): the new-game summary, the Pokédex page laid out as the class × stage
// matrix (silhouettes for regional species not seen yet, how to get each one in the hover card) and the recruit wording. Public setup
// information only: the list comes from the view (or, before a game starts, from the same pure draw the authority uses).
import type { Content, SpeciesId } from '../content/units.ts';
import type { RegionalDexDraw } from '../content/regional-dex.ts';
import { RECRUIT_SLOTS } from '../content/recruit-slots.ts';
import { recruitSlotsFor, regionalSpeciesIds, stoneEvolutionsFor } from '../content/roster.ts';
import { CLASS_NAMES } from '../content/unit-classes.ts';
import type { UnitClass } from '../content/unit-classes.ts';
import { TREE_TECHS } from '../content/tech-tree.ts';
import type { PlayerView } from '../core/model.ts';
import { pokemonSpritePath } from './sprites.ts';
import { artImage, escapeAttr, statChip, uiIcon } from './ui-icons.ts';
import { isStarterRecord } from './dex-owned.ts';

const CLASS_ORDER: readonly UnitClass[] = ['melee', 'ranged', 'fast', 'scout', 'siege', 'air', 'naval'];
const STAGE_NAMES = ['一阶', '二阶', '三阶'] as const;
const BIOME_LABEL: Record<string, string> = { grassland: '草原', forest: '森林', mountain: '山地', ocean: '海洋', desert: '荒漠', snow: '雪原', volcano: '火山',
  hill: '丘陵', river: '河流', peakside: '高峰旁' };
const name = (content: Content, id: string) => content.species[id]?.name ?? id;
const escape = (text: string) => text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);

/** New-game summary chips: regional species, naval lines, flying species (roster-v25 §2.8). */
export function dexSummaryCounts(draw: Pick<RegionalDexDraw, 'speciesIds' | 'lines'>, content: Content) {
  const naval = draw.lines.filter(line => line.speciesIds.some(id => content.species[id]?.role === 'naval')).length;
  const flying = draw.speciesIds.filter(id => content.species[id]?.typeId === 'flying' || content.species[id]?.secondaryTypeId === 'flying').length;
  return { species: draw.speciesIds.length, naval, flying, lines: draw.lines.length };
}
export function dexSummaryMarkup(draw: Pick<RegionalDexDraw, 'speciesIds' | 'lines'>, content: Content): string {
  const counts = dexSummaryCounts(draw, content);
  const sprites = draw.speciesIds.map(id => artImage(pokemonSpritePath(id), { size: 32, label: name(content, id) })).join('');
  return `<p class="dex-summary-line" aria-label="地区图鉴：${counts.species} 种 · 水面 ${counts.naval} 线 · 飞行 ${counts.flying} 种">`
    + `${statChip('pokedex', counts.species, '地区图鉴物种')}${statChip('class:naval', `${counts.naval} 线`, '水面进化线')}`
    + `${statChip('type:flying', counts.flying, '飞行属性物种')}</p>`
    + `<details class="dex-summary-list"><summary>本局地区图鉴名单（${counts.lines} 条进化线）</summary><div class="dex-strip">${sprites}</div></details>`;
}

/** How a regional species can be obtained: wild habitats, recruit slot, nests, evolution from an earlier form (hover card text). */
export function acquisitionText(content: Content, speciesId: SpeciesId): string {
  const roster = content.roster, parts: string[] = [];
  const wild = Object.entries(roster?.spawnWeights ?? {}).filter(([, weights]) => (weights[speciesId] ?? 0) > 0).map(([biome]) => BIOME_LABEL[biome] ?? biome);
  const features = Object.entries(roster?.habitatOverlays ?? {}).filter(([, weights]) => (weights[speciesId] ?? 0) > 0).map(([key]) => BIOME_LABEL[key] ?? key);
  if (wild.length || features.length) parts.push(`野外：${[...wild, ...features].join('、')}`);
  const slot = recruitSlotsFor(content).find(item => item.speciesId === speciesId);
  if (slot) {
    const definition = RECRUIT_SLOTS.find(entry => entry.id === slot.slot)!;
    parts.push(definition.techId ? `招募：研究「${TREE_TECHS[definition.techId]?.name ?? definition.techId}」` : `招募：进入第 ${definition.generation} 世代`);
  }
  if (roster?.nestPriority.includes(speciesId)) parts.push('巢穴');
  const from = Object.entries(content.species).filter(([, definition]) => definition.evolution?.speciesId === speciesId || definition.branches?.some(option => option.speciesId === speciesId))
    .map(([id]) => id).concat(stoneEvolutionsFor(content).filter(path => path.intoSpeciesId === speciesId).map(path => path.fromSpeciesId))
    .filter((id, index, list) => list.indexOf(id) === index && regionalSpeciesIds(content).includes(id as SpeciesId));
  if (from.length) parts.push(`进化自 ${from.map(id => name(content, id)).join('、')}`);
  return parts.join('；') || '仅通过对战记录';
}

/**
 * The v25 Pokédex card body: "documented / target / regional" chips, then the class × stage grid of the regional Pokédex. Species not seen
 * yet are silhouettes but still named; every entry's hover card says how to get it.
 */
export function regionalDexMarkup(view: PlayerView, content: Content): string {
  type DexRecord = { speciesId: SpeciesId; observed: boolean; battled: boolean; captured: boolean };
  const ids = regionalSpeciesIds(content), records: Partial<Record<SpeciesId, DexRecord>> = view.expansion?.world.player?.pokedex ?? {};
  const regional = new Set(ids);
  const all = Object.values(records) as DexRecord[];
  const documented = all.filter(record => regional.has(record.speciesId) && record.observed && (record.battled || record.captured)).length;
  const target = view.expansion?.world.victory?.targetDocumentedSpecies ?? 0;
  const entry = (id: SpeciesId) => {
    const record = records[id], seen = Boolean(record?.observed), done = seen && Boolean(record?.battled || record?.captured);
    // Playtest 2026-11 B6: the starter is recorded as captured but shown as owned (拥有), as in the classic Pokédex card.
    const starter = Boolean(record && isStarterRecord(view, record));
    const status = done ? (starter ? '拥有（初始伙伴）' : record!.captured ? '已捕捉' : '已对战') : seen ? '已观察' : '未见过';
    const label = `${name(content, id)} · ${status} · ${acquisitionText(content, id)}`;
    return `<span class="dex-entry${done ? ' documented' : ''}${seen ? '' : ' dex-silhouette'}" data-species="${id}" title="${escapeAttr(label)}">`
      + `${artImage(pokemonSpritePath(id), { size: 40, label })}${starter ? uiIcon('star', { size: 12, className: 'dex-mark' }) : record?.captured ? uiIcon('pokeBall', { size: 12, className: 'dex-mark' }) : done ? uiIcon('swords', { size: 12, className: 'dex-mark' }) : ''}`
      + `<small class="dex-name">${escape(name(content, id))}</small></span>`;
  };
  const rows = CLASS_ORDER.map(role => {
    const cells = [1, 2, 3].map(stage => ids.filter(id => content.species[id]?.role === role && content.species[id]?.stage === stage));
    return `<tr><th scope="row">${uiIcon(`class:${role}`, { size: 18, label: `${CLASS_NAMES[role]}兵种` })}</th>${cells.map((cell, index) =>
      `<td aria-label="${CLASS_NAMES[role]}${STAGE_NAMES[index]}">${cell.length ? cell.map(entry).join('') : '<span class="dex-empty" title="本地区没有" aria-label="本地区没有">—</span>'}</td>`).join('')}</tr>`;
  }).join('');
  return `<p class="world-stats" id="regional-dex-stats">${statChip('pokedex', `${documented}/${target}`, '完整记录 / 图鉴胜利目标')}${statChip('map', ids.length, '本地区物种')}`
    + `${statChip('class:scout', all.filter(record => regional.has(record.speciesId) && record.observed).length, '已观察的本地区物种')}</p>`
    + `<p class="unit-note">本局地区图鉴共 ${ids.length} 种，只有它们会在野外、巢穴、招募、劲敌和道馆里出现；只记录本地区物种。灰色剪影是还没见过的，悬停查看获得方式。</p>`
    + `<table class="regional-dex" id="regional-dex"><thead><tr><th scope="col">兵种</th>${STAGE_NAMES.map(stage => `<th scope="col">${stage}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}
