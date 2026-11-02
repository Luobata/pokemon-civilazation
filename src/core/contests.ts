import { gameplayAtLeast } from '../content/eras.ts';
import type { Content } from '../content/units.ts';
import { finishGame } from './victory.ts';
import { distinctRareBerries } from './rare-berries.ts';
import { cityYield } from './city.ts';
import type { EventPayload, GameState } from './model.ts';

/**
 * Gameplay v8: Pokémon Contests (Civilization culture victory).
 * Contest halls generate appeal from the registered Pokédex (variety and rarity), rare berries and gyms.
 * A civilization wins once its accumulated appeal is at least `winRatio` times every rival's home appeal
 * (their own accumulated appeal) and above `minimum`.
 */
export const CONTEST_RULES = {
  hallCost: 50, hallGold: 20,
  perHall: 2, perSpecies: 1, perRare: 2, perBerryKind: 1, perGym: 1,
  /** Appeal accrual is capped per hall so many halls matter, not one. */
  hallCap: 10,
  minimum: 500, winRatio: 1.5,
  /** Active performance: 30 gold for +appeal equal to halls × 3, cooldown 6. */
  showGold: 30, showPerHall: 3, showCooldown: 6,
} as const;
/** `building` maps cityId -> production invested; a hall completes at `hallCost`. */
export type ContestPlayer = { appeal: number; halls: number[]; building: Record<number, number>; showReadyAtRound: number };
export type ContestState = Record<number, ContestPlayer>;
export type ContestAction = { type: 'BuildContestHall'; cityId: number } | { type: 'HoldContest' };
export type ContestEvent =
  | { type: 'ContestHallBuilt'; playerId: number; cityId: number }
  | { type: 'ContestHeld'; playerId: number; appeal: number; public: true };
export type ContestView = { own: ContestPlayer & { perRound: number }; rivals: { playerId: number; appeal: number }[]; target: number };

export const usesContests = (state: Pick<GameState, 'setup' | 'expansion'>) => state.expansion !== undefined && gameplayAtLeast(state.setup, 8);
export function isContestAction(action: { type: unknown }): action is ContestAction { return action.type === 'BuildContestHall' || action.type === 'HoldContest'; }
export function initializeContests(state: GameState): void {
  if (usesContests(state)) state.expansion!.contests = Object.fromEntries(state.turnOrder.map(id => [id, { appeal: 0, halls: [], building: {}, showReadyAtRound: 1 }]));
}
function liveHalls(state: GameState, playerId: number): number[] {
  return state.expansion!.contests![playerId].halls.filter(cityId => state.cities[cityId]?.ownerId === playerId);
}
export function appealPerRound(state: GameState, playerId: number, content: Content): number {
  const halls = liveHalls(state, playerId).length;
  if (!halls) return 0;
  const player = state.players[playerId];
  const species = player.registeredSpeciesIds.length, rare = player.registeredSpeciesIds.filter(id => content.species[id]?.rare).length;
  const gyms = Object.entries(state.expansion?.essences?.gyms ?? {}).filter(([cityId]) => state.cities[Number(cityId)]?.ownerId === playerId).length;
  const raw = species * CONTEST_RULES.perSpecies + rare * CONTEST_RULES.perRare + distinctRareBerries(state, playerId) * CONTEST_RULES.perBerryKind + gyms * CONTEST_RULES.perGym;
  return halls * CONTEST_RULES.perHall + Math.min(raw, halls * CONTEST_RULES.hallCap);
}
export function validateContestAction(state: GameState, actorId: number, action: ContestAction): string | null {
  const contests = state.expansion?.contests;
  if (!usesContests(state) || !contests || state.players[actorId].eliminated) return 'contests-unavailable';
  if (action.type === 'HoldContest') {
    if (!liveHalls(state, actorId).length || state.round < contests[actorId].showReadyAtRound) return 'contest-cooldown';
    return state.players[actorId].gold >= CONTEST_RULES.showGold ? null : 'contest-gold';
  }
  const city = state.cities[action.cityId];
  if (!city || city.ownerId !== actorId || city.capturedAtRound === state.round || contests[actorId].halls.includes(city.id)
    || contests[actorId].building[city.id] !== undefined) return 'hall-unavailable';
  return state.players[actorId].gold >= CONTEST_RULES.hallGold ? null : 'hall-gold';
}
export function applyContestAction(state: GameState, actorId: number, action: ContestAction): EventPayload[] {
  const mine = state.expansion!.contests![actorId];
  if (action.type === 'HoldContest') {
    const appeal = liveHalls(state, actorId).length * CONTEST_RULES.showPerHall;
    state.players[actorId].gold -= CONTEST_RULES.showGold; mine.appeal += appeal; mine.showReadyAtRound = state.round + CONTEST_RULES.showCooldown;
    return [{ type: 'ContestHeld', playerId: actorId, appeal, public: true }];
  }
  // Starting a hall pays gold; half the city's production then goes to it each round until complete.
  state.players[actorId].gold -= CONTEST_RULES.hallGold;
  mine.building[action.cityId] = 0;
  return [];
}
/** Production left for the city's queue while a hall is being built here (the hall takes half). */
export function productionAfterHall(state: GameState, city: { id: number; ownerId: number | null }, production: number): number {
  const building = city.ownerId === null ? undefined : state.expansion?.contests?.[city.ownerId]?.building[city.id];
  return building === undefined ? production : production - Math.max(1, Math.floor(production / 2));
}
export function resolveContestRound(state: GameState, content: Content): EventPayload[] {
  const contests = state.expansion?.contests;
  if (!contests || state.outcome) return [];
  const events: EventPayload[] = [];
  for (const playerId of [...state.turnOrder].sort((a, b) => a - b)) {
    if (state.players[playerId].eliminated) continue;
    const mine = contests[playerId];
    for (const [cityText, invested] of Object.entries(mine.building)) {
      const city = state.cities[Number(cityText)];
      if (!city || city.ownerId !== playerId) { delete mine.building[Number(cityText)]; continue; }
      const total = invested + Math.max(1, Math.floor(cityYield(state, city, content).production / 2));
      if (total >= CONTEST_RULES.hallCost) {
        delete mine.building[city.id]; mine.halls = [...mine.halls, city.id].sort((a, b) => a - b);
        events.push({ type: 'ContestHallBuilt', playerId, cityId: city.id });
      } else mine.building[city.id] = total;
    }
    contests[playerId].halls = liveHalls(state, playerId);
    contests[playerId].appeal += appealPerRound(state, playerId, content);
  }
  const alive = state.turnOrder.filter(id => !state.players[id].eliminated);
  const winners = alive.filter(id => contests[id].appeal >= CONTEST_RULES.minimum
    && alive.every(other => other === id || contests[id].appeal >= CONTEST_RULES.winRatio * Math.max(1, contests[other].appeal)));
  if (winners.length === 1) events.push(...finishGame(state, 'contest', winners, content));
  return events;
}
export function observeContests(state: GameState, playerId: number, content: Content): ContestView | undefined {
  const contests = state.expansion?.contests;
  if (!contests) return undefined;
  const rivals = state.turnOrder.filter(id => id !== playerId && !state.players[id].eliminated).map(id => ({ playerId: id, appeal: contests[id].appeal }));
  return { own: { ...contests[playerId], halls: [...contests[playerId].halls], building: { ...contests[playerId].building }, perRound: appealPerRound(state, playerId, content) }, rivals,
    target: Math.max(CONTEST_RULES.minimum, ...rivals.map(rival => CONTEST_RULES.winRatio * Math.max(1, rival.appeal))) };
}
