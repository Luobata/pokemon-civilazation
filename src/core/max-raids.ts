// Gameplay v27 ⑤ (docs/design/pace-v27.md §6, option 5A): Max raids — Max shields (`shieldBase` + ⌈living / 2⌉; damage through them
// ×25%, a hit breaks 1, a breaker's or a super-effective hit 2), two phases (≤ 50% HP: shields return, the Max wave reaches 2 tiles), one free den Dynamax per civilization
// (RaidDynamax), roles by class, contribution = damage + 15 × shields + support healing, catch chances for every share ≥ 10%, the reward
// preview. The ledger rides on the raid boss (`RaidBoss.max`, absent before v27); the shield arithmetic is one pure function shared by the
// authority (`maxRaidHit` in combat.ts unitStrike) and the views (`viewMaxRaidDamage` in preview.ts, `raidPreview`). All integers.
import { eventsTuning } from '../content/pace-v27.ts';
import type { EventsTuning } from '../content/pace-v27.ts';
import { lateTuning } from '../content/depth-v26.ts';
import type { SpeciesDefinition, SpeciesId, TypeId } from '../content/species.ts';
import type { Content } from '../content/units.ts';
import { dualEffectiveness } from './combat-math.ts';
import { evolutionLines } from './evolution-goals.ts';
import { combatContext, teraTypes, viewCombatContext } from './era-abilities.ts';
import { hexDistance } from './hex.ts';
import type { Hex } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { EventPayload, GameState, MapUnit, PlayerView } from './model.ts';
import { maxUnitHp } from './unit.ts';

export type MaxRaidAction = { type: 'RaidDynamax'; unitId: number };
export const isMaxRaidAction = (action: { type: unknown }): action is MaxRaidAction => action.type === 'RaidDynamax';
/** Roles by class (§6.1 R4): breakers break 2 shields a hit, damage dealers hit ×1.25 once the shields are down, support heals. */
export type RaidRole = 'breaker' | 'dealer' | 'support';
export const RAID_ROLE_NAMES: Record<RaidRole, string> = { breaker: '破盾手', dealer: '输出', support: '支援' };
export const raidRole = (role: SpeciesDefinition['role']): RaidRole =>
  role === 'melee' || role === 'fast' || role === 'siege' ? 'breaker' : role === 'scout' ? 'support' : 'dealer';
/**
 * The v27 part of a raid boss. `shields` left of `shieldMax` in the current `phase`; per civilization: shields broken, HP healed by its
 * support, and the unit it Dynamaxed (one per raid).
 */
export type MaxRaidLedger = { shields: number; shieldMax: number; phase: 1 | 2; broken: Record<number, number>; healed: Record<number, number>; dynamax: Record<number, number> };
/** What the viewer sees: shields and phase once it explored the den; the ledger is public; its own Dynamax. */
export type MaxRaidView = { shields: number | null; shieldMax: number | null; phase: 1 | 2 | null; broken: Record<number, number>; healed: Record<number, number>;
  contribution: Record<number, number>; dynamaxUnitId: number | null; dynamaxUsed: boolean };
export type MaxRaidEvent =
  | { type: 'RaidDynamaxed'; public: true; playerId: number; unitId: number; untilRound: number }
  | { type: 'RaidShieldsBroken'; playerId: number; unitId: number | null; broken: number; shields: number; phase: 1 | 2; phaseTwo: boolean }
  | { type: 'RaidCaptureRolled'; public: true; playerId: number; speciesId: SpeciesId; chance: number; success: boolean; unitId: number | null };

/** A new boss's ledger: `shieldBase + ⌈living / 2⌉` shields (sweep-tuned base 1: 3 shields with 4 civilizations). */
export function initialMaxLedger(living: number, content: Content): MaxRaidLedger {
  const tuning = eventsTuning(content), shields = tuning.shieldBase + Math.ceil(living / 2);
  return { shields, shieldMax: shields, phase: 1, broken: {}, healed: {}, dynamax: {} };
}
/** Contribution per civilization = damage + `shieldPoints` × shields broken + support healing (§6.1 R5). */
export function raidContribution(damage: Readonly<Record<number, number>>, ledger: Pick<MaxRaidLedger, 'broken' | 'healed'>, content: Content): Record<number, number> {
  const points = eventsTuning(content).shieldPoints, result: Record<number, number> = {};
  for (const id of new Set([...Object.keys(damage), ...Object.keys(ledger.broken), ...Object.keys(ledger.healed)].map(Number))) {
    const value = (damage[id] ?? 0) + points * (ledger.broken[id] ?? 0) + (ledger.healed[id] ?? 0);
    if (value > 0) result[id] = value;
  }
  return result;
}
export type ShieldStrike = { damage: number; broken: number; phaseTwo: boolean };
/**
 * One strike on a Max boss (pure; authority and preview): through the shields the hit counts `shieldDamagePermille`, and it breaks 1
 * shield (2 for a breaker or a super-effective hit); with the shields down a damage dealer hits ×`dealerPermille`. The phase-one strike
 * that takes HP to the phase line (or below) starts phase two, where the shields return; its damage is kept.
 */
export function shieldStrike(boss: { shields: number; phase: 1 | 2; hp: number; maxHp: number }, role: RaidRole, superEffective: boolean, hit: number, tuning: EventsTuning): ShieldStrike {
  let damage: number, broken = 0;
  if (boss.shields > 0) {
    broken = Math.min(boss.shields, role === 'breaker' || superEffective ? tuning.breakerShields : 1);
    damage = Math.floor(hit * tuning.shieldDamagePermille / 1000);
  } else damage = role === 'dealer' ? Math.floor(hit * tuning.dealerPermille / 1000) : hit;
  damage = Math.max(0, Math.min(boss.hp, damage));
  const line = Math.floor(boss.maxHp * tuning.phaseTwoPercent / 100);
  if (boss.phase === 1 && boss.hp - damage <= line) return { damage, broken, phaseTwo: true };
  return { damage, broken, phaseTwo: false };
}
const typesOf = (content: Content, speciesId: SpeciesId): TypeId[] => {
  const species = content.species[speciesId];
  return [species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])];
};
const superEffective = (content: Content, attacker: SpeciesId, defenderTypes: readonly TypeId[], researched: boolean) =>
  dualEffectiveness(content.species[attacker].typeId, defenderTypes, researched) > 100;
const activeMax = (state: Pick<GameState, 'expansion'>) => { const boss = state.expansion?.raids?.active; return boss?.max ? boss : null; };

/** The damage a strike deals after the Max shields (= `hit` unless the defender is a raid boss of a Max-raid game); updates the ledger. */
export function maxRaidHit(state: GameState, attacker: MapUnit, defender: MapUnit, hit: number, content: Content): number {
  const boss = activeMax(state);
  if (!boss || boss.unitId !== defender.id || attacker.kind !== 'pokemon' || defender.kind !== 'pokemon' || attacker.ownerId === null) return hit;
  const ledger = boss.max!, tuning = eventsTuning(content);
  const researched = state.players[attacker.ownerId].research.unlockedIds.includes('typeResearch');
  const strike = shieldStrike({ shields: ledger.shields, phase: ledger.phase, hp: defender.hp, maxHp: boss.maxHp }, raidRole(content.species[attacker.speciesId].role),
    superEffective(content, attacker.speciesId, teraTypes(combatContext(state), defender.id) ?? typesOf(content, defender.speciesId), researched), hit, tuning);
  if (strike.broken) { ledger.shields -= strike.broken; ledger.broken[attacker.ownerId] = (ledger.broken[attacker.ownerId] ?? 0) + strike.broken; }
  if (strike.phaseTwo) { ledger.phase = 2; ledger.shields = ledger.shieldMax = tuning.shieldPhaseTwo; }
  return strike.damage;
}
/** Preview mirror: the min / max damage of the viewer's attack on a Max boss (unchanged for anything else). */
export function viewMaxRaidDamage(view: PlayerView, attacker: MapUnit, defender: MapUnit, damage: { min: number; max: number }, content: Content): { min: number; max: number; shields: number; phaseTwo: boolean } | null {
  const active = view.expansion?.raids?.active, max = active?.max;
  if (!active || !max || max.shields === null || max.phase === null || active.unitId !== defender.id || attacker.kind !== 'pokemon' || defender.kind !== 'pokemon') return null;
  const tuning = eventsTuning(content), role = raidRole(content.species[attacker.speciesId].role);
  const effective = superEffective(content, attacker.speciesId, teraTypes(viewCombatContext(view), defender.id) ?? typesOf(content, defender.speciesId), view.economy.player.research.unlockedIds.includes('typeResearch'));
  const boss = { shields: max.shields, phase: max.phase, hp: defender.hp, maxHp: active.maxHp };
  const low = shieldStrike(boss, role, effective, damage.min, tuning), high = shieldStrike(boss, role, effective, damage.max, tuning);
  return { min: low.damage, max: high.damage, shields: high.broken, phaseTwo: high.phaseTwo };
}

/**
 * Whether `playerId` knows where the den is: v26 — only once it explored the tile; v27 — always (the integration's fog follow-up: an
 * announced den is public to every civilization, like a world event, so several can join; terrain and units still need vision).
 */
export function knowsDen(_state?: Pick<GameState, 'knowledge'>, _playerId?: number, _tileIndex?: number, _content?: Content): boolean {
  void _state; void _playerId; void _tileIndex; void _content;
  return true;
}

// ---------- RaidDynamax ----------
export function validateMaxRaidAction(state: GameState, actorId: number, action: MaxRaidAction, content: Content): string | null {
  const boss = activeMax(state), statuses = state.expansion?.eraAbilities;
  if (!boss || !statuses || state.players[actorId]?.eliminated) return 'max-raids-unavailable';
  if (!knowsDen(state, actorId, boss.tileIndex, content)) return 'max-raids-unavailable';
  const unit = state.units[action.unitId], den = state.units[boss.unitId];
  if (!unit || unit.ownerId !== actorId || !isMapUnit(unit) || unit.kind !== 'pokemon' || !den || !isMapUnit(den)) return 'unit-unavailable';
  if (boss.max!.dynamax[actorId] !== undefined) return 'raid-dynamax-used';
  if (hexDistance(unit.position, den.position, state.map) > eventsTuning(content).dynamaxRange) return 'raid-dynamax-range';
  if ((statuses.units[unit.id]?.dynamaxUntilRound ?? 0) >= state.round) return 'raid-dynamax-active';
  return null;
}
/** The v26 Dynamax status (damage +30%, damage taken −30%) until the raid ends; no essence, no era-ability cooldown. */
export function applyMaxRaidAction(state: GameState, actorId: number, action: MaxRaidAction, content: Content): EventPayload[] {
  const reason = validateMaxRaidAction(state, actorId, action, content);
  if (reason) throw new Error(reason);
  const boss = activeMax(state)!, statuses = state.expansion!.eraAbilities!;
  statuses.units[action.unitId] = { ...(statuses.units[action.unitId] ?? {}), dynamaxUntilRound: boss.endsAtRound };
  boss.max!.dynamax[actorId] = action.unitId;
  return [{ type: 'RaidDynamaxed', public: true, playerId: actorId, unitId: action.unitId, untilRound: boss.endsAtRound }];
}
/** View mirror of the checks (null = the unit may Dynamax now). */
export function viewRaidDynamaxBlocker(view: PlayerView, unitId: number, content: Content): string | null {
  const active = view.expansion?.raids?.active, max = active?.max;
  if (!active || !max || active.unitId === null || view.outcome || view.activePlayerId !== view.playerId) return 'max-raids-unavailable';
  const unit = view.units.find(item => item.id === unitId && item.ownerId === view.playerId), den = view.units.find(item => item.id === active.unitId);
  if (!unit || unit.kind !== 'pokemon' || !den) return 'unit-unavailable';
  if (max.dynamaxUsed) return 'raid-dynamax-used';
  if (hexDistance(unit.position, den.position, view.map) > eventsTuning(content).dynamaxRange) return 'raid-dynamax-range';
  if ((view.expansion?.eraAbilities?.units[unit.id]?.dynamaxUntilRound ?? 0) >= view.round) return 'raid-dynamax-active';
  return null;
}
export const MAX_RAID_REASONS: Record<string, string> = {
  'max-raids-unavailable': '现在没有可以参加的极巨团体战', 'unit-unavailable': '没有这只宝可梦', 'raid-dynamax-used': '本次团体战你已经极巨化过一只',
  'raid-dynamax-range': '要站在极巨巢穴 2 格内', 'raid-dynamax-active': '它已经在极巨化',
};

// ---------- round end ----------
/** Max wave reach: adjacent in phase one, `phaseTwoRange` in phase two (1 before v27). */
export const maxWaveRange = (ledger: MaxRaidLedger | undefined, content: Content) => ledger?.phase === 2 ? eventsTuning(content).phaseTwoRange : 1;
/** Round end, support role: every own scout within `dynamaxRange` of the boss heals each own Pokémon within 1 by `supportHeal` (once a round). */
export function resolveRaidSupport(state: GameState, ledger: MaxRaidLedger, bossPosition: Hex, content: Content): void {
  const tuning = eventsTuning(content), units = Object.values(state.units).filter(isMapUnit).sort((a, b) => a.id - b.id);
  for (const scout of units) {
    if (scout.ownerId === null || scout.kind !== 'pokemon' || raidRole(content.species[scout.speciesId].role) !== 'support') continue;
    if (hexDistance(scout.position, bossPosition, state.map) > tuning.dynamaxRange) continue;
    for (const ally of units) {
      if (ally.ownerId !== scout.ownerId || ally.kind !== 'pokemon' || hexDistance(ally.position, scout.position, state.map) > 1 || !state.units[ally.id]) continue;
      const healed = Math.min(tuning.supportHeal, maxUnitHp(ally, content) - ally.hp);
      if (healed <= 0) continue;
      ally.hp += healed;
      ledger.healed[scout.ownerId] = (ledger.healed[scout.ownerId] ?? 0) + healed;
    }
  }
}
/** Civilizations whose share of the contribution is at least the v26 minimum (10%), ascending ids. */
export function raidSharers(contribution: Readonly<Record<number, number>>, content: Content): number[] {
  const total = Object.values(contribution).reduce((sum, value) => sum + value, 0);
  return Object.entries(contribution).filter(([, value]) => total > 0 && value * 100 >= lateTuning(content).raidMinSharePercent * total).map(([id]) => Number(id)).sort((a, b) => a - b);
}
/** The catch chance for a share (percent of the total, floored): base + share, at most `catchMaxPercent`. */
export const raidCatchChance = (sharePercent: number, content: Content) => Math.min(eventsTuning(content).catchMaxPercent, eventsTuning(content).catchBasePercent + sharePercent);
export function observeMaxRaid(state: GameState, playerId: number, damage: Readonly<Record<number, number>>, ledger: MaxRaidLedger, explored: boolean, content: Content): MaxRaidView {
  return { shields: explored ? ledger.shields : null, shieldMax: explored ? ledger.shieldMax : null, phase: explored ? ledger.phase : null,
    broken: { ...ledger.broken }, healed: { ...ledger.healed }, contribution: raidContribution(damage, ledger, content),
    dynamaxUnitId: ledger.dynamax[playerId] ?? null, dynamaxUsed: ledger.dynamax[playerId] !== undefined };
}

// ---------- reward preview (view-only) ----------
export type RaidPreview = {
  shields: number | null; shieldMax: number | null; phase: 1 | 2 | null; hp: number | null; maxHp: number;
  /** Own contribution, the total and the own share (percent, floored); whether the viewer leads the ledger. */
  own: number; total: number; sharePercent: number; leading: boolean;
  /** If the boss fell now: the species for the top contributor, the catch chance for the viewer (null below 10% or when leading), gold. */
  catchSpeciesId: SpeciesId; catchChance: number | null; gold: number;
  /** Own Pokémon within reach of the den with their role and an estimated contribution per round. */
  team: { unitId: number; role: RaidRole; perRound: number }[];
};
/** First form of the boss's line (itself when it has no line, e.g. a rare species): what a successful catch chance brings. */
export const raidCatchSpecies = (content: Content, speciesId: SpeciesId): SpeciesId => evolutionLines(content).root.get(speciesId) ?? speciesId;
/** Estimated contribution of one strike by `unit` on the boss now: a stage-based hit through the shields plus the shield points. */
export function estimatedRaidStrike(content: Content, speciesId: SpeciesId, shields: number): number {
  const tuning = eventsTuning(content), species = content.species[speciesId], role = raidRole(species.role);
  const hit = 12 + 8 * species.stage;
  if (shields > 0) return Math.floor(hit * tuning.shieldDamagePermille / 1000) + tuning.shieldPoints * Math.min(shields, role === 'breaker' ? tuning.breakerShields : 1);
  return role === 'dealer' ? Math.floor(hit * tuning.dealerPermille / 1000) : role === 'support' ? hit + tuning.supportHeal : hit;
}
export function raidPreview(view: PlayerView, content: Content, reach = 10): RaidPreview | null {
  const active = view.expansion?.raids?.active, max = active?.max;
  if (!active || !max) return null;
  const contribution = max.contribution, total = Object.values(contribution).reduce((sum, value) => sum + value, 0), own = contribution[view.playerId] ?? 0;
  const sharePercent = total ? Math.floor(own * 100 / total) : 0;
  const top = Object.entries(contribution).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0];
  const leading = top !== undefined && Number(top[0]) === view.playerId;
  const late = lateTuning(content), boss = active.unitId === null ? undefined : view.units.find(unit => unit.id === active.unitId);
  const gold = total && own * 100 >= late.raidMinSharePercent * total ? Math.min(late.raidMaxGold, Math.floor(late.raidShareGold * own * 10 / total)) : 0;
  const team = boss ? view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon' && hexDistance(unit.position, boss.position, view.map) <= reach)
    .sort((a, b) => hexDistance(a.position, boss.position, view.map) - hexDistance(b.position, boss.position, view.map) || a.id - b.id)
    .map(unit => ({ unitId: unit.id, role: raidRole(content.species[(unit as Extract<MapUnit, { kind: 'pokemon' }>).speciesId].role),
      perRound: estimatedRaidStrike(content, (unit as Extract<MapUnit, { kind: 'pokemon' }>).speciesId, max.shields ?? 0) })) : [];
  return { shields: max.shields, shieldMax: max.shieldMax, phase: max.phase, hp: boss ? boss.hp : null, maxHp: active.maxHp, own, total, sharePercent, leading,
    catchSpeciesId: raidCatchSpecies(content, active.speciesId), catchChance: !leading && own * 100 >= late.raidMinSharePercent * Math.max(1, total) ? raidCatchChance(sharePercent, content) : null, gold, team };
}
