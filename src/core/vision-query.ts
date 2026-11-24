// Visibility, territory ownership, and unit identity queries (decoupled from the full `observe()` aggregator).
import { leaderEffects } from '../content/leaders.ts';
import { contentFor, unitDefinition } from '../content/units.ts';
import type { Content, UnitIdentity } from '../content/units.ts';
import { workRadius } from './city-query.ts';
import { hexDistance, hexToIndex } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { GameState, KnowledgeState } from './model.ts';
import { playerPolicyEffects } from './policies.ts';
import { leaderVisionBonus } from './state-queries.ts';
import { featureVision } from './terrain.ts';
import { worldVisionSources } from './world-model.ts';

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
