import { expect, test } from 'vitest';
import { GameSession, replay } from '../../src/app/session.ts';
import { deserializeSave } from '../../src/app/save.ts';
import { LEADER_IDS } from '../../src/content/leaders.ts';
import type { LeaderId } from '../../src/content/leaders.ts';
import { CONTENT, STARTER_IDS } from '../../src/content/units.ts';
import { cityCounterAttack, cityYield } from '../../src/core/city.ts';
import { resolveAttack } from '../../src/core/combat.ts';
import { resolveEconomy } from '../../src/core/economy.ts';
import { createGame } from '../../src/core/game.ts';
import { hexToIndex } from '../../src/core/hex.ts';
import type { GameSetup } from '../../src/core/model.ts';
import { previewAttack } from '../../src/core/preview.ts';
import { resolveRecovery } from '../../src/core/recovery.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { observe, refreshKnowledge, visibleTiles } from '../../src/core/vision.ts';
import { combatFixture, pokemon } from './combat-fixture.ts';

const setup: GameSetup = { seed: 12345, width: 24, height: 16, players: [
  { id: 0, controller: 'human', starterId: 'bulbasaur' }, { id: 1, controller: 'ai' },
] };

test('every leader pairs with every starter without changing map, spawns or RNG', () => {
  for (const starterId of STARTER_IDS) {
    const legacy = createGame({ ...setup, players: [{ id: 0, controller: 'human', starterId }, setup.players[1]] });
    for (const leaderId of LEADER_IDS) {
      const current = createGame({ ...setup, players: [{ id: 0, controller: 'human', starterId, leaderId }, setup.players[1]] });
      expect(current.players[0]).toMatchObject({ starterId, leaderId });
      expect(current.map).toEqual(legacy.map);
      expect(current.units).toEqual(legacy.units);
      expect(current.rng).toEqual(legacy.rng);
    }
  }
});

test.each([...LEADER_IDS, undefined])('leader %s survives save/load and exact AI command replay', leaderId => {
  const chosen: GameSetup = structuredClone(setup);
  if (leaderId !== undefined) {
    chosen.players[0].leaderId = leaderId;
    chosen.players[1].leaderId = LEADER_IDS[(LEADER_IDS.indexOf(leaderId) + 1) % LEADER_IDS.length];
  }
  const session = new GameSession(chosen);
  for (let i = 0; i < 3; i++) expect(session.issue({ type: 'EndTurn' }).ok).toBe(true);
  const saved = session.save(), loaded = new GameSession(setup);
  loaded.load(saved);
  expect(loaded.save()).toBe(saved);
  expect(canonicalSerialize(replay(session.exportLog()))).toBe(canonicalSerialize(session.getState()));
  expect(loaded.getView().economy.player.leaderId).toBe(leaderId);
  if (leaderId === undefined) expect(loaded.getState().players[0]).not.toHaveProperty('leaderId');
  expect(session.aiInvalidCommands).toEqual([]);
});

test('unknown leader and setup/state leader mismatches are rejected', () => {
  const invalid = structuredClone(setup);
  invalid.players[0].leaderId = 'missing' as LeaderId;
  expect(() => createGame(invalid)).toThrow('Unknown leader');
  const save = JSON.parse(new GameSession(setup).save());
  save.state.players[0].leaderId = 'joy';
  expect(() => deserializeSave(JSON.stringify(save))).toThrow();
  save.state.players[0].leaderId = 'missing';
  save.state.setup.players[0].leaderId = 'missing';
  save.log.setup.players[0].leaderId = 'missing';
  expect(() => deserializeSave(JSON.stringify(save))).toThrow();
});

test('an explicitly undefined optional leader serializes exactly like a legacy setup', () => {
  const optional = structuredClone(setup);
  optional.players[0].leaderId = undefined;
  const session = new GameSession(optional);
  expect(session.getState().players[0]).not.toHaveProperty('leaderId');
  expect(session.save()).toBe(new GameSession(setup).save());
  expect(canonicalSerialize(replay(session.exportLog()))).toBe(canonicalSerialize(session.getState()));
});

test('Oak research is settled, benefits laboratories and respects captured/neutral city exclusions', () => {
  const state = combatFixture(), city = state.cities[1];
  const original = cityYield(state, city);
  state.players[0].leaderId = 'oak';
  expect(cityYield(state, city)).toEqual({ ...original, research: original.research + 1 });
  city.buildingIds.push('observatory');
  const output = cityYield(state, city);
  expect(output.research).toBe(original.research + 4); // laboratory +2, leader +1 and laboratory synergy +1
  resolveEconomy(state);
  expect(state.players[0].research.reserve).toBe(output.research);
  city.capturedAtRound = state.round;
  expect(cityYield(state, city).research).toBe(0);
  city.capturedAtRound = null; city.ownerId = null;
  expect(cityYield(state, city).research).toBe(0);
});

test('Lance damage preview and resolution agree, while counter damage and XP stay unchanged', () => {
  const base = combatFixture();
  pokemon(base, 10, 'charmeleon'); pokemon(base, 11, 'ivysaur', null, 4);
  refreshKnowledge(base);
  const boosted = structuredClone(base); boosted.players[0].leaderId = 'lance';
  const preview = previewAttack(observe(boosted, 0), 10, { kind: 'unit', id: 11 });
  expect(preview).toMatchObject({ ok: true, damage: { min: 19, max: 23 }, counter: { damage: 2 } });
  const normal = resolveAttack(base, 10, { kind: 'unit', id: 11 })[0];
  const battle = resolveAttack(boosted, 10, { kind: 'unit', id: 11 })[0];
  if (battle.type !== 'BattleResolved' || normal.type !== 'BattleResolved' || !preview.ok) throw new Error('Missing battle');
  expect(battle.damage).toBeGreaterThan(normal.damage);
  expect(battle.damage).toBeGreaterThanOrEqual(preview.damage.min);
  expect(battle.damage).toBeLessThanOrEqual(preview.damage.max);
  expect(battle.counterDamage).toBe(normal.counterDamage);
  expect(boosted.units[10].xp).toBe(base.units[10].xp);
  expect(boosted.rng).toEqual(base.rng);
  const normalCounter = combatFixture();
  pokemon(normalCounter, 10, 'ivysaur'); pokemon(normalCounter, 11, 'charmeleon', 1, 4);
  const lanceCounter = structuredClone(normalCounter); lanceCounter.players[1].leaderId = 'lance';
  expect(resolveAttack(lanceCounter, 10, { kind: 'unit', id: 11 })[0])
    .toEqual(resolveAttack(normalCounter, 10, { kind: 'unit', id: 11 })[0]);
});

test('Lance attacks on cities and Jenny counter bonuses use the same observed values as combat', () => {
  const state = combatFixture();
  state.players[0].leaderId = 'lance'; state.players[1].leaderId = 'jenny';
  state.players[1].starterId = 'squirtle'; state.diplomacy[0].status = 'war';
  pokemon(state, 10, 'machoke', 0, 9, 2);
  refreshKnowledge(state);
  const view = observe(state, 0);
  expect(cityCounterAttack(state.players[1])).toBe(38);
  expect(view.combat.cities[2].counterAttack).toBe(38);
  const preview = previewAttack(view, 10, { kind: 'city', id: 2 });
  const battle = resolveAttack(state, 10, { kind: 'city', id: 2 })[0];
  if (!preview.ok || battle.type !== 'BattleResolved') throw new Error('Missing battle');
  expect(battle.damage).toBeGreaterThanOrEqual(preview.damage.min);
  expect(battle.damage).toBeLessThanOrEqual(preview.damage.max);
  expect(battle.counterDamage).toBe(preview.counter.damage);
  const neutral = structuredClone(state); neutral.cities[2].ownerId = null;
  expect(observe(neutral, 0).combat.cities[2].counterAttack).toBe(0);
});

test('Jenny reveals the third city ring without revealing further units or private enemy economy', () => {
  const state = combatFixture();
  const ringThree = pokemon(state, 10, 'bulbasaur', 1, 5, 2);
  pokemon(state, 11, 'bulbasaur', 1, 6, 2);
  const index = hexToIndex(ringThree.position, state.map)!;
  expect(visibleTiles(state, 0).has(index)).toBe(false);
  state.players[0].leaderId = 'jenny'; state.players[1].leaderId = 'joy';
  refreshKnowledge(state); const view = observe(state, 0);
  expect(view.visibleTileIds).toContain(index);
  expect(view.units.map(unit => unit.id)).toEqual([10]);
  expect(view.civilizations.find(player => player.id === 1)).toEqual({ id: 1, eliminated: false, leaderId: 'joy' });
  expect(view.economy.cities.map(city => city.ownerId)).toEqual([0]);
  expect(view).not.toHaveProperty('players');
});

test.each([false, true])('Joy healing stays in owned territory, stacks with medicine=%s and clamps at max HP', medicine => {
  const state = combatFixture(); state.players[0].leaderId = 'joy';
  if (medicine) state.players[0].research.unlockedIds.push('medicine');
  pokemon(state, 10, 'charmander', 0, 2, 2).hp = 1;
  pokemon(state, 11, 'charmander', 0, 7, 5).hp = 1;
  pokemon(state, 12, 'charmander', 1, 10, 2).hp = 1;
  pokemon(state, 13, 'charmander', 0, 3, 2).hp = CONTENT.species.charmander.maxHp - 1;
  resolveRecovery(state);
  expect(state.units[10].hp).toBe(medicine ? 16 : 11);
  expect(state.units[11].hp).toBe(1);
  expect(state.units[12].hp).toBe(6);
  expect(state.units[13].hp).toBe(CONTENT.species.charmander.maxHp);
});

test.each([false, true])('Joy reduces recovery only on knockout, wildPhase=%s', wildPhase => {
  const state = combatFixture(); state.players[0].leaderId = 'joy';
  pokemon(state, 10, 'charmander', wildPhase ? null : 1, 4, 3);
  pokemon(state, 11, 'bulbasaur', 0, 3, 3).hp = 1;
  const events = resolveAttack(state, 10, { kind: 'unit', id: 11 }, CONTENT, wildPhase);
  expect(state.units[11]).toMatchObject({ location: 'recovering', roundsLeft: wildPhase ? 1 : 2, hp: 1, actionLeft: 0 });
  expect(events).toContainEqual(expect.objectContaining({ type: 'UnitRecovering', roundsLeft: wildPhase ? 1 : 2 }));
  resolveRecovery(state);
  expect(state.units[11].location).toBe(wildPhase ? 'map' : 'recovering');
  if (!wildPhase) expect(state.units[11]).toMatchObject({ roundsLeft: 1, hp: 1 });
});
