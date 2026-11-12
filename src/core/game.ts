import { isMapUnit } from './model.ts';
import { gameVersions } from './versions.ts';
import { isEraProgression, isGameplayVersion } from '../content/eras.ts';
import { initializeExpansion } from './expansion.ts';
import { spawnWild } from './wild.ts';
import { CLASSIC_LEADER_IDS, isLeaderId } from '../content/leaders.ts';
import { createMapUnit } from './unit.ts';
import type { TechId } from '../content/economy.ts';
import { assignNewWorkers, createCity } from './city.ts';
import { STARTER_IDS, contentFor } from '../content/units.ts';
import type { Content, StarterId } from '../content/units.ts';
import { generateMap } from './map.ts';
import { generateWorldMap } from './map-v24.ts';
import { indexToHex } from './hex.ts';
import { randomBelow } from './rng.ts';
import { initialUnitPosition } from './movement.ts';
import { emptyKnowledge, refreshKnowledge } from './vision.ts';
import type { GameSetup, GameState } from './model.ts';

export function createGame(setup: GameSetup, content: Content = contentFor(setup)): GameState {
  if (setup.players.some(player => player.leaderId !== undefined && !isLeaderId(player.leaderId))) {
    throw new Error('Unknown leader.');
  }
  if (setup.players.some(player => player.leaderId !== undefined && !(CLASSIC_LEADER_IDS as readonly string[]).includes(player.leaderId))
    && (setup.gameplayVersion ?? 0) < 4) throw new Error('This leader requires gameplay v4.');
  if ((setup.roundLimit !== undefined && ![100, 200, 300].includes(setup.roundLimit))
    || setup.players.length < 2 || setup.players.length > 4
    || new Set(setup.players.map(player => player.id)).size !== setup.players.length
    || setup.players.some(player => !Number.isSafeInteger(player.id) || player.id < 0)
    || (setup.expansionVersion !== undefined && setup.expansionVersion !== 1)
    || (setup.eraProgression !== undefined && (!isEraProgression(setup.eraProgression) || setup.expansionVersion !== 1))
    || (setup.gameplayVersion !== undefined && (!isGameplayVersion(setup.gameplayVersion) || setup.eraProgression === undefined))
    || (setup.multiplayer !== undefined && setup.multiplayer !== true)
    || (!setup.multiplayer && setup.players.filter(player => player.controller === 'human').length > 1)
    || setup.players.some(player => player.controller === 'human' && !STARTER_IDS.includes(player.starterId))) {
    throw new Error('Expected 2–4 distinct players and at most one human with a chosen starter.');
  }
  // v24 (world-v24 §2.1): continents and terrain features come from their own generator.
  const generated = content.terrain ? generateWorldMap({ ...setup, playerCount: setup.players.length, ...(content.world24 ? { landPercent: content.world24.landPercent } : {}) })
    : generateMap({ ...setup, playerCount: setup.players.length, ...(content.wrap ? { wrap: true } : {}) });
  const state: GameState = {
    ...gameVersions(setup), contentVersion: content.version,
    setup: JSON.parse(JSON.stringify(setup)) as GameSetup,
    map: { width: generated.width, height: generated.height, tiles: generated.tiles, ...(generated.wrap ? { wrap: true as const } : {}),
      ...(generated.features ? { features: generated.features } : {}) },
    rng: generated.rng, nextEntityId: 1, commandSeq: 0, round: 1,
    activePlayerId: setup.players[0].id, turnOrder: setup.players.map(player => player.id),
    diplomacy: setup.players.flatMap(a => setup.players.filter(b => a.id < b.id).map(b => ({ a: a.id, b: b.id, status: 'peace' as const, changedAtRound: 1, declaredBy: null, cooldownUntilRound: 0, rejectedAtRound: {}, citiesLostSinceWar: {}, proposal: null }))),
    outcome: null, players: {}, units: {}, cities: {}, knowledge: {},
  };
  // Reserve all city/settler tiles before placing starters in any outer ring.
  for (const [i, player] of setup.players.entries()) {
    const starterId: StarterId = player.controller === 'human' ? player.starterId : STARTER_IDS[randomBelow(state.rng, STARTER_IDS.length)];
    const { leaderId, ...playerBase } = player;
    state.players[player.id] = { ...playerBase, ...(leaderId === undefined ? {} : { leaderId }), starterId, gold: 50, headquartersCityId: state.nextEntityId, knockdownCount: 0, ballInventory: { pokeBall: 0, greatBall: 0 },
      personality: player.controller === 'ai' ? player.personality ?? (['expansion', 'aggressive', 'conservative'] as const)[i % 3] : 'conservative',
      lastSettlerProducedRound: 1, eliminated: false, frozenScore: null, registeredSpeciesIds: [starterId], research: { techId: null, reserve: 0, unlockedIds: [],
        progressByTech: Object.fromEntries(Object.keys(content.techs).map(id => [id, 0])) as Record<TechId, number>, ...(content.techTree ? { tree: true as const } : {}) } };
    state.knowledge[player.id] = emptyKnowledge();
    const position = indexToHex(generated.starts[i].tileIndex, state.map);
    const cityId = state.nextEntityId++;
    state.cities[cityId] = createCity(cityId, player.id, position, true, content);
    const settlerId = state.nextEntityId++;
    state.units[settlerId] = createMapUnit({ kind: 'logistics', role: 'settler' }, settlerId, player.id, position, content, 0, 1);
  }
  for (const player of setup.players) {
    const city = Object.values(state.cities).find(city => city.ownerId === player.id)!;
    // v16: the starting settler stands beside the capital instead of hidden under it.
    if ((setup.gameplayVersion ?? 0) >= 16) {
      const settler = Object.values(state.units).find(unit => unit.ownerId === player.id && unit.kind === 'logistics')!;
      if (isMapUnit(settler)) settler.position = initialUnitPosition(state, city.position, settler, content);
    }
    const unit = { kind: 'pokemon' as const, speciesId: state.players[player.id].starterId };
    const position = initialUnitPosition(state, city.position, unit, content);
    const id = state.nextEntityId++;
    state.units[id] = createMapUnit(unit, id, player.id, position, content, 0, 1);
  }
  for (const city of Object.values(state.cities)) assignNewWorkers(state, city, city.population, content);
  spawnWild(state, true, content);
  if (setup.expansionVersion === 1) initializeExpansion(state, content);
  refreshKnowledge(state, content);
  return state;
}
