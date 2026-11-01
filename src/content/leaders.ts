export const LEADER_IDS = ['oak', 'lance', 'jenny', 'joy'] as const;
export type LeaderId = typeof LEADER_IDS[number];
export type LeaderEffects = {
  cityResearch: number; laboratoryResearch: number; activeAttackMultiplier: number;
  cityCounterAttack: number; cityVision: number; territoryHealing: number; recoveryReduction: number;
};
const NO_EFFECTS: Readonly<LeaderEffects> = {
  cityResearch: 0, laboratoryResearch: 0, activeAttackMultiplier: 1000,
  cityCounterAttack: 0, cityVision: 0, territoryHealing: 0, recoveryReduction: 0,
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
};
export function isLeaderId(value: unknown): value is LeaderId {
  return typeof value === 'string' && Object.hasOwn(LEADERS, value);
}
// Omitted in legacy saves/logs: retain their exact original rules and serialized state.
export function leaderEffects(id: LeaderId | undefined): Readonly<LeaderEffects> {
  return id === undefined ? NO_EFFECTS : LEADERS[id].effects;
}
