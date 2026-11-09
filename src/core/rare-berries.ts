import { RARE_BERRIES, RARE_BERRY_IDS, RARE_BERRY_RULES } from '../content/rare-berries.ts';
import type { RareBerryId } from '../content/rare-berries.ts';
import { gameplayAtLeast } from '../content/eras.ts';
import { IMPROVEMENT_RULES_V23 } from '../content/improvements.ts';
import { edgeDistance, hexDistance, hexToIndex, indexToHex } from './hex.ts';
import type { EventPayload, GameState } from './model.ts';

/**
 * Gameplay v7. Deposits are fixed at creation; a player "owns" a kind while one of its cities works a deposit,
 * plus any copies received as gifts. Gifts move one surplus copy to a trade partner.
 */
export type RareBerryState = { deposits: Record<number, RareBerryId>; gifts: Record<number, Partial<Record<RareBerryId, number>>>; lastGiftRound: Record<string, number> };
export type RareBerryAction = { type: 'GiftBerry'; targetPlayerId: number; berry: RareBerryId };
export type RareBerryEvent = { type: 'BerryGifted'; playerId: number; targetPlayerId: number; berry: RareBerryId; public: true };
export type RareBerryView = { deposits: { tileIndex: number; berry: RareBerryId }[]; owned: Record<RareBerryId, number>; distinct: number; festival: boolean;
  /** Own gifts only: target player ID -> round of the last gift (for the cooldown). */
  lastGiftRoundByTarget?: Record<number, number> };

export const usesRareBerries = (state: Pick<GameState, 'setup' | 'expansion'>) => state.expansion !== undefined && gameplayAtLeast(state.setup, 7);
export function isRareBerryAction(action: { type: unknown }): action is RareBerryAction { return action.type === 'GiftBerry'; }
/** Deterministic hash of the seed and tile; avoids consuming the shared RNG. */
const hash = (seed: number, value: number) => (Math.imul(seed ^ 0x9e3779b9, 2654435761) ^ Math.imul(value + 1, 40503)) >>> 0;
export function initializeRareBerries(state: GameState): void {
  if (!usesRareBerries(state)) return;
  const taken = new Set<number>([...Object.keys(state.expansion!.world.resources).map(Number), ...Object.values(state.cities).map(city => hexToIndex(city.position, state.map) ?? -1)]);
  const deposits: Record<number, RareBerryId> = {};
  for (const berry of RARE_BERRY_IDS) {
    const biome = RARE_BERRIES[berry].biome;
    const candidates = state.map.tiles.flatMap((tile, index) => tile === biome && !taken.has(index) && edgeDistance(indexToHex(index, state.map), state.map) >= 1
      && !Object.values(state.cities).some(city => hexDistance(city.position, indexToHex(index, state.map), state.map) === 0) ? [index] : [])
      .sort((a, b) => hash(state.setup.seed, a * 7 + RARE_BERRY_IDS.indexOf(berry)) - hash(state.setup.seed, b * 7 + RARE_BERRY_IDS.indexOf(berry)) || a - b);
    const chosen: number[] = [];
    for (const index of candidates) {
      if (chosen.length >= RARE_BERRY_RULES.depositsPerType) break;
      if (chosen.some(other => hexDistance(indexToHex(other, state.map), indexToHex(index, state.map), state.map) < 5)) continue;
      chosen.push(index); taken.add(index);
    }
    for (const index of chosen) deposits[index] = berry;
  }
  state.expansion!.rareBerries = { deposits, gifts: Object.fromEntries(state.turnOrder.map(id => [id, {}])), lastGiftRound: {} };
}
export function ownedRareBerries(state: GameState, playerId: number): Record<RareBerryId, number> {
  const ledger = state.expansion?.rareBerries;
  const owned = Object.fromEntries(RARE_BERRY_IDS.map(id => [id, 0])) as Record<RareBerryId, number>;
  if (!ledger) return owned;
  const tiles = gameplayAtLeast(state.setup, 23) ? state.expansion?.improvements?.tiles : undefined;
  for (const city of Object.values(state.cities)) if (city.ownerId === playerId) for (const tile of city.workedTileIds) {
    const berry = ledger.deposits[tile];
    // v23: a worked, intact 种植园 counts two copies (the second can be gifted).
    if (berry) owned[berry] += tiles?.[tile]?.kind === 'plantation' && !tiles[tile].damaged ? IMPROVEMENT_RULES_V23.plantationCopies : 1;
  }
  for (const [berry, count] of Object.entries(ledger.gifts[playerId] ?? {}) as [RareBerryId, number][]) owned[berry] = Math.max(0, owned[berry] + count);
  return owned;
}
export function distinctRareBerries(state: GameState, playerId: number): number {
  return Object.values(ownedRareBerries(state, playerId)).filter(count => count > 0).length;
}
/** Yields per city (festival food) and bond per round from luxury variety. */
export function rareBerryCityFood(state: GameState, playerId: number | null): number {
  if (playerId === null || !state.expansion?.rareBerries) return 0;
  return distinctRareBerries(state, playerId) >= RARE_BERRY_RULES.festivalTypes ? 1 : 0;
}
export function rareBerryBond(state: GameState, playerId: number): number {
  return state.expansion?.rareBerries ? distinctRareBerries(state, playerId) * RARE_BERRY_RULES.bondPerType : 0;
}
export function resolveRareBerryRound(state: GameState): EventPayload[] {
  if (!state.expansion?.rareBerries) return [];
  for (const playerId of [...state.turnOrder].sort((a, b) => a - b)) {
    const world = state.expansion.world.players[playerId];
    if (!world || state.players[playerId].eliminated) continue;
    world.satisfaction = Math.min(100, world.satisfaction + distinctRareBerries(state, playerId) * RARE_BERRY_RULES.satisfactionPerType);
  }
  return [];
}
const pairKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;
export function validateRareBerryAction(state: GameState, actorId: number, action: RareBerryAction): string | null {
  const ledger = state.expansion?.rareBerries;
  if (!usesRareBerries(state) || !ledger || !Object.hasOwn(RARE_BERRIES, action.berry)) return 'gift-unavailable';
  if (!state.players[action.targetPlayerId] || action.targetPlayerId === actorId || state.players[action.targetPlayerId].eliminated) return 'gift-unavailable';
  const relation = state.expansion!.civilization.relations[pairKey(actorId, action.targetPlayerId)];
  if (!relation || relation.tradeSinceRound === null) return 'gift-needs-trade';
  if (state.round - (ledger.lastGiftRound[`${actorId}>${action.targetPlayerId}`] ?? -99) < RARE_BERRY_RULES.giftCooldown) return 'gift-cooldown';
  return ownedRareBerries(state, actorId)[action.berry] >= 2 ? null : 'gift-no-surplus';
}
export function applyRareBerryAction(state: GameState, actorId: number, action: RareBerryAction): EventPayload[] {
  const ledger = state.expansion!.rareBerries!;
  // Net gift balance per kind: received copies are positive, lent-out copies negative.
  // Validation guarantees the giver keeps at least one copy of the kind.
  const mine = ledger.gifts[actorId] ??= {}, theirs = ledger.gifts[action.targetPlayerId] ??= {};
  mine[action.berry] = (mine[action.berry] ?? 0) - 1;
  theirs[action.berry] = (theirs[action.berry] ?? 0) + 1;
  ledger.lastGiftRound[`${actorId}>${action.targetPlayerId}`] = state.round;
  const relation = state.expansion!.civilization.relations[pairKey(actorId, action.targetPlayerId)];
  relation.trust = Math.min(100, relation.trust + RARE_BERRY_RULES.giftTrust);
  state.players[actorId].gold += RARE_BERRY_RULES.giftGold;
  return [{ type: 'BerryGifted', playerId: actorId, targetPlayerId: action.targetPlayerId, berry: action.berry, public: true }];
}
export function observeRareBerries(state: GameState, playerId: number, visible: ReadonlySet<number>): RareBerryView | undefined {
  const ledger = state.expansion?.rareBerries;
  if (!ledger) return undefined;
  const remembered = state.knowledge[playerId]?.rememberedTiles ?? {};
  const owned = ownedRareBerries(state, playerId), distinct = Object.values(owned).filter(count => count > 0).length;
  const lastGiftRoundByTarget = Object.fromEntries(Object.entries(ledger.lastGiftRound).filter(([key]) => key.startsWith(`${playerId}>`))
    .map(([key, round]) => [Number(key.slice(key.indexOf('>') + 1)), round]));
  return { lastGiftRoundByTarget, deposits: Object.entries(ledger.deposits).map(([index, berry]) => ({ tileIndex: Number(index), berry }))
    .filter(item => visible.has(item.tileIndex) || Object.hasOwn(remembered, item.tileIndex)).sort((a, b) => a.tileIndex - b.tileIndex),
    owned, distinct, festival: distinct >= RARE_BERRY_RULES.festivalTypes };
}
