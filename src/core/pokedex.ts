// Pokédex documentation tracking and exploration victory.
import { isRegionalSpecies } from '../content/roster.ts';
import type { SpeciesId } from '../content/species.ts';
import type { Content } from '../content/units.ts';
import { WORLD_CONTENT } from '../content/world-systems.ts';
import { hexToIndex } from './hex.ts';
import type { Hex } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { Command, EventPayload, GameState } from './model.ts';
import { cleanupRampagers } from './nests.ts';
import { isRivalUnit } from './state-queries.ts';
import { finishGame } from './victory.ts';
import { visibleTiles } from './vision-query.ts';
import { documented } from './world-model.ts';
import type { WorldState } from './world-model.ts';

export function initializePokedex(state: GameState, world: WorldState): void {
  for (const player of Object.values(state.players)) {
    const records = world.players[player.id]?.pokedex;
    if (!records) continue;
    for (const speciesId of player.registeredSpeciesIds) {
      records[speciesId].observed = true;
      records[speciesId].captured = true;
      records[speciesId].firstObservedRound = state.round;
      records[speciesId].firstCaptureRound = state.round;
    }
  }
}

function markRecord(next: GameState, playerId: number, speciesId: SpeciesId,
  mode: 'observed' | 'battled' | 'captured', events: EventPayload[]): void {
  const pokedex = next.expansion?.world.players[playerId]?.pokedex;
  const record = pokedex?.[speciesId];
  if (!pokedex || !record) return;
  const observed = true;
  const battled = mode === 'battled' ? true : record.battled;
  const captured = mode === 'captured' ? true : record.captured;
  const firstObservedRound = mode === 'observed' ? (record.firstObservedRound ?? next.round) : record.firstObservedRound;
  const firstBattleRound = mode === 'battled' ? (record.firstBattleRound ?? next.round) : record.firstBattleRound;
  const firstCaptureRound = mode === 'captured' ? (record.firstCaptureRound ?? next.round) : record.firstCaptureRound;
  if (record.observed === observed && record.battled === battled && record.captured === captured
    && record.firstObservedRound === firstObservedRound && record.firstBattleRound === firstBattleRound && record.firstCaptureRound === firstCaptureRound) {
    return;
  }
  const changed = record.observed !== observed || record.battled !== battled || record.captured !== captured;
  pokedex[speciesId] = {
    speciesId: record.speciesId, observed, battled, captured,
    firstObservedRound, firstBattleRound, firstCaptureRound,
  };
  if (changed) {
    events.push({
      type: 'WorldPokedexUpdated', playerId, speciesId,
      observed, battled, captured,
    });
  }
}

function checkWorldVictory(next: GameState, playerId: number, events: EventPayload[], content: Content): boolean {
  const world = next.expansion?.world;
  if (!world || world.victory.achievedAtRound !== null || next.outcome) return false;
  // v25: only regional species count (sanctuary guards and other visitors are not part of this region's Pokédex).
  const count = Object.values(world.players[playerId]?.pokedex ?? {}).filter(record => documented(record) && isRegionalSpecies(content, record.speciesId)).length;
  if (count < world.victory.targetDocumentedSpecies) return false;
  world.victory.achievedAtRound = next.round;
  events.push({ type: 'WorldVictoryAchieved', playerId, documentedSpecies: count, target: world.victory.targetDocumentedSpecies });
  events.push(...finishGame(next, 'pokedex', [playerId], content));
  return true;
}

export function updateWorldRecords(before: GameState, next: GameState, command: Command,
  baseEvents: readonly EventPayload[], content: Content = WORLD_CONTENT.base): EventPayload[] {
  void command;
  const world = next.expansion?.world;
  if (!world) return [];
  const events: EventPayload[] = [];
  cleanupRampagers(world, next);
  for (const playerId of [...next.turnOrder].sort((a, b) => a - b)) {
    const visibleBefore = visibleTiles(before, playerId, content);
    const visibleAfter = visibleTiles(next, playerId, content);
    for (const source of [before, next]) {
      const visible = source === before ? visibleBefore : visibleAfter;
      for (const unit of Object.values(source.units).filter(isMapUnit)) {
        if (unit.kind === 'pokemon' && visible.has(hexToIndex(unit.position, source.map)!)) markRecord(next, playerId, unit.speciesId, 'observed', events);
      }
    }
    for (const event of baseEvents) {
      if (event.type === 'Moved') {
        const unit = before.units[event.unitId] ?? next.units[event.unitId];
        if (unit?.kind === 'pokemon' && event.path.some((position: Hex) => visibleBefore.has(hexToIndex(position, before.map)!))) {
          markRecord(next, playerId, unit.speciesId, 'observed', events);
        }
      } else if (event.type === 'WildSpawned' && visibleBefore.has(hexToIndex(event.position, before.map)!)) {
        const unit = next.units[event.unitId];
        if (unit?.kind === 'pokemon') markRecord(next, playerId, unit.speciesId, 'observed', events);
      } else if (event.type === 'BattleResolved') {
        const visible = event.positions.every((position: Hex) => visibleBefore.has(hexToIndex(position, before.map)!)
          || visibleAfter.has(hexToIndex(position, next.map)!));
        if (!visible) continue;
        const attacker = before.units[event.attackerId] ?? next.units[event.attackerId];
        const defender = event.target.kind === 'unit' ? before.units[event.target.id] ?? next.units[event.target.id] : undefined;
        // v26 (depth-v26 §5.4 fix): a Max Raid battle is "battled" only for the civilizations whose unit fought in it; the others only
        // watched (seen). No raids exist before v26.
        const boss = (before.expansion?.raids?.active ?? next.expansion?.raids?.active)?.unitId;
        const raid = boss !== undefined && (event.attackerId === boss || defender?.id === boss);
        const mode = raid && attacker?.ownerId !== playerId && defender?.ownerId !== playerId ? 'observed' : 'battled';
        // v24 C: a rival trainer's Pokémon only counts as seen (world-v24 §4.1).
        if (attacker?.kind === 'pokemon' && !isRivalUnit(before, attacker.id)) markRecord(next, playerId, attacker.speciesId, mode, events);
        if (defender?.kind === 'pokemon' && !isRivalUnit(before, defender.id)) markRecord(next, playerId, defender.speciesId, mode, events);
      } else if (event.type === 'Captured' && event.success && event.playerId === playerId) {
        const captured = before.units[event.targetUnitId] ?? next.units[event.targetUnitId];
        if (captured?.kind === 'pokemon') markRecord(next, playerId, captured.speciesId, 'captured', events);
      }
    }
    checkWorldVictory(next, playerId, events, content);
  }
  return events;
}
