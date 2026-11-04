import { expect, test } from 'vitest';
import { EXPANSION_CONTENT } from '../../src/content/units.ts';
import type { SpeciesId } from '../../src/content/units.ts';
import { PROMOTION_RULES } from '../../src/content/promotions.ts';
import type { PromotionTrait } from '../../src/content/promotions.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';
import { RULE_QUERIES } from '../../src/ai/query.ts';
import { planNext } from '../../src/ai/plan.ts';
import { rememberCityRejection } from '../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../src/ai/memory.ts';
import { replay } from '../../src/app/session.ts';
import type { CommandLog } from '../../src/app/session.ts';
import { createGame } from '../../src/core/game.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { previewAttack } from '../../src/core/preview.ts';
import { resolveAttack } from '../../src/core/combat.ts';
import { reachablePaths } from '../../src/core/movement.ts';
import { resolveRecovery } from '../../src/core/recovery.ts';
import { gameVersions } from '../../src/core/versions.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { pendingPromotions, promotionsEarned, recordPromotions } from '../../src/core/promotions.ts';
import { parseAuditAction } from '../../src/audit/commands.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';

const duel = (gameplayVersion: GameplayVersion): GameSetup => ({ seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1', gameplayVersion,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'oak' }] });
const act = (state: GameState, action: Command['action']) => step(state, { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action });
/** Two Pokémon facing each other on open grassland at war; unit 9000 (player 0) attacks 9001 (player 1). */
function arena(attacker: SpeciesId, defender: SpeciesId, version: GameplayVersion = 13): GameState {
  const state = createGame(duel(version), EXPANSION_CONTENT);
  state.map.tiles.fill('grassland'); state.units = {};
  state.diplomacy[0].status = 'war';
  state.cities[state.players[0].headquartersCityId].position = { q: 3, r: 3 };
  state.cities[state.players[1].headquartersCityId].position = { q: 20, r: 12 };
  state.units[9000] = createMapUnit({ kind: 'pokemon', speciesId: attacker }, 9000, 0, { q: 9, r: 6 }, EXPANSION_CONTENT, 0, 1);
  state.units[9001] = createMapUnit({ kind: 'pokemon', speciesId: defender }, 9001, 1, { q: 10, r: 6 }, EXPANSION_CONTENT, 0, 1);
  refreshKnowledge(state);
  return state;
}
const promote = (state: GameState, unitId: number, traits: PromotionTrait[]) => {
  state.expansion!.promotions!.units[unitId] = { merit: PROMOTION_RULES.thresholds[traits.length - 1] ?? 0, traits };
  return state;
};
const preview = (state: GameState, target: { kind: 'unit' | 'city'; id: number } = { kind: 'unit', id: 9001 }) => {
  const result = previewAttack(observe(state, 0, EXPANSION_CONTENT), 9000, target, EXPANSION_CONTENT);
  if (!result.ok) throw new Error(result.reason);
  return result;
};

test('promotions exist only from gameplay v13; the command parses strictly', () => {
  expect(Object.keys(createGame(duel(12), EXPANSION_CONTENT).expansion!)).not.toContain('promotions');
  expect(createGame(duel(13), EXPANSION_CONTENT).expansion!.promotions).toEqual({ units: {} });
  expect(gameVersions({ gameplayVersion: 13 })).toEqual({ schemaVersion: 8, rulesVersion: 'promotions-v13' });
  expect(parseAuditAction({ type: 'PromoteUnit', unitId: 3, trait: 'swift' })).toEqual({ type: 'PromoteUnit', unitId: 3, trait: 'swift' });
  expect(() => parseAuditAction({ type: 'PromoteUnit', unitId: 3, trait: 'flying' })).toThrow();
  expect([0, 5, 6, 13, 14, 24, 99].map(promotionsEarned)).toEqual([0, 0, 1, 1, 2, 3, 3]);
});

test('battles award merit; a promotion is chosen once per threshold and never repeats a trait', () => {
  const state = arena('machoke', 'rattata');
  const attacked = act(state, { type: 'Attack', unitId: 9000, target: { kind: 'unit', id: 9001 } });
  expect(attacked.ok).toBe(true);
  if (!attacked.ok) return;
  const battle = attacked.events.map(event => event.payload).find(payload => payload.type === 'BattleResolved')!;
  if (battle.type !== 'BattleResolved') throw new Error('expected battle');
  const units = attacked.state.expansion!.promotions!.units, m = PROMOTION_RULES.merit;
  const knocked = battle.knockedDownUnitIds.includes(9001);
  expect(units[9000].merit).toBe(m.attack + (knocked ? m.knockdown : 0));
  if (battle.counterDamage > 0) expect(units[9001].merit).toBe(m.counter);
  // Promotion choice: free (no action), one per threshold, unique traits, own units only.
  const next = attacked.state;
  next.expansion!.promotions!.units[9000] = { merit: 14, traits: [] };
  expect(pendingPromotions(next.expansion!.promotions!.units[9000])).toBe(2);
  const first = act(next, { type: 'PromoteUnit', unitId: 9000, trait: 'assault' });
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  expect(first.events.map(event => event.payload)).toContainEqual({ type: 'UnitPromoted', playerId: 0, unitId: 9000, trait: 'assault', rank: 1 });
  expect(act(first.state, { type: 'PromoteUnit', unitId: 9000, trait: 'assault' }).ok).toBe(false);
  const second = act(first.state, { type: 'PromoteUnit', unitId: 9000, trait: 'swift' });
  expect(second.ok).toBe(true);
  if (!second.ok) return;
  expect(act(second.state, { type: 'PromoteUnit', unitId: 9000, trait: 'bulwark' }).ok).toBe(false);
  expect(act(second.state, { type: 'PromoteUnit', unitId: 9001, trait: 'bulwark' }).ok).toBe(false);
  // The owner sees the event; the rival sees the traits of the visible unit only through the view.
  // Rivals see the public traits of a visible unit, never its merit.
  expect(observe(second.state, 1, EXPANSION_CONTENT).expansion!.promotions!.units[9000]).toEqual({ traits: ['assault', 'swift'] });
  expect(observe(second.state, 0, EXPANSION_CONTENT).expansion!.promotions!.units[9000]).toEqual({ merit: 14, traits: ['assault', 'swift'] });
});

test('recovering units wait to be promoted, and battles started by wild Pokémon award no merit', () => {
  const state = promote(arena('machoke', 'rattata'), 9000, []);
  state.expansion!.promotions!.units[9000].merit = 6;
  const unit = state.units[9000];
  state.units[9000] = { ...unit, location: 'recovering', position: null, cityId: state.players[0].headquartersCityId, roundsLeft: 2 } as GameState['units'][number];
  expect(act(state, { type: 'PromoteUnit', unitId: 9000, trait: 'assault' }).ok).toBe(false);
  const wild = arena('rattata', 'machoke');
  wild.units[9000].ownerId = null;
  const events = resolveAttack(wild, 9000, { kind: 'unit', id: 9001 });
  recordPromotions(wild, events);
  expect(wild.expansion!.promotions!.units[9001]).toBeUndefined();
});

test('猛攻, 坚守 and 破城 change the preview, and the authority stays inside it', () => {
  const plain = preview(arena('machoke', 'snorlax'));
  const assault = preview(promote(arena('machoke', 'snorlax'), 9000, ['assault']));
  const guarded = preview(promote(arena('machoke', 'snorlax'), 9001, ['bulwark']));
  expect(assault.damage.max).toBeGreaterThan(plain.damage.max);
  expect(guarded.damage.max).toBeLessThan(plain.damage.max);
  // Counter damage uses a fixed roll: with 坚守 on the attacker the preview equals the authority exactly.
  const counterState = promote(arena('machoke', 'snorlax'), 9000, ['bulwark']);
  const counterPreview = preview(counterState);
  expect(counterPreview.counter.damage).toBeLessThan(plain.counter.damage);
  for (const state of [promote(arena('machoke', 'snorlax'), 9000, ['assault', 'bulwark']), counterState]) {
    const expected = preview(state), defenderHp = state.units[9001].hp, attackerHp = state.units[9000].hp;
    const battle = resolveAttack(state, 9000, { kind: 'unit', id: 9001 })[0];
    if (battle.type !== 'BattleResolved') throw new Error('expected battle');
    expect(defenderHp - state.units[9001].hp).toBeGreaterThanOrEqual(expected.damage.min);
    expect(defenderHp - state.units[9001].hp).toBeLessThanOrEqual(expected.damage.max);
    expect(attackerHp - state.units[9000].hp).toBe(expected.counter.trigger === 'never' ? 0 : expected.counter.damage);
  }
  const city = (traits: PromotionTrait[]) => {
    const state = promote(arena('machoke', 'rattata'), 9000, traits);
    delete state.units[9001];
    state.cities[state.players[1].headquartersCityId].position = { q: 10, r: 6 };
    refreshKnowledge(state);
    return state;
  };
  const cityId = (state: GameState) => state.players[1].headquartersCityId;
  const base = city([]), breacher = city(['breacher']);
  expect(preview(breacher, { kind: 'city', id: cityId(breacher) }).damage.max).toBeGreaterThan(preview(base, { kind: 'city', id: cityId(base) }).damage.max);
  const expected = preview(breacher, { kind: 'city', id: cityId(breacher) }), hp = breacher.cities[cityId(breacher)].hp;
  resolveAttack(breacher, 9000, { kind: 'city', id: cityId(breacher) });
  expect(hp - breacher.cities[cityId(breacher)].hp).toBeGreaterThanOrEqual(expected.damage.min);
  expect(hp - breacher.cities[cityId(breacher)].hp).toBeLessThanOrEqual(expected.damage.max);
});

test('疾行 adds one movement and 再生 heals 5 HP outside territory', () => {
  // The whole open arena is known and the rival stands far away, so only the movement budget limits the reach.
  const reach = (state: GameState) => {
    state.units[9001].position = { q: 20, r: 1 };
    state.map.tiles.forEach((biomeId, index) => { state.knowledge[0].rememberedTiles[index] = { biomeId }; });
    return Object.keys(reachablePaths(observe(state, 0, EXPANSION_CONTENT), 9000, EXPANSION_CONTENT)).length;
  };
  expect(reach(promote(arena('rattata', 'snorlax'), 9000, ['swift']))).toBeGreaterThan(reach(arena('rattata', 'snorlax')));
  const heal = (traits: PromotionTrait[]) => {
    const state = promote(arena('machoke', 'snorlax'), 9000, traits);
    state.units[9000].hp = 10;
    resolveRecovery(state, EXPANSION_CONTENT);
    return state.units[9000].hp;
  };
  expect(heal(['regenerate']) - heal([])).toBe(PROMOTION_RULES.regenerateHealing);
});

test('a real v13 AI game promotes veterans and replays exactly', () => {
  const setup: GameSetup = { seed: 31, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 13, players: [
    { id: 0, controller: 'ai', personality: 'aggressive', leaderId: 'lance' }, { id: 1, controller: 'ai', personality: 'aggressive', leaderId: 'giovanni' },
    { id: 2, controller: 'ai', personality: 'expansion', leaderId: 'oak' }] };
  let state = createGame(setup, EXPANSION_CONTENT);
  const commands: Command[] = [], memory: RejectedCitySite[] = [];
  let promoted = 0;
  while (!state.outcome && state.round < 80) {
    const view = observe(state, state.activePlayerId, EXPANSION_CONTENT);
    let command = planNext(view, { ...RULE_QUERIES, content: EXPANSION_CONTENT }, memory);
    let result = step(state, command, EXPANSION_CONTENT);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command, EXPANSION_CONTENT);
    }
    if (!result.ok) throw new Error(result.reason);
    promoted += result.events.filter(event => event.payload.type === 'UnitPromoted').length;
    state = result.state; commands.push(command);
  }
  expect(promoted).toBeGreaterThan(0);
  for (const record of Object.values(state.expansion!.promotions!.units)) {
    expect(record.traits.length).toBeLessThanOrEqual(promotionsEarned(record.merit));
    expect(new Set(record.traits).size).toBe(record.traits.length);
  }
  const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
  expect(state.schemaVersion).toBe(8);
  expect(canonicalSerialize(replay(log))).toBe(canonicalSerialize(state));
}, 120_000);
