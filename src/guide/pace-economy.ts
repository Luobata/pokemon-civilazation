// Handbook chapters for the gameplay v27 economy lane (docs/design/pace-v27.md §4, §5): city projects and legend favour. Numbers come
// from the content knobs (src/content/pace-v27.ts).
import { CITY_PROJECT_IDS, CITY_PROJECT_INFO, ECONOMY_TUNING as E, cityProjectCost } from '../content/pace-v27.ts';
import { LATE_GAME_TUNING as L } from '../content/depth-v26.ts';
import { GAME_CONTENT } from '../content/units.ts';
import type { GuideSection } from './sections.ts';

const tip = (...lines: string[]) => `<div class="tip">${lines.map(line => `<p>${line}</p>`).join('')}</div>`;
const EFFECTS: Record<(typeof CITY_PROJECT_IDS)[number], string> = {
  hatchEgg: `城旁孵出一只<strong>已登记</strong>物种的一阶宝可梦（你拥有最少的那种，同数按编号），经验 +${E.hatchXp}；不算新图鉴记录。城旁没有空格时像训练出的宝可梦一样等待出场。`,
  gymDrill: `城里与相邻格的己方宝可梦各 +${E.drillXp} 经验（最多 ${E.drillUnits} 只，编号小的优先）。`,
  fieldReport: `科研 +${E.reportScience}，进当前研究或储备。所有科技都研究完后不能再选。`,
  contestRehearsal: `人气 +${E.rehearsalAppeal}；你的文明下一次华丽大赛季出战得分 +${E.rehearsalScore}（本届已经报名时算下一届；每届只算一次）。`,
  festival: `满意度 +${E.festivalSatisfaction}；时代分 +1（每 ${E.festivalEraInterval} 轮最多 1 分）。`,
};
const projectTable = `<div class="table-wrap"><table><thead><tr><th>计划</th><th>需要（本城）</th><th>第 1 / 2 / 5 / 10 次成本</th><th>完成时</th></tr></thead><tbody>${CITY_PROJECT_IDS.map(id =>
  `<tr><td>${CITY_PROJECT_INFO[id].name}</td><td>${CITY_PROJECT_INFO[id].needs}</td><td>${[0, 1, 4, 9].map(done => cityProjectCost(GAME_CONTENT, id, done)).join(' / ')}</td><td>${EFFECTS[id]}</td></tr>`).join('')}</tbody></table></div>`;

export const PACE_ECONOMY_SECTIONS: readonly GuideSection[] = [
  { id: 'city-projects', group: '文明发展', title: '城市计划：闲置产能的去处', badge: 'v27 新增', html: `
    <p>建筑都建完、宝可梦也够了的城市不再空转：城市面板「生产」页的<strong>「城市计划」</strong>分页有 5 种可以反复做的计划。它们和普通生产项一样排在队列里，每城队列里同时最多 1 个计划。</p>
    ${projectTable}
    <ul>
      <li><strong>成本按次数上涨</strong>：成本 = 基础 × (100 + ${E.projectStepPercent} × 你的文明已完成的同种计划数) / 100（向下取整）。一直刷同一种越来越贵，轮流做才划算；卡片上写着“第几次”，悬停看下一次的成本。</li>
      <li><strong>可以用金币买</strong>：计划是当前生产项时，「加急采购」按剩余生产 × ${L.rushBuildingGold} 金买下（同建筑），本轮末完成。后期一个计划要 200–300 生产，正好吸收堆积的国库。</li>
      <li><strong>空城一键填</strong>：队列为空时，「一键建议」也会给出一个计划（与 AI 的选择相同）。</li>
      <li>完成通知只发给你自己；孵出的宝可梦出现在地图上后照常可见。</li>
    </ul>
    ${tip('AI 只在一座城没有任何建筑、设施区、传说、职能单位或宝可梦可排时才做计划：交战或劲敌来访时做特训，华丽大赛季公布（或对手的人气快到胜利线）时做彩排，满意度低于 50 时办嘉年华，其余时候在调查报告与孵蛋之间轮流（军队超过训练上限的 1.5 倍时不孵蛋）。国库超过 300 + 5 × 维护费时，它会像买建筑一样加急计划。')}` },
  { id: 'legend-favor', group: '文明发展', title: '传说的青睐：传说奇观越多越贵', badge: 'v27 新增', html: `
    <p>传说不会全都青睐同一个训练家：你<strong>每拥有一座</strong>传说奇观，下一座的成本 +${E.legendFavorPercent}%。第 1 座 100%，第 2 座 ${100 + E.legendFavorPercent}%，第 5 座 ${100 + 4 * E.legendFavorPercent}%，第 9 座 ${100 + 8 * E.legendFavorPercent}%。</p>
    <ul>
      <li>“拥有”按现在的城市算：奇观跟着城市走，被攻下的城市里的奇观算新主人的。</li>
      <li>在建时又建成一座，剩余部分按新成本计，已有的进度不丢。</li>
      <li><strong>传说踪迹</strong>：别人先建成同一座时，照旧退还一半进度的金币，另把进度的 ${E.legendTrailPercent}% 留给这座城开工的下一座传说（已经排着另一座就直接加上去）。</li>
      <li>传说页和城市的「传说奇观」分页显示“第 k 座：成本 ×倍率”；对手只看到 v26 的竞赛档位（按你自己的成本算的百分比），看不到你拥有几座。</li>
    </ul>
    ${tip(`AI 拥有 4 座以上时，只开工 12 轮内能建成的传说，其余产能去做城市计划。`)}` },
];
