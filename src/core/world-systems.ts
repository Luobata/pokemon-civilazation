// World expansion coordinator: nests, overlords, berries/stones, and Pokédex tracking.
import { regionalPokedexTarget, victoryTargets } from '../content/opening.ts';
import { stoneEvolutionsFor } from '../content/roster.ts';
import type { Content } from '../content/units.ts';
import { WORLD_CONTENT } from '../content/world-systems.ts';
import type { WorldSystemContent } from '../content/world-systems.ts';
import { clonePlain } from './clone.ts';
import { hexDistance, hexToIndex } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { EventPayload, GameState, PlayerView } from './model.ts';
import { applyClearNest, initializeNests, resolveNestRound, validateClearNest } from './nests.ts';
import { applyOfferToOverlord, initializeOverlords, validateOfferToOverlord } from './overlords.ts';
import { initializePokedex, updateWorldRecords } from './pokedex.ts';
import { generationAllows } from './roster.ts';
import { isEmbarked } from './terrain.ts';
import { WORLD, blankPlayerState, harvestBlocker, worldCityYield, worldVisionSources } from './world-model.ts';
import type { WorldAction, WorldPlayerState, WorldState, WorldView } from './world-model.ts';
import { applyResourceAction, initializeResources, resolveResourceRound, resolveSatisfactionRound, validateResourceAction } from './world-resources.ts';

export { harvestBlocker, worldVisionSources, worldCityYield, updateWorldRecords };
export type {
  PokemonMapUnit, PokedexRecord, NestSite, OverlordSite, ResourceSite,
  WorldPlayerState, WorldVictoryState, WorldState, WorldAction,
  WorldSystemEvent, WorldEvent, PublicOverlordSite, WorldView,
} from './world-model.ts';

const clone = clonePlain;

export function isWorldAction(action: unknown): action is WorldAction {
  if (typeof action !== 'object' || action === null || !('type' in action)) return false;
  const type = (action as { type: unknown }).type;
  return type === 'ClearNest' || type === 'OfferToOverlord' || type === 'HarvestResource' || type === 'UseEvolutionStone';
}

export function initializeWorld(state: GameState, content: Content = WORLD_CONTENT.base): EventPayload[] {
  if (!state.expansion) throw new Error('Expansion container must exist before world initialization.');
  const definitions = WORLD();
  const players = Object.fromEntries(state.turnOrder.map(playerId => [playerId, blankPlayerState(content, definitions)])) as Record<number, WorldPlayerState>;
  const baseTarget = Math.min(Object.keys(content.species).length, definitions.pokedex.targetDocumentedSpecies + 3 + (content.roster?.pokedexTargetBonus ?? 0) + victoryTargets(state.setup).pokedexBonus);
  const world: WorldState = {
    version: 'world-v1', initializedAtRound: state.round, nests: {}, rampagingUnitIds: [],
    overlords: {}, resources: {}, players,
    // Gameplay v3 accelerates economies; the documented-species target rises so the Pokédex stays a long-game victory.
    // v25 (roster-v25 §2.6): the target scales with the regional Pokédex's share of the mode's pool.
    // v26 (depth-v26.md §14.9): `depth26.pokedexTargetBonus` more species on top of the regional target; v27 (pace-v27.md §13.8)
    // adds `pace27.opening.pokedexTargetBonus` (no pace27 before v27).
    victory: { targetDocumentedSpecies: (content.regionalDex ? regionalPokedexTarget(baseTarget, content.regionalDex.size, content.regionalDex.pool) : baseTarget)
      + (content.depth26?.pokedexTargetBonus ?? 0) + (content.pace27?.opening.pokedexTargetBonus ?? 0), achievedAtRound: null },
  };
  state.expansion.world = world;

  const used = new Set<number>();
  initializeNests(state, world, used, content);
  initializeOverlords(state, world, used, content);
  initializeResources(state, world, used);
  initializePokedex(state, world);
  return [];
}

export function validateWorldAction(state: GameState, actorId: number, action: WorldAction, content: Content = WORLD_CONTENT.base): string | null {
  const world = state.expansion?.world;
  if (!world || state.players[actorId]?.eliminated) return 'world-unavailable';
  if (action.type === 'ClearNest') return validateClearNest(state, actorId, action, content);
  if (action.type === 'OfferToOverlord') return validateOfferToOverlord(state, actorId, action, content);
  return validateResourceAction(state, actorId, action, content);
}

export function applyWorldAction(state: GameState, actorId: number, action: WorldAction, content: Content = WORLD_CONTENT.base): EventPayload[] {
  const reason = validateWorldAction(state, actorId, action, content);
  if (reason) throw new Error(`Invalid world action: ${reason}`);
  if (action.type === 'ClearNest') return applyClearNest(state, actorId, action, content);
  if (action.type === 'OfferToOverlord') return applyOfferToOverlord(state, actorId, action);
  return applyResourceAction(state, actorId, action, content);
}

export function resolveWorldRound(state: GameState, content: Content = WORLD_CONTENT.base): EventPayload[] {
  const world = state.expansion?.world;
  if (!world || state.outcome) return [];
  return [
    ...resolveNestRound(state, world, content),
    ...resolveResourceRound(state, world),
    ...resolveSatisfactionRound(state, world),
  ];
}

export function observeWorld(state: GameState, playerId: number, visibleTileIds: Set<number>): WorldView {
  const world = state.expansion?.world;
  if (!world) {
    return { version: 'world-v1', nests: [], overlords: [], resources: [], rampagingUnitIds: [], player: null, victory: null, visibleTileIds: [] };
  }
  const visible = [...visibleTileIds].sort((a, b) => a - b);
  return {
    version: 'world-v1',
    nests: Object.values(world.nests).filter(site => visibleTileIds.has(site.tileIndex)).sort((a, b) => a.id - b.id).map(site => ({
      ...clone(site),
      activeUnitIds: site.activeUnitIds.filter(unitId => {
        const unit = state.units[unitId];
        const tileIndex = unit && isMapUnit(unit) ? hexToIndex(unit.position, state.map) : null;
        return tileIndex !== null && visibleTileIds.has(tileIndex);
      }),
    })),
    overlords: Object.values(world.overlords).filter(site => visibleTileIds.has(site.tileIndex)).sort((a, b) => a.id - b.id)
      .map(site => ({
        id: site.id, tileIndex: site.tileIndex, position: clone(site.position), speciesId: site.speciesId,
        bond: site.bondByPlayer[playerId] ?? 0, lastOfferRound: site.lastOfferRoundByPlayer[playerId] ?? null,
      })),
    resources: Object.values(world.resources).filter(site => visibleTileIds.has(site.tileIndex)).sort((a, b) => a.tileIndex - b.tileIndex).map(clone),
    rampagingUnitIds: world.rampagingUnitIds.filter(unitId => {
      const unit = state.units[unitId];
      const index = unit && isMapUnit(unit) ? hexToIndex(unit.position, state.map) : null;
      return index !== null && visibleTileIds.has(index);
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
  // v24 A2: a unit carried on water cannot clear nests or harvest.
  const ownUnits = view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon' && unit.actionLeft === 1 && !isEmbarked(unit, view.map, content.base));
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
    if (unit && berryHasNearbyCity && harvestBlocker({ map: view.map, ownCities: view.economy.cities, position: resource.position,
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
