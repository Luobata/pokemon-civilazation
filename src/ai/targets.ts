import type { MapUnit, PlayerView } from '../core/model.ts';
import type { Hex } from '../core/hex.ts';
import { hexDistance, hexToIndex, indexToHex } from '../core/hex.ts';
import { knownCities } from './query.ts';
import { travelField } from './travel.ts';
import type { RuleQueries } from './query.ts';

// D42 fallback only. Never infer an unseen HQ position from authoritative state.
// Prefer the closest reachable exploration direction; row-major tile index breaks ties.
export function seekUnknownHeadquarters(view: PlayerView, unit: MapUnit, paths: ReturnType<RuleQueries['paths']>): Hex | null {
  const visible = new Set(view.visibleTileIds), explored = new Set(view.knowledge.exploredTileIds);
  const destinations = Object.entries(paths).filter(([, path]) => path.every(position => visible.has(hexToIndex(position, view.map)!)))
    .map(([index]) => indexToHex(Number(index), view.map));
  const targets = new Set(view.map.tiles.flatMap((_, index) => explored.has(index) ? [] : [index]));
  for (const city of knownCities(view)) {
    const index = hexToIndex(city.position, view.map);
    if (index !== null && !visible.has(index) && city.ownerId !== null && city.ownerId !== view.playerId
      && view.civilizations.some(civ => civ.id === city.ownerId && !civ.eliminated)) targets.add(index);
  }
  // v24 A2: only targets the unit can travel to (one field from its own tile; every target before v24).
  const reach = view.map.features ? travelField(view, unit, [unit.position]) : null;
  const ordered = [...targets].filter(index => !reach || reach[index] < 1 << 29).sort((a, b) => hexDistance(unit.position, indexToHex(a, view.map), view.map)
    - hexDistance(unit.position, indexToHex(b, view.map), view.map) || a - b);
  for (const index of ordered) {
    const target = indexToHex(index, view.map), before = hexDistance(unit.position, target, view.map);
    if (destinations.some(to => hexDistance(to, target, view.map) < before)) return target;
  }
  return null;
}
