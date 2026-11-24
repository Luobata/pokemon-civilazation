import { expect, test } from 'vitest';
import { contentFor, GAME_CONTENT } from '../../src/content/units.ts';
import { FAITH_RULES } from '../../src/content/faith-legends.ts';
import { createGame } from '../../src/core/game.ts';
import { createCity } from '../../src/core/city.ts';
import { step } from '../../src/core/step.ts';
import { resolveEconomy } from '../../src/core/economy.ts';
import { resolveFaithRound, faithCities } from '../../src/core/faith-legends.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { hexDistance, hexToIndex, neighbors } from '../../src/core/hex.ts';
import { isMapUnit } from '../../src/core/model.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';

/** Gameplay v25 rule fixes from docs/design/balance/gate-v24-ai.md ("needs a rule change"); v24 keeps the old behaviour. */
const setup = (gameplayVersion: 27): GameSetup => ({ seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1',
  gameplayVersion, players: [
    { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'misty' },
    { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'lance' },
  ] });
const act = (state: GameState, actorId: number, action: Command['action']) => step(state, { actorId, expectedSeq: state.commandSeq, action });
/** The capital with every neighbouring tile (and the capital's) turned into plain land, no units around. */
function inlandCapital(state: GameState) {
  const city = state.cities[state.players[0].headquartersCityId];
  for (const hex of [city.position, ...neighbors(city.position, state.map)]) {
    const index = hexToIndex(hex, state.map)!;
    state.map.tiles[index] = 'grassland';
    if (state.map.features) for (const key of Object.keys(state.map.features) as (keyof typeof state.map.features)[]) {
      const list = state.map.features[key];
      if (Array.isArray(list) && typeof list[0] === 'number') state.map.features[key] = (list as number[]).filter(tile => tile !== index) as never;
    }
  }
  for (const unit of Object.values(state.units)) if (isMapUnit(unit) && hexDistance(unit.position, city.position, state.map) <= 1) delete state.units[unit.id];
  return city;
}

test('fix 1: queueing a water-only species in an inland city is refused', () => {
  const state = createGame(setup(27)), city = inlandCapital(state), player = state.players[0];
  player.registeredSpeciesIds.push('magikarp'); player.research.unlockedIds.push('seafaring');
  const result = act(state, 0, { type: 'SetProductionQueue', cityId: city.id, orders: [{ item: { kind: 'pokemon', defId: 'magikarp' } }] });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe('invalid-production');
  expect(act(state, 0, { type: 'SetProductionQueue', cityId: city.id, orders: [{ item: { kind: 'pokemon', defId: 'bulbasaur' } }] }).ok).toBe(true);
});

test('fix 2: new units avoid the tiles beside a striking wild Pokémon when another tile is free', () => {
  const state = createGame(setup(27)), city = inlandCapital(state), content = contentFor(state.setup);
  const free = neighbors(city.position, state.map).sort((a, b) => hexToIndex(a, state.map)! - hexToIndex(b, state.map)!);
  const beside = neighbors(free[0], state.map).find(hex => hexDistance(hex, city.position, state.map) === 2)!;
  state.units[900] = createMapUnit({ kind: 'pokemon', speciesId: 'geodude' }, 900, null, beside, content);
  city.queue = []; city.pendingDeployments = [{ enteredAtRound: 1, sourceOrderId: 77, item: { kind: 'pokemon', defId: 'bulbasaur' } }];
  resolveEconomy(state, content);
  const trained = Object.values(state.units).find(unit => unit.ownerId === 0 && unit.kind === 'pokemon' && unit.speciesId === 'bulbasaur' && isMapUnit(unit)
    && hexDistance(unit.position, city.position, state.map) === 1 && unit.id !== 900);
  expect(trained && isMapUnit(trained)).toBe(true);
  const position = (trained as { position: { q: number; r: number } }).position;
  expect(hexDistance(position, beside, state.map)).toBeGreaterThan(1);
});

function faithTable(version: 27): GameState {
  const state = createGame(setup(version));
  const civ = state.expansion!.civilization.players[0];
  civ.lifetimeOfferings = FAITH_RULES.foundLifetime; civ.offeringPoints = FAITH_RULES.foundCost + 100;
  const result = act(state, 0, { type: 'FoundFaith', legend: 'lugia', tenets: ['missionaries', 'shrineGold'] });
  if (!result.ok) throw new Error(result.reason);
  const next = result.state, hq = next.cities[next.players[0].headquartersCityId];
  for (let i = 0; i < 5; i++) next.cities[960 + i] = createCity(960 + i, i < 3 ? 0 : 1, { q: hq.position.q + 2 + i, r: hq.position.r + 4 }, false);
  for (const id of [960, 961, 962, 963]) next.expansion!.faith!.cityFaith[id] = 0;
  // Three neutral cities (left behind by an eliminated civilization) that never followed the faith.
  for (let i = 0; i < 3; i++) { next.cities[970 + i] = createCity(970 + i, 1, { q: hq.position.q + 2 + i, r: hq.position.r + 6 }, false); next.cities[970 + i].ownerId = null; }
  return next;
}
test('fix 3: v27 faith victory counts neutral cities, so an elimination no longer lowers the bar', () => {
  const v27 = faithTable(27);
  expect(faithCities(v27)).toHaveLength(10);
  resolveFaithRound(v27, GAME_CONTENT);
  expect(v27.outcome).toBeNull();
  // Neutral cities that kept following the faith still count for it.
  const following = faithTable(27);
  for (const id of [970, 971, 972]) following.expansion!.faith!.cityFaith[id] = 0;
  resolveFaithRound(following, GAME_CONTENT);
  expect(following.outcome).toMatchObject({ kind: 'faith', winners: [0] });
});
