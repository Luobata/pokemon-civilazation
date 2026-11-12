import { contentFor } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import type { BiomeId } from '../content/rules.ts';
import type { SpeciesId } from '../content/species.ts';
import { spawnWeightsFor, speciesGeneration, wanderersFor } from '../content/roster.ts';
import { regionGeneration } from './roster.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { EventPayload, GameState } from './model.ts';
import { randomBelow } from './rng.ts';
import { canEnterTile } from './movement.ts';
import { createMapUnit } from './unit.ts';
import { workRadius } from './city.ts';
import { resolveAttack } from './combat.ts';
import { isRivalUnit } from './rivals.ts';
import { isDeep, isHill, isLandmarkTile, isPeak, isRiver } from './terrain.ts';
import { adjacentLandmarks } from './landmarks.ts';
import { DEEP_WATER_HABITAT_V24, HABITAT_OVERLAYS_V24, LANDMARKS, LANDMARK_RULES_V24, NIGHT_SPAWN_MULTIPLIER_V24 } from '../content/terrain.ts';
import { isNight } from '../content/era-abilities.ts';
import type { Hex } from './hex.ts';

function roulette<T extends string>(state: GameState, entries: [T, number][]): T {
  entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  let roll = randomBelow(state.rng, entries.reduce((sum, [, weight]) => sum + weight, 0));
  for (const [id, weight] of entries) { if (roll < weight) return id; roll -= weight; }
  throw new Error('Empty roulette');
}
export function spawnWild(state: GameState, initial = false, content: Content = contentFor(state.setup)): EventPayload[] {
  const events: EventPayload[] = [], regionColumns = Math.ceil(state.map.width / 8);
  const regionCount = regionColumns * Math.ceil(state.map.height / 8);
  const regionOf = (index: number) => Math.floor(Math.floor(index / state.map.width) / 8) * regionColumns + Math.floor(index % state.map.width / 8);
  const starts = Object.values(state.players).map(player => state.cities[player.headquartersCityId]?.position).filter(position => position !== undefined);
  for (let region = 0; region < regionCount; region++) for (let attempt = 0; attempt < (initial ? 2 : 1); attempt++) {
    const wild = Object.values(state.units).filter(isMapUnit).filter(unit => unit.ownerId === null);
    if (wild.length >= regionCount * 2 || wild.filter(unit => regionOf(hexToIndex(unit.position, state.map)!) === region).length >= 2) continue;
    if (!initial && randomBelow(state.rng, 100) >= 5) continue;
    const tiles = state.map.tiles.flatMap((_, i) => regionOf(i) === region ? [i] : []);
    // v24 A3 (world-v24 §2.6): pick the tile first, then a species from that tile's habitat.
    if (content.landmarks && state.map.features) { const spawned = spawnOnHabitat(state, tiles, starts, content); if (spawned) events.push(spawned); continue; }
    const counts: Partial<Record<BiomeId, number>> = {};
    for (const i of tiles) { const biome = state.map.tiles[i]; counts[biome] = (counts[biome] ?? 0) + 1; }
    const biome = roulette(state, Object.entries(counts) as [BiomeId, number][]);
    // v14: only species up to the generation of the civilization nearest this region can appear.
    const generation = content.roster ? regionGeneration(state, tiles) : Infinity;
    const pool = (Object.entries(spawnWeightsFor(content, biome)) as [SpeciesId, number][]).filter(([id]) => speciesGeneration(content, id) <= generation);
    if (!pool.length) continue;
    const speciesId = roulette(state, pool.map(([id, weight]) => [id, content.species[id].rare ? Math.floor(weight * 250 / 1000) : weight]));
    const definition = content.species[speciesId], identity = { kind: 'pokemon' as const, speciesId };
    const occupied = new Set([...Object.values(state.units).filter(isMapUnit), ...Object.values(state.cities)].map(entity => hexToIndex(entity.position, state.map)));
    const candidates = tiles.filter(i => state.map.tiles[i] === biome && definition.spawnBiomes.includes(biome)
      && canEnterTile(identity, state.map, i, content) && !occupied.has(i) && starts.every(start => hexDistance(start, indexToHex(i, state.map), state.map) >= 3));
    // Empty candidates retain decision/biome/species draws, but no position draw.
    if (!candidates.length) continue;
    const position = indexToHex(candidates[randomBelow(state.rng, candidates.length)], state.map), id = state.nextEntityId++;
    state.units[id] = createMapUnit(identity, id, null, position, content);
    events.push({ type: 'WildSpawned', unitId: id, position: { ...position } });
  }
  return events;
}
/** §2.6 habitat of one tile: the biome's table plus feature overlays, deep water, landmark residents and the night bonus. */
export function habitatWeights(state: GameState, tileIndex: number, content: Content): Partial<Record<SpeciesId, number>> {
  const map = state.map, biome = map.tiles[tileIndex];
  const weights: Partial<Record<SpeciesId, number>> = { ...spawnWeightsFor(content, biome) };
  const add = (extra: Partial<Record<SpeciesId, number>>) => { for (const [id, value] of Object.entries(extra) as [SpeciesId, number][]) weights[id] = (weights[id] ?? 0) + value; };
  if (isHill(map, tileIndex)) add(HABITAT_OVERLAYS_V24.hill);
  if (isRiver(map, tileIndex)) add(HABITAT_OVERLAYS_V24.river);
  const around = neighbors(indexToHex(tileIndex, map), map).map(hex => hexToIndex(hex, map)).filter((index): index is number => index !== null);
  if (biome === 'mountain' && around.some(index => isPeak(map, index))) add(HABITAT_OVERLAYS_V24.peakside);
  if (isDeep(map, tileIndex)) {
    for (const id of DEEP_WATER_HABITAT_V24.remove) delete weights[id];
    for (const [id, factor] of Object.entries(DEEP_WATER_HABITAT_V24.multiply) as [SpeciesId, number][]) if (weights[id]) weights[id] = weights[id]! * factor;
  }
  for (const id of adjacentLandmarks(map, tileIndex)) for (const resident of LANDMARKS[id].residents) {
    weights[resident] = (weights[resident] ?? LANDMARK_RULES_V24.residentBaseWeight) * LANDMARK_RULES_V24.residentMultiplier;
  }
  if (isNight(state.round)) for (const id of Object.keys(weights) as SpeciesId[]) {
    const species = content.species[id];
    if (species && [species.typeId, species.secondaryTypeId].some(type => type === 'dark' || type === 'ghost')) weights[id] = weights[id]! * NIGHT_SPAWN_MULTIPLIER_V24;
  }
  return weights;
}
function spawnOnHabitat(state: GameState, tiles: readonly number[], starts: readonly Hex[], content: Content): EventPayload | null {
  const occupied = new Set([...Object.values(state.units).filter(isMapUnit), ...Object.values(state.cities)].map(entity => hexToIndex(entity.position, state.map)));
  const candidates = tiles.filter(i => !occupied.has(i) && !isPeak(state.map, i) && !isLandmarkTile(state.map, i)
    && starts.every(start => hexDistance(start, indexToHex(i, state.map), state.map) >= 3));
  if (!candidates.length) return null;
  const tileIndex = candidates[randomBelow(state.rng, candidates.length)];
  const generation = content.roster ? regionGeneration(state, [...tiles]) : Infinity;
  const pool = (Object.entries(habitatWeights(state, tileIndex, content)) as [SpeciesId, number][])
    .filter(([id, weight]) => weight > 0 && content.species[id] && speciesGeneration(content, id) <= generation && canEnterTile({ kind: 'pokemon', speciesId: id }, state.map, tileIndex, content));
  if (!pool.length) return null;
  const speciesId = roulette(state, pool.map(([id, weight]): [SpeciesId, number] => [id, content.species[id].rare ? Math.max(1, Math.floor(weight * 250 / 1000)) : weight]));
  const position = indexToHex(tileIndex, state.map), id = state.nextEntityId++;
  state.units[id] = createMapUnit({ kind: 'pokemon', speciesId }, id, null, position, content);
  return { type: 'WildSpawned', unitId: id, position: { ...position } };
}
export function actWild(state: GameState, content: Content = contentFor(state.setup)): EventPayload[] {
  const events: EventPayload[] = [];
  for (const id of Object.values(state.units).filter(unit => unit.ownerId === null).map(unit => unit.id).sort((a, b) => a - b)) {
    const unit = state.units[id];
    // v24 C: rival trainers act in resolveRivalRound, not as wild Pokémon.
    if (!unit || !isMapUnit(unit) || unit.kind !== 'pokemon' || state.expansion?.world.rampagingUnitIds.includes(id) || isRivalUnit(state, id)) continue;
    if (wanderersFor(content).includes(unit.speciesId)) {
      const occupied = new Set(Object.values(state.units).filter(isMapUnit).map(other => hexToIndex(other.position, state.map)));
      const candidates = neighbors(unit.position, state.map).filter(position => {
        const index = hexToIndex(position, state.map);
        return index !== null && !occupied.has(index) && canEnterTile(unit, state.map, index, content)
          && !Object.values(state.cities).some(city => hexDistance(position, city.position, state.map) <= workRadius(city));
      }).sort((a, b) => hexToIndex(a, state.map)! - hexToIndex(b, state.map)!);
      if (!candidates.length) continue;
      const position = candidates[randomBelow(state.rng, candidates.length)], from = { ...unit.position };
      unit.position = position;
      events.push({ type: 'Moved', unitId: id, path: [from, { ...position }] });
    } else {
      const target = Object.values(state.units).filter(isMapUnit).filter(other => other.ownerId !== null && hexDistance(unit.position, other.position, state.map) === 1)
        .sort((a, b) => a.id - b.id)[0];
      if (target) events.push(...resolveAttack(state, id, { kind: 'unit', id: target.id }, content, true));
    }
  }
  return events;
}
export function resolveWild(state: GameState, content: Content = contentFor(state.setup)): EventPayload[] {
  return [...spawnWild(state, false, content), ...actWild(state, content)];
}
