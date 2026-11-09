import { victoryTargets } from '../content/opening.ts';
import { nestPriorityFor, speciesGeneration, stoneEvolutionsFor } from '../content/roster.ts';
import { generationAllows, maxGeneration } from './roster.ts';
import { gameplayAtLeast } from '../content/eras.ts';
import { resolveAttack } from './combat.ts';
import { cityDamage } from './combat-query.ts';
import { finishGame } from './victory.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors, edgeDistance } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { Command, EventPayload, GameState, MapUnit, PlayerView } from './model.ts';

export type PokemonMapUnit = Extract<MapUnit, { kind: 'pokemon' }>;
import { canEnterTile } from './movement.ts';
import { randomBelow, shuffled } from './rng.ts';
import { createMapUnit, registerSpecies } from './unit.ts';
import { visibleTiles } from './vision.ts';
import type { Content } from '../content/units.ts';
import type { Yield } from '../content/economy.ts';
import type { SpeciesId } from '../content/species.ts';
import { WORLD_CONTENT } from '../content/world-systems.ts';
import type { BerryId, StoneId, WorldDefinitions, WorldSystemContent } from '../content/world-systems.ts';
import type { Hex } from './hex.ts';
import type { MapShape } from './hex.ts';
import { workRadius } from './city.ts';

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

const WORLD = () => WORLD_CONTENT.world;
function definitionsFor(content: Content | WorldSystemContent): WorldDefinitions {
  return 'world' in content ? content.world : WORLD_CONTENT.world;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const documented = (record: PokedexRecord): boolean => record.observed && (record.battled || record.captured);

function requireWorld(state: GameState): WorldState {
  if (!state.expansion?.world) throw new Error('World expansion is not initialized.');
  return state.expansion.world;
}

function occupiedIndexes(state: GameState, extra: readonly number[] = []): Set<number> {
  const occupied = new Set(extra);
  for (const unit of Object.values(state.units).filter(isMapUnit)) {
    const index = hexToIndex(unit.position, state.map);
    if (index !== null) occupied.add(index);
  }
  for (const city of Object.values(state.cities)) occupied.add(hexToIndex(city.position, state.map)!);
  return occupied;
}

function blankPokedex(content: Content): Record<SpeciesId, PokedexRecord> {
  return Object.fromEntries((Object.keys(content.species) as SpeciesId[]).map(speciesId => [speciesId, {
    speciesId, observed: false, battled: false, captured: false,
    firstObservedRound: null, firstBattleRound: null, firstCaptureRound: null,
  }])) as Record<SpeciesId, PokedexRecord>;
}

function blankPlayerState(content: Content, definitions: WorldDefinitions): WorldPlayerState {
  return {
    satisfaction: 0,
    berryInventory: Object.fromEntries(Object.keys(definitions.berries).map(id => [id, 0])) as Record<BerryId, number>,
    stoneInventory: Object.fromEntries(Object.keys(definitions.stones).map(id => [id, 0])) as Record<StoneId, number>,
    pokedex: blankPokedex(content),
    lastProsperityRound: null,
  };
}

export function isWorldAction(action: unknown): action is WorldAction {
  if (typeof action !== 'object' || action === null || !('type' in action)) return false;
  const type = (action as { type: unknown }).type;
  return type === 'ClearNest' || type === 'OfferToOverlord' || type === 'HarvestResource' || type === 'UseEvolutionStone';
}

function specialPlacementCandidates(state: GameState, minimumCityDistance: number): number[] {
  const occupied = occupiedIndexes(state);
  const cities = Object.values(state.cities);
  return state.map.tiles.flatMap((_, index) => {
    const position = indexToHex(index, state.map);
    return edgeDistance(position, state.map) >= 1 && !occupied.has(index)
      && cities.every(city => hexDistance(position, city.position, state.map) >= minimumCityDistance) ? [index] : [];
  });
}

function takePlacement(state: GameState, candidates: number[], used: Set<number>, count: number): number[] {
  const available = shuffled(candidates.filter(index => !used.has(index)), state.rng);
  if (available.length < count) throw new Error(`Not enough legal world-site tiles (need ${count}, have ${available.length}).`);
  const chosen = available.slice(0, count);
  for (const index of chosen) used.add(index);
  return chosen;
}

function representativeNestSpecies(state: GameState, tileIndex: number, content: Content): SpeciesId {
  const biome = state.map.tiles[tileIndex];
  const preferred = nestPriorityFor(content);
  const compatible = preferred.filter(speciesId => content.species[speciesId]?.terrain.includes(biome));
  const weights = content.roster?.nestWeights;
  if (compatible.length && weights) {
    // v14: weighted pick (umbreon kept but rarer, per the user's request).
    let roll = randomBelow(state.rng, compatible.reduce((sum, id) => sum + (weights[id] ?? 1), 0));
    for (const id of compatible) { roll -= weights[id] ?? 1; if (roll < 0) return id; }
  }
  if (compatible.length) return compatible[randomBelow(state.rng, compatible.length)];
  const fallback = (Object.keys(content.species) as SpeciesId[])
    .filter(speciesId => content.species[speciesId].spawnBiomes.includes(biome) && !content.species[speciesId].rare)
    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  if (!fallback.length) throw new Error('No representative nest species is compatible with the generated map.');
  return fallback[randomBelow(state.rng, fallback.length)];
}

function rareOverlordSpecies(state: GameState, content: Content): SpeciesId[] {
  const rare = (Object.keys(content.species) as SpeciesId[])
    .filter(speciesId => content.species[speciesId].rare && speciesGeneration(content, speciesId) <= (content.roster ? maxGeneration(state.setup.eraProgression) : Infinity))
    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  if (rare.length < Object.keys(state.players).length) throw new Error('Not enough rare species for unique overlords.');
  return shuffled(rare, state.rng);
}

export function initializeWorld(state: GameState, content: Content = WORLD_CONTENT.base): EventPayload[] {
  if (!state.expansion) throw new Error('Expansion container must exist before world initialization.');
  const definitions = WORLD();
  const players = Object.fromEntries(state.turnOrder.map(playerId => [playerId, blankPlayerState(content, definitions)])) as Record<number, WorldPlayerState>;
  const world: WorldState = {
    version: 'world-v1', initializedAtRound: state.round, nests: {}, rampagingUnitIds: [],
    overlords: {}, resources: {}, players,
    // Gameplay v3 accelerates economies; the documented-species target rises so the Pokédex stays a long-game victory.
    victory: { targetDocumentedSpecies: gameplayAtLeast(state.setup, 3) ? Math.min(Object.keys(content.species).length, definitions.pokedex.targetDocumentedSpecies + 3 + (content.roster?.pokedexTargetBonus ?? 0) + victoryTargets(state.setup).pokedexBonus) : definitions.pokedex.targetDocumentedSpecies, achievedAtRound: null },
  };
  state.expansion.world = world;

  const used = new Set<number>();
  const nestTiles = takePlacement(state, specialPlacementCandidates(state, 4), used, definitions.nests.count);
  for (const tileIndex of nestTiles) {
    const id = state.nextEntityId++;
    world.nests[id] = {
      id, tileIndex, position: indexToHex(tileIndex, state.map), speciesId: representativeNestSpecies(state, tileIndex, content),
      hp: definitions.nests.hp, maxHp: definitions.nests.hp, nextSpawnRound: state.round + definitions.nests.spawnIntervalRounds,
      activeUnitIds: [],
    };
  }

  const overlordTiles = takePlacement(state, specialPlacementCandidates(state, 5), used, definitions.overlords.count);
  const overlordSpecies = rareOverlordSpecies(state, content);
  overlordTiles.forEach((tileIndex, index) => {
    const id = state.nextEntityId++;
    world.overlords[id] = {
      id, tileIndex, position: indexToHex(tileIndex, state.map), speciesId: overlordSpecies[index],
      bondByPlayer: Object.fromEntries(state.turnOrder.map(playerId => [playerId, 0])),
      lastOfferRoundByPlayer: {},
    };
  });

  const resourceCandidates = state.map.tiles.flatMap((_, index) => edgeDistance(indexToHex(index, state.map), state.map) >= 1 && !used.has(index) ? [index] : []);
  const berryIds = Object.keys(definitions.berries) as BerryId[];
  const berryTiles = takePlacement(state, resourceCandidates, used, definitions.berryDeposits);
  berryTiles.forEach((tileIndex, index) => {
    const definitionId = berryIds[index % berryIds.length];
    const definition = definitions.berries[definitionId];
    world.resources[tileIndex] = {
      tileIndex, position: indexToHex(tileIndex, state.map), kind: 'berry', definitionId,
      remaining: definition.uses, maximum: definition.uses, regrowsAtRound: null,
    };
  });

  const stoneIds = Object.keys(definitions.stones) as StoneId[];
  const stoneTileCount = stoneIds.reduce((sum, stoneId) => sum + definitions.stones[stoneId].deposits, 0);
  const stoneTiles = takePlacement(state, resourceCandidates, used, stoneTileCount);
  stoneIds.forEach((stoneId, stoneIndex) => {
    const before = stoneIds.slice(0, stoneIndex).reduce((sum, id) => sum + definitions.stones[id].deposits, 0);
    for (let index = before; index < before + definitions.stones[stoneId].deposits; index++) {
      const tileIndex = stoneTiles[index];
      world.resources[tileIndex] = {
        tileIndex, position: indexToHex(tileIndex, state.map), kind: 'stone', definitionId: stoneId,
        remaining: 1, maximum: 1, regrowsAtRound: null,
      };
    }
  });

  for (const player of Object.values(state.players)) {
    const records = world.players[player.id]?.pokedex;
    if (!records) continue;
    for (const speciesId of player.registeredSpeciesIds) {
      records[speciesId].observed = true;
      records[speciesId].captured = true;
      records[speciesId].firstObservedRound = state.round;
      records[speciesId].firstCaptureRound = state.round;
    }
  }
  return [];
}

function overlordTier(bond: number, definitions: WorldDefinitions = WORLD()): 0 | 1 | 2 | 3 {
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

function effectiveVisibleTiles(state: GameState, playerId: number, content: Content): Set<number> {
  const visible = new Set(visibleTiles(state, playerId, content));
  for (const source of worldVisionSources(state, playerId)) {
    for (let index = 0; index < state.map.tiles.length; index++) {
      if (hexDistance(source.position, indexToHex(index, state.map), state.map) <= source.radius) visible.add(index);
    }
  }
  return visible;
}

function visibleSite(state: GameState, playerId: number, tileIndex: number, content: Content): boolean {
  return tileIndex >= 0 && tileIndex < state.map.tiles.length && effectiveVisibleTiles(state, playerId, content).has(tileIndex);
}

function actorUnit(state: GameState, actorId: number, unitId: number): MapUnit | null {
  const unit = state.units[unitId];
  return unit && unit.ownerId === actorId && isMapUnit(unit) ? unit : null;
}

export function validateWorldAction(state: GameState, actorId: number, action: WorldAction, content: Content = WORLD_CONTENT.base): string | null {
  const world = state.expansion?.world;
  if (!world || state.players[actorId]?.eliminated) return 'world-unavailable';
  if (action.type === 'ClearNest') {
    const unit = actorUnit(state, actorId, action.unitId);
    const nest = world.nests[action.nestId];
    if (!unit || unit.kind !== 'pokemon' || !unit.actionLeft) return 'unit-unavailable';
    if (!nest || !visibleSite(state, actorId, nest.tileIndex, content)) return 'world-target-unavailable';
    if (hexDistance(unit.position, nest.position, state.map) > content.species[unit.speciesId].range) return 'world-target-unreachable';
    return null;
  }
  if (action.type === 'OfferToOverlord') {
    const overlord = world.overlords[action.overlordId];
    const city = state.cities[action.cityId];
    if (!overlord || !city || city.ownerId !== actorId || !visibleSite(state, actorId, overlord.tileIndex, content)) return 'world-target-unavailable';
    const definitions = WORLD();
    if (hexDistance(city.position, overlord.position, state.map) > definitions.overlords.reach) return 'world-target-unreachable';
    if (overlord.lastOfferRoundByPlayer[actorId] === state.round) return 'world-already-offered';
    if (action.currency === 'food' && city.food < definitions.overlords.foodCost) return 'world-payment-unavailable';
    if (action.currency === 'gold' && state.players[actorId].gold < definitions.overlords.goldCost) return 'world-payment-unavailable';
    return null;
  }
  if (action.type === 'HarvestResource') {
    const unit = actorUnit(state, actorId, action.unitId);
    const resource = world.resources[action.tileIndex];
    if (!unit || !unit.actionLeft) return 'unit-unavailable';
    if (!resource || resource.remaining <= 0 || !visibleSite(state, actorId, action.tileIndex, content)) return 'world-target-unavailable';
    if (hexToIndex(unit.position, state.map) !== action.tileIndex) return 'world-target-unreachable';
    if (gameplayAtLeast(state.setup, 23)) {
      const blocked = harvestBlocker({ map: state.map, ownCities: Object.values(state.cities).filter(city => city.ownerId === actorId), position: resource.position,
        improved: Object.hasOwn(state.expansion?.improvements?.tiles ?? {}, action.tileIndex) });
      if (blocked) return blocked;
    }
    if (resource.kind === 'berry') {
      const city = Object.values(state.cities).filter(candidate => candidate.ownerId === actorId)
        .sort((a, b) => hexDistance(resource.position, a.position, state.map) - hexDistance(resource.position, b.position, state.map) || a.id - b.id)[0];
      if (!city || hexDistance(city.position, resource.position, state.map) > 3) return 'world-city-unavailable';
    }
    return null;
  }
  const unit = actorUnit(state, actorId, action.unitId);
  if (!unit || unit.kind !== 'pokemon' || !unit.actionLeft) return 'unit-unavailable';
  const rule = stoneEvolutionsFor(content).find(candidate =>
    candidate.fromSpeciesId === unit.speciesId && candidate.intoSpeciesId === action.intoSpeciesId && candidate.stoneId === action.stoneId);
  if (rule && !generationAllows(content, state.players[actorId], state.setup.eraProgression, rule.intoSpeciesId)) return 'world-target-unavailable';
  if (!rule || unit.xp < rule.requiredXp || (world.players[actorId]?.stoneInventory[action.stoneId] ?? 0) < 1) return 'world-target-unavailable';
  return null;
}

export function applyWorldAction(state: GameState, actorId: number, action: WorldAction, content: Content = WORLD_CONTENT.base): EventPayload[] {
  const reason = validateWorldAction(state, actorId, action, content);
  if (reason) throw new Error(`Invalid world action: ${reason}`);
  const world = requireWorld(state);
  const definitions = WORLD();
  const playerState = world.players[actorId];
  if (action.type === 'ClearNest') {
    const unit = state.units[action.unitId] as PokemonMapUnit;
    const nest = world.nests[action.nestId];
    const hpBefore = nest.hp;
    const damage = Math.max(3, Math.floor(content.species[unit.speciesId].attack / 3));
    nest.hp = Math.max(0, nest.hp - damage);
    const counterDamage = unit.hp > definitions.nests.damage ? definitions.nests.damage : unit.hp - 1;
    unit.hp = Math.max(1, unit.hp - counterDamage);
    unit.actionLeft = 0;
    const events: WorldEvent[] = [{
      type: 'WorldNestStruck', playerId: actorId, unitId: unit.id, nestId: nest.id,
      hpBefore, hpAfter: nest.hp, counterDamage,
    }];
    if (nest.hp === 0) {
      state.players[actorId].gold += definitions.nests.clearGoldReward;
      playerState.satisfaction = Math.min(definitions.satisfaction.maximum, playerState.satisfaction + definitions.nests.clearSatisfactionReward);
      events.push({
        type: 'WorldNestCleared', playerId: actorId, nestId: nest.id, position: { ...nest.position },
        goldReward: definitions.nests.clearGoldReward, satisfactionReward: definitions.nests.clearSatisfactionReward,
      });
      delete world.nests[nest.id];
    }
    return events;
  }
  if (action.type === 'OfferToOverlord') {
    const overlord = world.overlords[action.overlordId];
    const city = state.cities[action.cityId];
    const bondBefore = overlord.bondByPlayer[actorId] ?? 0;
    if (action.currency === 'food') city.food -= definitions.overlords.foodCost;
    else state.players[actorId].gold -= definitions.overlords.goldCost;
    overlord.bondByPlayer[actorId] = bondBefore + definitions.overlords.bondPerOffering;
    overlord.lastOfferRoundByPlayer[actorId] = state.round;
    return [{
      type: 'WorldOverlordOffered', playerId: actorId, overlordId: overlord.id, cityId: city.id,
      currency: action.currency, bondBefore, bondAfter: overlord.bondByPlayer[actorId],
    }];
  }
  if (action.type === 'HarvestResource') {
    const unit = state.units[action.unitId] as PokemonMapUnit;
    const resource = world.resources[action.tileIndex];
    unit.actionLeft = 0;
    resource.remaining--;
    if (resource.kind === 'berry') {
      const definition = definitions.berries[resource.definitionId as BerryId];
      playerState.berryInventory[definition.id]++;
      playerState.satisfaction = Math.min(definitions.satisfaction.maximum, playerState.satisfaction + definition.satisfaction);
      const city = Object.values(state.cities).filter(candidate => candidate.ownerId === actorId)
        .sort((a, b) => hexDistance(resource.position, a.position, state.map) - hexDistance(resource.position, b.position, state.map) || a.id - b.id)[0];
      city.food += definition.food;
      resource.regrowsAtRound = state.round + definition.regrowthRounds;
      return [{
        type: 'WorldResourceHarvested', playerId: actorId, unitId: unit.id, resourceTileIndex: resource.tileIndex,
        position: { ...resource.position }, resourceKind: 'berry', definitionId: definition.id, amount: definition.food,
      }];
    }
    const stoneId = resource.definitionId as StoneId;
    playerState.stoneInventory[stoneId] += state.players[actorId].leaderId === 'steven' ? 2 : 1;
    return [{
      type: 'WorldResourceHarvested', playerId: actorId, unitId: unit.id, resourceTileIndex: resource.tileIndex,
      position: { ...resource.position }, resourceKind: 'stone', definitionId: stoneId, amount: 1,
    }];
  }
  const unit = state.units[action.unitId] as PokemonMapUnit;
  const fromSpeciesId = unit.speciesId;
  unit.actionLeft = 0;
  const before = content.species[fromSpeciesId];
  const after = content.species[action.intoSpeciesId];
  playerState.stoneInventory[action.stoneId]--;
  unit.hp = Math.max(1, Math.floor(unit.hp * after.maxHp / before.maxHp));
  unit.speciesId = action.intoSpeciesId;
  unit.xp = 0;
  registerSpecies(state.players[actorId], unit);
  const record = playerState.pokedex[action.intoSpeciesId];
  record.observed = true;
  record.captured = true;
  record.firstObservedRound ??= state.round;
  record.firstCaptureRound ??= state.round;
  return [{
    type: 'WorldStoneEvolution', playerId: actorId, unitId: unit.id,
    fromSpeciesId, intoSpeciesId: action.intoSpeciesId, stoneId: action.stoneId,
  }];
}

function cleanupRampagers(world: WorldState, state: GameState): void {
  world.rampagingUnitIds = world.rampagingUnitIds.filter(id => {
    const unit = state.units[id];
    return unit !== undefined && isMapUnit(unit) && unit.ownerId === null;
  });
  for (const nest of Object.values(world.nests)) nest.activeUnitIds = nest.activeUnitIds.filter(id => world.rampagingUnitIds.includes(id));
}

function freeSpawnTile(state: GameState, nest: NestSite, identity: { kind: 'pokemon'; speciesId: SpeciesId }, content: Content): Hex | null {
  const occupied = occupiedIndexes(state);
  const candidates = [nest.position, ...neighbors(nest.position, state.map).flatMap(position => [position, ...neighbors(position, state.map)])]
    .filter((position, index, all) => all.findIndex(other => other.q === position.q && other.r === position.r) === index)
    .filter(position => {
      const tileIndex = hexToIndex(position, state.map);
      return tileIndex !== null && !occupied.has(tileIndex) && canEnterTile(identity, state.map, tileIndex, content);
    })
    .sort((a, b) => hexDistance(nest.position, a, state.map) - hexDistance(nest.position, b, state.map)
      || (hexToIndex(a, state.map)! - hexToIndex(b, state.map)!));
  return candidates[0] ?? null;
}

function rampageTargets(state: GameState, attacker: MapUnit): Array<{ id: number; position: Hex; kind: 'unit' | 'city'; priority: number }> {
  return [
    ...Object.values(state.units).filter(isMapUnit).filter(unit => unit.ownerId !== null).map(unit => ({
      id: unit.id, position: unit.position, kind: 'unit' as const, priority: 0,
    })),
    ...Object.values(state.cities).filter(city => city.ownerId !== null).map(city => ({
      id: city.id, position: city.position, kind: 'city' as const, priority: 1,
    })),
  ]
    .sort((a, b) => hexDistance(attacker.position, a.position, state.map) - hexDistance(attacker.position, b.position, state.map)
      || a.priority - b.priority || a.id - b.id);
}

export function resolveWorldRound(state: GameState, content: Content = WORLD_CONTENT.base): EventPayload[] {
  const world = state.expansion?.world;
  if (!world || state.outcome) return [];
  const definitions = WORLD();
  const events: EventPayload[] = [];
  cleanupRampagers(world, state);

  for (const nest of Object.values(world.nests).sort((a, b) => a.id - b.id)) {
    if (state.round < nest.nextSpawnRound || nest.activeUnitIds.length >= definitions.nests.maxActivePerNest) continue;
    const identity = { kind: 'pokemon' as const, speciesId: nest.speciesId };
    const position = freeSpawnTile(state, nest, identity, content);
    if (!position) continue;
    const id = state.nextEntityId++;
    const unit = createMapUnit(identity, id, null, position, content);
    unit.hp = Math.max(1, Math.floor(unit.hp * definitions.nests.spawnHpPercent / 100));
    unit.actionLeft = 0;
    state.units[id] = unit;
    nest.activeUnitIds.push(id);
    world.rampagingUnitIds.push(id);
    nest.nextSpawnRound = state.round + definitions.nests.spawnIntervalRounds;
    events.push({ type: 'WorldNestSpawned', nestId: nest.id, unitId: id, position: { ...position } });
  }

  for (const unitId of [...world.rampagingUnitIds].sort((a, b) => a - b)) {
    const attacker = state.units[unitId];
    if (!attacker || !isMapUnit(attacker) || attacker.kind !== 'pokemon') continue;
    const target = rampageTargets(state, attacker)[0];
    if (!target) continue;
    const range = content.species[attacker.speciesId].range;
    const distance = hexDistance(attacker.position, target.position, state.map);
    if (distance <= range) {
      if (target.kind === 'unit') {
        events.push(...resolveAttack(state, attacker.id, { kind: 'unit', id: target.id }, content, true));
        continue;
      }
      const city = state.cities[target.id];
      const cityHpBefore = city.hp;
      const from = state.map.tiles[hexToIndex(attacker.position, state.map)!];
      const to = state.map.tiles[hexToIndex(city.position, state.map)!];
      const damage = cityDamage(attacker, from, to, false, 85 + randomBelow(state.rng, 16), content);
      city.hp = Math.max(1, city.hp - damage);
      events.push({
        type: 'WorldRampageStruckCity', unitId: attacker.id, cityId: city.id, position: { ...city.position },
        damage, cityHpBefore, cityHpAfter: city.hp,
      });
      continue;
    }
    const occupied = occupiedIndexes(state);
    const steps = neighbors(attacker.position, state.map)
      .filter(position => {
        const tileIndex = hexToIndex(position, state.map);
        return tileIndex !== null && !occupied.has(tileIndex) && canEnterTile(attacker, state.map, tileIndex, content)
          && hexDistance(position, target.position, state.map) < distance;
      })
      .sort((a, b) => hexDistance(a, target.position, state.map) - hexDistance(b, target.position, state.map)
        || hexToIndex(a, state.map)! - hexToIndex(b, state.map)!);
    if (steps.length) {
      const from = { ...attacker.position };
      attacker.position = steps[0];
      events.push({ type: 'Moved', unitId: attacker.id, path: [from, { ...attacker.position }] });
    }
  }
  cleanupRampagers(world, state);

  for (const resource of Object.values(world.resources).sort((a, b) => a.tileIndex - b.tileIndex)) {
    if (resource.kind !== 'berry' || resource.remaining >= resource.maximum || resource.regrowsAtRound === null || state.round < resource.regrowsAtRound) continue;
    resource.remaining = resource.maximum;
    resource.regrowsAtRound = null;
    events.push({
      type: 'WorldBerryRegrown', resourceTileIndex: resource.tileIndex,
      position: { ...resource.position }, definitionId: resource.definitionId as BerryId,
    });
  }

  for (const playerId of [...state.turnOrder].sort((a, b) => a - b)) {
    const playerState = world.players[playerId];
    if (!playerState || state.players[playerId]?.eliminated) continue;
    const before = playerState.satisfaction;
    playerState.satisfaction = Math.max(0, playerState.satisfaction - definitions.satisfaction.decayPerRound);
    let prosperityGold = 0;
    if (playerState.satisfaction >= definitions.satisfaction.prosperousThreshold) {
      prosperityGold = definitions.satisfaction.prosperousGold;
      state.players[playerId].gold += prosperityGold;
      playerState.lastProsperityRound = state.round;
    }
    events.push({
      type: 'WorldSatisfactionSettled', playerId, satisfactionBefore: before,
      satisfactionAfter: playerState.satisfaction, prosperityGold,
    });
  }
  return events;
}

function markRecord(next: GameState, playerId: number, speciesId: SpeciesId,
  mode: 'observed' | 'battled' | 'captured', events: EventPayload[]): void {
  const record = next.expansion?.world.players[playerId]?.pokedex[speciesId];
  if (!record) return;
  const before = { observed: record.observed, battled: record.battled, captured: record.captured };
  if (mode === 'observed' || mode === 'battled' || mode === 'captured') record.observed = true;
  if (mode !== 'observed') record[mode] = true;
  if (mode === 'observed') record.firstObservedRound ??= next.round;
  else if (mode === 'battled') record.firstBattleRound ??= next.round;
  else record.firstCaptureRound ??= next.round;
  if (before.observed !== record.observed || before.battled !== record.battled || before.captured !== record.captured) {
    events.push({
      type: 'WorldPokedexUpdated', playerId, speciesId,
      observed: record.observed, battled: record.battled, captured: record.captured,
    });
  }
}

function checkWorldVictory(next: GameState, playerId: number, events: EventPayload[], content: Content): boolean {
  const world = next.expansion?.world;
  if (!world || world.victory.achievedAtRound !== null || next.outcome) return false;
  const count = Object.values(world.players[playerId]?.pokedex ?? {}).filter(documented).length;
  if (count < world.victory.targetDocumentedSpecies) return false;
  world.victory.achievedAtRound = next.round;
  events.push({ type: 'WorldVictoryAchieved', playerId, documentedSpecies: count, target: world.victory.targetDocumentedSpecies });
  events.push(...finishGame(next, 'pokedex', [playerId], content));
  return true;
}

export function updateWorldRecords(before: GameState, next: GameState, command: Command,
  baseEvents: readonly EventPayload[], content: Content = WORLD_CONTENT.base): EventPayload[] {
  const world = next.expansion?.world;
  if (!world) return [];
  const events: EventPayload[] = [];
  cleanupRampagers(world, next);
  for (const playerId of [...next.turnOrder].sort((a, b) => a - b)) {
    const visibleBefore = effectiveVisibleTiles(before, playerId, content);
    const visibleAfter = effectiveVisibleTiles(next, playerId, content);
    for (const source of [before, next]) {
      const visible = source === before ? visibleBefore : visibleAfter;
      for (const unit of Object.values(source.units).filter(isMapUnit)) {
        if (unit.kind === 'pokemon' && visible.has(hexToIndex(unit.position, source.map)!)) markRecord(next, playerId, unit.speciesId, 'observed', events);
      }
    }
    for (const event of baseEvents) {
      if (event.type === 'Moved') {
        const unit = before.units[event.unitId] ?? next.units[event.unitId];
        if (unit?.kind === 'pokemon' && event.path.some((position: Hex) => visibleBefore.has(hexToIndex(position, before.map)!))) {
          markRecord(next, playerId, unit.speciesId, 'observed', events);
        }
      } else if (event.type === 'WildSpawned' && visibleBefore.has(hexToIndex(event.position, before.map)!)) {
        const unit = next.units[event.unitId];
        if (unit?.kind === 'pokemon') markRecord(next, playerId, unit.speciesId, 'observed', events);
      } else if (event.type === 'BattleResolved') {
        const visible = event.positions.every((position: Hex) => visibleBefore.has(hexToIndex(position, before.map)!)
          || visibleAfter.has(hexToIndex(position, next.map)!));
        if (!visible) continue;
        const attacker = before.units[event.attackerId] ?? next.units[event.attackerId];
        if (attacker?.kind === 'pokemon') markRecord(next, playerId, attacker.speciesId, 'battled', events);
        if (event.target.kind === 'unit') {
          const defender = before.units[event.target.id] ?? next.units[event.target.id];
          if (defender?.kind === 'pokemon') markRecord(next, playerId, defender.speciesId, 'battled', events);
        }
      } else if (event.type === 'Captured' && event.success && event.playerId === playerId) {
        const captured = before.units[event.targetUnitId] ?? next.units[event.targetUnitId];
        if (captured?.kind === 'pokemon') markRecord(next, playerId, captured.speciesId, 'captured', events);
      }
    }
    checkWorldVictory(next, playerId, events, content);
  }
  return events;
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

export function observeWorld(state: GameState, playerId: number, visibleTileIds: Set<number>): WorldView {
  const world = state.expansion?.world;
  if (!world) {
    return { version: 'world-v1', nests: [], overlords: [], resources: [], rampagingUnitIds: [], player: null, victory: null, visibleTileIds: [] };
  }
  const visible = [...visibleTileIds].sort((a, b) => a - b);
  return {
    version: 'world-v1',
    nests: Object.values(world.nests).filter(site => visible.includes(site.tileIndex)).sort((a, b) => a.id - b.id).map(site => ({
      ...clone(site),
      activeUnitIds: site.activeUnitIds.filter(unitId => {
        const unit = state.units[unitId];
        const tileIndex = unit && isMapUnit(unit) ? hexToIndex(unit.position, state.map) : null;
        return tileIndex !== null && visible.includes(tileIndex);
      }),
    })),
    overlords: Object.values(world.overlords).filter(site => visible.includes(site.tileIndex)).sort((a, b) => a.id - b.id)
      .map(site => ({
        id: site.id, tileIndex: site.tileIndex, position: clone(site.position), speciesId: site.speciesId,
        bond: site.bondByPlayer[playerId] ?? 0, lastOfferRound: site.lastOfferRoundByPlayer[playerId] ?? null,
      })),
    resources: Object.values(world.resources).filter(site => visible.includes(site.tileIndex)).sort((a, b) => a.tileIndex - b.tileIndex).map(clone),
    rampagingUnitIds: world.rampagingUnitIds.filter(unitId => {
      const unit = state.units[unitId];
      const index = unit && isMapUnit(unit) ? hexToIndex(unit.position, state.map) : null;
      return index !== null && visible.includes(index);
    }),
    player: world.players[playerId] ? clone(world.players[playerId]) : null,
    victory: clone(world.victory),
    visibleTileIds: visible,
  };
}

export function planWorldAction(view: PlayerView, content: WorldSystemContent = WORLD_CONTENT): WorldAction | null {
  const world = view.expansion?.world;
  if (!world?.player) return null;
  const playerState = world.player;
  const ownUnits = view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon' && unit.actionLeft === 1);
  for (const nest of world.nests) {
    const unit = ownUnits.filter(candidate => candidate.kind === 'pokemon')
      .find(candidate => hexDistance(candidate.position, nest.position, view.map) <= content.base.species[candidate.speciesId].range);
    if (unit?.kind === 'pokemon') return { type: 'ClearNest', unitId: unit.id, nestId: nest.id };
  }
  for (const resource of world.resources) {
    if (resource.remaining <= 0) continue;
    const unit = ownUnits.find(candidate => view.visibleTileIds.includes(resource.tileIndex)
      && hexToIndex(candidate.position, view.map) === resource.tileIndex);
    const berryHasNearbyCity = resource.kind !== 'berry' || view.economy.cities.some(city =>
      city.ownerId === view.playerId && hexDistance(city.position, resource.position, view.map) <= 3);
    if (unit && berryHasNearbyCity && (view.gameplayVersion ?? 0) >= 23 && harvestBlocker({ map: view.map, ownCities: view.economy.cities, position: resource.position,
      improved: (view.expansion?.improvements?.tiles ?? []).some(tile => tile.tileIndex === resource.tileIndex) })) continue;
    if (unit && berryHasNearbyCity) return { type: 'HarvestResource', unitId: unit.id, tileIndex: resource.tileIndex };
  }
  for (const overlord of world.overlords) {
    if (overlord.lastOfferRound === view.round || overlord.bond >= content.world.overlords.tier3Bond) continue;
    const goldAvailable = view.economy.player.gold - content.world.overlords.goldCost >= 100;
    const city = view.economy.cities.find(candidate => hexDistance(candidate.position, overlord.position, view.map) <= content.world.overlords.reach
      && (candidate.food >= content.world.overlords.foodCost || goldAvailable));
    if (city) {
      const currency = city.food >= content.world.overlords.foodCost ? 'food' : 'gold';
      return { type: 'OfferToOverlord', overlordId: overlord.id, cityId: city.id, currency };
    }
  }
  for (const unit of ownUnits) {
    if (unit.kind !== 'pokemon') continue;
    const rule = stoneEvolutionsFor(content.base).find(candidate =>
      candidate.fromSpeciesId === unit.speciesId && unit.xp >= candidate.requiredXp
      && generationAllows(content.base, view.economy.player, view.eraProgression, candidate.intoSpeciesId)
      && (playerState.stoneInventory[candidate.stoneId] ?? 0) > 0);
    if (rule) return { type: 'UseEvolutionStone', unitId: unit.id, intoSpeciesId: rule.intoSpeciesId, stoneId: rule.stoneId };
  }
  return null;
}
