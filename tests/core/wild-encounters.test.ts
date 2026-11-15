import { afterEach, expect, test, vi } from 'vitest';
import { contentFor } from '../../src/content/units.ts';
import type { Content } from '../../src/content/units.ts';
import type { SpeciesId } from '../../src/content/species.ts';
import { createGame } from '../../src/core/game.ts';
import { actWild } from '../../src/core/wild.ts';
import { resolveAttack } from '../../src/core/combat.ts';
import { resolveRecovery } from '../../src/core/recovery.ts';
import { previewCapture } from '../../src/core/preview.ts';
import { step } from '../../src/core/step.ts';
import { observe } from '../../src/core/vision.ts';
import { createCity } from '../../src/core/city.ts';
import * as rng from '../../src/core/rng.ts';
import { hexDistance, hexToIndex, neighbors } from '../../src/core/hex.ts';
import type { Hex } from '../../src/core/hex.ts';
import { isMapUnit } from '../../src/core/model.ts';
import type { GameSetup, GameState, MapUnit, RecoveringUnit } from '../../src/core/model.ts';
import { canEnterTile } from '../../src/core/movement.ts';
import { createMapUnit, maxUnitHp } from '../../src/core/unit.ts';
import { encounterCaptureChance, exhaustAfterStrike, isExhausted } from '../../src/core/wild-encounters.ts';

afterEach(() => vi.restoreAllMocks());
const setup = (gameplayVersion: 26 | 27): GameSetup => ({ seed: 31, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur' }, { id: 1, controller: 'ai' }] });
/** Player 0's starter alone on the map, with a city (knocked-out Pokémon recover there), domestication and two Poké Balls. */
function arena(version: 26 | 27): { state: GameState; content: Content; starter: MapUnit } {
  const state = createGame(setup(version)), content = contentFor(state.setup);
  const starter = Object.values(state.units).find(unit => unit.ownerId === 0 && unit.kind === 'pokemon') as MapUnit;
  const settler = Object.values(state.units).find(unit => unit.ownerId === 0 && unit.kind === 'logistics') as MapUnit;
  for (const id of Object.keys(state.units).map(Number)) if (id !== starter.id) delete state.units[id];
  state.cities[90] = createCity(90, 0, settler.position);
  state.players[0].headquartersCityId = 90;
  state.players[0].research.unlockedIds.push('domestication');
  state.players[0].ballInventory.pokeBall = 2;
  return { state, content, starter };
}
const free = (state: GameState, hex: Hex) => !Object.values(state.units).filter(isMapUnit).some(unit => hexDistance(unit.position, hex, state.map) === 0)
  && !Object.values(state.cities).some(city => hexDistance(city.position, hex, state.map) === 0);
function addWild(state: GameState, content: Content, near: Hex, speciesId: SpeciesId = 'rattata', hp?: number): MapUnit {
  const hex = neighbors(near, state.map).filter(item => free(state, item) && canEnterTile({ kind: 'pokemon', speciesId }, state.map, hexToIndex(item, state.map)!, content))
    .sort((a, b) => hexToIndex(a, state.map)! - hexToIndex(b, state.map)!)[0];
  const id = state.nextEntityId++;
  state.units[id] = { ...createMapUnit({ kind: 'pokemon', speciesId }, id, null, hex, content), ...(hp === undefined ? {} : { hp }) };
  return state.units[id] as MapUnit;
}

test('exhaustion: a strike to at most 40% exhausts a wild Pokémon once for 2 rounds; the first encounter of a species pays +15 XP and +5 science', () => {
  const { state, content, starter } = arena(27);
  const wild = addWild(state, content, starter.position, 'rattata', 41), xp = starter.xp, reserve = state.players[0].research.reserve;
  expect(exhaustAfterStrike(state, starter, wild, content)).toBeNull(); // 41% is above the line
  wild.hp = 40;
  const event = exhaustAfterStrike(state, starter, wild, content);
  expect(event).toEqual({ type: 'WildExhausted', playerId: 0, unitId: starter.id, targetUnitId: wild.id, speciesId: 'rattata', untilRound: state.round + 1, firstEncounter: true, xp: 15, science: 5 });
  expect(starter.xp).toBe(xp + 15);
  expect(state.players[0].research.reserve).toBe(reserve + 5);
  expect(isExhausted(wild, state.round) && isExhausted(wild, state.round + 1) && !isExhausted(wild, state.round + 2)).toBe(true);
  // Once per wild Pokémon; the species reward once per civilization.
  expect(exhaustAfterStrike(state, starter, wild, content)).toBeNull();
  const second = addWild(state, content, starter.position, 'rattata', 30);
  expect(exhaustAfterStrike(state, starter, second, content)).toMatchObject({ firstEncounter: false, xp: 0, science: 0 });
  expect(state.expansion!.wildEncounters).toEqual({ encountered: { 0: ['rattata'] }, firstBall: {} });
});

test('exhaustion through combat: the attack that leaves the wild Pokémon alive at most 40% exhausts it; v26 never does', () => {
  for (const version of [26, 27] as const) {
    const { state, content, starter } = arena(version);
    const wild = addWild(state, content, starter.position, 'rattata', 41);
    const events = resolveAttack(state, starter.id, { kind: 'unit', id: wild.id }, content);
    const survived = state.units[wild.id] && isMapUnit(state.units[wild.id]);
    expect(survived).toBe(true);
    expect(events.some(event => event.type === 'WildExhausted')).toBe(version === 27);
    expect((state.units[wild.id] as MapUnit).exhaustedUntilRound).toBe(version === 27 ? state.round + 1 : undefined);
  }
});

test('an exhausted wild Pokémon neither strikes nor moves; on its last round HP returns to 41%, then it acts again', () => {
  const { state, content, starter } = arena(27);
  const wild = addWild(state, content, starter.position, 'rattata', 20);
  wild.exhaustedUntilRound = state.round + 1;
  const position = { ...wild.position };
  expect(actWild(state, content)).toEqual([]);
  expect(wild.hp).toBe(20);
  state.round++;
  expect(actWild(state, content)).toEqual([]);
  expect(wild.hp).toBe(41);
  expect(wild.position).toEqual(position);
  state.round++;
  expect(actWild(state, content).find(event => event.type === 'BattleResolved')).toMatchObject({ attackerId: wild.id, target: { kind: 'unit', id: starter.id } });
});

test('capture: the first ball is certain (no draw), later exhausted targets +25 (cap 95); preview = authority', () => {
  const { state, content, starter } = arena(27);
  const first = addWild(state, content, starter.position, 'rattata', 40);
  first.exhaustedUntilRound = state.round + 1;
  expect(state.activePlayerId).toBe(0);
  expect(previewCapture(observe(state, 0, content), starter.id, first.id, 'pokeBall', content)).toEqual({ ok: true, probability: 100 });
  const draws = vi.spyOn(rng, 'randomBelow');
  const result = step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'Capture', unitId: starter.id, targetUnitId: first.id, ballId: 'pokeBall' } }, content);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(draws).not.toHaveBeenCalled();
  expect(result.events.map(event => event.payload)).toContainEqual(expect.objectContaining({ type: 'Captured', success: true, probability: 100 }));
  const after = result.state;
  expect(after.units[first.id].ownerId).toBe(0);
  expect(after.units[first.id].exhaustedUntilRound).toBeUndefined();
  expect(after.expansion!.wildEncounters!.firstBall).toEqual({ 0: true });
  // The next exhausted target: the plain chance + 25, capped at 95, never lower than the plain chance.
  const own = after.units[starter.id] as MapUnit; own.actionLeft = 1;
  const second = addWild(after, content, own.position, 'rattata', 40);
  second.exhaustedUntilRound = after.round + 1;
  const preview = previewCapture(observe(after, 0, content), own.id, second.id, 'pokeBall', content);
  second.exhaustedUntilRound = undefined;
  const plain = previewCapture(observe(after, 0, content), own.id, second.id, 'pokeBall', content);
  second.exhaustedUntilRound = after.round + 1;
  expect(preview.ok && plain.ok).toBe(true);
  if (!preview.ok || !plain.ok) return;
  expect(preview.probability).toBe(Math.min(95, plain.probability + 25));
  draws.mockClear();
  const again = step(after, { actorId: 0, expectedSeq: after.commandSeq, action: { type: 'Capture', unitId: own.id, targetUnitId: second.id, ballId: 'pokeBall' } }, content);
  expect(again.ok).toBe(true);
  if (!again.ok) return;
  expect(draws).toHaveBeenCalledTimes(1);
  expect(again.events.map(event => event.payload)).toContainEqual(expect.objectContaining({ type: 'Captured', probability: preview.probability }));
  expect([encounterCaptureChance(90, true, true, content), encounterCaptureChance(98, true, true, content), encounterCaptureChance(10, false, true, content), encounterCaptureChance(10, false, false, content)])
    .toEqual([95, 98, 10, 100]);
});

test('newbie protection: knocked out by a wild Pokémon up to round 30 → 1 round, back at 50%; later (and in v26) as before', () => {
  const heals: number[] = [];
  for (const [version, round, rounds, percent] of [[27, 30, 1, 50], [27, 31, 2, undefined], [26, 10, 2, undefined]] as const) {
    const { state, content, starter } = arena(version);
    state.round = round;
    starter.hp = 1;
    addWild(state, content, starter.position, 'rattata');
    actWild(state, content);
    const knocked = state.units[starter.id] as RecoveringUnit;
    expect(knocked.location).toBe('recovering');
    expect(knocked.roundsLeft).toBe(rounds);
    expect(knocked.recoverHpPercent).toBe(percent);
    for (let left = rounds; left > 0; left--) resolveRecovery(state, content);
    const back = state.units[starter.id];
    expect(back.location).toBe('map');
    // Back at the percent, then the same pass heals it like any unit in its territory.
    heals.push(back.hp - Math.floor(maxUnitHp(back, content) * (percent ?? 25) / 100));
    expect('recoverHpPercent' in back).toBe(false);
  }
  expect(new Set(heals).size).toBe(1);
  expect(heals[0]).toBeGreaterThanOrEqual(0);
});

test('the view shows the exhaustion (public, with the unit) and only the own ledger', () => {
  const { state, content, starter } = arena(27);
  const wild = addWild(state, content, starter.position, 'rattata', 40);
  exhaustAfterStrike(state, starter, wild, content);
  const mine = observe(state, 0, content), theirs = observe(state, 1, content);
  expect(mine.units.find(unit => unit.id === wild.id)?.exhaustedUntilRound).toBe(state.round + 1);
  expect(mine.expansion!.wildEncounters).toEqual({ encountered: ['rattata'], firstBallUsed: false });
  expect(theirs.expansion!.wildEncounters).toEqual({ encountered: [], firstBallUsed: false });
  expect(observe(createGame(setup(26)), 0).expansion!.wildEncounters).toBeUndefined();
});

test('option A: the first ball after domestication is certain on a full-HP wild Pokémon too; the second one draws as before; v26 draws', () => {
  for (const version of [26, 27] as const) {
    const { state, content, starter } = arena(version);
    const wild = addWild(state, content, starter.position, 'rattata');
    expect(isExhausted(wild, state.round)).toBe(false);
    const preview = previewCapture(observe(state, 0, content), starter.id, wild.id, 'pokeBall', content);
    const draws = vi.spyOn(rng, 'randomBelow');
    const result = step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'Capture', unitId: starter.id, targetUnitId: wild.id, ballId: 'pokeBall' } }, content);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const captured = result.events.map(event => event.payload).find(payload => payload.type === 'Captured');
    expect(captured).toMatchObject({ probability: preview.ok ? preview.probability : -1 });
    if (version === 27) {
      expect(preview).toEqual({ ok: true, probability: 100 });
      expect(draws).not.toHaveBeenCalled();
      expect(captured).toMatchObject({ success: true });
      // The second ball on a full-HP target: the plain chance, one draw.
      const after = result.state, own = after.units[starter.id] as MapUnit; own.actionLeft = 1;
      const next = addWild(after, content, own.position, 'rattata');
      const second = previewCapture(observe(after, 0, content), own.id, next.id, 'pokeBall', content);
      expect(second.ok && second.probability < 100).toBe(true);
      draws.mockClear();
      const again = step(after, { actorId: 0, expectedSeq: after.commandSeq, action: { type: 'Capture', unitId: own.id, targetUnitId: next.id, ballId: 'pokeBall' } }, content);
      expect(again.ok).toBe(true);
      expect(draws).toHaveBeenCalledTimes(1);
    } else {
      expect(draws).toHaveBeenCalledTimes(1);
      expect(preview.ok && preview.probability < 100).toBe(true);
    }
    vi.restoreAllMocks();
  }
});
