import { expect, test } from 'vitest';
import { GameSession, replay } from '../../src/app/session.ts';
import { EXPANSION_CONTENT } from '../../src/content/units.ts';
import { BIOME_ESSENCE, ESSENCE_IDS, ESSENCE_RULES, TYPE_ESSENCE } from '../../src/content/essences.ts';
import type { LeaderId } from '../../src/content/leaders.ts';
import { createGame } from '../../src/core/game.ts';
import { cityYield, productionCost } from '../../src/core/city.ts';
import { resolveEconomy } from '../../src/core/economy.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { previewAttack, previewCapture } from '../../src/core/preview.ts';
import { resolveAttack } from '../../src/core/combat.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { homeDefenseMultiplier, resolveEssenceRound } from '../../src/core/essences.ts';
import { parseAuditAction } from '../../src/audit/commands.ts';
import type { GameSetup, GameState } from '../../src/core/model.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';
import type { TypeId } from '../../src/content/species.ts';

function setup(gameplayVersion?: GameplayVersion, leaderId: LeaderId = 'oak'): GameSetup {
  return { seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1',
    ...(gameplayVersion ? { gameplayVersion } : {}), players: [
      { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId },
      { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'lance' },
    ] };
}
const act = (state: GameState, action: Parameters<typeof step>[1]['action']) => step(state, { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action });

test('every type and every biome maps to exactly one essence', () => {
  const types: TypeId[] = ['grass', 'fire', 'water', 'electric', 'normal', 'fighting', 'flying', 'rock', 'psychic', 'ghost', 'dragon', 'ground', 'poison', 'bug', 'ice', 'steel', 'dark', 'fairy'];
  for (const type of types) expect(ESSENCE_IDS).toContain(TYPE_ESSENCE[type]);
  expect(new Set(Object.values(BIOME_ESSENCE)).size).toBe(7);
});

test('essences exist only in gameplay v4 and accrue from worked terrain each round', () => {
  expect(createGame(setup(3)).expansion).not.toHaveProperty('essences');
  const state = createGame(setup(4));
  expect(state.expansion!.essences!.stock[0]).toEqual(Object.fromEntries(ESSENCE_IDS.map(id => [id, 0])));
  const view = observe(state, 0).expansion!.essences!;
  const city = state.cities[state.players[0].headquartersCityId];
  const expected = 1 + city.workedTileIds.length;
  expect(Object.values(view.perRound).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(expected);
  resolveEssenceRound(state);
  expect(state.expansion!.essences!.stock[0]).toEqual(view.perRound);
  expect(observe(state, 1).expansion!.essences!.stock).toEqual(state.expansion!.essences!.stock[1]);
});

test('gyms cost essence and gold, one per city, and boost matching training', () => {
  const state = createGame(setup(4));
  const cityId = state.players[0].headquartersCityId;
  expect(parseAuditAction({ type: 'BuildGym', cityId, essence: 'sylvan' })).toEqual({ type: 'BuildGym', cityId, essence: 'sylvan' });
  expect(act(state, { type: 'BuildGym', cityId, essence: 'sylvan' }).ok).toBe(false);
  state.expansion!.essences!.stock[0].sylvan = ESSENCE_RULES.gymEssenceCost + ESSENCE_RULES.trainingSpend;
  state.players[0].gold = ESSENCE_RULES.gymGoldCost;
  const built = act(state, { type: 'BuildGym', cityId, essence: 'sylvan' });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  const next = built.state;
  expect(next.expansion!.essences!.gyms[cityId]).toBe('sylvan');
  expect(next.players[0].gold).toBe(0);
  expect(act(next, { type: 'BuildGym', cityId, essence: 'earth' }).ok).toBe(false);
  // Bulbasaur (grass) uses sylvan: training spends 2 essence for +4 progress with the gym.
  const city = next.cities[cityId];
  city.queue = [{ id: 900, progress: 0, item: { kind: 'pokemon', defId: 'bulbasaur' } }];
  const production = cityYield(next, city).production;
  resolveEconomy(next);
  expect(next.cities[cityId].queue[0]?.progress ?? productionCost({ kind: 'pokemon', defId: 'bulbasaur' }, EXPANSION_CONTENT)).toBeGreaterThanOrEqual(Math.min(production + ESSENCE_RULES.gymTrainingBoost, productionCost({ kind: 'pokemon', defId: 'bulbasaur' }, EXPANSION_CONTENT)));
  expect(next.expansion!.essences!.stock[0].sylvan).toBe(0);
});

test('home terrain defense matches preview and authority only in v4', () => {
  expect(homeDefenseMultiplier(true, { kind: 'pokemon', speciesId: 'geodude' }, 'mountain', EXPANSION_CONTENT)).toBe(900);
  expect(homeDefenseMultiplier(true, { kind: 'pokemon', speciesId: 'geodude' }, 'ocean', EXPANSION_CONTENT)).toBe(1000);
  expect(homeDefenseMultiplier(false, { kind: 'pokemon', speciesId: 'geodude' }, 'mountain', EXPANSION_CONTENT)).toBe(1000);
  for (const version of [3, 4] as const) {
    const state = createGame(setup(version));
    state.map.tiles.fill('mountain'); state.units = {};
    state.diplomacy[0].status = 'war';
    const attacker = createMapUnit({ kind: 'pokemon', speciesId: 'machop' }, 9000, 0, { q: 8, r: 6 }, EXPANSION_CONTENT, 0, 1);
    const defender = createMapUnit({ kind: 'pokemon', speciesId: 'snorlax' }, 9001, 1, { q: 9, r: 6 }, EXPANSION_CONTENT, 0, 1);
    const rock = createMapUnit({ kind: 'pokemon', speciesId: 'geodude' }, 9002, 1, { q: 7, r: 6 }, EXPANSION_CONTENT, 0, 1);
    Object.assign(state.units, { 9000: attacker, 9001: defender, 9002: rock });
    refreshKnowledge(state);
    const normal = previewAttack(observe(state, 0), 9000, { kind: 'unit', id: 9001 });
    const home = previewAttack(observe(state, 0), 9000, { kind: 'unit', id: 9002 });
    expect(normal.ok && home.ok).toBe(true);
    const before = state.units[9002].hp;
    resolveAttack(state, 9000, { kind: 'unit', id: 9002 });
    if (home.ok) {
      expect(before - state.units[9002].hp).toBeLessThanOrEqual(home.damage.max);
      expect(before - state.units[9002].hp).toBeGreaterThanOrEqual(Math.min(before, home.damage.min));
    }
  }
});

test('new leaders apply their passives', () => {
  const brock = createGame(setup(4, 'brock'));
  const settler = { kind: 'logistics' as const, defId: 'settler' as const };
  expect(productionCost(settler, EXPANSION_CONTENT, 0, 25)).toBe(23);
  expect(productionCost(settler, EXPANSION_CONTENT, 0, 15)).toBe(26);
  const jasmine = createGame(setup(4, 'jasmine'));
  const oak = createGame(setup(4, 'oak'));
  const city = (state: GameState) => state.cities[state.players[0].headquartersCityId];
  city(jasmine).population = 3; city(oak).population = 3;
  expect(cityYield(jasmine, city(jasmine)).gold).toBe(cityYield(oak, city(oak)).gold + 1);
  void brock;
  const giovanni = createGame(setup(4, 'giovanni'));
  giovanni.map.tiles.fill('grassland'); giovanni.units = {};
  giovanni.players[0].research.unlockedIds = ['domestication']; giovanni.players[0].ballInventory.pokeBall = 1;
  const own = createMapUnit({ kind: 'pokemon', speciesId: 'machop' }, 9000, 0, { q: 8, r: 6 }, EXPANSION_CONTENT, 0, 1);
  const wild = createMapUnit({ kind: 'pokemon', speciesId: 'rattata' }, 9001, null, { q: 9, r: 6 }, EXPANSION_CONTENT, 0, 1);
  wild.hp = 1; Object.assign(giovanni.units, { 9000: own, 9001: wild }); refreshKnowledge(giovanni);
  const preview = previewCapture(observe(giovanni, 0), 9000, 9001, 'pokeBall');
  const plain = createGame(setup(4, 'oak'));
  plain.map.tiles.fill('grassland'); plain.units = {};
  plain.players[0].research.unlockedIds = ['domestication']; plain.players[0].ballInventory.pokeBall = 1;
  Object.assign(plain.units, { 9000: structuredClone(own), 9001: structuredClone(wild) }); refreshKnowledge(plain);
  const base = previewCapture(observe(plain, 0), 9000, 9001, 'pokeBall');
  expect(preview.ok && base.ok && preview.probability - base.probability).toBe(15);
});

test('gameplay v4 with the new leaders keeps exact save/load and replay', () => {
  const session = new GameSession({ ...setup(4, 'misty'), multiplayer: undefined, players: [
    { id: 0, controller: 'human', starterId: 'squirtle', leaderId: 'misty' }, { id: 1, controller: 'ai', personality: 'expansion', leaderId: 'steven' },
    { id: 2, controller: 'ai', personality: 'aggressive', leaderId: 'giovanni' }, { id: 3, controller: 'ai', personality: 'conservative', leaderId: 'jasmine' }] });
  for (let turn = 0; turn < 40; turn++) {
    const current = session.getState();
    if (current.outcome) break;
    expect(session.submit({ actorId: current.activePlayerId, expectedSeq: current.commandSeq, action: { type: 'EndTurn' } }).ok).toBe(true);
  }
  const saved = session.save(), loaded = new GameSession(setup(4));
  loaded.load(saved);
  expect(loaded.save()).toBe(saved);
  expect(canonicalSerialize(replay(session.exportLog()))).toBe(canonicalSerialize(session.getState()));
  expect(session.aiInvalidCommands).toEqual([]);
}, 30_000);
