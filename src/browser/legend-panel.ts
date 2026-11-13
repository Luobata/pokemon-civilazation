// Gameplay v15 UI: legendary wonders (production cards, the 传说 screen, story cards). Reads the PlayerView only.
import { LEGEND_CLUE_TEXT, LEGEND_WONDERS, LEGEND_WONDER_IDS, legendCost } from '../content/legend-wonders.ts';
import { legendRaceMarkup } from './late-game-ui.ts';
import type { LegendWonderId } from '../content/legend-wonders.ts';
import { LEGEND_STORIES } from '../content/legend-stories.ts';
import { BIOME_DISPLAY } from './canvas.ts';
import { legendSiteBiome, viewLegendBlocker } from '../core/legends.ts';
import type { LegendView } from '../core/legends.ts';
import type { PlayerView } from '../core/model.ts';
import { civHint } from './civ-hint.ts';

type ViewCity = PlayerView['economy']['cities'][number];
const YIELD_NAMES = { food: '食物', production: '生产', gold: '金币', research: '科研' } as const;
const EFFECT_NAMES: Record<string, string> = { visionBonus: '城市视野', trainedXp: '新训练宝可梦经验', healing: '宝可梦每轮恢复', captureBonus: '捕捉成功率',
  trainingDiscountPercent: '训练花费 −%', cityFood: '每城食物', cityGold: '每城金币', cityResearch: '每城科研', cityProduction: '每城生产' };
export const legendSprite = (id: LegendWonderId) => {
  const dex = LEGEND_WONDERS[id].dex;
  return `/sprites/${dex <= 386 ? 'gen3' : dex <= 493 ? 'gen4' : dex <= 649 ? 'gen5' : dex <= 721 ? 'gen6' : dex <= 809 ? 'gen7' : dex <= 905 ? 'gen8' : 'gen9'}/${dex}.png`;
};
export const legendTitle = (id: LegendWonderId) => `${LEGEND_WONDERS[id].name} · ${LEGEND_WONDERS[id].wonderName}`;
export function legendEffectText(id: LegendWonderId): string {
  const legend = LEGEND_WONDERS[id];
  const city = Object.entries(legend.cityYield).map(([key, value]) => `${YIELD_NAMES[key as keyof typeof YIELD_NAMES]} +${value}`).join('、');
  const empire = Object.entries(legend.effects).map(([key, value]) => key === 'trainingDiscountPercent' ? `训练花费 −${value}%` : `${EFFECT_NAMES[key] ?? key} +${value}`).join('、');
  return `所在城市 ${city}；整个文明 ${empire}`;
}
const siteText = (legends: LegendView, id: LegendWonderId) => {
  const biome = legendSiteBiome(legends, id);
  return biome ? `城市范围内要有${BIOME_DISPLAY[biome].label}` : '任意城市';
};

/** Why this city cannot start the wonder, as player-facing text (null = it can). */
export function legendStartBlocker(view: PlayerView, city: ViewCity, id: LegendWonderId): string | null {
  const reason = viewLegendBlocker(view, city, id), legends = view.expansion?.legends;
  if (!reason) return null;
  return { unavailable: '本局没有传说奇观', built: '已被建成', 'no-clue': '还没有线索', generation: `需要进入第 ${LEGEND_WONDERS[id].generation} 时代`,
    elsewhere: '另一座城市正在建造', queued: '已在本城队列中', site: legends ? siteText(legends, id) : '' }[reason];
}
export const buildableLegends = (view: PlayerView, city: ViewCity) => LEGEND_WONDER_IDS.filter(id => legendStartBlocker(view, city, id) === null);

/** Production tab body: every legend with a clue, buildable or not, with the reason. */
export function legendProductionMarkup(view: PlayerView, city: ViewCity): string {
  const legends = view.expansion?.legends;
  if (!legends) return '';
  const known = legends.clues.filter(id => !legends.wonders.some(wonder => wonder.legendId === id));
  if (!known.length) return '<p class="empty-note">还没有任何传说的线索。打开顶栏「传说」查看每位传说的线索条件。</p>';
  return `<ul class="legend-production">${known.map(id => {
    const blocker = legendStartBlocker(view, city, id);
    return `<li class="${blocker ? 'blocked' : 'ready'}"><img src="${legendSprite(id)}" alt="" width="40" height="40"><div><strong>${legendTitle(id)}</strong>
      <small>${legendCost(id)} 生产 · ${legendEffectText(id)}</small>${blocker ? `<small class="legend-blocker">${blocker}</small>` : ''}</div></li>`;
  }).join('')}</ul>`;
}

type CardState = 'mine' | 'theirs' | 'building' | 'ready' | 'clue' | 'unknown' | 'locked';
/** The 传说 screen: cards by generation with clue, site, effect, status and unlocked story chapters. */
export function legendScreenMarkup(view: PlayerView): string {
  const legends = view.expansion?.legends;
  if (!legends) return '<p class="empty-note">传说奇观从玩法 v15 开始，只在有时代进程的对局里出现。</p>';
  const ids = LEGEND_WONDER_IDS.filter(id => LEGEND_WONDERS[id].generation <= legends.maxGeneration);
  const built = legends.wonders.filter(wonder => wonder.ownerId === view.playerId).length;
  const civName = (id: number | null) => id === null ? '无主' : id === view.playerId ? '你' : `文明 ${id + 1}`;
  const groups = [...new Set(ids.map(id => LEGEND_WONDERS[id].generation))];
  const card = (id: LegendWonderId) => {
    const legend = LEGEND_WONDERS[id], wonder = legends.wonders.find(item => item.legendId === id), building = legends.building.find(item => item.legendId === id);
    const clue = legends.clues.includes(id), story = LEGEND_STORIES[id];
    const state: CardState = wonder ? wonder.ownerId === view.playerId ? 'mine' : 'theirs' : building ? 'building' : clue && legends.generation >= legend.generation ? 'ready' : clue ? 'clue' : legends.generation < legend.generation ? 'locked' : 'unknown';
    const status = { mine: `已建成 · 你的城市 ${wonder?.cityId ?? ''}（第 ${wonder?.round} 轮）`, theirs: `已被${civName(wonder?.ownerId ?? null)}建成（第 ${wonder?.round} 轮）`,
      building: `建造中 · 城市 ${building?.cityId} · ${building?.progress}/${building?.cost}`, ready: `有线索，可以开工（${siteText(legends, id)}）`,
      clue: `有线索 · 进入第 ${legend.generation} 时代后可以开工`, unknown: `线索：${LEGEND_CLUE_TEXT(legend.clue)}`, locked: `第 ${legend.generation} 时代 · 线索：${LEGEND_CLUE_TEXT(legend.clue)}` }[state];
    const chapters = story ? [clue || wonder ? ['第一章 · 线索', story.clue] : null, building || state === 'mine' ? ['第二章 · 筑殿', story.building] : null,
      state === 'mine' ? ['终章 · 降临', story.complete] : null].filter((item): item is string[] => item !== null) : [];
    const site = legends.sites.find(item => item.legendId === id);
    return `<article class="legend-card ${state}" data-legend="${id}"><img src="${legendSprite(id)}" alt="" width="64" height="64">
      <div><p class="legend-dex">#${String(legend.dex).padStart(3, '0')}</p><h3>${legendTitle(id)}</h3><p class="legend-status">${status}</p>
      <p class="legend-effect">${legendCost(id)} 生产 · ${legendEffectText(id)}</p>
      ${site && !wonder ? `<button type="button" data-legend-site="${site.tileIndex}">在地图上定位踪迹</button>` : ''}
      ${chapters.length ? `<details class="legend-story"><summary>剧情（${chapters.length}/3）</summary>${chapters.map(([title, text]) => `<h4>${title}</h4><p>${text}</p>`).join('')}</details>` : ''}</div></article>`;
  };
  return `<div class="legend-screen"><p class="legend-summary">你建成 ${built} 座传说奇观 · 全世界已建成 ${legends.wonders.length}/${ids.length} 座 · 你的线索 ${legends.clues.length} · 当前第 ${legends.generation} 时代 ${civHint('wonder')}</p>${legendRaceMarkup(view)}
    ${groups.map(generation => `<section class="legend-generation"><h2>第 ${generation} 时代</h2><div class="legend-grid">${ids.filter(id => LEGEND_WONDERS[id].generation === generation).map(card).join('')}</div></section>`).join('')}</div>`;
}

/** Full-screen story card shown to the builder when a wonder completes. */
export function legendCompletionMarkup(id: LegendWonderId): string {
  const story = LEGEND_STORIES[id];
  return `<div class="legend-arrival" role="dialog" aria-label="传说奇观落成"><div class="legend-arrival-card"><p class="eyebrow">传说奇观落成 · 终章</p>
    <img src="${legendSprite(id)}" alt="${LEGEND_WONDERS[id].name}" width="128" height="128"><h2>${legendTitle(id)}</h2>
    <p class="legend-arrival-text">${story?.complete ?? ''}</p>${story?.quote ? `<blockquote>${story.quote}</blockquote>` : ''}
    <p class="legend-effect">${legendEffectText(id)}</p><button type="button" id="legend-arrival-close" class="primary">继续</button></div></div>`;
}
