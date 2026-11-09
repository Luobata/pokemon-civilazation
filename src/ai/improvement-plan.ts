import { usesBuilders, usesImprovementsV23 } from '../core/improvements.ts';
import { IMPROVEMENT_IDS, IMPROVEMENTS, RESOURCE_IMPROVEMENT, improvementIdsFor } from '../content/improvements.ts';
import type { ImprovementId } from '../content/improvements.ts';
import type { Content } from '../content/units.ts';
import { crewPoints, improvementOptions, improvementYield, resourceLookup } from '../core/improvements.ts';
import { viewRepairs } from '../core/pillage.ts';
import { workRadius } from '../core/city.ts';
import { hexDistance, indexToHex } from '../core/hex.ts';
import type { CityState, Command, MapUnit, PlayerView } from '../core/model.ts';

type Suggestion = { action: Command['action']; benefit: number };
const value = (kind: ImprovementId, view: PlayerView) => {
  const y = improvementYield(kind, view.economy.player);
  return y.food * 2 + y.production * 3 + y.gold * 2 + y.research * 3;
};
/** v23: resource improvements also carry satisfaction / stones / a giftable copy. */
const RESOURCE_EXTRA = 4;
/** v23: a hungry city (small, or growing by at most 1 food a round) values food twice. */
const hungry = (city: Pick<CityState, 'population'> & { yields: { food: number } }) => city.population <= 3 || city.yields.food - 2 * city.population <= 1;
const valueFor = (kind: ImprovementId, view: PlayerView, foodFirst: boolean) => {
  const y = improvementYield(kind, view.economy.player);
  return y.food * (foodFirst ? 4 : 2) + y.production * 3 + y.gold * 2 + y.research * 3 + (IMPROVEMENTS[kind].resource ? RESOURCE_EXTRA : 0);
};
/** Units that may work tiles this turn: a small peacetime crew, crew-type specialists first. */
export function designatedWorkers(view: PlayerView, content: Content, busy: boolean): Set<number> {
  if (!view.expansion?.improvements) return new Set();
  // v18: 工匠 units are the only workers and always work, even in wartime.
  if (usesBuilders(view)) return new Set(view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'logistics' && unit.role === 'builder').map(unit => unit.id));
  if (busy) return new Set();
  const own = view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon');
  const limit = Math.min(view.economy.cities.length, Math.max(1, Math.floor(own.length / 3)));
  const skill = (unit: MapUnit) => Math.max(...IMPROVEMENT_IDS.map(kind => crewPoints(unit, content, kind)));
  return new Set([...own].sort((a, b) => skill(b) - skill(a) || a.id - b.id).slice(0, limit).map(unit => unit.id));
}
/** v18: train a 工匠 when unimproved worked tiles outnumber what living and queued builders can still build. */
export function wantsBuilder(view: PlayerView): boolean {
  if (!view.expansion?.improvements || !usesBuilders(view)) return false;
  const builders = view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'logistics' && unit.role === 'builder');
  const queued = view.economy.cities.reduce((sum, city) => sum + [...city.queue, ...city.pendingDeployments].filter(order => order.item.kind === 'logistics' && order.item.defId === 'builder').length, 0);
  // v23: damaged own improvements also need a builder (repairs cost no charge, so one living builder covers them).
  if (usesImprovementsV23(view) && queued === 0 && builders.length === 0 && damagedOwn(view).length > 0) return true;
  return queued === 0 && builders.length < Math.max(1, Math.ceil(view.economy.cities.length / 3)) && targets(view).length > builders.reduce((sum, unit) => sum + (unit.charges ?? 0), 0);
}
/** v23: damaged improvements inside own territory. */
function damagedOwn(view: PlayerView): number[] {
  return (view.expansion?.improvements?.tiles ?? []).filter(tile => tile.damaged && view.economy.cities.some(city => {
    const distance = hexDistance(city.position, indexToHex(tile.tileIndex, view.map), view.map);
    return distance > 0 && distance <= workRadius(city);
  })).map(tile => tile.tileIndex);
}
/** Worked, unimproved own tiles and the improvement that fits each. */
function targets(view: PlayerView): { tileIndex: number; kind: ImprovementId }[] {
  const improvements = view.expansion?.improvements;
  if (!improvements) return [];
  if (usesImprovementsV23(view)) return targetsV23(view);
  const done = new Set(improvements.tiles.map(tile => tile.tileIndex));
  return view.economy.cities.flatMap(city => city.workedTileIds).filter(index => !done.has(index)).flatMap(tileIndex => {
    const biome = view.map.tiles[tileIndex];
    const kind = [...IMPROVEMENT_IDS].sort((a, b) => value(b, view) - value(a, view)).find(id => biome && IMPROVEMENTS[id].biomes.includes(biome as never));
    return kind ? [{ tileIndex, kind }] : [];
  }).sort((a, b) => a.tileIndex - b.tileIndex);
}
/**
 * v23: worked unimproved tiles get the best researched improvement for the city's needs; every resource tile in own
 * territory (worked or not) gets its resource improvement once researched.
 */
function targetsV23(view: PlayerView): { tileIndex: number; kind: ImprovementId }[] {
  const improvements = view.expansion!.improvements!, unlocked = view.economy.player.research.unlockedIds;
  const done = new Set([...improvements.tiles.map(tile => tile.tileIndex), ...(view.expansion?.districts?.tiles.map(tile => tile.tileIndex) ?? []),
    ...(view.expansion?.districts?.projects.map(tile => tile.tileIndex) ?? []), ...(view.expansion?.districts?.constructionSites?.filter(site => site.category === 'district').map(site => site.tileIndex) ?? [])]);
  const resourceAt = resourceLookup(view.expansion?.world.resources ?? [], (view.expansion?.rareBerries?.deposits ?? []).map(item => item.tileIndex));
  const researched = (kind: ImprovementId) => !IMPROVEMENTS[kind].requiredTech || unlocked.includes(IMPROVEMENTS[kind].requiredTech!);
  const centres = new Set(view.cities.map(city => `${city.position.q},${city.position.r}`));
  const out = new Map<number, ImprovementId>();
  for (const city of [...view.economy.cities].sort((a, b) => a.id - b.id)) {
    const foodFirst = hungry(city), radius = workRadius(city);
    const resources = view.map.tiles.flatMap((_, index) => {
      const position = indexToHex(index, view.map), distance = hexDistance(city.position, position, view.map);
      return distance > 0 && distance <= radius && resourceAt(index) && !centres.has(`${position.q},${position.r}`) ? [index] : [];
    });
    for (const tileIndex of [...city.workedTileIds, ...resources]) {
      if (done.has(tileIndex) || out.has(tileIndex)) continue;
      const biome = view.map.tiles[tileIndex], resource = resourceAt(tileIndex);
      const kind = resource ? (researched(RESOURCE_IMPROVEMENT[resource]) ? RESOURCE_IMPROVEMENT[resource] : undefined)
        : [...improvementIdsFor(view)].filter(id => !IMPROVEMENTS[id].resource && researched(id) && biome && IMPROVEMENTS[id].biomes.includes(biome as never))
          .sort((a, b) => valueFor(b, view, foodFirst) - valueFor(a, view, foodFirst))[0];
      if (kind) out.set(tileIndex, kind);
    }
  }
  return [...out].map(([tileIndex, kind]) => ({ tileIndex, kind })).sort((a, b) => a.tileIndex - b.tileIndex);
}
export function improvementSuggestions(view: PlayerView, unit: MapUnit, content: Content,
  paths: Record<string, unknown[]>): Suggestion[] {
  const out: Suggestion[] = [];
  const goals = targets(view), wanted = new Set(goals.map(goal => `${goal.tileIndex}:${goal.kind}`));
  // v23: repairs come first (no charge spent), unless a hostile Pokémon is within 2 tiles of the damaged tile.
  const damaged = usesImprovementsV23(view) ? damagedOwn(view).filter(tileIndex => !view.units.some(other => other.ownerId !== null && other.ownerId !== view.playerId
    && other.kind === 'pokemon' && view.diplomacy.some(pair => pair.status === 'war' && (pair.a === view.playerId || pair.b === view.playerId) && (pair.a === other.ownerId || pair.b === other.ownerId))
    && hexDistance(other.position, indexToHex(tileIndex, view.map), view.map) <= 2)) : [];
  const tiles = new Map((view.expansion?.improvements?.tiles ?? []).map(tile => [tile.tileIndex, tile]));
  for (const tileIndex of usesImprovementsV23(view) ? viewRepairs(view, unit.id, content) : []) {
    if (damaged.includes(tileIndex)) out.push({ action: { type: 'RepairImprovement', unitId: unit.id, tileIndex }, benefit: 350 + value(tiles.get(tileIndex)!.kind, view) * 10 });
  }
  for (const option of improvementOptions(view, unit.id, content)) {
    if (!wanted.has(`${option.tileIndex}:${option.kind}`)) continue;
    out.push({ action: { type: 'ImproveTile', unitId: unit.id, tileIndex: option.tileIndex, kind: option.kind }, benefit: 300 + value(option.kind, view) * 10 + option.progress * 20 });
  }
  const destinations = [...damaged.map(tileIndex => ({ tileIndex })), ...goals];
  if (out.length || !destinations.length) return out;
  const nearest = [...destinations].sort((a, b) => hexDistance(unit.position, indexToHex(a.tileIndex, view.map), view.map) - hexDistance(unit.position, indexToHex(b.tileIndex, view.map), view.map) || a.tileIndex - b.tileIndex)[0];
  const goal = indexToHex(nearest.tileIndex, view.map), offset = view.map.tiles[nearest.tileIndex] === 'ocean' ? 1 : 0;
  const before = hexDistance(unit.position, goal, view.map);
  for (const indexText of Object.keys(paths)) {
    const to = indexToHex(Number(indexText), view.map), after = hexDistance(to, goal, view.map);
    if (after < before && after >= offset) out.push({ action: { type: 'Move', unitId: unit.id, to }, benefit: 80 - after });
  }
  return out;
}
