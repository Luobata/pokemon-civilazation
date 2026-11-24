// Shared types and read-only queries for the world expansion (nests, overlords, berries/stones, Pokédex).
import type { Yield } from '../content/economy.ts';
import type { SpeciesId } from '../content/species.ts';
import type { Content } from '../content/units.ts';
import { WORLD_CONTENT } from '../content/world-systems.ts';
import type { BerryId, StoneId, WorldDefinitions, WorldSystemContent } from '../content/world-systems.ts';
import { workRadius } from './city-query.ts';
import { edgeDistance, hexDistance, hexToIndex, indexToHex } from './hex.ts';
import type { Hex, MapShape } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { GameState, MapUnit } from './model.ts';
import { shuffled } from './rng.ts';
import { worldSiteAllowed } from './terrain.ts';

export type PokemonMapUnit = Extract<MapUnit, { kind: 'pokemon' }>;

/**
 * Gameplay v23 harvesting (docs/design/improvements-v23.md §5), shared by authority, UI and AI:
 * a resource inside the harvester's own territory (or under its city) is developed by an improvement instead,
 * and nobody may harvest a resource that already carries an improvement.
 */
export function harvestBlocker(input: { map: MapShape; ownCities: readonly { position: Hex; population: number }[]; position: Hex; improved: boolean }): string | null {
  if (input.ownCities.some(city => hexDistance(city.position, input.position, input.map) <= workRadius(city as never))) return 'harvest-own-territory';
  if (input.improved) return 'harvest-developed';
  return null;
}

export type PokedexRecord = {
  speciesId: SpeciesId;
  observed: boolean;
  battled: boolean;
  captured: boolean;
  firstObservedRound: number | null;
  firstBattleRound: number | null;
  firstCaptureRound: number | null;
};

export type NestSite = {
  id: number;
  tileIndex: number;
  position: Hex;
  speciesId: SpeciesId;
  hp: number;
  maxHp: number;
  nextSpawnRound: number;
  activeUnitIds: number[];
};

export type OverlordSite = {
  id: number;
  tileIndex: number;
  position: Hex;
  speciesId: SpeciesId;
  bondByPlayer: Record<number, number>;
  lastOfferRoundByPlayer: Record<number, number>;
};

export type ResourceSite = {
  tileIndex: number;
  position: Hex;
  kind: 'berry' | 'stone';
  definitionId: BerryId | StoneId;
  remaining: number;
  maximum: number;
  regrowsAtRound: number | null;
};

export type WorldPlayerState = {
  satisfaction: number;
  berryInventory: Record<BerryId, number>;
  stoneInventory: Record<StoneId, number>;
  pokedex: Record<SpeciesId, PokedexRecord>;
  lastProsperityRound: number | null;
};

export type WorldVictoryState = {
  targetDocumentedSpecies: number;
  achievedAtRound: number | null;
};

export type WorldState = {
  version: 'world-v1';
  initializedAtRound: number;
  nests: Record<number, NestSite>;
  rampagingUnitIds: number[];
  overlords: Record<number, OverlordSite>;
  resources: Record<number, ResourceSite>;
  players: Record<number, WorldPlayerState>;
  victory: WorldVictoryState;
};

export type WorldAction =
  | { type: 'ClearNest'; unitId: number; nestId: number }
  | { type: 'OfferToOverlord'; overlordId: number; cityId: number; currency: 'food' | 'gold' }
  | { type: 'HarvestResource'; unitId: number; tileIndex: number }
  | { type: 'UseEvolutionStone'; unitId: number; intoSpeciesId: SpeciesId; stoneId: StoneId };

export type WorldSystemEvent =
  | { type: 'WorldNestSpawned'; nestId: number; unitId: number; position: Hex }
  | { type: 'WorldNestStruck'; playerId: number; unitId: number; nestId: number; hpBefore: number; hpAfter: number; counterDamage: number }
  | { type: 'WorldNestCleared'; playerId: number; nestId: number; position: Hex; goldReward: number; satisfactionReward: number }
  | { type: 'WorldOverlordOffered'; playerId: number; overlordId: number; cityId: number; currency: 'food' | 'gold'; bondBefore: number; bondAfter: number }
  | { type: 'WorldResourceHarvested'; playerId: number; unitId: number; resourceTileIndex: number; position: Hex; resourceKind: 'berry' | 'stone'; definitionId: BerryId | StoneId; amount: number }
  | { type: 'WorldBerryRegrown'; resourceTileIndex: number; position: Hex; definitionId: BerryId }
  | { type: 'WorldSatisfactionSettled'; playerId: number; satisfactionBefore: number; satisfactionAfter: number; prosperityGold: number }
  | { type: 'WorldStoneEvolution'; playerId: number; unitId: number; fromSpeciesId: SpeciesId; intoSpeciesId: SpeciesId; stoneId: StoneId }
  | { type: 'WorldRampageStruckCity'; unitId: number; cityId: number; position: Hex; damage: number; cityHpBefore: number; cityHpAfter: number }
  | { type: 'WorldPokedexUpdated'; playerId: number; speciesId: SpeciesId; observed: boolean; battled: boolean; captured: boolean }
  | { type: 'WorldVictoryAchieved'; playerId: number; documentedSpecies: number; target: number };

export type WorldEvent = WorldSystemEvent;

export type PublicOverlordSite = Omit<OverlordSite, 'bondByPlayer' | 'lastOfferRoundByPlayer'> & {
  bond: number;
  lastOfferRound: number | null;
};

export type WorldView = {
  version: 'world-v1';
  nests: NestSite[];
  overlords: PublicOverlordSite[];
  resources: ResourceSite[];
  rampagingUnitIds: number[];
  player: WorldPlayerState | null;
  victory: WorldVictoryState | null;
  visibleTileIds: number[];
};

export const WORLD = () => WORLD_CONTENT.world;
export function definitionsFor(content: Content | WorldSystemContent): WorldDefinitions {
  return 'world' in content ? content.world : WORLD_CONTENT.world;
}
export const documented = (record: PokedexRecord): boolean => record.observed && (record.battled || record.captured);

export function requireWorld(state: GameState): WorldState {
  if (!state.expansion?.world) throw new Error('World expansion is not initialized.');
  return state.expansion.world;
}

export function occupiedIndexes(state: GameState, extra: readonly number[] = []): Set<number> {
  const occupied = new Set(extra);
  for (const unit of Object.values(state.units).filter(isMapUnit)) {
    const index = hexToIndex(unit.position, state.map);
    if (index !== null) occupied.add(index);
  }
  for (const city of Object.values(state.cities)) occupied.add(hexToIndex(city.position, state.map)!);
  return occupied;
}

export function blankPokedex(content: Content): Record<SpeciesId, PokedexRecord> {
  return Object.fromEntries((Object.keys(content.species) as SpeciesId[]).map(speciesId => [speciesId, {
    speciesId, observed: false, battled: false, captured: false,
    firstObservedRound: null, firstBattleRound: null, firstCaptureRound: null,
  }])) as Record<SpeciesId, PokedexRecord>;
}

export function blankPlayerState(content: Content, definitions: WorldDefinitions): WorldPlayerState {
  return {
    satisfaction: 0,
    berryInventory: Object.fromEntries(Object.keys(definitions.berries).map(id => [id, 0])) as Record<BerryId, number>,
    stoneInventory: Object.fromEntries(Object.keys(definitions.stones).map(id => [id, 0])) as Record<StoneId, number>,
    pokedex: blankPokedex(content),
    lastProsperityRound: null,
  };
}

export function specialPlacementCandidates(state: GameState, minimumCityDistance: number): number[] {
  const occupied = occupiedIndexes(state);
  const cities = Object.values(state.cities);
  return state.map.tiles.flatMap((_, index) => {
    const position = indexToHex(index, state.map);
    return edgeDistance(position, state.map) >= 1 && !occupied.has(index) && worldSiteAllowed(state.map, index, 'continent')
      && cities.every(city => hexDistance(position, city.position, state.map) >= minimumCityDistance) ? [index] : [];
  });
}

export function takePlacement(state: GameState, candidates: number[], used: Set<number>, count: number): number[] {
  const available = shuffled(candidates.filter(index => !used.has(index)), state.rng);
  if (available.length < count) throw new Error(`Not enough legal world-site tiles (need ${count}, have ${available.length}).`);
  const chosen = available.slice(0, count);
  for (const index of chosen) used.add(index);
  return chosen;
}

export function actorUnit(state: GameState, actorId: number, unitId: number): MapUnit | null {
  const unit = state.units[unitId];
  return unit && unit.ownerId === actorId && isMapUnit(unit) ? unit : null;
}

export function overlordTier(bond: number, definitions: WorldDefinitions = WORLD()): 0 | 1 | 2 | 3 {
  if (bond >= definitions.overlords.tier3Bond) return 3;
  if (bond >= definitions.overlords.tier2Bond) return 2;
  if (bond >= definitions.overlords.tier1Bond) return 1;
  return 0;
}

export function worldVisionSources(state: GameState, playerId: number): Array<{ position: Hex; radius: number }> {
  const world = state.expansion?.world;
  if (!world) return [];
  const definitions = WORLD();
  return Object.values(world.overlords)
    .filter(overlord => overlordTier(overlord.bondByPlayer[playerId] ?? 0, definitions) >= 1)
    .map(overlord => ({ position: { ...overlord.position }, radius: definitions.overlords.tier1VisionRadius }));
}

export function worldCityYield(state: GameState, city: { ownerId: number | null; position: Hex; workedTileIds: number[] }, content: Content = WORLD_CONTENT.base): Yield {
  const world = state.expansion?.world;
  const result: Yield = { food: 0, production: 0, gold: 0, research: 0 };
  if (!world || city.ownerId === null) return result;
  const definitions = definitionsFor(content);
  for (const tileIndex of city.workedTileIds) {
    const resource = world.resources[tileIndex];
    if (!resource) continue;
    if (resource.kind === 'berry') result.food += Math.max(1, Math.floor(definitions.berries[resource.definitionId as BerryId].food / 4));
    else result.production += 1;
  }
  let tier = 0;
  for (const overlord of Object.values(world.overlords)) {
    if (hexDistance(city.position, overlord.position, state.map) > definitions.overlords.reach) continue;
    tier = Math.max(tier, overlordTier(overlord.bondByPlayer[city.ownerId] ?? 0, definitions));
  }
  const bonus = tier === 3 ? definitions.overlords.tier3Yield : tier === 2 ? definitions.overlords.tier2Yield : null;
  if (bonus) {
    result.food += bonus.food;
    result.production += bonus.production;
    result.gold += bonus.gold;
    result.research += bonus.research;
  }
  return result;
}
