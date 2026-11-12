// Icons for civics, policy cards and governments (docs/design/ui-icons/README.md): what a PolicyEffects bonus does,
// as icon + number chips, and an emblem per charter, government, policy card and slot kind. Presentation only.
import type { CharterId, GovernmentId, PolicyEffects, PolicyId, SlotKind } from '../content/policies.ts';
import { escapeAttr, statChip, uiIcon } from './ui-icons.ts';
import type { UiIconName } from './ui-icons.ts';

const EFFECTS: Record<keyof PolicyEffects, { icon: UiIconName; label: string; format: (value: number) => string }> = {
  trainedXp: { icon: 'star', label: '新训练宝可梦经验', format: value => `+${value}` },
  trainingDiscountPercent: { icon: 'production', label: '训练所需生产', format: value => `−${value}%` },
  cityProduction: { icon: 'production', label: '每座城市生产', format: value => `+${value}` },
  cityFood: { icon: 'food', label: '每座城市食物', format: value => `+${value}` },
  cityGold: { icon: 'gold', label: '每座城市金币', format: value => `+${value}` },
  cityResearch: { icon: 'research', label: '每座城市科研', format: value => `+${value}` },
  workPointBonus: { icon: 'improvement', label: '改良每次施工', format: value => `+${value}` },
  captureBonus: { icon: 'pokeBall', label: '捕捉成功率', format: value => `+${value}%` },
  healing: { icon: 'medicine', label: '宝可梦每轮恢复 HP', format: value => `+${value}` },
  ballDiscount: { icon: 'greatBall', label: '精灵球价格', format: value => `−${value}` },
  upkeepReduction: { icon: 'unit', label: '维护费', format: value => `−${value}` },
  visionBonus: { icon: 'class:scout', label: '视野', format: value => `+${value}` },
};

/** One icon + number chip per effect; each chip is named by its effect. */
export const effectChips = (effects: PolicyEffects): string => (Object.entries(effects) as [keyof PolicyEffects, number][])
  .filter(([, value]) => value).map(([key, value]) => statChip(EFFECTS[key].icon, EFFECTS[key].format(value), EFFECTS[key].label, 'effect-stat')).join('');

export const CHARTER_ICONS: Record<CharterId, UiIconName> = {
  gymCode: 'gym', rangerCharter: 'map', tradeGuild: 'handshake', breederAssociation: 'egg', pokemonLeague: 'badge', eliteFour: 'trophy',
};
export const GOVERNMENT_ICONS: Record<GovernmentId, UiIconName> = {
  gymLeague: 'gymDistrict', researchSociety: 'researchDistrict', ranchCommons: 'ranch', championCouncil: 'trophy', breederRepublic: 'gardenDistrict', merchantAssembly: 'gold',
};
export const POLICY_ICONS: Record<PolicyId, UiIconName> = {
  gymChallenge: 'star', fieldDrill: 'production', conscription: 'unit', rangerPatrol: 'class:scout', nurseCorps: 'medicine', safariZone: 'pokeBall',
  harvestFestival: 'food', masterBuilders: 'improvement', marketDay: 'gold', pokeMart: 'greatBall', researchGrant: 'research', professorNetwork: 'production',
};

/** A slot-kind pip ("军事槽 +1"): an empty card in the slot's colour (the colour policy chips of that kind share) and the count. */
export const slotPip = (kind: SlotKind, count: number, name: string) =>
  `<span class="slot-pip ${kind}" role="img" aria-label="${name}槽 +${count}" title="${name}槽 +${count}"><i class="slot-card ${kind}" aria-hidden="true"></i><b aria-hidden="true">+${count}</b></span>`;
/** The slot card alone, named, for slot-board rows. */
export const slotCard = (kind: SlotKind, name: string) => `<i class="slot-card ${kind}" role="img" aria-label="${name}槽" title="${name}槽"></i>`;

/** A policy card as a small card-shaped picture; the name and effect are its accessible name. */
export const policyChip = (id: PolicyId, slot: Exclude<SlotKind, 'wild'>, label: string, affinity: boolean) =>
  `<span class="policy-chip ${slot}${affinity ? ' affinity' : ''}" role="img" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}">${uiIcon(POLICY_ICONS[id], { size: 18 })}</span>`;
