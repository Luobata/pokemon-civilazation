import { clonePlain } from './clone.ts';
import { observeOpening, rememberOpening } from './opening.ts';
import { featureVision, viewFeatures } from './terrain.ts';
import { observeLandmarks } from './landmarks.ts';
import { observeGymCircuit } from './gym-circuit.ts';
import { observeRivals } from './rivals.ts';
import { observeGoldSinks } from './gold-sinks.ts';
import { observeContestSeasons } from './contest-seasons.ts';
import { observeRaids } from './raids.ts';
import { observeWildEncounters } from './wild-encounters.ts';
import { observeCityProjects } from './city-projects.ts';
import { observeLegendRace, withLegendRace } from './legend-race.ts';
import { observeVictoryWatch } from './victory-watch.ts';
import { observeResearchTasks } from './research-tasks.ts';
import { observeCityNetwork } from './city-network.ts';
import { observeLegends } from './legends.ts';
import { observeEraHonors } from './era-honors.ts';
import { observePromotions } from './promotions.ts';
import { observeDistricts, rememberDistricts } from './districts.ts';
import { observeFaith } from './faith-legends.ts';
import { observeContests } from './contests.ts';
import { observeRareBerries } from './rare-berries.ts';
import { observeBonds } from './bonds.ts';
import { observeEraAbilities } from './era-abilities.ts';
import { observeEssences } from './essences.ts';
import { observePolicies, playerPolicyEffects } from './policies.ts';
import { observeImprovements, usesImprovementsV23 } from './improvements.ts';
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import { observeWorld, worldVisionSources } from './world-systems.ts';
import { observeCivilization } from './civilization-systems.ts';
import { leaderVisionBonus, observeLeaders } from './leader-systems.ts';
import { isMapUnit } from './model.ts';
import { cityCounterAttack, cityYield, workCandidates, workRadius } from './city.ts';
import { leaderEffects } from '../content/leaders.ts';
import { unitDefinition, contentFor } from '../content/units.ts';
import type { Content, UnitIdentity } from '../content/units.ts';
import { hexDistance, hexToIndex } from './hex.ts';
import type { GameState, PlayerView, KnowledgeState, MapUnit, RecoveringUnit, GameEvent, VisibleEvent, Diplomacy } from './model.ts';

export function unitIdentity(unit: UnitIdentity): UnitIdentity {
  return unit.kind === 'pokemon' ? { kind: 'pokemon', speciesId: unit.speciesId, ...(unit.uniqueLeader ? { uniqueLeader: unit.uniqueLeader } : {}) }
    : { kind: 'logistics', role: unit.role };
}
export function emptyKnowledge(): KnowledgeState {
  return { exploredTileIds: [], rememberedTiles: {}, lastKnownUnits: {}, lastKnownCities: {} };
}
export function visibleTiles(state: GameState, playerId: number, content: Content = contentFor(state.setup)): Set<number> {
  const map = state.map, width = map.width, height = map.height, wrap = Boolean(map.wrap);
  const sources: { position: { q: number; r: number }; radius: number }[] = [];
  const cityBonus = 2 + leaderEffects(state.players[playerId].leaderId).cityVision + playerPolicyEffects(state, playerId).visionBonus;
  for (const city of Object.values(state.cities)) {
    if (city.ownerId === playerId) sources.push({ position: city.position, radius: cityBonus + leaderVisionBonus(state, playerId, city.id) });
  }
  const worldSources = worldVisionSources(state, playerId);
  for (let i = 0; i < worldSources.length; i++) sources.push(worldSources[i]);
  const sanctuaries = state.expansion?.civilization?.sanctuaries;
  if (sanctuaries) {
    for (let i = 0; i < sanctuaries.length; i++) if (sanctuaries[i].ownerId === playerId) sources.push({ position: sanctuaries[i].position, radius: 2 });
  }
  for (const unit of Object.values(state.units)) {
    if (!isMapUnit(unit) || unit.ownerId !== playerId) continue;
    const index = hexToIndex(unit.position, map)!;
    sources.push({ position: unit.position,
      radius: unitDefinition(unit, content).vision + (map.tiles[index] === 'mountain' ? 1 : 0) + featureVision(map, index) });
  }
  const visible = new Set<number>();
  for (let s = 0; s < sources.length; s++) {
    const { position, radius } = sources[s];
    if (width > radius * 2) {
      const rMin = Math.max(0, position.r - radius), rMax = Math.min(height - 1, position.r + radius);
      for (let r = rMin; r <= rMax; r++) {
        const dr = r - position.r;
        const dqMin = Math.max(-radius, -dr - radius), dqMax = Math.min(radius, -dr + radius);
        const halfRow = Math.floor(r / 2), rowBase = r * width;
        for (let dq = dqMin; dq <= dqMax; dq++) {
          let col = position.q + dq + halfRow;
          if (wrap) col = ((col % width) + width) % width;
          else if (col < 0 || col >= width) continue;
          visible.add(rowBase + col);
        }
      }
    } else {
      for (let r = position.r - radius; r <= position.r + radius; r++) {
        for (let q = position.q - radius; q <= position.q + radius; q++) {
          if (hexDistance(position, { q, r }, map) > radius) continue;
          const index = hexToIndex({ q, r }, map);
          if (index !== null) visible.add(index);
        }
      }
    }
  }
  return new Set([...visible].sort((a, b) => a - b));
}

// D39: territory is the union of civilization city radii, not exclusive worked-tile ownership.
export function territoryOwners(state: GameState): number[][] {
  const map = state.map, width = map.width, height = map.height, wrap = Boolean(map.wrap);
  const len = map.tiles.length;
  const owners: number[][] = new Array(len);
  for (let i = 0; i < len; i++) owners[i] = [];
  for (const city of Object.values(state.cities)) {
    if (city.ownerId === null) continue;
    const ownerId = city.ownerId, radius = workRadius(city), pos = city.position;
    if (width > radius * 2) {
      const rMin = Math.max(0, pos.r - radius), rMax = Math.min(height - 1, pos.r + radius);
      for (let r = rMin; r <= rMax; r++) {
        const dr = r - pos.r;
        const dqMin = Math.max(-radius, -dr - radius), dqMax = Math.min(radius, -dr + radius);
        const halfRow = Math.floor(r / 2), rowBase = r * width;
        for (let dq = dqMin; dq <= dqMax; dq++) {
          let col = pos.q + dq + halfRow;
          if (wrap) col = ((col % width) + width) % width;
          else if (col < 0 || col >= width) continue;
          const list = owners[rowBase + col];
          if (!list.includes(ownerId)) list.push(ownerId);
        }
      }
    } else {
      for (let q = pos.q - radius; q <= pos.q + radius; q++) for (let r = pos.r - radius; r <= pos.r + radius; r++) {
        if (hexDistance(pos, { q, r }, map) > radius) continue;
        const index = hexToIndex({ q, r }, map);
        if (index !== null && !owners[index].includes(ownerId)) owners[index].push(ownerId);
      }
    }
  }
  for (let i = 0; i < len; i++) if (owners[i].length > 1) owners[i].sort((a, b) => a - b);
  return owners;
}

// Called only on the new authoritative state, never as a side effect of observe.
export function refreshKnowledge(state: GameState, content: Content = contentFor(state.setup)): void {
  const territory = territoryOwners(state);
  const mapUnits = Object.values(state.units).filter(isMapUnit);
  const cities = Object.values(state.cities);
  const hqOwnerByCity = new Map<number, number>();
  for (const player of Object.values(state.players)) hqOwnerByCity.set(player.headquartersCityId, player.id);
  const remember = usesImprovementsV23(state) ? state.expansion?.improvements?.tiles : undefined;
  for (const playerId of state.turnOrder) {
    const visible = visibleTiles(state, playerId, content);
    const knowledge = state.knowledge[playerId];
    rememberDistricts(state, playerId, visible);
    rememberOpening(state, playerId, visible);
    knowledge.exploredTileIds = [...new Set([...knowledge.exploredTileIds, ...visible])].sort((a, b) => a - b);
    for (const tile of visible) knowledge.rememberedTiles[tile] = { biomeId: state.map.tiles[tile], territoryOwnerIds: [...territory[tile]],
      ...(remember?.[tile] ? { improvement: clonePlain(remember[tile]) } : {}) };
    for (const [id, known] of Object.entries(knowledge.lastKnownUnits)) {
      const tile = hexToIndex(known.position, state.map)!;
      const current = state.units[Number(id)];
      if (visible.has(tile) && (!current || !isMapUnit(current) || hexToIndex(current.position, state.map) !== tile)) {
        delete knowledge.lastKnownUnits[Number(id)];
      }
    }
    for (const unit of mapUnits) {
      if (visible.has(hexToIndex(unit.position, state.map)!)) knowledge.lastKnownUnits[unit.id] = {
        ...unitIdentity(unit), ownerId: unit.ownerId, position: { ...unit.position }, lastSeenRound: state.round,
      };
    }
    for (const city of cities) {
      if (visible.has(hexToIndex(city.position, state.map)!)) knowledge.lastKnownCities[city.id] = {
        ownerId: city.ownerId, position: { ...city.position }, lastSeenRound: state.round,
        headquartersOf: hqOwnerByCity.get(city.id) ?? null,
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

/**
 * Lightweight read-only projection for internal `Move` pathfinding, movement-budget, and ZoC checks
 * inside `step()`. Exposes the exact fog-filtered map, visible units/cities, diplomacy, player research,
 * lastKnownCities, and promotion traits that `reachablePaths`, `movementBudget`, and `zocTiles` read —
 * without cloning `knowledge` or running all 25 expansion sub-observers.
 */
export function observeForMove(state: GameState, playerId: number, content: Content = contentFor(state.setup)): PlayerView {
  const visible = visibleTiles(state, playerId, content);
  const knowledge = state.knowledge[playerId];
  const map = state.map;
  const tiles = map.tiles.map((biome, i) => visible.has(i) ? biome : knowledge.rememberedTiles[i]?.biomeId ?? null);
  const units: MapUnit[] = [];
  for (const unit of Object.values(state.units)) {
    if (isMapUnit(unit) && visible.has(hexToIndex(unit.position, map)!)) units.push(unit);
  }
  const cities: PlayerView['cities'] = [];
  for (const city of Object.values(state.cities)) {
    if (visible.has(hexToIndex(city.position, map)!)) {
      cities.push({ id: city.id, ownerId: city.ownerId, position: city.position, headquartersOf: null });
    }
  }
  return {
    ...(state.expansion?.promotions ? { expansion: { promotions: state.expansion.promotions } as unknown as NonNullable<PlayerView['expansion']> } : {}),
    ...(state.setup.eraProgression ? { eraProgression: state.setup.eraProgression } : {}),
    ...(state.setup.gameplayVersion ? { gameplayVersion: state.setup.gameplayVersion } : {}),
    playerId, seed: state.setup.seed, round: state.round, activePlayerId: state.activePlayerId, commandSeq: state.commandSeq,
    map: { width: map.width, height: map.height, ...(map.wrap ? { wrap: true } : {}), tiles,
      ...(map.features ? { features: viewFeatures(map, knowledge.exploredTileIds) } : {}) },
    territoryOwnerIds: [],
    combat: { units: {}, cities: {} },
    visibleTileIds: [...visible], knowledge, diplomacy: state.diplomacy,
    outcome: state.outcome, roundLimit: state.setup.roundLimit ?? 100,
    civilizations: [],
    units, recoveringUnits: [], cities,
    economy: { player: state.players[playerId], cities: [] },
  };
}

export function observe(state: GameState, playerId: number, content: Content = contentFor(state.setup)): PlayerView {
  const visible = visibleTiles(state, playerId, content);
  const knowledge = clonePlain(state.knowledge[playerId]);
  const territory = territoryOwners(state);
  const hqOwnerByCity = new Map<number, number>();
  for (const player of Object.values(state.players)) hqOwnerByCity.set(player.headquartersCityId, player.id);
  const copyUnit = (unit: MapUnit): MapUnit => ({ ...clonePlain(unit),
    wildHome: unit.ownerId === playerId ? unit.wildHome && { ...unit.wildHome } : null });
  return {
    ...(state.expansion ? { expansion: { version: 1 as const, world: observeWorld(state, playerId, visible), civilization: observeCivilization(state, playerId, visible, { ...CIVILIZATION_CONTENT, world: content }), leaders: observeLeaders(state, playerId),
      ...(state.expansion.improvements ? { improvements: observeImprovements(state, playerId, visible) } : {}),
      ...(state.expansion.discoveries ? { discoveries: [...(state.expansion.discoveries[playerId] ?? [])] } : {}),
      ...(state.expansion.policies ? { policies: observePolicies(state, playerId) } : {}),
      ...(state.expansion.essences ? { essences: observeEssences(state, playerId) } : {}),
      ...(state.expansion.bonds ? { bonds: observeBonds(state, playerId) } : {}),
      ...(state.expansion.districts ? { districts: observeDistricts(state, playerId, visible) } : {}),
      ...(state.expansion.eraHonors ? { eraHonors: observeEraHonors(state, playerId) } : {}),
      // v26 D: the legend race rides on the legend view (absent before v26).
      ...(state.expansion.legends ? { legends: withLegendRace(observeLegends(state, playerId, visible, content), observeLegendRace(state, playerId, content)) } : {}),
      ...(state.expansion.victoryWatch ? { victoryWatch: observeVictoryWatch(state, content) } : {}),
      ...(state.expansion.cityNetwork ? { cityNetwork: observeCityNetwork(state, playerId) } : {}),
      ...(state.expansion.opening ? { opening: observeOpening(state, playerId, visible) } : {}),
      ...(state.expansion.landmarks ? { landmarks: observeLandmarks(state, playerId) } : {}),
      ...(state.expansion.gymCircuit ? { gymCircuit: observeGymCircuit(state, playerId) } : {}),
      ...(state.expansion.rivals ? { rivals: observeRivals(state, playerId, visible, content) } : {}),
      ...(state.expansion.researchTasks ? { researchTasks: observeResearchTasks(state, playerId) } : {}),
      // v26 D: present only when the late-game lanes create their ledgers.
      ...(state.expansion.goldSinks ? { goldSinks: observeGoldSinks(state, playerId) } : {}),
      ...(state.expansion.contestSeasons ? { contestSeasons: observeContestSeasons(state, playerId, content) } : {}),
      ...(state.expansion.raids ? { raids: observeRaids(state, playerId, content) } : {}),
      ...(state.expansion.wildEncounters ? { wildEncounters: observeWildEncounters(state, playerId) } : {}),
      cityProjects: observeCityProjects(state, playerId),
      ...(state.expansion.promotions ? { promotions: observePromotions(state, playerId, visible, hex => hexToIndex(hex, state.map)) } : {}),
      ...(state.expansion.faith ? { faith: observeFaith(state, playerId, content) } : {}),
      ...(state.expansion.contests ? { contests: observeContests(state, playerId, content) } : {}),
      ...(state.expansion.rareBerries ? { rareBerries: observeRareBerries(state, playerId, visible) } : {}),
      ...(state.expansion.eraAbilities ? { eraAbilities: observeEraAbilities(state, playerId, visible, hex => hexToIndex(hex, state.map)) } : {}) } } : {}),
    ...(state.setup.eraProgression ? { eraProgression: state.setup.eraProgression } : {}),
    ...(state.setup.gameplayVersion ? { gameplayVersion: state.setup.gameplayVersion } : {}),
    ...(content.regionalDex ? { regionalDex: [...content.regionalDex.speciesIds] } : {}),
    playerId, seed: state.setup.seed, round: state.round, activePlayerId: state.activePlayerId, commandSeq: state.commandSeq,
    map: { width: state.map.width, height: state.map.height, ...(state.map.wrap ? { wrap: true } : {}),
      tiles: state.map.tiles.map((biome, i) => visible.has(i) ? biome : knowledge.rememberedTiles[i]?.biomeId ?? null),
      ...(state.map.features ? { features: viewFeatures(state.map, knowledge.exploredTileIds) } : {}) },
    territoryOwnerIds: territory.map((ids, i) => visible.has(i) ? [...ids] : knowledge.rememberedTiles[i]?.territoryOwnerIds?.slice() ?? null),
    combat: {
      units: Object.fromEntries(Object.values(state.units).filter(isMapUnit).filter(unit => visible.has(hexToIndex(unit.position, state.map)!))
        .map(unit => [unit.id, { typeResearch: unit.ownerId !== null && state.players[unit.ownerId].research.unlockedIds.includes('typeResearch') }])),
      cities: Object.fromEntries(Object.values(state.cities).filter(city => visible.has(hexToIndex(city.position, state.map)!))
        .map(city => [city.id, { hp: city.hp, counterAttack: cityCounterAttack(city.ownerId === null ? undefined : state.players[city.ownerId], content) }])),
    },
    visibleTileIds: [...visible], knowledge, diplomacy: state.diplomacy.map(pair => projectDiplomacy(pair, playerId)),
    outcome: state.outcome && clonePlain(state.outcome), roundLimit: state.setup.roundLimit ?? 100,
    civilizations: Object.values(state.players).map(player => ({ id: player.id, eliminated: player.eliminated,
      ...(player.leaderId === undefined ? {} : { leaderId: player.leaderId }) })),
    units: Object.values(state.units).filter(isMapUnit).filter(unit => visible.has(hexToIndex(unit.position, state.map)!)).map(copyUnit),
    recoveringUnits: Object.values(state.units).filter((unit): unit is RecoveringUnit => unit.location === 'recovering' && unit.ownerId === playerId).map(clonePlain),
    cities: Object.values(state.cities).filter(city => visible.has(hexToIndex(city.position, state.map)!))
      .map(city => ({ id: city.id, ownerId: city.ownerId, position: { ...city.position }, headquartersOf: hqOwnerByCity.get(city.id) ?? null })),
    economy: { player: clonePlain(state.players[playerId]),
      cities: Object.values(state.cities).filter(city => city.ownerId === playerId).map(city => ({
        ...clonePlain(city), yields: cityYield(state, city, content), availableTileIds: workCandidates(state, city, content),
      })) },
  };
}

export function projectEvents(before: GameState, after: GameState, events: readonly GameEvent[],
  playerId: number, content: Content = contentFor(before.setup)): VisibleEvent[] {
  const visible = new Set([...visibleTiles(before, playerId, content), ...visibleTiles(after, playerId, content)]);
  const projected: VisibleEvent[] = [];
  for (const event of events) {
    if (event.payload.type === 'DiplomacyChanged') {
      projected.push({ seq: event.seq, payload: { type: 'DiplomacyChanged', relation: projectDiplomacy(event.payload.relation, playerId) } });
      continue;
    }
    // v23: pillage / repair reach the actor, the territory owner and anyone who sees the tile.
    if (event.payload.type === 'ImprovementPillaged' || event.payload.type === 'ImprovementRepaired') {
      const payload = event.payload, involved = payload.playerId === playerId || (payload.type === 'ImprovementPillaged' && payload.ownerId === playerId);
      if (involved || visible.has(payload.tileIndex)) projected.push({ seq: event.seq, payload: clonePlain(payload) });
      continue;
    }
    if ('playerId' in event.payload && !('public' in event.payload && event.payload.public) && event.payload.playerId !== playerId) continue;
    if ((event.payload.type === 'AllianceChanged' || event.payload.type === 'TradeChanged') && !event.payload.public && !event.payload.playerIds.includes(playerId)) continue;
    if (event.payload.type === 'BattleResolved' && !event.payload.positions.every(position => visible.has(hexToIndex(position, before.map)!))) continue;
    if (event.payload.type.startsWith('World') && 'position' in event.payload && !visible.has(hexToIndex(event.payload.position, before.map)!)) continue;
    if (event.payload.type === 'WildSpawned' && !visible.has(hexToIndex(event.payload.position, before.map)!)) continue;
    if (event.payload.type !== 'Moved') {
      projected.push({ seq: event.seq, payload: clonePlain(event.payload) });
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
