import { DISTRICTS, DISTRICT_IDS, districtTech } from '../content/districts.ts';
import type { DistrictEffects, DistrictId } from '../content/districts.ts';
import { EXPANSION_CONTENT, WORLD_CONTENT, techOf } from '../content/units.ts';
import { cityDistrictDetails, districtSites } from '../core/districts.ts';
import type { DistrictBreakdown, DistrictSite } from '../core/districts.ts';
import { indexToHex } from '../core/hex.ts';
import type { PlayerView } from '../core/model.ts';
import { BIOME_DISPLAY } from './canvas.ts';
import { uiIcon } from './ui-icons.ts';
import type { UiIconName } from './ui-icons.ts';
import { civHint } from './civ-hint.ts';

const EFFECT_LABELS: Record<keyof DistrictEffects, string> = {
  food: '食物', production: '生产', gold: '金币', research: '科研', trainedXp: '宝可梦出场经验', bondPressure: '每轮羁绊压力',
};
export function districtReason(reason: string | null, kind: DistrictId, gameplayVersion?: number): string {
  if (!reason) return '';
  const tree = (gameplayVersion ?? 0) >= 22, definition = DISTRICTS[kind], tech = techOf(tree ? WORLD_CONTENT : EXPANSION_CONTENT, districtTech(kind, tree)).name;
  const biomes = definition.biomes.map(biome => BIOME_DISPLAY[biome].label).join('、');
  const messages: Record<string, string> = {
    'districts-unavailable': '当前对局未启用设施区，需要显式 gameplay v10。',
    'unknown-district': '未知的设施区类型，请重新选择。',
    'city-unavailable': '请先选择一座当前可下单的己方城市。',
    'district-tech-locked': `尚未研究「${tech}」，完成后即可建造。`,
    'unknown-tile': '只能选择当前可见且已知的地块。',
    'city-center': '城市中心格不能建造设施区。',
    'outside-city-territory': '目标格必须在所选城市的当前领地与工作距离内。',
    'wrong-biome': `地形不符合要求：${definition.name}需要${biomes}。`,
    'harbor-needs-coast': '港口需要相邻一块已探索的陆地。',
    'district-tile-occupied': '该格已有设施区或设施区订单。',
    'tile-improved-or-under-construction': '地块改良与设施区不能共用一格，请选择其他地块。',
    'rare-berry-deposit': '稀有树果矿点必须保留，不能建造设施区。',
    'contested-territory': '目标格属于其他文明领地，不能在这里下单。',
    'district-kind-limit': '每座城市每种设施区最多一个，包含队列中的订单。',
    'district-city-limit': '每座城市最多两个设施区，包含队列中的订单。',
  };
  return messages[reason] ?? `当前不可建造（${reason}）。`;
}

function effectText(effects: DistrictEffects): string {
  return (Object.keys(EFFECT_LABELS) as (keyof DistrictEffects)[])
    .filter(key => effects[key] !== 0).map(key => `${EFFECT_LABELS[key]} +${effects[key]}`).join(' · ') || '无';
}

function breakdownMarkup(effects: DistrictBreakdown): string {
  return `<dl class="district-effects"><dt>基础效果</dt><dd>${effectText(effects.base)}</dd>${effects.adjacency.map(rule =>
    `<dt>相邻 · ${rule.label}</dt><dd>${EFFECT_LABELS[rule.effect]} +${rule.value}（已知来源 ${rule.tileIndices.length} 格，封顶 ${rule.cap}）</dd>`).join('')}
    <dt>当前已知合计</dt><dd><strong>${effectText(effects.total)}</strong></dd></dl>
    ${effects.incomplete ? `<p class="district-incomplete">部分相邻格未知（${effects.unknownAdjacentTileIds.length}），实际效果可能更高。</p>` : ''}`;
}

export function districtTypeCards(view: PlayerView, cityId: number, disabled: boolean): string {
  const city = view.economy.cities.find(item => item.id === cityId);
  return `<div class="district-type-grid">${DISTRICT_IDS.map(kind => {
    const definition = DISTRICTS[kind], sites = districtSites(view, cityId, kind), available = sites.some(site => site.reason === null);
    const reason = available ? null : sites.find(site => site.reason === 'district-kind-limit')?.reason
      ?? sites.find(site => site.reason === 'district-city-limit')?.reason ?? sites.find(site => site.reason === 'district-tech-locked')?.reason ?? sites[0]?.reason ?? null;
    const queueFull = (city?.queue.length ?? 0) >= 5, blocked = disabled || !available || queueFull;
    const reasonText = queueFull ? '生产队列已满 5 项，请先完成或取消订单。' : districtReason(reason, kind, view.gameplayVersion);
    return `<button type="button" class="district-type-card" data-district-kind="${kind}" aria-label="${definition.name}，${definition.cost} 生产${reasonText ? `，${reasonText}` : ''}" ${blocked ? 'disabled' : ''}>
      <span class="district-mark has-icon">${uiIcon(kind as UiIconName, { size: 28 })}</span><strong>${definition.name}</strong><span>${uiIcon('production', { size: 14 })}${definition.cost} 生产</span>
      <small>${definition.biomes.map(biome => BIOME_DISPLAY[biome].label).join('、')}${definition.coastal ? ' · 须临岸' : ''} · ${effectText(definition.base)}</small>
      ${reasonText ? `<small class="district-reason">${reasonText}</small>` : ''}</button>`;
  }).join('')}</div>`;
}

export function districtPreviewMarkup(view: PlayerView, site: DistrictSite, disabled: boolean): string {
  const definition = DISTRICTS[site.kind], position = indexToHex(site.tileIndex, view.map), biome = view.map.tiles[site.tileIndex];
  return `<section id="district-preview" class="district-preview" aria-label="设施区选址预览"><p class="eyebrow">设施区选址</p><h3>${definition.name} · 地块 ${site.tileIndex}（${position.q},${position.r}）</h3>
    <p>当前地形：${biome ? BIOME_DISPLAY[biome].label : '未知'}</p>${breakdownMarkup(site.effects)}
    ${site.releasesWork ? `<p class="district-release">下单后，城市 ${site.releasedCityIds.join('、')} 将释放该格工作与锁定；对应人口成为观测者，不自动改派。</p>` : ''}
    ${site.reason ? `<p class="district-reason" role="status">${districtReason(site.reason, site.kind, view.gameplayVersion)}</p>` : ''}
    <div class="district-preview-actions">${site.reason === null ? `<button id="confirm-district" class="primary" ${disabled ? 'disabled' : ''}>确认入队</button>` : ''}<button id="cancel-district">取消选址</button></div></section>`;
}

export function cityDistrictMarkup(view: PlayerView, cityId: number): string {
  const districts = view.expansion?.districts;
  if (!districts) return '';
  const completed = cityDistrictDetails(view, cityId), projects = districts.projects.filter(item => item.cityId === cityId);
  return `<section id="city-districts" class="city-districts" aria-label="城市设施区"><p class="section-label">设施区 ${completed.length + projects.length}/2 ${civHint('district')}</p>
    ${completed.map(item => {
      const definition = DISTRICTS[item.kind], position = indexToHex(item.tileIndex, view.map);
      return `<details class="district-detail" data-district-tile="${item.tileIndex}"><summary><span class="district-mark has-icon">${uiIcon(item.kind as UiIconName, { size: 20 })}</span>${definition.name} · 地块 ${item.tileIndex}（${position.q},${position.r}）${item.active ? '' : ' · 停用'}</summary>
        ${item.ownerId === null ? '<p class="district-reason">当前停用</p>' : ''}${breakdownMarkup(item.effects)}</details>`;
    }).join('')}
    ${projects.map(item => `<p class="district-project" data-district-project="${item.orderId}">${uiIcon(item.kind as UiIconName, { size: 18 })}${uiIcon('construction', { size: 12, label: '在建' })} ${DISTRICTS[item.kind].name} · 地块 ${item.tileIndex} · 在建 ${item.progress}/${DISTRICTS[item.kind].cost}</p>`).join('')}
    ${completed.length + projects.length ? '' : '<p class="empty-note">尚未建造设施区。</p>'}</section>`;
}

export function constructionNotice(view: PlayerView, tileIndex: number): string | null {
  const site = view.expansion?.districts?.constructionSites?.find(item => item.tileIndex === tileIndex);
  return site ? `文明 ${site.ownerId + 1} · 施工中` : null;
}
