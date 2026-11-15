// Handbook chapter for the gameplay v27 events lane (docs/design/pace-v27.md §6 ⑤ Max raids, §8 ⑦ the contest circuit). Numbers come
// from the content knobs (content.pace27.events, the v26 late-game knobs).
import { EVENTS_TUNING as E } from '../content/pace-v27.ts';
import { LATE_GAME_TUNING as L } from '../content/depth-v26.ts';
import { CONTEST_CATEGORIES, CONTEST_CATEGORY_INFO } from '../core/contest-seasons.ts';
import { CIRCUIT_PRIZE_TYPES } from '../core/contest-circuit.ts';
import { TYPE_NAMES } from '../content/type-names.ts';
import type { GuideSection } from './sections.ts';

const tip = (...lines: string[]) => `<div class="tip">${lines.map(line => `<p>${line}</p>`).join('')}</div>`;
const prizes = `<table><thead><tr><th>类别</th><th>冠军学习器</th></tr></thead><tbody>${CONTEST_CATEGORIES.map(id =>
  `<tr><td>${CONTEST_CATEGORY_INFO[id].name}</td><td>${TYPE_NAMES[CIRCUIT_PRIZE_TYPES[id]]}属性</td></tr>`).join('')}</tbody></table>`;

export const PACE_EVENT_SECTIONS: readonly GuideSection[] = [
  { id: 'max-raids', group: '文明发展', title: '极巨团体战：护盾、两阶段、巢穴极巨化、捕捉机会', badge: 'v27 新增', html: `
    <p>v27 的极巨巢穴不再是普通围攻（地点、预告、首领 HP ${L.raidBaseHp} + ${L.raidHpPerCiv} × 存活文明数、停留 ${L.raidRounds} 轮照旧）。地图上的首领站在红粉色的极巨光晕里、放大 1.5 倍，头顶一排护盾格，HP 条在第二阶段变紫。</p>
    <ul>
      <li><strong>极巨护盾</strong>：首领出现时带 ${E.shieldBase} + ⌈存活文明数 / 2⌉ 格护盾（4 个文明时 ${E.shieldBase + 2} 格）。护盾在时，打到首领的伤害只算 <strong>${E.shieldDamagePermille / 10}%</strong>；每次命中打掉 1 格，<strong>效果拔群</strong>或<strong>破盾手</strong>的命中打掉 ${E.breakerShields} 格。</li>
      <li><strong>两阶段</strong>：HP 降到 ${E.phaseTwoPercent}% 时首领进入第二阶段：护盾回到 ${E.shieldPhaseTwo} 格，轮末的「极巨波」打 <strong>${E.phaseTwoRange} 格内</strong>所有单位（第一阶段只打相邻）。别把整支队伍挤在旁边。</li>
      <li><strong>巢穴极巨化</strong>：巢穴开放期间，每个文明可以免费让<strong>一只</strong>站在首领 ${E.dynamaxRange} 格内的宝可梦极巨化（单位栏「团体战极巨化」，世界页团体战卡也有按钮）：伤害 +30%、受到伤害 −30%，到团体战结束。不需要精华，不占世代能力的冷却。</li>
      <li><strong>职能</strong>（按兵种自动决定）：破盾手 = 近战、快速、攻城（每次打掉 ${E.breakerShields} 格）；输出 = 远程、飞行、水面（护盾打完后伤害 ×${E.dealerPermille / 1000}）；支援 = 侦察（轮末给 1 格内的己方宝可梦各回复 ${E.supportHeal} HP，站在首领 ${E.dynamaxRange} 格内时计入贡献）。</li>
      <li><strong>贡献</strong> = 伤害 + ${E.shieldPoints} × 打掉的护盾格 + 支援回复量。账本公开（世界页「极巨团体战」）。</li>
      <li><strong>奖励</strong>（首领被打倒时）：贡献第一必得这只宝可梦（离巢最近的己方城旁）和时代分 +1；其他贡献 ≥ ${L.raidMinSharePercent}% 的文明各有一次<strong>捕捉机会</strong>，成功率 = ${E.catchBasePercent}% + 贡献百分比（最多 ${E.catchMaxPercent}%），成功得到这条进化线的一阶（没有进化线的稀有物种就是它本身）；金币按贡献份额（每 10% ${L.raidShareGold} 金，最多 ${L.raidMaxGold}）。没打倒、首领离开时，每个贡献 ≥ ${L.raidMinSharePercent}% 的文明得 ${E.participationGold} 金参与奖。</li>
    </ul>
    <p><strong>奖励预览</strong>：世界页的团体战卡按当前账本实时算你的份额、捕捉率和金币（例如“你 22% → 捕捉率 52%”）；攻击预览也已经算上护盾（伤害 ×${E.shieldDamagePermille / 10}%、会打掉几格）。预览只用你看得见的东西，不预知随机数。</p>
    <p><strong>迷雾</strong>：没探索过巢穴的文明看不见护盾和阶段，只看见公开的账本。捕捉机会按文明编号从小到大，各从对局的随机数里抽一次。</p>
    ${tip('先派破盾手（近战、快速）把护盾打掉，再让远程、飞行的输出动手；极巨化留给护盾打完时离首领最近的输出。第二家、第三家只要打到 10% 就有 40% 以上的捕捉机会，值得去。', 'AI：组队时先挑 1 只破盾手，再挑输出，有侦察就带 1 只支援；城里最后一只守军不去；只在预计贡献 ≥ 10% 时出队；己方城市 3 格内有交战敌人时不出队，但已经在首领旁边的宝可梦照样出手。')}` },
  { id: 'contest-circuit', group: '文明发展', title: '巡回华丽大赛：任意城市报名、名次奖品', badge: 'v27 新增', html: `
    <p>v27 的华丽大赛季（届次、类别、得分公式、轮末评审照旧）改成<strong>巡回</strong>：</p>
    <ul>
      <li><strong>不需要大赛馆</strong>：任意一只站在<strong>任意己方城市里或旁边</strong>的宝可梦都能报名（每届每文明 1 只，花掉它的行动），也不需要「华丽大赛」科技。大赛馆仍然加分（每座 +${L.seasonHallPoints}，最多 ${L.seasonHallCap} 座）。</li>
      <li><strong>名次奖品</strong>（人气照旧）：第 1 名得一张本届类别的<strong>招式学习器</strong>（类别的第一个属性，免费，<strong>不需要徽章</strong>）和时代分 +1；第 2 名 ${E.circuitGold[0]} 金；第 3 名 ${E.circuitGold[1]} 金；其余参赛宝可梦经验 +${E.circuitEntrantXp}（“表演经验”）。</li>
    </ul>
    ${prizes}
    <p>奖品是公开事件；学习器进获奖文明自己的免费学习器库存（世界页「训练与学习器」）。不消耗随机数。</p>
    ${tip('第 45 轮的第 1 届就能上台：把得分最高的宝可梦带回城里即可。世界页的大赛季卡写出本届奖品；没有合适的宝可梦时写原因。', 'AI：所有性格在类别公布后，从任意己方城市 8 格内挑得分最高的宝可梦回城报名；交战中只派离敌方宝可梦至少 4 格的。')}` },
];
