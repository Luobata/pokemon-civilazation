// World berries, evolution stones, harvesting, stone evolution, berry regrowth, and satisfaction settlement.
import { stoneEvolutionsFor } from '../content/roster.ts';
import type { Content } from '../content/units.ts';
import type { BerryId, StoneId } from '../content/world-systems.ts';
import { edgeDistance, hexDistance, hexToIndex, indexToHex } from './hex.ts';
import type { EventPayload, GameState } from './model.ts';
import { generationAllows } from './roster.ts';
import { worldSiteAllowed } from './terrain.ts';
import { registerSpecies } from './unit.ts';
import { visibleTiles } from './vision-query.ts';
import { WORLD, actorUnit, harvestBlocker, requireWorld, takePlacement } from './world-model.ts';
import type { PokemonMapUnit, WorldAction, WorldState } from './world-model.ts';

export function initializeResources(state: GameState, world: WorldState, used: Set<number>): void {
  const definitions = WORLD();
  // v24 A3: resources only on passable land (islands included); nests and overlords stay on continents (specialPlacementCandidates).
  const resourceCandidates = state.map.tiles.flatMap((_, index) => edgeDistance(indexToHex(index, state.map), state.map) >= 1 && !used.has(index)
    && worldSiteAllowed(state.map, index, 'land') ? [index] : []);
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
}

function visibleSite(state: GameState, playerId: number, tileIndex: number, content: Content): boolean {
  return tileIndex >= 0 && tileIndex < state.map.tiles.length && visibleTiles(state, playerId, content).has(tileIndex);
}

export function validateResourceAction(state: GameState, actorId: number,
  action: Extract<WorldAction, { type: 'HarvestResource' | 'UseEvolutionStone' }>, content: Content): string | null {
  const world = state.expansion!.world;
  if (action.type === 'HarvestResource') {
    const unit = actorUnit(state, actorId, action.unitId);
    const resource = world.resources[action.tileIndex];
    if (!unit || !unit.actionLeft) return 'unit-unavailable';
    if (!resource || resource.remaining <= 0 || !visibleSite(state, actorId, action.tileIndex, content)) return 'world-target-unavailable';
    if (hexToIndex(unit.position, state.map) !== action.tileIndex) return 'world-target-unreachable';
    const blocked = harvestBlocker({ map: state.map, ownCities: Object.values(state.cities).filter(city => city.ownerId === actorId), position: resource.position,
      improved: Object.hasOwn(state.expansion?.improvements?.tiles ?? {}, action.tileIndex) });
    if (blocked) return blocked;
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

export function applyResourceAction(state: GameState, actorId: number,
  action: Extract<WorldAction, { type: 'HarvestResource' | 'UseEvolutionStone' }>, content: Content): EventPayload[] {
  const world = requireWorld(state);
  const definitions = WORLD();
  const playerState = world.players[actorId];
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
  playerState.pokedex[action.intoSpeciesId] = {
    ...record,
    observed: true,
    captured: true,
    firstObservedRound: record.firstObservedRound ?? state.round,
    firstCaptureRound: record.firstCaptureRound ?? state.round,
  };
  return [{
    type: 'WorldStoneEvolution', playerId: actorId, unitId: unit.id,
    fromSpeciesId, intoSpeciesId: action.intoSpeciesId, stoneId: action.stoneId,
  }];
}

export function resolveResourceRound(state: GameState, world: WorldState): EventPayload[] {
  const events: EventPayload[] = [];
  for (const resource of Object.values(world.resources).sort((a, b) => a.tileIndex - b.tileIndex)) {
    if (resource.kind !== 'berry' || resource.remaining >= resource.maximum || resource.regrowsAtRound === null || state.round < resource.regrowsAtRound) continue;
    resource.remaining = resource.maximum;
    resource.regrowsAtRound = null;
    events.push({
      type: 'WorldBerryRegrown', resourceTileIndex: resource.tileIndex,
      position: { ...resource.position }, definitionId: resource.definitionId as BerryId,
    });
  }
  return events;
}

export function resolveSatisfactionRound(state: GameState, world: WorldState): EventPayload[] {
  const definitions = WORLD();
  const events: EventPayload[] = [];
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
