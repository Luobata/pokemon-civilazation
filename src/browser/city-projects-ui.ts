// Gameplay v27 ③ ④ UI (docs/design/pace-v27.md §4.3, §5.4): the city panel's 城市计划 tab (five cards: icon, cost, this time's
// yield, which completion it is; hover explains the +20% scaling and the rush price) and the legend favour chip on the wonder tab.
// Reads the PlayerView only; numbers come from the authority's own functions (`cityProjectBlocker`, `projectCost`, `viewLegendCost`).
import { CITY_PROJECT_IDS, CITY_PROJECT_INFO, cityProjectCost, economyTuning } from '../content/pace-v27.ts';
import type { CityProjectId } from '../content/pace-v27.ts';
import { lateTuning } from '../content/depth-v26.ts';
import type { Content } from '../content/units.ts';
import { CITY_PROJECT_BLOCKER_TEXT, cityProjectBlocker, viewCityProjectInput, viewProjectsDone } from '../core/city-projects.ts';
import { viewLegendFavorPercent, viewOwnedLegends } from '../core/legend-favor.ts';
import type { PlayerView } from '../core/model.ts';
import type { CityProjectEvent } from '../core/city-projects.ts';
import { uiIcon } from './ui-icons.ts';
import type { UiIconName } from './ui-icons.ts';

type ViewCity = PlayerView['economy']['cities'][number];
export const PROJECT_ICONS: Record<CityProjectId, UiIconName> = { hatchEgg: 'egg', gymDrill: 'training', fieldReport: 'clipboard', contestRehearsal: 'ribbon', festival: 'satisfaction' };
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const percentText = (percent: number) => `×${percent / 100}`;

/** What the next completion gives, in one line (the numbers of `completeCityProject`). */
export function projectEffectText(view: PlayerView, id: CityProjectId, content: Content): string {
  const t = economyTuning(content), projects = view.expansion?.cityProjects;
  if (id === 'hatchEgg') return `城旁孵出一只已登记的一阶宝可梦（你拥有最少的那种），经验 +${t.hatchXp}；不算新图鉴记录`;
  if (id === 'gymDrill') return `城里与相邻格的己方宝可梦各 +${t.drillXp} 经验（最多 ${t.drillUnits} 只）`;
  if (id === 'fieldReport') return `科研 +${t.reportScience}（进当前研究或储备）`;
  if (id === 'contestRehearsal') {
    const season = view.expansion?.contestSeasons, used = season && projects?.rehearsalSeason === (season.ownEntry ? season.season + 1 : season.season);
    return `人气 +${t.rehearsalAppeal}；${used ? '本届的彩排加分已经拿到' : `下一次华丽大赛季出战得分 +${t.rehearsalScore}（每届一次）`}`;
  }
  const last = projects?.festivalRound ?? null, ready = last === null || view.round - last >= t.festivalEraInterval;
  return `满意度 +${t.festivalSatisfaction}；${ready ? '时代分 +1' : `时代分要到第 ${last + t.festivalEraInterval} 轮后才能再得`}（每 ${t.festivalEraInterval} 轮最多 1 分）`;
}
/** Hover card: the scaling (base, n-th, next) and the rush price. */
export function projectTip(view: PlayerView, id: CityProjectId, content: Content): string {
  const t = economyTuning(content), done = viewProjectsDone(view)[id] ?? 0, cost = cityProjectCost(content, id, done);
  return [`${CITY_PROJECT_INFO[id].name} · 需要：${CITY_PROJECT_INFO[id].needs}`, projectEffectText(view, id, content) + '。',
    `成本 = 基础 ${t.projectCost[id]} × (100 + ${t.projectStepPercent} × 已完成次数) / 100。你的文明已完成 ${done} 次，这是第 ${done + 1} 次：${cost} 生产；下一次 ${cityProjectCost(content, id, done + 1)}。`,
    `反复做同一种越来越贵，轮流做才划算。可以用「加急采购」买下：剩余生产 × ${lateTuning(content).rushBuildingGold} 金（同建筑）。每城队列里同时只能有 1 个计划。`].join('\n');
}
/** The 城市计划 tab: five cards, the available ones clickable (`data-production-option`, the panel's own handler). */
export function projectCardsMarkup(view: PlayerView, city: ViewCity, content: Content, rate: number, disabled: boolean): string {
  const input = viewCityProjectInput(view, city, content), done = viewProjectsDone(view);
  return `<ul id="project-cards" class="project-cards" aria-label="城市计划 · 点击加入队列">${CITY_PROJECT_IDS.map(id => {
    const blocker = cityProjectBlocker(input, id), cost = cityProjectCost(content, id, done[id] ?? 0), nth = (done[id] ?? 0) + 1;
    const rounds = rate > 0 ? `≈${Math.max(1, Math.ceil(cost / rate))} 轮` : '停滞', tip = projectTip(view, id, content);
    return `<li><button type="button" class="project-card${blocker ? ' blocked' : ''}" data-production-option="project:${id}" data-project="${id}" data-tip="${esc(tip)}" data-tip-title="${esc(CITY_PROJECT_INFO[id].name)}" aria-label="${esc(`${CITY_PROJECT_INFO[id].name}，第 ${nth} 次，${cost} 生产。${blocker ? CITY_PROJECT_BLOCKER_TEXT[blocker] : projectEffectText(view, id, content)}`)}" ${disabled || blocker || city.queue.length >= 5 ? 'disabled' : ''}>
      ${uiIcon(PROJECT_ICONS[id], { size: 32, className: 'project-icon' })}<span class="project-main"><b>${CITY_PROJECT_INFO[id].name}</b><small class="project-effect">${blocker ? `<span class="project-blocker">${uiIcon('lock', { size: 12 })}${CITY_PROJECT_BLOCKER_TEXT[blocker]}</span>` : projectEffectText(view, id, content)}</small></span>
      <span class="project-cost">${uiIcon('production', { size: 14, label: '生产' })}<b>${cost}</b><small class="project-nth">第 ${nth} 次</small><small>${uiIcon('turns', { size: 12 })}${rounds}</small></span></button></li>`;
  }).join('')}</ul>`;
}
export const PROJECT_HELP = '城市计划可以重复做，把用不完的产能变成经验、科研、人气、满意度或新的宝可梦。每完成一次，你的文明下一次做同一种计划的成本 +20%（悬停卡片看公式）；可以用「加急采购」花金币买下。';

/** Wonder tab chip: the cost multiplier of the viewer's next legend and, on hover, the rule (nothing before v27). */
export function legendFavorChip(view: PlayerView, content: Content): string {
  if (!content.legendFavor) return '';
  const owned = viewOwnedLegends(view), percent = viewLegendFavorPercent(view, content), step = economyTuning(content).legendFavorPercent;
  const tip = `传说不会全都青睐同一个训练家：你每拥有一座传说奇观，下一座的成本 +${step}%。\n你拥有 ${owned} 座，下一座（第 ${owned + 1} 座）成本 ${percentText(percent)}。在建时又建成一座，剩余部分按新成本计，进度不丢。\n别人先建成同一座时：退还一半进度的金币，另把 ${economyTuning(content).legendTrailPercent}% 的进度留给这座城的下一座传说（传说踪迹）。`;
  return `<span class="legend-favor-chip" data-tip="${esc(tip)}" data-tip-title="传说的青睐" tabindex="0" role="img" aria-label="${esc(`第 ${owned + 1} 座传说：成本 ${percentText(percent)}`)}">${uiIcon('wonder', { size: 14 })}第 ${owned + 1} 座：成本 <b>${percentText(percent)}</b></span>`;
}
/** The city's legend trail (production a newly queued legend starts with), as a note ('' without one). */
export function legendTrailNote(view: PlayerView, cityId: number): string {
  const trail = view.expansion?.cityProjects?.legendTrail[cityId];
  return trail ? `<p class="legend-trail" id="legend-trail">${uiIcon('wonder', { size: 14 })}传说踪迹：这座城开工的下一座传说自带 <b>${trail}</b> 生产。</p>` : '';
}
/** What a completed project gave (notification and log text). */
export function cityProjectResultText(event: Pick<CityProjectEvent, 'effects'>, content: Content): string {
  const e = event.effects, parts: string[] = [];
  if (e.speciesId) parts.push(`孵出${content.species[e.speciesId]?.name ?? e.speciesId}（经验 ${e.xp}）${e.waiting ? '，城旁没有空格，等待出场' : ''}`);
  else if (e.unitIds) parts.push(e.unitIds.length ? `${e.unitIds.length} 只宝可梦经验 +${e.xp}` : '城里和城旁没有宝可梦，特训没有对象');
  if (e.science) parts.push(`科研 +${e.science}`);
  if (e.appeal) parts.push(`人气 +${e.appeal}`);
  if (e.seasonScore) parts.push(`下一次华丽大赛季出战得分 +${e.seasonScore}`);
  if (e.satisfaction) parts.push(`满意度 +${e.satisfaction}`);
  if (e.eraScore) parts.push(`时代分 +${e.eraScore}`);
  return parts.join('，') + '。';
}
