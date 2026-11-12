// Gameplay v24 A2 (docs/design/world-v24.md §2.8): travel distance for AI moves around water and peaks, from the player's view only.
//
// A travel field is a multi-source Dijkstra from a set of target tiles, run backwards (the cost of a step is paid on the tile being
// entered), with the passage rules of one kind of mover: flying, amphibious (native to land and water), naval, or a land unit with its
// civilization's water access (0 none, 1 shallow after 近海航行, 2 deep after 远洋航行). Costs: the biome's move cost plus hills and river
// crossings; embarking or landing costs TERRAIN_RULES_V24.embarkTravelCost; an unexplored tile is assumed passable at
// TERRAIN_RULES_V24.unexploredCost (optimistic, so units still go and look, and nothing hidden leaks). Fields are cached per view and
// mover, so a planner pays one Dijkstra per (mover, target set) per command.
//
// On maps without v24 features (v≤23) both exports are exactly the straight hex distance the planners compared before, so older
// command logs are unchanged. Other v24 planners (gyms, rivals) should compare progress through `travelDistance` / `travelCloser`
// rather than calling hexDistance directly.
import { TERRAIN_RULES_V24 } from '../content/terrain.ts';
import { contentForView, unitDefinition } from '../content/units.ts';
import type { Content, UnitIdentity } from '../content/units.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from '../core/hex.ts';
import type { Hex } from '../core/hex.ts';
import type { MapUnit, PlayerView } from '../core/model.ts';
import { isFlying, waterAccess } from '../core/movement.ts';
import { featureMoveExtra, isDeep, isLandmarkTile, isPeak } from '../core/terrain.ts';

/** How a unit crosses the map: what it may enter is decided by its kind and, for land units, its civilization's water access. */
export type Mover = { kind: 'flying' | 'amphibious' | 'naval' | 'land'; access: 0 | 1 | 2 };
const INF = 1 << 29;
export function moverOf(view: PlayerView, unit: UnitIdentity, content: Content = contentForView(view)): Mover {
  const terrain = unitDefinition(unit, content).terrain;
  if (isFlying(unit, content)) return { kind: 'flying', access: 2 };
  if (terrain.includes('ocean')) return { kind: terrain.includes('grassland') ? 'amphibious' : 'naval', access: 2 };
  return { kind: 'land', access: waterAccess(view.economy.player, content) };
}

type FieldCache = { adjacency: number[][]; fields: Map<string, Int32Array> };
const caches = new WeakMap<PlayerView, FieldCache>();
function cacheOf(view: PlayerView): FieldCache {
  let cache = caches.get(view);
  if (!cache) {
    const adjacency = view.map.tiles.map((_, index) => neighbors(indexToHex(index, view.map), view.map)
      .map(hex => hexToIndex(hex, view.map)).filter((next): next is number => next !== null));
    cache = { adjacency, fields: new Map() };
    caches.set(view, cache);
  }
  return cache;
}
/** Cost for `mover` to step from tile `from` into tile `to`, or INF when it cannot enter. */
function stepCost(view: PlayerView, mover: Mover, from: number, to: number, content: Content, sample: UnitIdentity): number {
  const map = view.map, biome = map.tiles[to];
  if (biome === null) return TERRAIN_RULES_V24.unexploredCost;
  if (isLandmarkTile(map, to) || (isPeak(map, to) && mover.kind !== 'flying')) return INF;
  const water = biome === 'ocean', wasWater = map.tiles[from] === 'ocean';
  if (mover.kind === 'naval' && !water) return INF;
  if (mover.kind === 'land') {
    if (water && mover.access < (isDeep(map, to) ? 2 : 1)) return INF;
    if (water !== wasWater && map.tiles[from] !== null) return TERRAIN_RULES_V24.embarkTravelCost;
    if (water) return 1;
  }
  if (mover.kind !== 'flying' && !water && biome === 'volcano' && !unitDefinition(sample, content).terrain.includes('volcano')) return INF;
  return content.moveCosts[biome] + featureMoveExtra(map, from, to, sample, content);
}
/** The travel field towards `targets` for this unit's kind of mover (cached per view). */
export function travelField(view: PlayerView, unit: UnitIdentity, targets: readonly Hex[], content: Content = contentForView(view)): Int32Array {
  return fieldFor(view, moverOf(view, unit, content), unit, targets, content);
}
function fieldFor(view: PlayerView, mover: Mover, unit: UnitIdentity, targets: readonly Hex[], content: Content): Int32Array {
  const cache = cacheOf(view);
  const sources = [...new Set(targets.map(target => hexToIndex(target, view.map)).filter((index): index is number => index !== null))].sort((a, b) => a - b);
  // The volcano rule depends on the species; key it so a fire Pokémon's field is not reused for others.
  const volcano = mover.kind !== 'flying' && unitDefinition(unit, content).terrain.includes('volcano');
  const key = `${mover.kind}:${mover.access}:${volcano ? 'v' : ''}:${sources.join(',')}`;
  const cached = cache.fields.get(key);
  if (cached) return cached;
  const n = view.map.tiles.length, dist = new Int32Array(n).fill(INF);
  // Bucket queue over small integer costs (Dial's algorithm): deterministic, linear in the map size.
  const buckets: number[][] = [[]];
  for (const index of sources) { dist[index] = 0; buckets[0].push(index); }
  for (let d = 0; d < buckets.length; d++) {
    const bucket = buckets[d];
    if (!bucket) continue;
    for (let k = 0; k < bucket.length; k++) {
      const to = bucket[k];
      if (dist[to] !== d) continue;
      // Backwards: a unit standing on `from` pays the cost of entering `to`.
      for (const from of cache.adjacency[to]) {
        const cost = stepCost(view, mover, from, to, content, unit);
        if (cost >= INF) continue;
        const next = d + cost;
        if (next < dist[from]) { dist[from] = next; (buckets[next] ??= []).push(from); }
      }
    }
  }
  cache.fields.set(key, dist);
  return dist;
}
/**
 * Travel cost for `unit` from `from` to `target` with its own (and its civilization's) passage rules; Infinity when unreachable.
 * Without v24 terrain features this is exactly `hexDistance(from, target, view.map)`.
 */
export function travelDistance(view: PlayerView, unit: MapUnit, from: Hex, target: Hex): number {
  if (!view.map.features) return hexDistance(from, target, view.map);
  return nearestTravel(view, unit, from, [target]);
}
/** Travel cost from `from` to the nearest of `targets` (Infinity when none is reachable); the hex distance before v24. */
export function nearestTravel(view: PlayerView, unit: UnitIdentity, from: Hex, targets: readonly Hex[]): number {
  if (!view.map.features) return targets.length ? Math.min(...targets.map(target => hexDistance(from, target, view.map))) : Infinity;
  const index = hexToIndex(from, view.map);
  if (index === null || !targets.length) return Infinity;
  const value = travelField(view, unit, targets)[index];
  return value >= INF ? Infinity : value;
}
/**
 * Travel cost for a unit that never embarks (a rival trainer's Pokémon, a wild Pokémon) from `from` to the nearest of `targets`: its species
 * terrain table plus the peak and landmark rules, no water access. The hex distance before v24.
 */
export function walkerTravel(view: PlayerView, unit: UnitIdentity, from: Hex, targets: readonly Hex[], content: Content = contentForView(view)): number {
  if (!view.map.features) return targets.length ? Math.min(...targets.map(target => hexDistance(from, target, view.map))) : Infinity;
  const index = hexToIndex(from, view.map), mover = moverOf(view, unit, content);
  if (index === null || !targets.length) return Infinity;
  const value = fieldFor(view, mover.kind === 'land' ? { kind: 'land', access: 0 } : mover, unit, targets, content)[index];
  return value >= INF ? Infinity : value;
}
/** Whether moving `unit` to `to` brings it closer to `target` (strictly; never true for an unreachable target). */
export function travelCloser(view: PlayerView, unit: MapUnit, to: Hex, target: Hex): boolean {
  const after = travelDistance(view, unit, to, target);
  return after < travelDistance(view, unit, unit.position, target) && after !== Infinity;
}

const LAND_WALKER: UnitIdentity = { kind: 'logistics', role: 'settler' };
/** Whether `to` is a boarding step for `unit` (a land unit leaving land for water; v24 only). */
export function isBoarding(view: PlayerView, unit: MapUnit, to: Hex, content: Content = contentForView(view)): boolean {
  if (!content.embark || !view.map.features || moverOf(view, unit, content).kind !== 'land') return false;
  const here = hexToIndex(unit.position, view.map), there = hexToIndex(to, view.map);
  return here !== null && there !== null && view.map.tiles[here] !== 'ocean' && view.map.tiles[there] === 'ocean';
}
/**
 * §2.8 when to board: a land unit steps onto water only when no hostile water-going unit (a wild sea Pokémon, or a Pokémon of a
 * civilization at war with this one) is visible within 3 tiles of the boarding tile, and no hostile Pokémon at all stands next to it;
 * a settler, builder or trader also needs one of its own Pokémon within 2 tiles; a Pokémon needs company within 2 tiles (another own
 * unit — e.g. the settler it escorts — in peace, two more own Pokémon at war; landings are made together). Integration fix: lone
 * Pokémon crossing in peace were the units knocked out at sea. Always true for moves that do not board (so always true before v24).
 */
export function safeToBoard(view: PlayerView, unit: MapUnit, to: Hex, content: Content = contentForView(view)): boolean {
  if (!isBoarding(view, unit, to, content)) return true;
  const enemies = new Set(view.diplomacy.filter(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId))
    .map(pair => pair.a === view.playerId ? pair.b : pair.a));
  const hostile = view.units.some(other => other.kind === 'pokemon' && (other.ownerId === null || enemies.has(other.ownerId))
    && (hexDistance(other.position, to, view.map) <= 1 || (unitDefinition(other, content).terrain.includes('ocean') && hexDistance(other.position, to, view.map) <= 3)));
  if (hostile) return false;
  const near = view.units.filter(other => other.ownerId === view.playerId && other.id !== unit.id && hexDistance(other.position, unit.position, view.map) <= 2);
  const escorts = near.filter(other => other.kind === 'pokemon').length;
  if (unit.kind === 'logistics') return escorts >= 1;
  return enemies.size === 0 ? near.length >= 1 : escorts >= 2;
}
/**
 * §2.8 research: +60 for 近海航行 when fewer than two known city sites are reachable over land from the capital, or an aggressive
 * civilization knows of no rival headquarters reachable over land; +40 for 远洋航行 while at war with a civilization none of whose
 * known cities can be reached over land and shallow water. 0 before v24. `citySite` is the planner's own site test.
 */
export function embarkResearchBonus(view: PlayerView, techId: string, content: Content, citySite: (position: Hex) => boolean): number {
  if (!content.embark || !view.map.features || (techId !== 'seafaring' && techId !== 'oceanography')) return 0;
  const capital = view.economy.cities.find(city => city.id === view.economy.player.headquartersCityId) ?? view.economy.cities[0];
  if (!capital) return 0;
  const reachable = (access: 0 | 1, positions: readonly Hex[]) => {
    const field = fieldFor(view, { kind: 'land', access }, LAND_WALKER, [capital.position], content);
    return positions.filter(position => { const index = hexToIndex(position, view.map); return index !== null && field[index] < INF; });
  };
  const known = Object.values(view.knowledge.lastKnownCities);
  if (techId === 'seafaring') {
    const sites = view.map.tiles.flatMap((biome, index) => biome !== null && biome !== 'ocean' && citySite(indexToHex(index, view.map)) ? [indexToHex(index, view.map)] : []);
    if (reachable(0, sites).length < 2) return 60;
    const rivals = known.filter(city => city.headquartersOf != null && city.ownerId !== null && city.ownerId !== view.playerId).map(city => city.position);
    return view.economy.player.personality === 'aggressive' && !reachable(0, rivals).length ? 60 : 0;
  }
  const enemies = new Set(view.diplomacy.filter(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId))
    .map(pair => pair.a === view.playerId ? pair.b : pair.a));
  const targets = known.filter(city => city.ownerId !== null && enemies.has(city.ownerId)).map(city => city.position);
  return targets.length && !reachable(1, targets).length ? 40 : 0;
}
