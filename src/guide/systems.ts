// Handbook chapters for the systems added by gameplay packs v3–v10 and the expansion world.
// Rules that live only in src/core are written here (the v3+ Pokédex target is base + 3, see src/core/world-systems.ts).
import type { GuideSection } from './sections.ts';
import * as T from './tables.ts';

const tip = (...lines: string[]) => `<div class="tip">${lines.map(line => `<p>${line}</p>`).join('')}</div>`;
const link = (id: string, label: string) => `<a href="#${id}">${label}</a>`;
const civ = T.civilization;
const world = T.world;

/** Chapters that belong near the top (after Quick start). */
export const OVERVIEW_SECTIONS: readonly GuideSection[] = [
  { id: 'systems', group: '入门', title: '系统总览', html: `
    <p>新开对局包含下表的全部系统。“版本”是它加入游戏时的玩法版本；读取旧存档时，晚于该存档版本的系统不会出现。</p>
    ${T.table(['系统', '版本', '一句话说明', '在哪里操作', '详见'], [
      ['六角格地图、迷雾、群系', '基础', '7 种群系，种子生成，视野与记忆地形', '地图', link('map', '地图与群系')],
      ['城市、人口、建筑', '基础', '建城、增长、耕作地块、6 种建筑', '点城市', link('cities', '城市')],
      ['科技与图鉴发现', '基础 / v2', '12 项科技分 3 层，达成条件立减 40%', '研究面板', link('techs', '科技与时代')],
      ['宝可梦单位、捕捉、进化', '基础', '48 种宝可梦，7 种定位', '点单位', link('pokemon', '宝可梦图鉴')],
      ['18 属性战斗、攻城定位', '扩展', '属性克制、地形、攻城倍率', '点单位', link('combat', '战斗与捕捉')],
      ['领袖与时代方针', '扩展 / v4', '9 位领袖，被动、主动、专属单位与建筑', '领袖面板', link('leaders', '领袖')],
      ['时代（世代）', '扩展', '按完成科技数推进世代', '时代面板', link('techs', '科技与时代')],
      ['世界：图鉴、巢穴、霸主、树果、进化石、满意度', '扩展', '地图上的中立资源与威胁', '点单位 / 扩展面板', link('world', '世界系统')],
      ['文明：供奉、幻影、圣所、冠军赛、外交', '扩展', '伟人、起源胜利、冠军赛胜利、贸易与结盟', '扩展面板 / 外交面板', link('civilization', '供奉、幻影与圣所')],
      ['地块改良、控制区、夹击', 'v2', '宝可梦施工；近战/快速型阻挡敌人', '点单位', link('improvements', '地块改良')],
      ['联盟规章与方针卡', 'v3', '联盟点开放方针槽', '规章面板', link('policies', '联盟规章与方针卡')],
      ['战功与晋升', 'v13', '战斗累积战功，晋升时选特性：破城、猛攻、坚守、疾行、再生', '点单位', link('combat', '战斗与捕捉')],
      ['城市规划与城市网络', 'v17', '设施区相邻、区域辐射、属性城市、商路、开拓队随行', '城市面板', link('city-network', '城市规划与城市网络')],
      ['移动力（先走后打）', 'v16', '按地形消耗移动力，还有移动力时可以攻击；开局开拓队在首都旁', '选中单位', link('combat', '战斗与捕捉')],
      ['传说奇观（剧情）', 'v15', '找线索、建奇观，全世界唯一，三章剧情', '顶栏「传说」/ 城市生产', link('legends', '传说奇观')],
      ['世代荣誉（黄金/黑暗世代）', 'v12', '按上一世代平均得分决定新世代的加成或逆境', '时代页面', link('techs', '科技与时代')],
      ['联盟体制（政体）', 'v11', '一次一个体制：额外方针槽和常驻加成', '规章页面顶部', link('governments', '联盟体制')],
      ['属性精华与属性道馆', 'v4', '群系产出精华，道馆加速训练', '城市 / 顶部精华栏', link('essences', '属性精华与道馆')],
      ['时代能力（昼夜、天气、Mega 等）', 'v5', '花精华发动的战术能力', '时代面板 / 单位', link('era-abilities', '时代能力')],
      ['城市羁绊（忠诚度）', 'v6', '羁绊归零的城市会脱离成中立', '城市详情', link('bonds', '满意度与城市羁绊')],
      ['稀有树果（奢侈品）', 'v7', '种类越多满意度和羁绊越高', '城市耕作', link('rare-berries', '稀有树果')],
      ['华丽大赛', 'v8', '华丽馆积累魅力，大赛胜利', '城市 / 扩展面板', link('contests', '华丽大赛')],
      ['传说信仰', 'v9', '创立信仰、传播，信仰胜利', '扩展面板', link('faith', '传说信仰')],
      ['设施区', 'v10', '城市周边的专业化地块', '城市生产', link('districts', '设施区')],
    ])}
    <h3>每轮结算顺序</h3>
    <p>所有玩家结束回合后依次结算：经济（食物、生产、金币、科研）→ 恢复 → 野生宝可梦 → 世界（巢穴暴走、树果再生、满意度）→ 文明（工程师、提议过期、贸易、冠军赛）→ 方针 → 精华 → 时代能力 → 稀有树果 → 羁绊 → 华丽大赛 → 信仰 → 图鉴胜利检查 → 轮上限计分。前面一步触发胜利时，后面的步骤不再执行。</p>` },

  { id: 'victory', group: '入门', title: '胜利条件', badge: '8 种结局', html: `
    ${T.table(['胜利', '条件', '准备什么'], [
      ['征服', '占领对手的<strong>首都</strong>就会消灭该文明（其余城市变为中立、单位全部移除）。只剩你一个文明时获胜。', '攻城型 + 投石改装；见 ' + link('combat', '攻城')],
      ['图鉴', `图鉴记录物种数达到 ${world.pokedex.targetDocumentedSpecies + 3} 种（物种被你<strong>看到过</strong>，并且你<strong>看到它参与过战斗</strong>或<strong>捕捉过它</strong>）。先达到者立即获胜。`, '满图侦察、捕捉、清巢穴'],
      ['起源', `拥有全部 ${civ.sanctuaries.definitions.length} 块圣所石板。只有圣所主人能挑战守卫，所以 4 个圣所都要由你建立；任一圣所被对手抢先建立，这条路线就断了。`, '早期派单位占圣所，每个 80 金'],
      ['冠军赛', `赢得 ${civ.championship.titlesNeededForVictory} 次冠军赛。第 ${civ.championship.firstSeasonRound} 轮开第一届，之后每 ${civ.championship.intervalRounds} 轮一届。`, '6 只高等级宝可梦，报名时与所有文明和平'],
      ['华丽大赛', '魅力 ≥ 500，并且至少是每个存活对手的 1.5 倍。', '多建华丽馆、多登记物种和稀有树果'],
      ['信仰', '地图上至少有 6 座有主城市；你的信仰占所有有主城市的 60%（向上取整）以上；并且每个存活对手都至少有 1 座城市信你的信仰。', '先攒供奉点创立信仰，再主动传播'],
      ['计分', '到达轮上限（100 / 200 / 300）那一轮结束时，分数最高者获胜。', '均衡发展'],
      ['失败', '单人模式下你的首都被占，游戏立刻结束，没有赢家。', '首都留守'],
    ])}
    <h3>计分公式</h3>
    <p><strong>分数 = (城市 × 80 + 人口 × 10 + 已登记物种 × 5 + 科技 × 20 + 击倒数 × 2) × 1.2（已研究联盟规章，否则 × 1）</strong>，向下取整。被消灭的文明分数冻结。同分时依次比较城市、人口、科技、击倒数，仍相同则共享胜利。</p>
    ${tip('计分里城市权重最高：一座城 = 8 个人口 = 16 个物种。100 轮的局，前 30 轮多开城几乎总是对的。')}` },
];

export const SYSTEM_SECTIONS: readonly GuideSection[] = [
  { id: 'essences', group: '文明发展', title: '属性精华与道馆', badge: 'v4', html: `
    <p>18 种属性归为 7 种精华，每种群系产出一种。精华用于建属性道馆、加速训练、发动时代能力。</p>
    ${T.essenceTable()}
    <ul>
      <li><strong>产出</strong>：每座城市每轮，城市中心格 +1、每个耕作中的地块 +1（按各自群系）；有道馆再 +1 道馆精华。每种精华最多存 ${T.essenceRules.cap}，超出部分浪费。当轮被占领的城市不产出。</li>
      <li><strong>属性道馆</strong>：${T.essenceRules.gymEssenceCost} 点对应精华 + ${T.essenceRules.gymGoldCost} 金，每城 1 座。效果：精华 +1/轮；本城训练的同属性宝可梦经验 +${T.essenceRules.gymTrainedXp}；训练加速更强；羁绊 +2；华丽大赛魅力 +1；可以在本城供奉。城市被占或脱离时道馆消失。</li>
      <li><strong>训练加速</strong>：城市队列第一项是宝可梦、且你有至少 ${T.essenceRules.trainingSpend} 点它主属性的精华时，每轮自动花 ${T.essenceRules.trainingSpend} 点换 +${T.essenceRules.trainingBoost} 生产进度（同属性道馆城市 +${T.essenceRules.gymTrainingBoost}）。</li>
      <li><strong>主场防守</strong>：防守方站在与自己任一属性同精华的群系上时，受到伤害 ×${T.essenceRules.homeDefense / 1000}。例如岩石系在山地、水系在海洋。</li>
    </ul>` },

  { id: 'era-abilities', group: '文明发展', title: '时代能力与天气', badge: 'v5', html: `
    <p>每进入一个新世代解锁一项能力。除昼夜外，主动能力都要消耗精华。<strong>精简进程只能到第 3 世代</strong>，所以只有昼夜和天气；Mega、Z 招式、极巨化、太晶化只在完整进程中出现。</p>
    ${T.eraAbilityTable()}
    <h3>天气</h3>
    ${T.weatherTable()}
    <ul>
      <li>天气以你的一座城市为中心，半径 3，持续 3 轮，冷却 8 轮。效果只看<strong>攻击方所在位置和主属性</strong>，范围内的敌人同样受影响。</li>
      <li>夜晚是每 4 轮中的后 2 轮，对所有文明生效：恶、幽灵系主动攻击 +15%。</li>
      <li>亲密度：第 2 世代起，你城市劳动范围内的宝可梦每轮 +3 经验。</li>
      <li>Mega 只能给最终形态，永久生效，同时只能有一只；太晶化同理。</li>
    </ul>
    ${tip('下雨/大晴天要放在“你的攻击方”站的位置，而不是敌人站的位置。火系部队进攻时，别在自己头顶下雨。')}` },

  { id: 'bonds', group: '文明发展', title: '满意度与城市羁绊', badge: 'v6', html: `
    <h3>满意度（整个文明一个数值）</h3>
    <p>范围 0–100，<strong>开局为 0</strong>，每轮 −4。满意度 ≥ 50 时每轮 +2 金、联盟点 +2；低于 20 时所有非首都城市羁绊每轮 −2。来源：采集树果、清除巢穴（+10）、稀有树果（每种 +2/轮）、信条“和谐”（+1/轮）。</p>
    <h3>城市羁绊（每座城市）</h3>
    <p>自建城市起始 100，占领来的城市起始 75。首都永远是 100，不会脱离。每轮变化为以下各项之和：</p>
    ${T.table(['因素', '每轮'], [
      ['基础', '+2'], ['距首都超过 6 格', '每多 1 格 −1，最多 −6'], ['最近 10 轮内被占领', '−4'], ['文明满意度低于 20', '−2'],
      ['有宝可梦中心', '+2'], ['有属性道馆', '+2'], ['相邻 1 格内有己方宝可梦（驻军）', '+2'], ['花园设施区', '+1 起（含相邻加成）'],
      ['信仰烈空坐', '+1'], ['每拥有一种稀有树果', '+1'], ['5 格内每座他国城市', '−1'],
    ])}
    <ul>
      <li><strong>羁绊归零</strong>：城市脱离成为中立营地，耕作和生产队列清空，在此休养的宝可梦消失，道馆丢失。信奉本国信仰并有“和谐”信条的城市不会脱离。</li>
      <li><strong>收复</strong>：花 80 金收回距离你城市 6 格（或劳动范围）内的中立城市，羁绊回到 50，并按“刚被占领”计算 10 轮。</li>
    </ul>
    ${tip('开局满意度是 0，前期远离首都的新城会慢慢掉羁绊。在边境城放一只宝可梦驻守（+2），尽早建宝可梦中心，并找稀有树果。')}` },

  { id: 'rare-berries', group: '文明发展', title: '稀有树果', badge: 'v7', html: `
    <p>每种稀有树果在对应群系有 ${T.rareBerryRules.depositsPerType} 个矿点（彼此至少相距 5 格）。<strong>城市耕作</strong>该地块就算拥有这种树果；设施区不能建在稀有树果上。</p>
    ${T.rareBerryTable()}
    <ul>
      <li>每拥有一<strong>种</strong>：满意度 +${T.rareBerryRules.satisfactionPerType}/轮，所有城市羁绊 +${T.rareBerryRules.bondPerType}/轮，华丽大赛魅力 +1。2 种就能抵消满意度每轮 −4 的衰减。</li>
      <li>拥有 ${T.rareBerryRules.festivalTypes} 种及以上：<strong>庆典</strong>，每座城市食物 +1。</li>
      <li><strong>赠送</strong>：与贸易伙伴之间，可以把多余的一份（同种第 2 份起）送给对方，赠送方 +${T.rareBerryRules.giftTrust} 信任、+${T.rareBerryRules.giftGold} 金，同一对象冷却 ${T.rareBerryRules.giftCooldown} 轮。</li>
    </ul>` },

  { id: 'world', group: '世界', title: '世界系统', html: `
    <h3>图鉴记录</h3>
    <p>一个物种计入图鉴，需要<strong>看到过</strong>它，并且<strong>看到它参与战斗</strong>或<strong>捕捉过它</strong>。用进化石进化会直接记录新物种；普通经验进化的新形态还要参加一次战斗才计入。图鉴胜利目标 21 种。</p>
    <h3>巢穴</h3>
    <p>开局在离城市 4 格以外放置 ${world.nests.count} 个巢穴（${world.nests.hp} HP）。每 ${world.nests.spawnIntervalRounds} 轮在附近刷出一只<strong>暴走宝可梦</strong>（80% HP，每巢最多 ${world.nests.maxActivePerNest} 只），它们会攻击<strong>所有文明</strong>最近的单位或城市，但不会把城市打到 1 HP 以下。</p>
    <p>清除巢穴：让射程内的宝可梦攻击它，每次造成 max(3, ⌊攻击/3⌋) 伤害，巢穴反击 ${world.nests.damage}（不会击倒你的单位）。清除奖励 ${world.nests.clearGoldReward} 金 + ${world.nests.clearSatisfactionReward} 满意度。</p>
    <h3>霸主</h3>
    <p>${world.overlords.count} 只稀有宝可梦占据的营地，离城市至少 5 格。你的城市在 ${world.overlords.reach} 格内时可以供奉（${world.overlords.foodCost} 食物或 ${world.overlords.goldCost} 金，每只每轮一次），每次羁绊 +${world.overlords.bondPerOffering}，不会衰减。</p>
    ${T.table(['等级', '所需羁绊', '效果'], [
      ['1', String(world.overlords.tier1Bond), `霸主周围 ${world.overlords.tier1VisionRadius} 格永久视野`],
      ['2', String(world.overlords.tier2Bond), `3 格内你的城市：${T.yieldText(world.overlords.tier2Yield)}`],
      ['3', String(world.overlords.tier3Bond), `3 格内你的城市：${T.yieldText(world.overlords.tier3Yield)}`],
    ], [1])}
    <p class="note">同一城市只取范围内最高的一个等级，多个霸主不叠加。</p>
    <h3>普通树果</h3>
    <p>地图上 ${world.berryDeposits} 处树果丛。单位站在上面、且 3 格内有你的城市时可以采集：食物送到最近的城市，满意度增加。采完后过一段时间再生；城市耕作这格时也有少量食物。</p>
    ${T.berryTable()}
    <h3>进化石</h3>
    <p>每种进化石 2 个矿点，各只能采 1 次（大吾采集得 2 块）。宝可梦站在上面采集，用石头进化不花金币。</p>
    ${T.stoneTable()}
    ${tip('御三家的最终进化只能靠进化石，而每种只有 2 块。开局就派侦察兵去找对应的石头矿点。')}` },

  { id: 'civilization', group: '世界', title: '供奉、幻影与圣所', html: `
    <h3>供奉点</h3>
    <p>城市可以供奉（${civ.offering.foodCost} 食物或 ${civ.offering.goldCost} 金，每城每轮一次）获得 ${civ.offering.points} 供奉点。前提：你拥有至少一个圣所，或该城有属性道馆或华丽馆。供奉点用于召唤幻影、创立和传播信仰。</p>
    <h3>幻影（伟人）</h3>
    <p>第 n 个幻影花费 ${civ.phantoms.firstSummonCost} + ${civ.phantoms.summonCostStep} × (n − 1) 供奉点。五类各只能召唤一次，激活后进入名人堂。</p>
    ${T.phantomTable()}
    <h3>圣所与起源胜利</h3>
    <p>地图四个象限各有一个圣所。任意单位站上去并花 ${civ.sanctuaries.establishmentCost} 金即可建立，<strong>永久归你</strong>。圣所主人可以带 1–3 只宝可梦（2 格内、至少一只站在圣所上）挑战守卫，每轮一次。战斗自动模拟，你的宝可梦以当前 HP 参战；胜利获得石板，集齐 4 块即起源胜利。</p>
    ${T.sanctuaryTable()}
    <h3>冠军赛</h3>
    <p>报名需要 6 只不同的己方宝可梦，且报名时与所有文明处于和平。赛季开赛时 6 人淘汰赛，不足由 NPC 补齐（NPC 强度随届数上升）。队伍强度 = 每只的 HP + 攻 + 防 + ⌊经验/10⌋ 之和。赢 2 届获胜。</p>
    ${tip('冠军赛看的是进化阶段和经验。把进化完成、经验高的最终形态留在后方，报名前停战。')}` },

  { id: 'diplomacy', group: '世界', title: '外交', html: `
    <ul>
      <li>所有文明开局都处于和平。宣战需要和平状态、过了冷却期，并且双方没有同盟。</li>
      <li>停战提议只能在交战满 5 轮后提出；对方 5 轮内拒绝过你时不能再提。对方结束回合不回应视为拒绝。停战后 10 轮内不能再宣战（任一方研究联盟规章则为 5 轮）。</li>
      <li><strong>贸易</strong>：和平时提议，对方同意后每 5 轮双方各 +4 金（小椿翻倍），信任 +1。</li>
      <li><strong>同盟</strong>：和平时提议；规则上的作用是双方不能互相宣战。提议 5 轮后过期，被拒后 10 轮内不能再提。</li>
      <li>任一方宣战会在轮末取消双方的同盟和贸易。解除同盟免费；背叛同盟花 20 金，信任降到 −50，10 轮内不能再提同盟。</li>
    </ul>` },

  { id: 'contests', group: '世界', title: '华丽大赛', badge: 'v8', html: `
    <ul>
      <li><strong>华丽馆</strong>：先付 20 金，之后城市每轮把一半生产（至少 1）投入建造，满 50 完工；建造期间生产队列只拿到另一半。每城 1 座。</li>
      <li><strong>魅力</strong>每轮增加：华丽馆数 × 2 + min(基础值, 华丽馆数 × 10)。基础值 = 已登记物种 + 稀有物种 × 2 + 稀有树果种类 + 道馆数。</li>
      <li><strong>举办大赛</strong>：30 金，每座华丽馆魅力 +3，冷却 6 轮。</li>
      <li><strong>胜利</strong>：魅力 ≥ 500 且至少是每个存活对手的 1.5 倍，只有一人满足时获胜。</li>
    </ul>
    ${tip('每座华丽馆最多吃 10 点基础值，所以馆越多上限越高；物种和稀有树果是基础值的主要来源。')}` },

  { id: 'faith', group: '世界', title: '传说信仰', badge: 'v9', html: `
    <ul>
      <li><strong>创立</strong>：累计供奉 ≥ ${T.faithRules.foundLifetime} 且当前有 ${T.faithRules.foundCost} 供奉点。选一位未被选走的传说和 2 条信条。首都立即皈依。</li>
      <li><strong>主动传播</strong>：对你城市 ${T.faithRules.spreadRange} 格内任一有主城市（包括对手的），花 ${T.faithRules.spreadCost} 点，信仰压力 +${T.faithRules.spreadPressure}（传教士信条为 15 点、+50）。</li>
      <li><strong>被动传播</strong>：每座信仰城市每轮给 ${T.faithRules.passiveRange} 格内的有主城市 +${T.faithRules.passivePressure} 压力。压力上限 ${T.faithRules.pressureCap}，不会衰减。</li>
      <li>某信仰压力达到 ${T.faithRules.convertAt} 且领先时，城市皈依；平局保持原信仰。城市变为中立时失去信仰。</li>
    </ul>
    ${T.legendTable()}
    ${T.tenetTable()}` },

  { id: 'strategy', group: '攻略', title: '攻略：按胜利路线', html: `
    <h3>征服（默认最常见）</h3>
    <ul>
      <li>选渡、君莎、大吾或坂木。前期扩张到 3–4 城，再研究特训法和投石改装。</li>
      <li>部队配比：2 只攻城型（小拳石一系、大岩蛇）负责扣城血，近战/快速型在前面形成控制区挡住反击，远程补刀并吃夹击。</li>
      <li>只打首都：首都一破，对方所有城市变中立，可以花 80 金逐个收复。</li>
    </ul>
    <h3>图鉴</h3>
    <ul>
      <li>选坂木或大木博士。研究驯化 → 精灵球工艺 → 野外观察，买超级球。</li>
      <li>侦察型满图跑：“看到 + 看到战斗”也算记录，不一定要抓。巢穴里有扩展物种（穿山鼠、阿柏蛇、绿毛虫等），清巢穴时顺便记录。</li>
    </ul>
    <h3>起源</h3>
    <ul><li>前 20 轮派快速/侦察单位抢 4 个圣所（每个 80 金）。守卫强度依次升高，最后一个（山岳守卫）需要进化过的队伍。只要有一个圣所被别人建了，就改走别的路线。</li></ul>
    <h3>华丽大赛 / 信仰（和平路线）</h3>
    <ul>
      <li>选小椿或乔伊。多开城，每城建华丽馆或道馆（也让该城能供奉），找齐稀有树果。</li>
      <li>信仰需要每个对手至少有 1 座城信你的教：优先对边境的对手城市主动传播。</li>
    </ul>
    <h3>通用</h3>
    <ul>
      <li>金币不要变成负数：会从维护费最高的宝可梦开始解散。</li>
      <li>首都必须留守，单人局首都失守直接失败。</li>
      <li>每次完成规章或进入新时代时免费换方针卡，趁这时调整。</li>
    </ul>` },
];
