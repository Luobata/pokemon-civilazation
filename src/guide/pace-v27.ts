// Handbook chapters for the gameplay v27 opening (docs/design/pace-v27.md §2, §3). Numbers come from the content knobs.
import { OPENING_TUNING as O } from '../content/pace-v27.ts';
import { uiIcon } from '../browser/ui-icons.ts';
import type { GuideSection } from './sections.ts';

const tip = (...lines: string[]) => `<div class="tip">${lines.map(line => `<p>${line}</p>`).join('')}</div>`;

export const PACE_V27_SECTIONS: readonly GuideSection[] = [
  { id: 'opening-safety', group: '开局', title: '开局安全：职能单位受惊撤退、近处城址', badge: 'v27 预览', html: `
    <p>gameplay v27 起（新局默认仍是 v26），野生宝可梦不再“一击带走”开拓队、工匠和商队。</p>
    <ul>
      <li>${uiIcon('startled', { size: 16, label: '受惊撤退' })} <strong>受惊撤退</strong>：会出手的野生宝可梦在轮末本该打一个职能单位时，改为把它<strong>吓跑</strong>——职能单位退到身边一个离这只野生 2 格、能进入的空格（多个时取格号最小的），没有受伤；这只野生本轮不再打别人。周围没有这样的空格时照旧被打。只对野生宝可梦：劲敌、别的文明和极巨巢穴的首领不变。与己方宝可梦同格的职能单位本来就不会被打（v26 护送）。</li>
      <li><strong>近处城址</strong>：AI 认定的合法城址只要求周围 <strong>${O.aiSiteRadius} 圈</strong>都探索过（v26 要 3 圈），所以开局更早知道去哪建城。第 3 圈里如果藏着看不见的城市，建城会被拒绝（离城市要 ≥ 4 格），这时 AI 记住这个格子不再试——你的推荐城址图钉也会在悬停卡里用 ${uiIcon('cloud', { size: 14, label: '未探索' })} 提醒“周围还有未探索的格子，可能有看不见的城市”。</li>
      <li><strong>信仰补偿</strong>：开局多出来的城市会让领先的信仰更早凑够比例，所以 v27 的传说共鸣（信仰）胜利要 <strong>${O.faithWinSharePercent}%</strong> 的城市信它（v26 是 60%，向上取整），其余条件不变。</li>
    </ul>
    ${tip('开拓队仍然怕被围：受惊撤退要有一个“离野生 2 格”的空格。沿着海岸或山口走时，最好还是让一只宝可梦和它同格护送。')}` },
  { id: 'wild-encounters', group: '开局', title: '草丛遭遇：力竭、新手保护、第一颗球', badge: 'v27 预览', html: `
    <p>野外战斗的结局从“它把你打回家”变成“你决定抓不抓”。</p>
    <ul>
      <li>${uiIcon('exhausted', { size: 16, label: '力竭' })} <strong>力竭</strong>：野生宝可梦（不含劲敌和极巨巢穴的首领）被任何文明的攻击打到 <strong>HP ≤ ${O.exhaustHpPercent}%</strong> 时力竭 ${O.exhaustRounds} 轮：轮末不攻击、不移动，地图上变灰并顶着汗滴标记；捕捉成功率 <strong>+${O.exhaustCaptureBonus}%</strong>（最多 ${O.exhaustCaptureCap}%，不会因此变低）。力竭结束时 HP 若仍 ≤ ${O.exhaustHpPercent}%，恢复到 ${O.exhaustRecoverPercent}% 并照常行动。每只野生宝可梦只会力竭一次。</li>
      <li><strong>第一颗球</strong>：研究完「驯化」后，每个文明的<strong>第一次捕捉必定成功</strong>——对任何相邻的野生宝可梦都一样，不必先打残（不抽随机数，“大木博士的教学”）；之后照常按概率，力竭目标 +${O.exhaustCaptureBonus}%。捕捉预览会写“第一颗球必中”。</li>
      <li><strong>初次遭遇</strong>：第 ${O.encounterBeforeRound} 轮前，你第一次把某个物种打到力竭时，出手的宝可梦经验 +${O.encounterXp}、科研 +${O.encounterScience}，并收到“野生的 X 力竭了！”通知（点“捕捉”选中那只宝可梦，再按 Q）。</li>
      <li><strong>新手保护</strong>：第 ${O.protectionLastRound} 轮（含）之前，被<strong>野生</strong>宝可梦打倒的宝可梦只休养 ${O.protectionRounds} 轮（平时 2–3 轮），回来时 HP ${O.protectionHpPercent}%（平时 25%）。劲敌、别的文明和巢穴首领不变。</li>
    </ul>
    ${tip('第一颗球留给你最想要的物种。之后“先打残、再扔球”：攻击相邻的野生宝可梦，看到汗滴标记就按 Q。力竭只持续 2 轮，球不够时在城市的「物资采购」里买。')}` },
];
