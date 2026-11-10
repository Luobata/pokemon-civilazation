import { landmarkEssences } from './landmarks.ts';
import type { MapFeatures } from './terrain.ts';
import { BIOME_ESSENCE, ESSENCE_IDS, ESSENCE_RULES, ESSENCES, TYPE_ESSENCE } from '../content/essences.ts';
import type { EssenceId } from '../content/essences.ts';
import { gameplayAtLeast } from '../content/eras.ts';
import type { LeaderId } from '../content/leaders.ts';
import type { BiomeId } from '../content/rules.ts';
import type { Content, SpeciesId, UnitIdentity } from '../content/units.ts';
import { hexToIndex } from './hex.ts';
import { treeGateOpen } from './tech-tree.ts';
import type { CityState, EventPayload, GameState, PlayerView } from './model.ts';

/** Gameplay v4 only. Per player stock, and at most one type gym per city. */
export type EssenceState = { stock: Record<number, Record<EssenceId, number>>; gyms: Record<number, EssenceId> };
export type EssenceAction = { type: 'BuildGym'; cityId: number; essence: EssenceId };
export type EssenceEvent =
  | { type: 'GymBuilt'; playerId: number; cityId: number; essence: EssenceId }
  | { type: 'EssencesSettled'; playerId: number; gained: Record<EssenceId, number>; stock: Record<EssenceId, number> }
  | { type: 'EssenceTrainingBoost'; playerId: number; cityId: number; essence: EssenceId; spent: number; progress: number };
export type EssenceView = { stock: Record<EssenceId, number>; gyms: { cityId: number; essence: EssenceId }[]; perRound: Record<EssenceId, number>; byCity: Record<number, Record<EssenceId, number>> };

/** Leader affinity essence: +1 of it per round in every city that already produces it. */
export const LEADER_ESSENCE: Record<LeaderId, EssenceId> = {
  oak: 'mind', lance: 'mind', jenny: 'life', joy: 'sylvan', brock: 'earth', misty: 'tide', steven: 'spark', jasmine: 'spark', giovanni: 'earth',
};
export const usesEssences = (state: Pick<GameState, 'setup' | 'expansion'>) => state.expansion !== undefined && gameplayAtLeast(state.setup, 4);
export const emptyEssences = (): Record<EssenceId, number> => Object.fromEntries(ESSENCE_IDS.map(id => [id, 0])) as Record<EssenceId, number>;
export function isEssenceAction(action: { type: unknown }): action is EssenceAction { return action.type === 'BuildGym'; }
export function initializeEssences(state: GameState): void {
  if (usesEssences(state)) state.expansion!.essences = { stock: Object.fromEntries(state.turnOrder.map(id => [id, emptyEssences()])), gyms: {} };
}
export function speciesEssence(speciesId: SpeciesId, content: Content): EssenceId {
  return TYPE_ESSENCE[content.species[speciesId].typeId];
}
export function identityEssences(identity: UnitIdentity, content: Content): EssenceId[] {
  if (identity.kind !== 'pokemon') return [];
  const species = content.species[identity.speciesId];
  return [...new Set([TYPE_ESSENCE[species.typeId], ...(species.secondaryTypeId ? [TYPE_ESSENCE[species.secondaryTypeId]] : [])])];
}
/** Essence a city produces per round: its center tile, each worked tile, its gym and leader affinity. */
export function cityEssenceYield(tiles: readonly (BiomeId | null)[], size: { width: number; height: number; features?: MapFeatures },
  city: Pick<CityState, 'position' | 'workedTileIds' | 'id'>, gym: EssenceId | undefined, leaderId: LeaderId | undefined): Record<EssenceId, number> {
  const out = emptyEssences();
  const center = hexToIndex(city.position, size);
  for (const index of [...(center === null ? [] : [center]), ...city.workedTileIds]) {
    const biome = tiles[index];
    if (biome) out[BIOME_ESSENCE[biome]]++;
  }
  // v24 A3: worked tiles beside Singing Dunes / Thunder Mesa (no landmarks before v24).
  landmarkEssences({ ...size, tiles }, city.workedTileIds, out);
  if (gym) out[gym] += ESSENCE_RULES.gymEssenceYield;
  if (leaderId && out[LEADER_ESSENCE[leaderId]] > 0) out[LEADER_ESSENCE[leaderId]]++;
  return out;
}
export function validateEssenceAction(state: GameState, actorId: number, action: EssenceAction): string | null {
  const essences = state.expansion?.essences, city = state.cities[action.cityId];
  if (!usesEssences(state) || !essences) return 'essences-unavailable';
  if (!city || city.ownerId !== actorId || city.capturedAtRound === state.round) return 'city-unavailable';
  if (!Object.hasOwn(ESSENCES, action.essence) || essences.gyms[city.id] !== undefined) return 'gym-unavailable';
  if (!treeGateOpen(state.players[actorId], 'gym')) return 'gym-tech-locked';
  return essences.stock[actorId][action.essence] >= ESSENCE_RULES.gymEssenceCost && state.players[actorId].gold >= ESSENCE_RULES.gymGoldCost ? null : 'gym-cost';
}
export function applyEssenceAction(state: GameState, actorId: number, action: EssenceAction): EventPayload[] {
  const essences = state.expansion!.essences!;
  essences.stock[actorId][action.essence] -= ESSENCE_RULES.gymEssenceCost;
  state.players[actorId].gold -= ESSENCE_RULES.gymGoldCost;
  essences.gyms[action.cityId] = action.essence;
  return [{ type: 'GymBuilt', playerId: actorId, cityId: action.cityId, essence: action.essence }];
}
/**
 * Economy hook, called once per city before production is added: a Pokémon order spends matching
 * essence for extra progress (more with a matching gym). Returns the bonus progress.
 */
export function essenceTrainingBonus(state: GameState, city: CityState, content: Content, events: EventPayload[]): number {
  const essences = state.expansion?.essences, order = city.queue[0];
  if (!essences || city.ownerId === null || order?.item.kind !== 'pokemon') return 0;
  const essence = speciesEssence(order.item.defId, content), stock = essences.stock[city.ownerId];
  if (stock[essence] < ESSENCE_RULES.trainingSpend) return 0;
  stock[essence] -= ESSENCE_RULES.trainingSpend;
  const progress = essences.gyms[city.id] === essence ? ESSENCE_RULES.gymTrainingBoost : ESSENCE_RULES.trainingBoost;
  events.push({ type: 'EssenceTrainingBoost', playerId: city.ownerId, cityId: city.id, essence, spent: ESSENCE_RULES.trainingSpend, progress });
  return progress;
}
/** Extra XP for a unit trained in a city whose gym matches one of its types. */
export function gymTrainedXp(state: GameState, cityId: number, identity: UnitIdentity, content: Content): number {
  const gym = state.expansion?.essences?.gyms[cityId];
  return gym && identityEssences(identity, content).includes(gym) ? ESSENCE_RULES.gymTrainedXp : 0;
}
export function resolveEssenceRound(state: GameState): EventPayload[] {
  const essences = state.expansion?.essences;
  if (!essences) return [];
  const events: EventPayload[] = [];
  for (const playerId of [...state.turnOrder].sort((a, b) => a - b)) {
    const player = state.players[playerId];
    if (player.eliminated) continue;
    const gained = emptyEssences();
    for (const city of Object.values(state.cities).filter(city => city.ownerId === playerId && city.capturedAtRound !== state.round).sort((a, b) => a.id - b.id)) {
      const yieldNow = cityEssenceYield(state.map.tiles, state.map, city, essences.gyms[city.id], player.leaderId);
      for (const id of ESSENCE_IDS) gained[id] += yieldNow[id];
    }
    const stock = essences.stock[playerId];
    for (const id of ESSENCE_IDS) stock[id] = Math.min(ESSENCE_RULES.cap, stock[id] + gained[id]);
    events.push({ type: 'EssencesSettled', playerId, gained, stock: { ...stock } });
  }
  return events;
}
/** Captured cities lose their gym. */
export function clearGym(state: GameState, cityId: number): void {
  if (state.expansion?.essences) delete state.expansion.essences.gyms[cityId];
}
/** Terrain home defense: a defender standing on a biome whose essence matches one of its types takes less damage. */
export function homeDefenseMultiplier(enabled: boolean, defender: UnitIdentity, biome: BiomeId | null | undefined, content: Content): number {
  if (!enabled || !biome || defender.kind !== 'pokemon') return 1000;
  return identityEssences(defender, content).includes(BIOME_ESSENCE[biome]) ? ESSENCE_RULES.homeDefense : 1000;
}
export function observeEssences(state: GameState, playerId: number): EssenceView | undefined {
  const essences = state.expansion?.essences;
  if (!essences) return undefined;
  const cities = Object.values(state.cities).filter(city => city.ownerId === playerId);
  const byCity: Record<number, Record<EssenceId, number>> = {};
  const perRound = emptyEssences();
  for (const city of cities) {
    byCity[city.id] = cityEssenceYield(state.map.tiles, state.map, city, essences.gyms[city.id], state.players[playerId].leaderId);
    for (const id of ESSENCE_IDS) perRound[id] += byCity[city.id][id];
  }
  return { stock: { ...essences.stock[playerId] }, perRound, byCity,
    gyms: cities.filter(city => essences.gyms[city.id] !== undefined).map(city => ({ cityId: city.id, essence: essences.gyms[city.id] })) };
}
export const viewUsesEssences = (view: PlayerView) => view.expansion?.essences !== undefined;
