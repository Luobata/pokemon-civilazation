import { hexDistance, hexToIndex } from '../src/core/hex.ts';
import { isMapUnit } from '../src/core/model.ts';
import type { Command, GameState } from '../src/core/model.ts';
import { observe } from '../src/core/vision.ts';
import { knownCities } from '../src/ai/query.ts';

// Simulator-only diagnosis after core has rejected a command. Never passed to the AI.
export function classifyRejection(state: GameState, command: Command, reason: string): 'fog' | 'defect' {
  if (reason !== 'invalid-city-site' || command.action.type !== 'FoundCity') return 'defect';
  const unit = state.units[command.action.unitId];
  if (!unit || !isMapUnit(unit) || unit.kind !== 'logistics' || unit.ownerId !== command.actorId || unit.actionLeft <= 0) return 'defect';
  const index = hexToIndex(unit.position, state.map);
  if (index === null || state.map.tiles[index] === 'ocean') return 'defect';
  const view = observe(state, command.actorId);
  if (knownCities(view).some(city => hexDistance(city.position, unit.position) < 4)) return 'defect';
  const blockers = Object.values(state.cities).filter(city => hexDistance(city.position, unit.position) < 4);
  return blockers.length > 0 && blockers.every(city => !view.visibleTileIds.includes(hexToIndex(city.position, state.map)!)) ? 'fog' : 'defect';
}
