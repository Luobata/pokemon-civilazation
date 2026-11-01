import { EXPANSION_CONTENT, CONTENT } from '../content/units.ts';
import { leaderEffects } from '../content/leaders.ts';
import type { Content } from '../content/units.ts';
import { hexDistance, hexToIndex, neighbors } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { CombatEvent, GameState } from './model.ts';
import { canEnter } from './movement.ts';
import { createMapUnit, maxUnitHp } from './unit.ts';
import { workRadius } from './city.ts';

export function resolveRecovery(state: GameState, content: Content = state.setup.expansionVersion === 1 ? EXPANSION_CONTENT : CONTENT): CombatEvent[] {
  const events: CombatEvent[] = [];
  for (const unit of Object.values(state.units).sort((a, b) => a.id - b.id)) {
    if (unit.location !== 'recovering') continue;
    if (unit.roundsLeft > 0) {
      unit.roundsLeft--;
      if (unit.roundsLeft === 0) unit.hp = Math.floor(maxUnitHp(unit, content) * 250 / 1000);
    }
    if (unit.roundsLeft > 0) continue;
    const city = state.cities[unit.cityId];
    const occupied = new Set([...Object.values(state.units).filter(isMapUnit), ...Object.values(state.cities)].map(entity => hexToIndex(entity.position, state.map)));
    const position = neighbors(city.position).filter(position => {
      const index = hexToIndex(position, state.map);
      return index !== null && !occupied.has(index) && canEnter(unit, state.map.tiles[index], content);
    }).sort((a, b) => hexToIndex(a, state.map)! - hexToIndex(b, state.map)!)[0];
    if (!position) continue;
    state.units[unit.id] = { ...createMapUnit(unit, unit.id, unit.ownerId, position, content, unit.xp), hp: unit.hp, enraged: unit.enraged };
    events.push({ type: 'UnitRecovered', playerId: unit.ownerId!, unitId: unit.id, position: { ...position } });
  }
  for (const unit of Object.values(state.units).filter(isMapUnit)) {
    if (unit.ownerId === null || !Object.values(state.cities).some(city => city.ownerId === unit.ownerId
      && hexDistance(city.position, unit.position) <= workRadius(city))) continue;
    const player = state.players[unit.ownerId];
    const heal = (player.research.unlockedIds.includes('medicine') ? 10 : 5)
      + (unit.kind === 'pokemon' ? leaderEffects(player.leaderId).territoryHealing : 0);
    unit.hp = Math.min(maxUnitHp(unit, content), unit.hp + heal);
  }
  return events;
}
