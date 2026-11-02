import { rareBerryBond } from './rare-berries.ts';
import { gameplayAtLeast } from '../content/eras.ts';
import { hexDistance } from './hex.ts';
import { workRadius } from './city.ts';
import { isMapUnit } from './model.ts';
import type { CityState, EventPayload, GameState } from './model.ts';

/**
 * Gameplay v6: city bonds (Civilization loyalty). Each owned city keeps a bond 0..100.
 * Pressure per round = own HQ pull - distance - recent capture - unhappiness + gyms/centers + garrison.
 * Bond 0 makes the city defect to a neutral camp (never the headquarters).
 */
export const BOND_RULES = {
  start: 100, max: 100, defectAt: 0,
  /** Base pressure; cities within this distance of their HQ never lose bond from distance. */
  base: 2, safeDistance: 6, perDistance: 1,
  capturedPenalty: 4, capturedRounds: 10, capturedStart: 75,
  unhappy: 2, unhappyBelow: 20,
  trainingGround: 2, gym: 2, garrison: 2,
  /** Enemy cities of another civilization within this range pull bond down. */
  foreignRange: 5, foreignPull: 1,
} as const;
export type BondState = Record<number, number>;
export type BondEvent =
  | { type: 'CityBondChanged'; playerId: number; cityId: number; bond: number; delta: number }
  | { type: 'CityDefected'; playerId: number; public: true; cityId: number; position: { q: number; r: number } };

export const usesBonds = (state: Pick<GameState, 'setup' | 'expansion'>) => state.expansion !== undefined && gameplayAtLeast(state.setup, 6);
export function initializeBonds(state: GameState): void {
  if (usesBonds(state)) state.expansion!.bonds = Object.fromEntries(Object.values(state.cities).filter(city => city.ownerId !== null).map(city => [city.id, BOND_RULES.start]));
}
export type BondBreakdown = { total: number; parts: { label: string; value: number }[] };
export function bondPressure(state: GameState, city: CityState): BondBreakdown {
  const parts: { label: string; value: number }[] = [];
  const owner = city.ownerId!;
  const player = state.players[owner];
  if (player.headquartersCityId === city.id) return { total: BOND_RULES.max, parts: [{ label: '联盟总部', value: BOND_RULES.max }] };
  parts.push({ label: '基础', value: BOND_RULES.base });
  const hq = state.cities[player.headquartersCityId];
  const distance = hq && hq.ownerId === owner ? hexDistance(hq.position, city.position) : 99;
  if (distance > BOND_RULES.safeDistance) parts.push({ label: `距总部 ${distance === 99 ? '失联' : distance} 格`, value: -BOND_RULES.perDistance * Math.min(6, distance - BOND_RULES.safeDistance) });
  if (city.capturedAtRound !== null && state.round - city.capturedAtRound < BOND_RULES.capturedRounds) parts.push({ label: '新占领', value: -BOND_RULES.capturedPenalty });
  const satisfaction = state.expansion?.world.players[owner]?.satisfaction ?? 50;
  if (satisfaction < BOND_RULES.unhappyBelow) parts.push({ label: '满意度低', value: -BOND_RULES.unhappy });
  if (city.buildingIds.includes('trainingGround')) parts.push({ label: '宝可梦中心', value: BOND_RULES.trainingGround });
  if (state.expansion?.essences?.gyms[city.id]) parts.push({ label: '属性道馆', value: BOND_RULES.gym });
  if (Object.values(state.units).some(unit => isMapUnit(unit) && unit.ownerId === owner && unit.kind === 'pokemon' && hexDistance(unit.position, city.position) <= 1)) {
    parts.push({ label: '驻军', value: BOND_RULES.garrison });
  }
  const luxury = rareBerryBond(state, owner);
  if (luxury) parts.push({ label: '稀有树果', value: luxury });
  const foreign = Object.values(state.cities).filter(other => other.ownerId !== null && other.ownerId !== owner && hexDistance(other.position, city.position) <= BOND_RULES.foreignRange).length;
  if (foreign) parts.push({ label: `邻近外国城市 ${foreign}`, value: -BOND_RULES.foreignPull * foreign });
  return { total: parts.reduce((sum, part) => sum + part.value, 0), parts };
}
export function resolveBondRound(state: GameState): EventPayload[] {
  const bonds = state.expansion?.bonds;
  if (!bonds) return [];
  const events: EventPayload[] = [];
  for (const id of Object.keys(bonds).map(Number)) if (!state.cities[id] || state.cities[id].ownerId === null) delete bonds[id];
  for (const city of Object.values(state.cities).filter(city => city.ownerId !== null).sort((a, b) => a.id - b.id)) {
    const owner = city.ownerId!;
    if (state.players[owner].eliminated) continue;
    const before = bonds[city.id] ?? BOND_RULES.start;
    const { total } = bondPressure(state, city);
    const after = Math.max(0, Math.min(BOND_RULES.max, before + total));
    bonds[city.id] = after;
    if (after !== before) events.push({ type: 'CityBondChanged', playerId: owner, cityId: city.id, bond: after, delta: after - before });
    if (after <= BOND_RULES.defectAt && state.players[owner].headquartersCityId !== city.id) {
      city.ownerId = null; city.workedTileIds = []; city.lockedTileIds = []; city.queue = []; city.pendingDeployments = [];
      for (const unit of Object.values(state.units)) if (unit.location === 'recovering' && unit.cityId === city.id) delete state.units[unit.id];
      if (state.expansion?.essences) delete state.expansion.essences.gyms[city.id];
      delete bonds[city.id];
      events.push({ type: 'CityDefected', playerId: owner, public: true, cityId: city.id, position: { ...city.position } });
    }
  }
  return events;
}
/** A newly owned city (founded or captured) starts with a bond; called from the transaction tail. */
export function syncBonds(state: GameState): void {
  const bonds = state.expansion?.bonds;
  if (!bonds) return;
  for (const city of Object.values(state.cities)) {
    if (city.ownerId === null) { delete bonds[city.id]; continue; }
    if (bonds[city.id] === undefined) bonds[city.id] = city.capturedAtRound !== null ? BOND_RULES.capturedStart : BOND_RULES.start;
  }
}
export function observeBonds(state: GameState, playerId: number): Record<number, { bond: number; pressure: BondBreakdown }> | undefined {
  const bonds = state.expansion?.bonds;
  if (!bonds) return undefined;
  return Object.fromEntries(Object.values(state.cities).filter(city => city.ownerId === playerId)
    .map(city => [city.id, { bond: bonds[city.id] ?? BOND_RULES.start, pressure: bondPressure(state, city) }]));
}
/** Cities can win a neutral camp back peacefully with gold when adjacent to own territory. */
export const BOND_RECLAIM = { gold: 80, range: 6 } as const;
export type BondAction = { type: 'ReclaimCity'; cityId: number };
export function isBondAction(action: { type: unknown }): action is BondAction { return action.type === 'ReclaimCity'; }
export function validateBondAction(state: GameState, actorId: number, action: BondAction): string | null {
  const city = state.cities[action.cityId];
  if (!usesBonds(state) || !city || city.ownerId !== null) return 'reclaim-unavailable';
  const near = Object.values(state.cities).some(own => own.ownerId === actorId && hexDistance(own.position, city.position) <= Math.max(BOND_RECLAIM.range, workRadius(own)));
  return near && state.players[actorId].gold >= BOND_RECLAIM.gold ? null : 'reclaim-unavailable';
}
export function applyBondAction(state: GameState, actorId: number, action: BondAction): EventPayload[] {
  const city = state.cities[action.cityId];
  state.players[actorId].gold -= BOND_RECLAIM.gold;
  city.ownerId = actorId; city.capturedAtRound = state.round;
  state.expansion!.bonds![city.id] = 50;
  return [{ type: 'CityBondChanged', playerId: actorId, cityId: city.id, bond: 50, delta: 50 }];
}
