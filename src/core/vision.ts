import { observePolicies, playerPolicyEffects } from './policies.ts';
import { observeImprovements } from './improvements.ts';
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import { observeWorld, worldVisionSources } from './world-systems.ts';
import { observeCivilization } from './civilization-systems.ts';
import { leaderVisionBonus, observeLeaders } from './leader-systems.ts';
import { isMapUnit } from './model.ts';
import { cityCounterAttack, cityYield, workCandidates, workRadius } from './city.ts';
import { leaderEffects } from '../content/leaders.ts';
import { EXPANSION_CONTENT, CONTENT, unitDefinition } from '../content/units.ts';
import type { Content, UnitIdentity } from '../content/units.ts';
import { hexDistance, hexToIndex } from './hex.ts';
import type { GameState, PlayerView, KnowledgeState, MapUnit, GameEvent, VisibleEvent, Diplomacy } from './model.ts';

export function unitIdentity(unit: UnitIdentity): UnitIdentity {
  return unit.kind === 'pokemon' ? { kind: 'pokemon', speciesId: unit.speciesId, ...(unit.uniqueLeader ? { uniqueLeader: unit.uniqueLeader } : {}) }
    : { kind: 'logistics', role: unit.role };
}
export function emptyKnowledge(): KnowledgeState {
  return { exploredTileIds: [], rememberedTiles: {}, lastKnownUnits: {}, lastKnownCities: {} };
}
export function visibleTiles(state: GameState, playerId: number, content: Content = state.setup.expansionVersion === 1 ? EXPANSION_CONTENT : CONTENT): Set<number> {
  const sources = Object.values(state.cities).filter(city => city.ownerId === playerId)
    .map(city => ({ position: city.position, radius: 2 + leaderEffects(state.players[playerId].leaderId).cityVision + leaderVisionBonus(state, playerId, city.id) + playerPolicyEffects(state, playerId).visionBonus }));
  sources.push(...worldVisionSources(state, playerId));
  sources.push(...(state.expansion?.civilization?.sanctuaries ?? []).filter(site => site.ownerId === playerId).map(site => ({ position: site.position, radius: 2 })));
  for (const unit of Object.values(state.units).filter(isMapUnit).filter(unit => unit.ownerId === playerId)) {
    const index = hexToIndex(unit.position, state.map)!;
    sources.push({ position: unit.position,
      radius: unitDefinition(unit, content).vision + (state.map.tiles[index] === 'mountain' ? 1 : 0) });
  }
  const visible = new Set<number>();
  for (const { position, radius } of sources) for (let r = position.r - radius; r <= position.r + radius; r++) {
    for (let q = position.q - radius; q <= position.q + radius; q++) {
      if (hexDistance(position, { q, r }) > radius) continue;
      const index = hexToIndex({ q, r }, state.map);
      if (index !== null) visible.add(index);
    }
  }
  return new Set([...visible].sort((a, b) => a - b));
}

// D39: territory is the union of civilization city radii, not exclusive worked-tile ownership.
function territoryOwners(state: GameState): number[][] {
  const owners = state.map.tiles.map(() => [] as number[]);
  for (const city of Object.values(state.cities)) {
    if (city.ownerId === null) continue;
    const radius = workRadius(city);
    for (let q = city.position.q - radius; q <= city.position.q + radius; q++) for (let r = city.position.r - radius; r <= city.position.r + radius; r++) {
      if (hexDistance(city.position, { q, r }) > radius) continue;
      const index = hexToIndex({ q, r }, state.map);
      if (index !== null && !owners[index].includes(city.ownerId)) owners[index].push(city.ownerId);
    }
  }
  return owners.map(ids => ids.sort((a, b) => a - b));
}

// Called only on the new authoritative state, never as a side effect of observe.
export function refreshKnowledge(state: GameState, content: Content = state.setup.expansionVersion === 1 ? EXPANSION_CONTENT : CONTENT): void {
  const territory = territoryOwners(state);
  for (const playerId of state.turnOrder) {
    const visible = visibleTiles(state, playerId, content);
    const knowledge = state.knowledge[playerId];
    knowledge.exploredTileIds = [...new Set([...knowledge.exploredTileIds, ...visible])].sort((a, b) => a - b);
    for (const tile of visible) knowledge.rememberedTiles[tile] = { biomeId: state.map.tiles[tile], territoryOwnerIds: [...territory[tile]] };
    for (const [id, known] of Object.entries(knowledge.lastKnownUnits)) {
      const tile = hexToIndex(known.position, state.map)!;
      const current = state.units[Number(id)];
      if (visible.has(tile) && (!current || !isMapUnit(current) || hexToIndex(current.position, state.map) !== tile)) {
        delete knowledge.lastKnownUnits[Number(id)];
      }
    }
    for (const unit of Object.values(state.units).filter(isMapUnit)) {
      if (visible.has(hexToIndex(unit.position, state.map)!)) knowledge.lastKnownUnits[unit.id] = {
        ...unitIdentity(unit), ownerId: unit.ownerId, position: { ...unit.position }, lastSeenRound: state.round,
      };
    }
    for (const city of Object.values(state.cities)) {
      if (visible.has(hexToIndex(city.position, state.map)!)) knowledge.lastKnownCities[city.id] = {
        ownerId: city.ownerId, position: { ...city.position }, lastSeenRound: state.round,
        headquartersOf: Object.values(state.players).find(player => player.headquartersCityId === city.id)?.id ?? null,
      };
    }
  }
}

function projectDiplomacy(pair: Diplomacy, playerId: number): Diplomacy {
  const involved = pair.a === playerId || pair.b === playerId;
  return { ...pair, proposal: involved && pair.proposal ? { ...pair.proposal } : null,
    rejectedAtRound: pair.rejectedAtRound[playerId] === undefined ? {} : { [playerId]: pair.rejectedAtRound[playerId] },
    citiesLostSinceWar: involved ? { [playerId]: pair.citiesLostSinceWar[playerId] ?? 0 } : {} };
}

export function observe(state: GameState, playerId: number, content: Content = state.setup.expansionVersion === 1 ? EXPANSION_CONTENT : CONTENT): PlayerView {
  const visible = visibleTiles(state, playerId, content);
  const knowledge = JSON.parse(JSON.stringify(state.knowledge[playerId])) as KnowledgeState;
  const territory = territoryOwners(state);
  const copyUnit = (unit: MapUnit): MapUnit => ({ ...JSON.parse(JSON.stringify(unit)),
    wildHome: unit.ownerId === playerId ? unit.wildHome && { ...unit.wildHome } : null });
  return {
    ...(state.expansion ? { expansion: { version: 1 as const, world: observeWorld(state, playerId, visible), civilization: observeCivilization(state, playerId, visible, { ...CIVILIZATION_CONTENT, world: content }), leaders: observeLeaders(state, playerId),
      ...(state.expansion.improvements ? { improvements: observeImprovements(state, playerId, visible) } : {}),
      ...(state.expansion.discoveries ? { discoveries: [...(state.expansion.discoveries[playerId] ?? [])] } : {}),
      ...(state.expansion.policies ? { policies: observePolicies(state, playerId) } : {}) } } : {}),
    ...(state.setup.eraProgression ? { eraProgression: state.setup.eraProgression } : {}),
    ...(state.setup.gameplayVersion ? { gameplayVersion: state.setup.gameplayVersion } : {}),
    playerId, seed: state.setup.seed, round: state.round, activePlayerId: state.activePlayerId, commandSeq: state.commandSeq,
    map: { width: state.map.width, height: state.map.height,
      tiles: state.map.tiles.map((biome, i) => visible.has(i) ? biome : knowledge.rememberedTiles[i]?.biomeId ?? null) },
    territoryOwnerIds: territory.map((ids, i) => visible.has(i) ? [...ids] : knowledge.rememberedTiles[i]?.territoryOwnerIds?.slice() ?? null),
    combat: {
      units: Object.fromEntries(Object.values(state.units).filter(isMapUnit).filter(unit => visible.has(hexToIndex(unit.position, state.map)!))
        .map(unit => [unit.id, { typeResearch: unit.ownerId !== null && state.players[unit.ownerId].research.unlockedIds.includes('typeResearch') }])),
      cities: Object.fromEntries(Object.values(state.cities).filter(city => visible.has(hexToIndex(city.position, state.map)!))
        .map(city => [city.id, { hp: city.hp, counterAttack: cityCounterAttack(city.ownerId === null ? undefined : state.players[city.ownerId], content) }])),
    },
    visibleTileIds: [...visible], knowledge, diplomacy: state.diplomacy.map(pair => projectDiplomacy(pair, playerId)),
    outcome: state.outcome && JSON.parse(JSON.stringify(state.outcome)), roundLimit: state.setup.roundLimit ?? 100,
    civilizations: Object.values(state.players).map(player => ({ id: player.id, eliminated: player.eliminated,
      ...(player.leaderId === undefined ? {} : { leaderId: player.leaderId }) })),
    units: Object.values(state.units).filter(isMapUnit).filter(unit => visible.has(hexToIndex(unit.position, state.map)!)).map(copyUnit),
    recoveringUnits: Object.values(state.units).filter(unit => unit.location === 'recovering' && unit.ownerId === playerId).map(unit => JSON.parse(JSON.stringify(unit))),
    cities: Object.values(state.cities).filter(city => visible.has(hexToIndex(city.position, state.map)!))
      .map(city => ({ id: city.id, ownerId: city.ownerId, position: { ...city.position }, headquartersOf: Object.values(state.players).find(player => player.headquartersCityId === city.id)?.id ?? null })),
    economy: { player: JSON.parse(JSON.stringify(state.players[playerId])),
      cities: Object.values(state.cities).filter(city => city.ownerId === playerId).map(city => ({
        ...JSON.parse(JSON.stringify(city)), yields: cityYield(state, city, content), availableTileIds: workCandidates(state, city, content),
      })) },
  };
}

export function projectEvents(before: GameState, after: GameState, events: readonly GameEvent[],
  playerId: number, content: Content = before.setup.expansionVersion === 1 ? EXPANSION_CONTENT : CONTENT): VisibleEvent[] {
  const visible = new Set([...visibleTiles(before, playerId, content), ...visibleTiles(after, playerId, content)]);
  const projected: VisibleEvent[] = [];
  for (const event of events) {
    if (event.payload.type === 'DiplomacyChanged') {
      projected.push({ seq: event.seq, payload: { type: 'DiplomacyChanged', relation: projectDiplomacy(event.payload.relation, playerId) } });
      continue;
    }
    if ('playerId' in event.payload && !('public' in event.payload && event.payload.public) && event.payload.playerId !== playerId) continue;
    if ((event.payload.type === 'AllianceChanged' || event.payload.type === 'TradeChanged') && !event.payload.public && !event.payload.playerIds.includes(playerId)) continue;
    if (event.payload.type === 'BattleResolved' && !event.payload.positions.every(position => visible.has(hexToIndex(position, before.map)!))) continue;
    if (event.payload.type.startsWith('World') && 'position' in event.payload && !visible.has(hexToIndex(event.payload.position, before.map)!)) continue;
    if (event.payload.type === 'WildSpawned' && !visible.has(hexToIndex(event.payload.position, before.map)!)) continue;
    if (event.payload.type !== 'Moved') {
      projected.push({ seq: event.seq, payload: JSON.parse(JSON.stringify(event.payload)) });
      continue;
    }
    const unit = before.units[event.payload.unitId] ?? after.units[event.payload.unitId];
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
