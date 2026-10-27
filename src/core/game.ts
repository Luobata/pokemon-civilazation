import { CONTENT, STARTER_IDS } from '../content/units.ts';
import type { Content, StarterId } from '../content/units.ts';
import { generateMap } from './map.ts';
import { indexToHex } from './hex.ts';
import { randomBelow } from './rng.ts';
import { initialUnitPosition } from './movement.ts';
import { emptyKnowledge, refreshKnowledge } from './vision.ts';
import type { GameSetup, GameState } from './model.ts';

export function createGame(setup: GameSetup, content: Content = CONTENT): GameState {
  if (setup.players.length < 2 || setup.players.length > 4
    || new Set(setup.players.map(player => player.id)).size !== setup.players.length
    || setup.players.some(player => !Number.isSafeInteger(player.id) || player.id < 0)
    || setup.players.filter(player => player.controller === 'human').length !== 1
    || setup.players.some(player => player.controller === 'human' && !STARTER_IDS.includes(player.starterId))) {
    throw new Error('Expected 2–4 distinct players and one human with a chosen starter.');
  }
  const generated = generateMap({ ...setup, playerCount: setup.players.length });
  const state: GameState = {
    schemaVersion: 1, rulesVersion: 'm1-v1', contentVersion: content.version,
    setup: JSON.parse(JSON.stringify(setup)) as GameSetup,
    map: { width: generated.width, height: generated.height, tiles: generated.tiles },
    rng: generated.rng, nextEntityId: 1, commandSeq: 0, round: 1,
    activePlayerId: setup.players[0].id, turnOrder: setup.players.map(player => player.id),
    players: {}, units: {}, cities: {}, knowledge: {},
  };
  // Reserve all city/settler tiles before placing starters in any outer ring.
  for (const [i, player] of setup.players.entries()) {
    const starterId: StarterId = player.controller === 'human' ? player.starterId : STARTER_IDS[randomBelow(state.rng, STARTER_IDS.length)];
    state.players[player.id] = { ...player, starterId };
    state.knowledge[player.id] = emptyKnowledge();
    const position = indexToHex(generated.starts[i].tileIndex, state.map);
    const cityId = state.nextEntityId++;
    state.cities[cityId] = { id: cityId, ownerId: player.id, position: { ...position } };
    const settlerId = state.nextEntityId++;
    state.units[settlerId] = { kind: 'logistics', role: 'settler', id: settlerId, ownerId: player.id, position, actionLeft: 1 };
  }
  for (const player of setup.players) {
    const city = Object.values(state.cities).find(city => city.ownerId === player.id)!;
    const unit = { kind: 'pokemon' as const, speciesId: state.players[player.id].starterId };
    const position = initialUnitPosition(state, city.position, unit, content);
    const id = state.nextEntityId++;
    state.units[id] = { ...unit, id, ownerId: player.id, position, actionLeft: 1 };
  }
  refreshKnowledge(state, content);
  return state;
}
