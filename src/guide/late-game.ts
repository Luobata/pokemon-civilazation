// Handbook chapter for the gameplay v26 late game (docs/design/depth-v26.md §4.2, §5, §7.2, §8). Numbers come from the content knobs.
import { LATE_GAME_TUNING as L } from '../content/depth-v26.ts';
import { CONTEST_CATEGORIES, CONTEST_CATEGORY_INFO } from '../core/contest-seasons.ts';
import { TYPE_NAMES } from '../content/type-names.ts';
import type { GuideSection } from './sections.ts';

const tip = (...lines: string[]) => `<div class="tip">${lines.map(line => `<p>${line}</p>`).join('')}</div>`;
const categories = `<table><thead><tr><th>类别</th><th>加分属性</th></tr></thead><tbody>${CONTEST_CATEGORIES.map(id =>
  `<tr><td>${CONTEST_CATEGORY_INFO[id].name}</td><td>${CONTEST_CATEGORY_INFO[id].types.map(type => TYPE_NAMES[type]).join('、')}</td></tr>`).join('')}</tbody></table>`;

export const LATE_GAME_SECTIONS: readonly GuideSection[] = [
  { id: 'gold-sinks', group: '文明发展', title: '金币出口：加急、宝可梦中心、特训、学习器', badge: 'v26 新增', html: `
    <p>后期金币不再只是堆着。四种花法都只动你自己的国库和单位，按钮旁直接写价格；不能用时悬停说明原因。</p>
    <ul>
      <li><strong>加急采购</strong>（城市面板生产队列下方）：当前生产项剩余的生产 × ${L.rushBuildingGold} 金（建筑）/ × ${L.rushUnitGold} 金（宝可梦、职能单位），本轮末与正常生产同时完成，本轮的生产照常流到下一项。传说奇观、设施区不能买；每城每轮 1 次。</li>
      <li><strong>宝可梦中心</strong>（城市面板）：休养中的宝可梦立刻在城旁归队，每剩 1 轮休养 ${L.recoveryGold} 金（最多 ${L.recoveryMaxGold} 金），HP 同正常归队（25%），本轮不能再行动。</li>
      <li><strong>特训</strong>（世界页「训练与学习器」）：站在有宝可梦中心的己方城市里或旁边，${L.trainingGold} 金换 ${L.trainingXp} 经验，花掉行动；每只每 ${L.trainingCooldown} 轮 1 次。</li>
      <li><strong>招式学习器</strong>：给一只宝可梦加 1 个只在对战层（道馆、大会、劲敌对决）和华丽大赛季里用的属性。属性要属于你持有徽章的精华；一、二阶 ${L.tmGold} 金，三阶 ${L.tmFinalGold} 金，可以花全价替换。<strong>每赢一枚巡回徽章送 1 张该道馆属性的学习器</strong>（免费）。</li>
    </ul>
    ${tip('AI 在国库超过 300 + 5 × 维护费时才买生产：先给受威胁的城市买宝可梦，再按产出最高的城市买；交战时用宝可梦中心；开局缺第三座城时也会加急便宜的开拓队。')}` },
  { id: 'contest-seasons', group: '文明发展', title: '华丽大赛季', badge: 'v26 新增', html: `
    <p>从第 ${L.seasonFirstRound} 轮起每 ${L.seasonInterval} 轮一届，赛前 ${L.seasonAnnounce} 轮公布本届<strong>类别</strong>（每局一个固定的轮换）并开放报名。派一只站在有大赛馆的己方城市里或旁边的宝可梦参赛（每届每文明 1 只，花掉它的行动），本届轮末评审。</p>
    ${categories}
    <p>得分 = ${L.seasonTypePoints} × 匹配属性数（主、副和学习器属性，最多 2）+ ${L.seasonStagePoints} × 阶段 + 历练（每 50 经验 +1，最多 +5）+ ${L.seasonHallPoints} × 大赛馆数（最多 ${L.seasonHallCap}）+ 0–9 的决胜分。名次人气：第 1 名 +${L.seasonRewards[0]} 并得一条缎带，第 2 名 +${L.seasonRewards[1]}，第 3 名 +${L.seasonRewards[2]}，其余参赛者 +${L.seasonEntryAppeal}。参赛者、名次和缎带都公开。</p>
    <p><strong>文化防守</strong>：所有 AI（包括好战型）在第 60 轮或第 3 座城之后至少建 1 座大赛馆；任一对手的人气达到其胜利目标的 ${L.defencePercent}%（或出现华丽大赛的接近胜利预警）时，再多建一座并每次冷却结束就举办。华丽大赛胜利仍要求人气 ≥ 每个对手的 1.5 倍，所以对手的人气越高，这条路越难走。</p>` },
  { id: 'late-events', group: '文明发展', title: '后期事件：极巨团体战、传说竞赛、接近胜利预警', badge: 'v26 新增', html: `
    <ul>
      <li><strong>极巨巢穴</strong>：第 ${L.raidFirstRound} 轮起每 ${L.raidInterval} 轮，离所有首都至少 ${L.raidCapitalDistance} 格的地方（优先巢穴、霸主附近）出现一只本地区的三阶或稀有宝可梦：HP ${L.raidBaseHp} + ${L.raidHpPerCiv} × 存活文明数，不移动、不能捕捉，每轮末攻击所有相邻单位，停留 ${L.raidRounds} 轮。用普通攻击打它，账本公开；打倒时伤害第一的文明得到这只宝可梦（离巢最近的己方城市旁）和世代分 +1，伤害 ≥ ${L.raidMinSharePercent}% 的文明每 10% 份额得 ${L.raidShareGold} 金（最多 ${L.raidMaxGold}）。没探索过那里的文明只收到“远方出现了极巨巢穴”。</li>
      <li><strong>传说神殿竞赛</strong>：传说页顶部的竞赛条显示<strong>已相遇</strong>文明（见过对方领土或城市）在建的传说，只给档位：开工（&lt; 50%）、过半、即将完成（≥ 85%），不给城市和轮数。对方开工和进入“即将完成”时都会通知你。AI 不会去追一座别人已过半、自己要 10 轮以上的传说，并会放弃明显赢不了的。</li>
      <li><strong>接近胜利预警</strong>：任一文明在任一胜利路线（征服、图鉴、起源、冠军赛、华丽大赛、信仰）达到 ${L.watchPercent}% 时，所有文明都收到一条公开通知（每条路线一次），世界页首位出现预警卡。这是信息，不是补偿。</li>
    </ul>` },
  { id: 'tile-sharing', group: '宝可梦与战斗', title: '同格护送与开局礼物', badge: 'v26 新增', html: `
    <ul>
      <li><strong>同格</strong>：一格最多 1 只宝可梦 + 1 个职能单位（开拓队、工匠、商队），必须同一主人。单位可以穿过任何己方单位，只能停在自己那一层空着的格子上；同格的职能单位画成格子右下角的小徽记，再点一次同一格可以切换选中。</li>
      <li><strong>护送</strong>：职能单位与己方宝可梦同格时<strong>不能被选为攻击目标</strong>，会出手的野生宝可梦和极巨巢穴也只打宝可梦；宝可梦被击倒后，职能单位就又暴露了。新单位也可以出生在“另一层”空着的格子上。AI 在不足 ${L.escortMaxCities} 座城时给出城的开拓队派一只宝可梦护送。</li>
      <li><strong>大木博士的礼物</strong>：研究完「驯化」时送 ${L.giftBalls} 个精灵球，第一次捕捉不用先回城买球。</li>
      <li><strong>进化目标</strong>：神奇糖果进化的世代分从 +2 减为 +1；每条进化线第一次进化出最终形态 +1 世代分（每世代最多 3 次）。</li>
    </ul>` },
];
