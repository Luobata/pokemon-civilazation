import { clonePlain } from './clone.ts';
import { isMapUnit } from './model.ts';
import { gameVersions } from './versions.ts';
import { isEraProgression, isGameplayVersion, LATEST_GAMEPLAY_VERSION } from '../content/eras.ts';
import { initializeExpansion } from './expansion.ts';
import { spawnWild } from './wild.ts';
import { isLeaderId } from '../content/leaders.ts';
import { createMapUnit } from './unit.ts';
import type { TechId } from '../content/economy.ts';
import { assignNewWorkers, createCity } from './city.ts';
import { STARTER_IDS, contentFor } from '../content/units.ts';
import type { Content, StarterId } from '../content/units.ts';
import { generateWorldMap } from './map-v24.ts';
import { indexToHex } from './hex.ts';
import { randomBelow } from './rng.ts';
import { initialUnitPosition } from './movement.ts';
import { emptyKnowledge, refreshKnowledge } from './vision.ts';
import type { GameSetup, GameState } from './model.ts';

export function createGame(rawSetup: GameSetup, content?: Content): GameState {
  if (rawSetup.players.some(player => player.leaderId !== undefined && !isLeaderId(player.leaderId))) {
    throw new Error('Unknown leader.');
  }
  if ((rawSetup.roundLimit !== undefined && ![100, 200, 300].includes(rawSetup.roundLimit))
    || rawSetup.players.length < 2 || rawSetup.players.length > 4
    || new Set(rawSetup.players.map(player => player.id)).size !== rawSetup.players.length
    || rawSetup.players.some(player => !Number.isSafeInteger(player.id) || player.id < 0)
    || (rawSetup.expansionVersion !== undefined && rawSetup.expansionVersion !== 1)
    || (rawSetup.eraProgression !== undefined && !isEraProgression(rawSetup.eraProgression))
    || (rawSetup.gameplayVersion !== undefined && !isGameplayVersion(rawSetup.gameplayVersion))
    || (rawSetup.multiplayer !== undefined && rawSetup.multiplayer !== true)
    || (!rawSetup.multiplayer && rawSetup.players.filter(player => player.controller === 'human').length > 1)
    || rawSetup.players.some(player => player.controller === 'human' && !STARTER_IDS.includes(player.starterId))) {
    throw new Error('Expected 2–4 distinct players and at most one human with a chosen starter.');
  }
  if (rawSetup.dexSeed !== undefined && (!Number.isSafeInteger(rawSetup.dexSeed) || rawSetup.dexSeed < 0)) {
    throw new Error('dexSeed must be a non-negative integer.');
  }
  const setup: GameSetup = {
    ...clonePlain(rawSetup),
    expansionVersion: 1,
    eraProgression: rawSetup.eraProgression ?? 'simple-v1',
    gameplayVersion: LATEST_GAMEPLAY_VERSION,
  };
  const activeContent = content ?? contentFor(setup);
  const generated = generateWorldMap({
    ...setup,
    playerCount: setup.players.length,
    landPercent: activeContent.world24.landPercent,
    ...(activeContent.regionalDex ? { regionalSpeciesIds: activeContent.regionalDex.speciesIds } : {}),
  });
  const state: GameState = {
    ...gameVersions(), contentVersion: activeContent.version,
    setup,
    map: {
      width: generated.width, height: generated.height, tiles: generated.tiles,
      ...(generated.wrap ? { wrap: true as const } : {}),
      ...(generated.features ? { features: generated.features } : {}),
    },
    rng: generated.rng, nextEntityId: 1, commandSeq: 0, round: 1,
    activePlayerId: setup.players[0].id, turnOrder: setup.players.map(player => player.id),
    diplomacy: setup.players.flatMap(a => setup.players.filter(b => a.id < b.id).map(b => ({
      a: a.id, b: b.id, status: 'peace' as const, changedAtRound: 1, declaredBy: null,
      cooldownUntilRound: 0, rejectedAtRound: {}, citiesLostSinceWar: {}, proposal: null,
    }))),
    outcome: null, players: {}, units: {}, cities: {}, knowledge: {},
  };
  for (const [i, player] of setup.players.entries()) {
    const starterId: StarterId = player.controller === 'human' ? player.starterId : STARTER_IDS[randomBelow(state.rng, STARTER_IDS.length)];
    const { leaderId, ...playerBase } = player;
    state.players[player.id] = {
      ...playerBase, ...(leaderId === undefined ? {} : { leaderId }), starterId, gold: 50,
      headquartersCityId: state.nextEntityId, knockdownCount: 0, ballInventory: { pokeBall: 0, greatBall: 0 },
      personality: player.controller === 'ai' ? player.personality ?? (['expansion', 'aggressive', 'conservative'] as const)[i % 3] : 'conservative',
      lastSettlerProducedRound: 1, eliminated: false, frozenScore: null, registeredSpeciesIds: [starterId],
      research: {
        techId: null, reserve: 0, unlockedIds: [],
        progressByTech: Object.fromEntries(Object.keys(activeContent.techs).map(id => [id, 0])) as Record<TechId, number>,
        tree: true as const,
      },
    };
    state.knowledge[player.id] = emptyKnowledge();
    const position = indexToHex(generated.starts[i].tileIndex, state.map);
    const cityId = state.nextEntityId++;
    state.cities[cityId] = createCity(cityId, player.id, position, true, activeContent);
    const settlerId = state.nextEntityId++;
    state.units[settlerId] = createMapUnit({ kind: 'logistics', role: 'settler' }, settlerId, player.id, position, activeContent, 0, 1);
  }
  for (const player of setup.players) {
    const city = Object.values(state.cities).find(city => city.ownerId === player.id)!;
    const settler = Object.values(state.units).find(unit => unit.ownerId === player.id && unit.kind === 'logistics')!;
    if (isMapUnit(settler)) settler.position = initialUnitPosition(state, city.position, settler, activeContent);
    const unit = { kind: 'pokemon' as const, speciesId: state.players[player.id].starterId };
    const position = initialUnitPosition(state, city.position, unit, activeContent);
    const id = state.nextEntityId++;
    state.units[id] = createMapUnit(unit, id, player.id, position, activeContent, 0, 1);
  }
  for (const city of Object.values(state.cities)) assignNewWorkers(state, city, city.population, activeContent);
  spawnWild(state, true, activeContent);
  initializeExpansion(state, activeContent);
  refreshKnowledge(state, activeContent);
  return state;
}
