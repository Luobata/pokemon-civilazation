// Gameplay v13: battle merit and trait promotions (Civilization unit promotions). Merit is read from
// BattleResolved events after each transaction; traits only multiply the existing damage chain, so the
// authoritative battle and the attack preview share one calculation.
import { PROMOTION_RULES, PROMOTION_TRAIT_IDS } from '../content/promotions.ts';
import type { PromotionTrait } from '../content/promotions.ts';
import { gameplayAtLeast } from '../content/eras.ts';
import type { Content } from '../content/units.ts';
import { isMapUnit } from './model.ts';
import type { EventPayload, GameState, PlayerView } from './model.ts';
import type { Hex } from './hex.ts';

export type UnitPromotion = { merit: number; traits: PromotionTrait[] };
export type PromotionState = { units: Record<number, UnitPromotion> };
/** Own units (deployed or recovering) with merit; visible rival units with their public traits only. */
export type PromotionView = { units: Record<number, { merit?: number; traits: PromotionTrait[] }> };
export type PromotionAction = { type: 'PromoteUnit'; unitId: number; trait: PromotionTrait };
export type PromotionEvent = { type: 'UnitPromoted'; playerId: number; unitId: number; trait: PromotionTrait; rank: number };

export const usesPromotions = (state: Pick<GameState, 'setup' | 'expansion'>) => state.expansion !== undefined && gameplayAtLeast(state.setup, 13);
export function isPromotionAction(action: { type: unknown }): action is PromotionAction { return action.type === 'PromoteUnit'; }
export function initializePromotions(state: GameState): void {
  if (usesPromotions(state)) state.expansion!.promotions = { units: {} };
}

/** Promotions earned so far by a merit total (0–3). */
export const promotionsEarned = (merit: number) => PROMOTION_RULES.thresholds.filter(threshold => merit >= threshold).length;
export const pendingPromotions = (record: { merit?: number; traits: readonly PromotionTrait[] } | undefined) => record ? Math.max(0, promotionsEarned(record.merit ?? 0) - record.traits.length) : 0;
export const nextThreshold = (merit: number): number | null => PROMOTION_RULES.thresholds.find(threshold => merit < threshold) ?? null;

export function validatePromotionAction(state: GameState, actorId: number, action: PromotionAction): string | null {
  const ledger = state.expansion?.promotions, unit = state.units[action.unitId];
  if (!ledger) return 'promotions-unavailable';
  // Deployed units only: recovering units keep pending promotions until they return to the map (same for players and AI).
  if (!unit || unit.ownerId !== actorId || unit.kind !== 'pokemon' || !isMapUnit(unit)) return 'unit-unavailable';
  if (!PROMOTION_TRAIT_IDS.includes(action.trait)) return 'invalid-trait';
  const record = ledger.units[unit.id];
  if (pendingPromotions(record) < 1) return 'no-promotion';
  return record!.traits.includes(action.trait) ? 'trait-owned' : null;
}
export function applyPromotionAction(state: GameState, actorId: number, action: PromotionAction): EventPayload[] {
  const record = state.expansion!.promotions!.units[action.unitId];
  record.traits.push(action.trait);
  return [{ type: 'UnitPromoted', playerId: actorId, unitId: action.unitId, trait: action.trait, rank: record.traits.length }];
}

/** Adds merit for one transaction's battles. Only owned Pokémon that still exist (deployed or recovering) earn merit, and only in
 * battles a civilization started: wild rampages and guardians attacking units parked near them award nothing. */
export function recordPromotions(after: GameState, events: readonly EventPayload[]): void {
  const ledger = after.expansion?.promotions;
  if (!ledger) return;
  const award = (unitId: number, points: number) => {
    const unit = after.units[unitId];
    if (!unit || unit.ownerId === null || unit.kind !== 'pokemon') return;
    const record = ledger.units[unitId] ??= { merit: 0, traits: [] };
    record.merit += points;
  };
  for (const event of events) {
    if (event.type !== 'BattleResolved') continue;
    const attacker = after.units[event.attackerId];
    if (!attacker || attacker.ownerId === null) continue;
    if (event.damage > 0) award(event.attackerId, PROMOTION_RULES.merit.attack);
    if (event.counterDamage > 0 && event.target.kind === 'unit') award(event.target.id, PROMOTION_RULES.merit.counter);
    for (const knockdown of event.knockdowns ?? []) if (knockdown.source.kind === 'pokemon') award(knockdown.source.id, PROMOTION_RULES.merit.knockdown);
    if (event.capturedCity) award(event.attackerId, PROMOTION_RULES.merit.cityCaptured);
  }
}
/** Drops records of units that no longer exist. */
export function resolvePromotionRound(state: GameState): EventPayload[] {
  const ledger = state.expansion?.promotions;
  if (ledger) for (const id of Object.keys(ledger.units).map(Number)) if (!state.units[id]) delete ledger.units[id];
  return [];
}

/** Applies a permille multiplier; neutral multipliers leave the value untouched (keeps v<=12 float math byte-identical). */
export const scalePermille = (value: number, permille: number) => permille === 1000 ? value : value * permille / 1000;
type Source = { expansion?: { promotions?: { units: Record<number, { traits: readonly PromotionTrait[] }> } } };
export const traitsOf = (source: Source, unitId: number): readonly PromotionTrait[] => source.expansion?.promotions?.units[unitId]?.traits ?? [];
const has = (source: Source, unitId: number, trait: PromotionTrait) => traitsOf(source, unitId).includes(trait);
/** Permille multiplier on a strike between Pokémon: 猛攻 on active attacks, 坚守 on every hit taken. */
export function promotionStrikeMultiplier(source: Source, attackerId: number, defenderId: number, counter: boolean): number {
  return (!counter && has(source, attackerId, 'assault') ? PROMOTION_RULES.assaultDamage : 1000)
    * (has(source, defenderId, 'bulwark') ? PROMOTION_RULES.bulwarkDamageTaken : 1000) / 1000;
}
export const promotionCityMultiplier = (source: Source, attackerId: number) => has(source, attackerId, 'breacher') ? PROMOTION_RULES.breacherCityDamage : 1000;
export const promotionMovement = (source: Source, unitId: number) => has(source, unitId, 'swift') ? PROMOTION_RULES.swiftMovement : 0;
export const promotionHealing = (source: Source, unitId: number) => has(source, unitId, 'regenerate') ? PROMOTION_RULES.regenerateHealing : 0;

export function observePromotions(state: GameState, playerId: number, visible: ReadonlySet<number>, indexOf: (hex: Hex) => number | null): PromotionView | undefined {
  const ledger = state.expansion?.promotions;
  if (!ledger) return undefined;
  const units: PromotionView['units'] = {};
  for (const [id, record] of Object.entries(ledger.units)) {
    const unit = state.units[Number(id)];
    if (!unit) continue;
    if (unit.ownerId !== playerId) {
      if (!isMapUnit(unit)) continue;
      const index = indexOf(unit.position);
      if (index === null || !visible.has(index)) continue;
    }
    units[Number(id)] = unit.ownerId === playerId ? { merit: record.merit, traits: [...record.traits] } : { traits: [...record.traits] };
  }
  return { units };
}

/** AI and auto-pick order by battlefield role; already-owned traits are skipped. */
const ROLE_ORDER: Record<string, PromotionTrait[]> = {
  siege: ['breacher', 'bulwark', 'regenerate', 'assault', 'swift'],
  melee: ['assault', 'bulwark', 'regenerate', 'breacher', 'swift'],
  fast: ['assault', 'swift', 'regenerate', 'bulwark', 'breacher'],
  ranged: ['bulwark', 'assault', 'regenerate', 'breacher', 'swift'],
  scout: ['swift', 'regenerate', 'bulwark', 'assault', 'breacher'],
  naval: ['regenerate', 'assault', 'bulwark', 'breacher', 'swift'],
  air: ['assault', 'swift', 'regenerate', 'bulwark', 'breacher'],
};
export function preferredTrait(view: PlayerView, unitId: number, content: Content): PromotionTrait | null {
  const unit = [...view.units, ...view.recoveringUnits].find(candidate => candidate.id === unitId);
  if (!unit || unit.kind !== 'pokemon') return null;
  const owned = traitsOf(view, unitId);
  return (ROLE_ORDER[content.species[unit.speciesId].role] ?? PROMOTION_TRAIT_IDS).find(trait => !owned.includes(trait)) ?? null;
}
