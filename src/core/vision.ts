import { cityYield, workCandidates } from './city.ts';
import { CONTENT, unitDefinition } from '../content/units.ts';
import type { Content, UnitIdentity } from '../content/units.ts';
import { hexDistance, hexToIndex, indexToHex } from './hex.ts';
import type { GameState, PlayerView, KnowledgeState, UnitState, GameEvent, VisibleEvent } from './model.ts';

export function unitIdentity(unit: UnitIdentity): UnitIdentity {
  return unit.kind === 'pokemon' ? { kind: 'pokemon', speciesId: unit.speciesId }
    : { kind: 'logistics', role: unit.role };
}
export function emptyKnowledge(): KnowledgeState {
  return { exploredTileIds: [], rememberedTiles: {}, lastKnownUnits: {}, lastKnownCities: {} };
}
export function visibleTiles(state: GameState, playerId: number, content: Content = CONTENT): Set<number> {
  const sources = Object.values(state.cities).filter(city => city.ownerId === playerId)
    .map(city => ({ position: city.position, radius: 2 }));
  for (const unit of Object.values(state.units).filter(unit => unit.ownerId === playerId)) {
    const index = hexToIndex(unit.position, state.map)!;
    sources.push({ position: unit.position,
      radius: unitDefinition(unit, content).vision + (state.map.tiles[index] === 'mountain' ? 1 : 0) });
  }
  return new Set(state.map.tiles.flatMap((_, index) =>
    sources.some(source => hexDistance(source.position, indexToHex(index, state.map)) <= source.radius) ? [index] : []));
}

// Called only on the new authoritative state, never as a side effect of observe.
export function refreshKnowledge(state: GameState, content: Content = CONTENT): void {
  for (const playerId of state.turnOrder) {
    const visible = visibleTiles(state, playerId, content);
    const knowledge = state.knowledge[playerId];
    knowledge.exploredTileIds = [...new Set([...knowledge.exploredTileIds, ...visible])].sort((a, b) => a - b);
    for (const tile of visible) knowledge.rememberedTiles[tile] = { biomeId: state.map.tiles[tile] };
    for (const [id, known] of Object.entries(knowledge.lastKnownUnits)) {
      const tile = hexToIndex(known.position, state.map)!;
      const current = state.units[Number(id)];
      if (visible.has(tile) && (!current || hexToIndex(current.position, state.map) !== tile)) {
        delete knowledge.lastKnownUnits[Number(id)];
      }
    }
    for (const unit of Object.values(state.units)) {
      if (visible.has(hexToIndex(unit.position, state.map)!)) knowledge.lastKnownUnits[unit.id] = {
        ...unitIdentity(unit), ownerId: unit.ownerId, position: { ...unit.position }, lastSeenRound: state.round,
      };
    }
    for (const city of Object.values(state.cities)) {
      if (visible.has(hexToIndex(city.position, state.map)!)) knowledge.lastKnownCities[city.id] = {
        ownerId: city.ownerId, position: { ...city.position }, lastSeenRound: state.round,
      };
    }
  }
}

export function observe(state: GameState, playerId: number, content: Content = CONTENT): PlayerView {
  const visible = visibleTiles(state, playerId, content);
  const knowledge = JSON.parse(JSON.stringify(state.knowledge[playerId])) as KnowledgeState;
  const copyUnit = (unit: UnitState): UnitState => ({ ...unit, position: { ...unit.position } });
  return {
    playerId, seed: state.setup.seed, round: state.round, activePlayerId: state.activePlayerId, commandSeq: state.commandSeq,
    map: { width: state.map.width, height: state.map.height,
      tiles: state.map.tiles.map((biome, i) => visible.has(i) ? biome : knowledge.rememberedTiles[i]?.biomeId ?? null) },
    visibleTileIds: [...visible], knowledge,
    units: Object.values(state.units).filter(unit => visible.has(hexToIndex(unit.position, state.map)!)).map(copyUnit),
    cities: Object.values(state.cities).filter(city => visible.has(hexToIndex(city.position, state.map)!))
      .map(city => ({ id: city.id, ownerId: city.ownerId, position: { ...city.position } })),
    economy: { player: JSON.parse(JSON.stringify(state.players[playerId])),
      cities: Object.values(state.cities).filter(city => city.ownerId === playerId).map(city => ({
        ...JSON.parse(JSON.stringify(city)), yields: cityYield(state, city, content), availableTileIds: workCandidates(state, city, content),
      })) },
  };
}

export function projectEvents(before: GameState, after: GameState, events: readonly GameEvent[],
  playerId: number, content: Content = CONTENT): VisibleEvent[] {
  const visible = new Set([...visibleTiles(before, playerId, content), ...visibleTiles(after, playerId, content)]);
  const projected: VisibleEvent[] = [];
  for (const event of events) {
    if ('playerId' in event.payload && event.payload.playerId !== playerId) continue;
    if (event.payload.type !== 'Moved') {
      projected.push({ seq: event.seq, payload: JSON.parse(JSON.stringify(event.payload)) });
      continue;
    }
    const unit = before.units[event.payload.unitId];
    let segment: typeof event.payload.path = [];
    const flush = () => {
      if (segment.length) projected.push({ seq: event.seq, payload: { type: 'Moved',
        unit: { ...unitIdentity(unit), id: unit.id, ownerId: unit.ownerId }, path: segment } });
      segment = [];
    };
    for (const position of event.payload.path) {
      if (visible.has(hexToIndex(position, before.map)!)) segment.push({ ...position });
      else flush(); // Never join visible endpoints across a hidden path segment.
    }
    flush();
  }
  return projected;
}
