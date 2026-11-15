// Handbook chapter for the gameplay v27 league trainers (docs/design/pace-v27.md §7, option 6A). Numbers come from the content knobs.
import { TRAINER_ARCHETYPES } from '../content/conference.ts';
import { DEPTH26_TUNING as D } from '../content/depth-v26.ts';
import { TRAINERS_TUNING as T } from '../content/pace-v27.ts';
import { TYPE_NAMES } from '../content/type-names.ts';
import type { GuideSection } from './sections.ts';

const ROLE_NAMES = { melee: '近战', siege: '攻城', naval: '水面', ranged: '远程', scout: '侦察', fast: '快速', air: '飞行' } as const;
const archetypes = `<table><thead><tr><th>头像</th><th>职业</th><th>偏好属性</th><th>偏好兵种</th><th>名字（每局取一个）</th></tr></thead><tbody>${TRAINER_ARCHETYPES.map(archetype =>
  `<tr><td><img src="/trainers/${archetype.id}.svg" alt="${archetype.title}" width="48" height="48" style="image-rendering:pixelated"></td><td>${archetype.title}<br><small>${archetype.personality}</small></td>`
  + `<td>${archetype.types.map(type => TYPE_NAMES[type]).join('、')}</td><td>${archetype.roles.map(role => ROLE_NAMES[role]).join('、')}</td><td>${archetype.names.join('、')}</td></tr>`).join('')}</tbody></table>`;

export const LEAGUE_TRAINER_SECTIONS: readonly GuideSection[] = [
  { id: 'league-trainers', group: '宝可梦与战斗', title: '联盟训练家：名册、招牌宝可梦与宿敌', badge: 'v27', html: `
    <p>从 v27 起，联盟大会的 NPC 不再每届重抽：每局开局就定下 <strong>${T.rosterSize} 位原创训练家</strong>，整局不变。每位来自一种职业，有自己的名字、性格、像素头像和台词；在对阵表、大会结果卡、选阵界面的对手栏和世界页的「联盟名册」里，把鼠标移到头像上（或用键盘聚焦）就能看到他的资料卡：主 / 副属性、招牌宝可梦、冠军头衔和对你的战绩。</p>
    ${archetypes}
    <ul>
      <li><strong>主题</strong>：主属性在 ${T.rosterSize} 位之间互不相同，优先从职业偏好的属性里、在本局地区图鉴有三阶宝可梦的属性中抽；本图鉴没有时换成别的属性（资料卡写的是实际属性）。</li>
      <li><strong>招牌宝可梦</strong>（★）：主属性的一只三阶宝可梦，${T.rosterSize} 位之间互不相同，总在最后出场。其余 5 只按“主属性 → 副属性 → 偏好兵种”从本图鉴的最终形态里选，同一局里一种宝可梦最多出现在 3 支队伍里。</li>
      <li><strong>逐届成长</strong>：第 1–2 届带 4 只、招牌是它的二阶形态；第 3 届起 5 只、招牌进化成三阶（“它进化了！这次不一样了。”）；第 5 届起 6 只，其他成员也进化到最终形态。</li>
      <li><strong>战力</strong>：一支队伍的总战力 = ${T.npcBasePower} + 届数 × ${D.npcSeasonPower} + 名额 × ${D.npcSlotPower}，按阶段权重（一阶 ${T.stageWeights[0]} / 二阶 ${T.stageWeights[1]} / 三阶 ${T.stageWeights[2]}）分给每只，招牌再 ×${T.signaturePercent / 100}——只数少的时候每只更强，招牌真正是王牌。</li>
      <li><strong>出场</strong>：每届需要 6 − 报名文明数（再减去劲敌）位训练家；上一届没出场的优先，其余按固定的轮换，所以同一位训练家每 2–3 届就会再遇到。同一届里不会出现两个同名的训练家。</li>
      <li><strong>战绩与宿敌</strong>：每位训练家的冠军头衔和对每个文明的胜负都公开。<strong>宿敌</strong>是打败你次数最多的训练家（并列时取最近一次赢你的）：头像带红框和劲敌标记，世界页的公布名单里排第一，选阵界面默认打开他那一页。在大会上击败宿敌：时代分 +1（每届最多 1 分）。AI 也会多训练克制自己宿敌主属性的宝可梦。</li>
    </ul>
    <div class="tip"><p>看名单时先找星标：招牌最后出场、数值最高。把克制它的宝可梦放在队伍后半段，前面几只先消耗对手的普通成员。</p></div>` },
];
