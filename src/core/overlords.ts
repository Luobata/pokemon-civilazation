// Wild overlord habitats: placement and offering interactions.
import { isRegionalSpecies, speciesGeneration } from '../content/roster.ts';
import type { SpeciesId } from '../content/species.ts';
import type { Content } from '../content/units.ts';
import { hexDistance, indexToHex } from './hex.ts';
import type { EventPayload, GameState } from './model.ts';
import { shuffled } from './rng.ts';
import { maxGeneration } from './roster.ts';
import { visibleTiles } from './vision-query.ts';
import { WORLD, requireWorld, specialPlacementCandidates, takePlacement } from './world-model.ts';
import type { WorldAction, WorldState } from './world-model.ts';

function rareOverlordSpecies(state: GameState, content: Content): SpeciesId[] {
  const rare = (Object.keys(content.species) as SpeciesId[])
    .filter(speciesId => content.species[speciesId].rare && speciesGeneration(content, speciesId) <= (content.roster ? maxGeneration(state.setup.eraProgression) : Infinity)
      && isRegionalSpecies(content, speciesId))
    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  if (rare.length < Object.keys(state.players).length) throw new Error('Not enough rare species for unique overlords.');
  return shuffled(rare, state.rng);
}

export function initializeOverlords(state: GameState, world: WorldState, used: Set<number>, content: Content): void {
  const definitions = WORLD();
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
}

function visibleSite(state: GameState, playerId: number, tileIndex: number, content: Content): boolean {
  return tileIndex >= 0 && tileIndex < state.map.tiles.length && visibleTiles(state, playerId, content).has(tileIndex);
}

export function validateOfferToOverlord(state: GameState, actorId: number, action: Extract<WorldAction, { type: 'OfferToOverlord' }>, content: Content): string | null {
  const world = state.expansion!.world;
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

export function applyOfferToOverlord(state: GameState, actorId: number, action: Extract<WorldAction, { type: 'OfferToOverlord' }>): EventPayload[] {
  const world = requireWorld(state);
  const definitions = WORLD();
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
