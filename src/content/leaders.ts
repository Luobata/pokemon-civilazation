/** Classic four plus five more (expansion v1 only uses them when a setup names them). */
export const LEADER_IDS = ['oak', 'lance', 'jenny', 'joy', 'brock', 'misty', 'steven', 'jasmine', 'giovanni'] as const;
export type LeaderId = typeof LEADER_IDS[number];
export type LeaderEffects = {
  cityResearch: number; laboratoryResearch: number; activeAttackMultiplier: number;
  cityCounterAttack: number; cityVision: number; territoryHealing: number; recoveryReduction: number;
  /** Extra city defense (permille city HP base) and per-city gold, used by the newer leaders. */
  cityGold: number; captureBonus: number; captureGold: number; workPointBonus: number; settlerDiscountPercent: number;
};
const NO_EFFECTS: Readonly<LeaderEffects> = {
  cityResearch: 0, laboratoryResearch: 0, activeAttackMultiplier: 1000,
  cityCounterAttack: 0, cityVision: 0, territoryHealing: 0, recoveryReduction: 0,
  cityGold: 0, captureBonus: 0, captureGold: 0, workPointBonus: 0, settlerDiscountPercent: 0,
};
export type LeaderDefinition = {
  id: LeaderId; name: string; title: string; specialty: string; ability: string; description: string;
  effects: Readonly<LeaderEffects>;
};

// Prototype balance. The human and AI use the same effects; no leader consumes RNG.
export const LEADERS: Record<LeaderId, LeaderDefinition> = {
  oak: { id: 'oak', name: '大木博士', title: '真新镇的研究者', specialty: '科研', ability: '图鉴研究',
    description: '每座城市每轮科研 +1；建有宝可梦研究所的城市额外科研 +1。',
    effects: { ...NO_EFFECTS, cityResearch: 1, laboratoryResearch: 1 } },
  lance: { id: 'lance', name: '渡', title: '龙之使者', specialty: '进攻', ability: '冠军号令',
    description: '己方宝可梦主动攻击单位或城市时，伤害 +10%；反击不加成。',
    effects: { ...NO_EFFECTS, activeAttackMultiplier: 1100 } },
  jenny: { id: 'jenny', name: '君莎小姐', title: '城镇的守护者', specialty: '巡防', ability: '联盟警戒',
    description: '己方城市视野半径 +1 格，城市反击攻击力 +4。',
    effects: { ...NO_EFFECTS, cityCounterAttack: 4, cityVision: 1 } },
  joy: { id: 'joy', name: '乔伊小姐', title: '宝可梦护理师', specialty: '恢复', ability: '悉心护理',
    description: '己方宝可梦在领地内每轮额外恢复 5 HP；战败休养减少 1 轮，至少 1 轮。',
    effects: { ...NO_EFFECTS, territoryHealing: 5, recoveryReduction: 1 } },
  brock: { id: 'brock', name: '小刚', title: '深灰市道馆馆主', specialty: '建设', ability: '坚岩筑城',
    description: '开拓队训练所需生产 −25%；宝可梦每次施工地块改良额外 +1 点。',
    effects: { ...NO_EFFECTS, settlerDiscountPercent: 25, workPointBonus: 1 } },
  misty: { id: 'misty', name: '小霞', title: '华蓝市道馆馆主', specialty: '水域', ability: '水之馆主',
    description: '己方城市反击攻击力 +2；己方宝可梦在海洋或临海地块的主动攻击与反击伤害 +10%。',
    effects: { ...NO_EFFECTS, cityCounterAttack: 2 } },
  steven: { id: 'steven', name: '大吾', title: '丰缘联盟冠军', specialty: '进化', ability: '石之收藏家',
    description: '采集进化石矿脉额外获得 1 块；宝可梦进化所需金币 −50%；每座城市科研 +1。',
    effects: { ...NO_EFFECTS, cityResearch: 1 } },
  jasmine: { id: 'jasmine', name: '小椿', title: '浅葱市道馆馆主', specialty: '贸易', ability: '灯塔守望',
    description: '人口 ≥3 的城市金币 +1；贸易协定收益翻倍。',
    effects: { ...NO_EFFECTS, cityGold: 1 } },
  giovanni: { id: 'giovanni', name: '坂木', title: '常磐市道馆馆主', specialty: '捕捉', ability: '火箭队首领',
    description: '捕捉成功率 +15%；每次成功捕捉获得 15 金币；开拓队训练所需生产 −15%。',
    effects: { ...NO_EFFECTS, captureBonus: 15, captureGold: 15, settlerDiscountPercent: 15 } },
};
/** Classic leaders are the original four; the rest arrive with gameplay v4. */
export const CLASSIC_LEADER_IDS = ['oak', 'lance', 'jenny', 'joy'] as const;
export function isLeaderId(value: unknown): value is LeaderId {
  return typeof value === 'string' && Object.hasOwn(LEADERS, value);
}
// Omitted in legacy saves/logs: retain their exact original rules and serialized state.
export function leaderEffects(id: LeaderId | undefined): Readonly<LeaderEffects> {
  return id === undefined ? NO_EFFECTS : LEADERS[id].effects;
}
