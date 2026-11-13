// Glossary for players who know Civilization VI: each Pokémon-themed system name, the closest
// Civ VI system, and a one-line note on how it differs. Display-only data (no rule reads it):
// the handbook table (src/guide) and the in-game hints (src/browser/civ-hint.ts) both read it.
// Only systems with a genuinely close analogue are listed; 冠军赛、圣所与起源胜利、属性精华、
// 时代能力 and the Pokédex victory have none and are left out on purpose.

export type CivGlossaryGroup = '市政与政体' | '时代' | '城市与单位' | '世界' | '宗教与伟人' | '战斗' | '胜利';

export type CivGlossaryEntry = {
  /** The name this game uses (as written in the UI and the handbook). */
  term: string;
  /** Other spellings of the same thing in the UI or handbook. */
  aliases?: readonly string[];
  /** The closest Civilization VI system, in the Chinese localisation's words. */
  civ: string;
  /** How it differs from Civ VI, when it does. */
  note?: string;
  /** Handbook section (id in src/guide) that explains the system and uses the term. */
  section: string;
  group: CivGlossaryGroup;
};

export const CIV_GLOSSARY = {
  charter: { term: '联盟规章', aliases: ['规章'], civ: '市政', group: '市政与政体', section: 'policies',
    note: '6 项规章组成一棵小树，前置要全部确立；没有对应“鼓舞”的提前完成。' },
  charterPoints: { term: '联盟点', aliases: ['规章点'], civ: '文化值', group: '市政与政体', section: 'policies',
    note: '只用来推进联盟规章，不扩张边界。' },
  policyCard: { term: '方针卡', civ: '政策卡', group: '市政与政体', section: 'policies',
    note: '只有军事、经济、通配三种槽，没有外交槽。' },
  government: { term: '联盟体制', aliases: ['体制'], civ: '政体', group: '市政与政体', section: 'governments',
    note: '6 种分两层，提供额外方针槽和一项常驻加成；没有传承加成。' },

  era: { term: '时代', aliases: ['第 N 时代'], civ: '时代', group: '时代', section: 'techs',
    note: '按你自己完成的科技数推进，各文明分别计算；文明 6 的时代是全世界一起推进。“世代”只指黄金/黑暗世代。' },
  eraAge: { term: '黄金世代', aliases: ['黑暗世代', '英雄世代', '世代荣誉'], civ: '黄金时代 / 黑暗时代', group: '时代', section: 'techs',
    note: '按上一世代平均每轮的世代分判定，不看总分。' },
  eraScore: { term: '世代分', aliases: ['世代得分'], civ: '时代得分', group: '时代', section: 'techs',
    note: '建城、进化、捕捉、确立规章等里程碑得分。' },
  dedication: { term: '时代献礼', civ: '时代献礼（Dedications）', group: '时代', section: 'techs',
    note: '“承诺”在普通/黑暗世代额外得世代分；“黄金效果”只在黄金/英雄世代生效。' },
  discovery: { term: '图鉴发现', civ: '尤里卡', group: '时代', section: 'techs',
    note: '达成条件立得该科技 40% 进度；只有科技有，规章没有。' },

  district: { term: '设施区', civ: '区域', group: '城市与单位', section: 'districts',
    note: '每城最多 2 个，同类 1 个；同样占一整格，有相邻加成。' },
  improvement: { term: '地块改良', aliases: ['改良'], civ: '改良设施', group: '城市与单位', section: 'improvements',
    note: '只有工匠能修；资源格要建对应的资源改良。' },
  pillage: { term: '掠夺', civ: '掠夺', group: '城市与单位', section: 'improvements',
    note: '交战时站在敌方改良上掠夺，得一次性奖励；工匠修复不消耗次数。' },
  builder: { term: '工匠', civ: '建造者', group: '城市与单位', section: 'roles',
    note: '固定由搬运小匠担任，次数用完就离开；可以带一只随行宝可梦换特长。' },
  settler: { term: '开拓队', civ: '开拓者', group: '城市与单位', section: 'roles',
    note: '随行宝可梦的属性决定新城的开局特长。' },
  trader: { term: '商队', civ: '商人', group: '城市与单位', section: 'roles',
    note: '固定由变隐龙担任，只开国内商路。' },
  tradeRoute: { term: '商路', civ: '商路', group: '城市与单位', section: 'city-network',
    note: '只能连自己的城市，收益固定；没有国际商路和路线选择。' },
  satisfaction: { term: '满意度', civ: '宜居度', group: '城市与单位', section: 'bonds',
    note: '整个文明一个数值（文明 6 按城市算），开局为 0、每轮下降。' },
  bond: { term: '城市羁绊', aliases: ['羁绊'], civ: '忠诚度', group: '城市与单位', section: 'bonds',
    note: '归零的城市脱离成中立营地；首都永远不会脱离。' },
  neutralCamp: { term: '中立营地', civ: '自由城市', group: '城市与单位', section: 'bonds',
    note: '不产出、不能工作；可以花金币和平收复，或打下来。' },
  rareBerry: { term: '稀有树果', civ: '奢侈品资源', group: '城市与单位', section: 'rare-berries',
    note: '城市耕作就算拥有；每种只算一次，加全文明满意度和城市羁绊。' },

  nest: { term: '巢穴', civ: '蛮族前哨', group: '世界', section: 'world',
    note: '定期刷出暴走宝可梦；不会扩张，清除得金币和满意度。' },
  rampaging: { term: '暴走宝可梦', civ: '蛮族单位', group: '世界', section: 'world',
    note: '攻击所有文明的单位和城市，但只能把城市打到 1 HP，不会占城。' },
  overlord: { term: '霸主', civ: '城邦', group: '世界', section: 'world',
    note: '供奉食物或金币累积羁绊（类似派使者）换加成；没有宗主和城邦任务。' },
  itemBall: { term: '道具球', civ: '部落村庄', group: '世界', section: 'opening',
    note: '任意己方单位走上去就拿到一件随机奖励。' },
  wonder: { term: '传说奇观', civ: '奇观', group: '世界', section: 'legends',
    note: '要先找到这位传说的线索才能开工；全世界唯一，带三章剧情。' },

  phantom: { term: '幻影', civ: '伟人', group: '宗教与伟人', section: 'civilization',
    note: '五类各只能召唤一次，用供奉点直接召唤，不和其他文明抢伟人点。' },
  offering: { term: '供奉点', aliases: ['供奉'], civ: '信仰值', group: '宗教与伟人', section: 'civilization',
    note: '城市花食物或金币供奉获得；用来召唤幻影、创立和传播信仰。' },
  faith: { term: '传说信仰', civ: '宗教', group: '宗教与伟人', section: 'faith',
    note: '花供奉点直接传播，没有传教士等宗教单位，也没有神学战斗。' },
  tenet: { term: '信条', civ: '宗教信仰（Beliefs）', group: '宗教与伟人', section: 'faith',
    note: '创立时一次选 2 条，之后不再增加。' },

  unitClass: { term: '兵种', civ: '单位类型', group: '战斗', section: 'classes',
    note: '兵种相克只小幅修正，主要的克制仍看 18 种属性。' },
  merit: { term: '战功', civ: '单位经验值（晋升）', group: '战斗', section: 'combat',
    note: '与进化用的经验分开；每次晋升从 5 个通用特性里选，最多 3 次。' },
  flanking: { term: '夹击', civ: '侧翼包抄', group: '战斗', section: 'combat',
    note: '最多算 3 只相邻己方宝可梦；攻城和反击不吃夹击。' },

  contest: { term: '华丽大赛', civ: '文化胜利', group: '胜利', section: 'contests',
    note: '比的是华丽馆积累的魅力（达到门槛且是每个对手的 1.5 倍），没有旅游业绩和游客。' },
  faithVictory: { term: '信仰胜利', civ: '宗教胜利', group: '胜利', section: 'faith',
    note: '要占全图有主城市的 60%，且每个对手至少 1 座城信你的信仰。' },
} as const satisfies Record<string, CivGlossaryEntry>;

export type CivGlossaryId = keyof typeof CIV_GLOSSARY;
export const CIV_GLOSSARY_IDS = Object.keys(CIV_GLOSSARY) as CivGlossaryId[];
export const CIV_GLOSSARY_GROUPS: readonly CivGlossaryGroup[] = ['市政与政体', '时代', '城市与单位', '世界', '宗教与伟人', '战斗', '胜利'];

/** "文明 6：市政" — the short form used next to headings. */
export const civTermLabel = (id: CivGlossaryId): string => `文明 6：${CIV_GLOSSARY[id].civ}`;
/** Short parenthetical for plain-text places (the map hover line and the tile inspector). */
export const civAside = (id: CivGlossaryId): string => `（${civTermLabel(id)}）`;
/** One sentence for hover text and tooltips: the analogue, then the difference. */
export const civTermSentence = (id: CivGlossaryId): string => {
  const entry: CivGlossaryEntry = CIV_GLOSSARY[id];
  return `${entry.term} ≈ 《文明 6》的${entry.civ}${entry.note ? `。${entry.note}` : '。'}`;
};
