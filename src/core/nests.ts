// Rampaging Pokémon nests: placement, clearing, spawning, and round-end rampaging strikes.
import { isRegionalSpecies, nestPriorityFor } from '../content/roster.ts';
import type { SpeciesId } from '../content/species.ts';
import type { Content } from '../content/units.ts';
import { resolveAttack } from './combat.ts';
import { cityDamage } from './combat-query.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from './hex.ts';
import type { Hex } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { EventPayload, GameState, MapUnit } from './model.ts';
import { canEnterTile } from './movement.ts';
import { randomBelow } from './rng.ts';
import { createMapUnit } from './unit.ts';
import { visibleTiles } from './vision-query.ts';
import { WORLD, actorUnit, occupiedIndexes, requireWorld, specialPlacementCandidates, takePlacement } from './world-model.ts';
import type { NestSite, PokemonMapUnit, WorldAction, WorldEvent, WorldState } from './world-model.ts';

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
    .filter(speciesId => content.species[speciesId].spawnBiomes.includes(biome) && !content.species[speciesId].rare && isRegionalSpecies(content, speciesId))
    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  if (!fallback.length) throw new Error('No representative nest species is compatible with the generated map.');
  return fallback[randomBelow(state.rng, fallback.length)];
}

export function initializeNests(state: GameState, world: WorldState, used: Set<number>, content: Content): void {
  const definitions = WORLD();
  const nestTiles = takePlacement(state, specialPlacementCandidates(state, 4), used, definitions.nests.count);
  for (const tileIndex of nestTiles) {
    const id = state.nextEntityId++;
    world.nests[id] = {
      id, tileIndex, position: indexToHex(tileIndex, state.map), speciesId: representativeNestSpecies(state, tileIndex, content),
      hp: definitions.nests.hp, maxHp: definitions.nests.hp, nextSpawnRound: state.round + definitions.nests.spawnIntervalRounds,
      activeUnitIds: [],
    };
  }
}

function visibleSite(state: GameState, playerId: number, tileIndex: number, content: Content): boolean {
  return tileIndex >= 0 && tileIndex < state.map.tiles.length && visibleTiles(state, playerId, content).has(tileIndex);
}

export function validateClearNest(state: GameState, actorId: number, action: Extract<WorldAction, { type: 'ClearNest' }>, content: Content): string | null {
  const world = state.expansion!.world;
  const unit = actorUnit(state, actorId, action.unitId);
  const nest = world.nests[action.nestId];
  if (!unit || unit.kind !== 'pokemon' || !unit.actionLeft) return 'unit-unavailable';
  if (!nest || !visibleSite(state, actorId, nest.tileIndex, content)) return 'world-target-unavailable';
  if (hexDistance(unit.position, nest.position, state.map) > content.species[unit.speciesId].range) return 'world-target-unreachable';
  return null;
}

export function applyClearNest(state: GameState, actorId: number, action: Extract<WorldAction, { type: 'ClearNest' }>, content: Content): EventPayload[] {
  const world = requireWorld(state);
  const definitions = WORLD();
  const playerState = world.players[actorId];
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

export function cleanupRampagers(world: WorldState, state: GameState): void {
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

export function resolveNestRound(state: GameState, world: WorldState, content: Content): EventPayload[] {
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
  return events;
}
