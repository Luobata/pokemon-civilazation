import { expect, test } from 'vitest';
import { GameSession, replay } from '../../src/app/session.ts';
import { RARE_BERRY_IDS, RARE_BERRY_RULES, RARE_BERRIES } from '../../src/content/rare-berries.ts';
import { createGame } from '../../src/core/game.ts';
import { cityYield } from '../../src/core/city.ts';
import { observe } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { distinctRareBerries, ownedRareBerries, resolveRareBerryRound } from '../../src/core/rare-berries.ts';
import { planRareBerryAction } from '../../src/ai/rare-berry-plan.ts';
import { parseAuditAction } from '../../src/audit/commands.ts';
import type { GameSetup } from '../../src/core/model.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';

function setup(gameplayVersion?: GameplayVersion): GameSetup {
  return { seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1',
    ...(gameplayVersion ? { gameplayVersion } : {}), players: [
      { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' },
      { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'jasmine' },
    ] };
}

test('rare berries exist only in gameplay v7, deterministic, on their biome, without consuming RNG', () => {
  expect(createGame(setup(6)).expansion).not.toHaveProperty('rareBerries');
  const a = createGame(setup(7)), b = createGame(setup(7)), v6 = createGame(setup(6));
  expect(a.expansion!.rareBerries!.deposits).toEqual(b.expansion!.rareBerries!.deposits);
  expect(a.rng).toEqual(v6.rng);
  for (const [tile, berry] of Object.entries(a.expansion!.rareBerries!.deposits)) expect(a.map.tiles[Number(tile)]).toBe(RARE_BERRIES[berry].biome);
  expect(parseAuditAction({ type: 'GiftBerry', targetPlayerId: 1, berry: 'liechi' })).toEqual({ type: 'GiftBerry', targetPlayerId: 1, berry: 'liechi' });
  expect(() => parseAuditAction({ type: 'GiftBerry', targetPlayerId: 1, berry: 'oran' })).toThrow();
});

test('working deposits grants kinds, satisfaction and the festival food bonus', () => {
  const state = createGame(setup(7));
  const firstOfKind = new Map<string, number>();
  for (const [tile, berry] of Object.entries(state.expansion!.rareBerries!.deposits)) if (!firstOfKind.has(berry)) firstOfKind.set(berry, Number(tile));
  expect(firstOfKind.size).toBeGreaterThanOrEqual(RARE_BERRY_RULES.festivalTypes);
  const city = state.cities[state.players[0].headquartersCityId];
  const tiles = [...firstOfKind.values()].slice(0, RARE_BERRY_RULES.festivalTypes);
  city.workedTileIds = tiles;
  expect(distinctRareBerries(state, 0)).toBe(RARE_BERRY_RULES.festivalTypes);
  expect(observe(state, 0).expansion!.rareBerries!.festival).toBe(true);
  const withFestival = cityYield(state, city).food;
  // Same tiles counted, but one deposit removed from the ledger: below the festival threshold.
  const removed = tiles[0], berry = state.expansion!.rareBerries!.deposits[removed];
  delete state.expansion!.rareBerries!.deposits[removed];
  const without = cityYield(state, city).food;
  expect(withFestival - without).toBe(1);
  state.expansion!.rareBerries!.deposits[removed] = berry;
  const satisfaction = state.expansion!.world.players[0].satisfaction;
  resolveRareBerryRound(state);
  expect(state.expansion!.world.players[0].satisfaction).toBe(Math.min(100, satisfaction + RARE_BERRY_RULES.festivalTypes * RARE_BERRY_RULES.satisfactionPerType));
});

test('gifts need an active trade and a surplus copy; the receiver gains the kind', () => {
  const state = createGame(setup(7));
  const deposits = state.expansion!.rareBerries!.deposits;
  const kind = RARE_BERRY_IDS.find(id => Object.values(deposits).filter(berry => berry === id).length >= 2)!;
  const tiles = Object.entries(deposits).filter(([, berry]) => berry === kind).map(([tile]) => Number(tile)).slice(0, 2);
  state.cities[state.players[0].headquartersCityId].workedTileIds = tiles;
  const gift = { type: 'GiftBerry' as const, targetPlayerId: 1, berry: kind };
  expect(step(state, { actorId: 0, expectedSeq: 0, action: gift }).ok).toBe(false);
  const key = Object.keys(state.expansion!.civilization.relations)[0];
  state.expansion!.civilization.relations[key].tradeSinceRound = 1;
  const gold = state.players[0].gold;
  const result = step(state, { actorId: 0, expectedSeq: 0, action: gift });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(ownedRareBerries(result.state, 0)[kind]).toBe(1);
  expect(ownedRareBerries(result.state, 1)[kind]).toBe(1);
  expect(result.state.players[0].gold).toBe(gold + RARE_BERRY_RULES.giftGold);
  expect(step(result.state, { actorId: 0, expectedSeq: 1, action: gift }).ok).toBe(false);
  // The AI sees its own gift cooldown and does not propose a gift the rules would reject.
  expect(planRareBerryAction(observe(state, 0))).toEqual(gift);
  state.expansion!.rareBerries!.lastGiftRound['0>1'] = state.round;
  expect(observe(state, 0).expansion!.rareBerries!.lastGiftRoundByTarget).toEqual({ 1: state.round });
  expect(observe(state, 1).expansion!.rareBerries!.lastGiftRoundByTarget).toEqual({});
  expect(planRareBerryAction(observe(state, 0))).toBeNull();
  state.round += RARE_BERRY_RULES.giftCooldown;
  expect(planRareBerryAction(observe(state, 0))).toEqual(gift);
});

test('gameplay v7 keeps exact save/load and replay', () => {
  const session = new GameSession({ ...setup(7), multiplayer: undefined, players: [
    { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'ai', personality: 'expansion', leaderId: 'jasmine' }] });
  for (let turn = 0; turn < 40; turn++) {
    const current = session.getState();
    if (current.outcome) break;
    expect(session.submit({ actorId: current.activePlayerId, expectedSeq: current.commandSeq, action: { type: 'EndTurn' } }).ok).toBe(true);
  }
  const saved = session.save(), loaded = new GameSession(setup(7));
  loaded.load(saved);
  expect(loaded.save()).toBe(saved);
  expect(canonicalSerialize(replay(session.exportLog()))).toBe(canonicalSerialize(session.getState()));
  expect(session.aiInvalidCommands).toEqual([]);
}, 30_000);
