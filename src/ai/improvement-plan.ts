import { usesBuilders } from '../core/improvements.ts';
import { IMPROVEMENT_IDS, IMPROVEMENTS } from '../content/improvements.ts';
import type { ImprovementId } from '../content/improvements.ts';
import type { Content } from '../content/units.ts';
import { crewPoints, improvementOptions, improvementYield } from '../core/improvements.ts';
import { hexDistance, indexToHex } from '../core/hex.ts';
import type { Command, MapUnit, PlayerView } from '../core/model.ts';

type Suggestion = { action: Command['action']; benefit: number };
const value = (kind: ImprovementId, view: PlayerView) => {
  const y = improvementYield(kind, view.economy.player);
  return y.food * 2 + y.production * 3 + y.gold * 2 + y.research * 3;
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
  return queued === 0 && builders.length < Math.max(1, Math.ceil(view.economy.cities.length / 3)) && targets(view).length > builders.reduce((sum, unit) => sum + (unit.charges ?? 0), 0);
}
/** Worked, unimproved own tiles and the improvement that fits each. */
function targets(view: PlayerView): { tileIndex: number; kind: ImprovementId }[] {
  const improvements = view.expansion?.improvements;
  if (!improvements) return [];
  const done = new Set(improvements.tiles.map(tile => tile.tileIndex));
  return view.economy.cities.flatMap(city => city.workedTileIds).filter(index => !done.has(index)).flatMap(tileIndex => {
    const biome = view.map.tiles[tileIndex];
    const kind = [...IMPROVEMENT_IDS].sort((a, b) => value(b, view) - value(a, view)).find(id => biome && IMPROVEMENTS[id].biomes.includes(biome as never));
    return kind ? [{ tileIndex, kind }] : [];
  }).sort((a, b) => a.tileIndex - b.tileIndex);
}
export function improvementSuggestions(view: PlayerView, unit: MapUnit, content: Content,
  paths: Record<string, unknown[]>): Suggestion[] {
  const out: Suggestion[] = [];
  const goals = targets(view), wanted = new Set(goals.map(goal => `${goal.tileIndex}:${goal.kind}`));
  for (const option of improvementOptions(view, unit.id, content)) {
    if (!wanted.has(`${option.tileIndex}:${option.kind}`)) continue;
    out.push({ action: { type: 'ImproveTile', unitId: unit.id, tileIndex: option.tileIndex, kind: option.kind }, benefit: 300 + value(option.kind, view) * 10 + option.progress * 20 });
  }
  if (out.length || !goals.length) return out;
  const nearest = [...goals].sort((a, b) => hexDistance(unit.position, indexToHex(a.tileIndex, view.map), view.map) - hexDistance(unit.position, indexToHex(b.tileIndex, view.map), view.map) || a.tileIndex - b.tileIndex)[0];
  const goal = indexToHex(nearest.tileIndex, view.map), offset = view.map.tiles[nearest.tileIndex] === 'ocean' ? 1 : 0;
  const before = hexDistance(unit.position, goal, view.map);
  for (const indexText of Object.keys(paths)) {
    const to = indexToHex(Number(indexText), view.map), after = hexDistance(to, goal, view.map);
    if (after < before && after >= offset) out.push({ action: { type: 'Move', unitId: unit.id, to }, benefit: 80 - after });
  }
  return out;
}
