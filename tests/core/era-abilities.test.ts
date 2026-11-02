import { expect, test } from 'vitest';
import { GameSession, replay } from '../../src/app/session.ts';
import { EXPANSION_CONTENT } from '../../src/content/units.ts';
import type { SpeciesId } from '../../src/content/units.ts';
import { TECHS } from '../../src/content/economy.ts';
import type { TechId } from '../../src/content/economy.ts';
import { ERA_ABILITY_RULES, isNight } from '../../src/content/era-abilities.ts';
import type { EraProgression } from '../../src/content/eras.ts';
import { createGame } from '../../src/core/game.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { previewAttack } from '../../src/core/preview.ts';
import { resolveAttack } from '../../src/core/combat.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { generationOf, resolveEraAbilityRound, unlockedAbilities } from '../../src/core/era-abilities.ts';
import { parseAuditAction } from '../../src/audit/commands.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';

const techs = (count: number) => Object.keys(TECHS).slice(0, count) as TechId[];
function setup(gameplayVersion?: GameplayVersion, eraProgression: EraProgression = 'full-v1'): GameSetup {
  return { seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression,
    ...(gameplayVersion ? { gameplayVersion } : {}), players: [
      { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' },
      { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'lance' },
    ] };
}
const act = (state: GameState, action: Command['action']) => step(state, { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action });
function arena(version: GameplayVersion | undefined, techCount: number, attacker: SpeciesId, defender: SpeciesId): GameState {
  const state = createGame(setup(version));
  state.map.tiles.fill('grassland'); state.units = {};
  state.diplomacy[0].status = 'war';
  state.players[0].research.unlockedIds = techs(techCount);
  const city = state.cities[state.players[0].headquartersCityId]; city.position = { q: 8, r: 6 };
  state.units[9000] = createMapUnit({ kind: 'pokemon', speciesId: attacker }, 9000, 0, { q: 9, r: 6 }, EXPANSION_CONTENT, 0, 1);
  state.units[9001] = createMapUnit({ kind: 'pokemon', speciesId: defender }, 9001, 1, { q: 10, r: 6 }, EXPANSION_CONTENT, 0, 1);
  if (state.expansion?.essences) for (const id of Object.keys(state.expansion.essences.stock[0]) as (keyof typeof state.expansion.essences.stock[0])[]) state.expansion.essences.stock[0][id] = 50;
  refreshKnowledge(state);
  return state;
}
const damageMax = (state: GameState) => { const p = previewAttack(observe(state, 0), 9000, { kind: 'unit', id: 9001 }); return p.ok ? p.damage.max : NaN; };

test('generations map to abilities; simple mode stops at weather', () => {
  expect(unlockedAbilities(1)).toEqual([]);
  expect(unlockedAbilities(3)).toEqual(['dayNight', 'weather']);
  expect(unlockedAbilities(9)).toEqual(['dayNight', 'weather', 'mega', 'zMove', 'dynamax', 'tera']);
  expect(generationOf({ research: { unlockedIds: techs(12) } }, 'simple-v1')).toBe(3);
  expect(generationOf({ research: { unlockedIds: techs(12) } }, 'full-v1')).toBe(9);
  expect(isNight(1)).toBe(false); expect(isNight(3)).toBe(true); expect(isNight(5)).toBe(false);
});

test('era abilities exist only in gameplay v5 and commands parse strictly', () => {
  expect(createGame(setup(4)).expansion).not.toHaveProperty('eraAbilities');
  expect(createGame(setup(5)).expansion?.eraAbilities?.players[0]).toMatchObject({ megaUnitId: null, teraUnitId: null });
  expect(parseAuditAction({ type: 'SummonWeather', cityId: 1, weather: 'rain' })).toEqual({ type: 'SummonWeather', cityId: 1, weather: 'rain' });
  expect(() => parseAuditAction({ type: 'SummonWeather', cityId: 1, weather: 'fog' })).toThrow();
  expect(() => parseAuditAction({ type: 'Terastallize', unitId: 1, typeId: 'shadow' })).toThrow();
});

test('weather boosts and weakens by type, preview matches authority', () => {
  // Full mode: generation 3 (weather) needs 2 techs; with 1 tech the ability is locked.
  const early = arena(5, 1, 'squirtle', 'snorlax');
  expect(act(early, { type: 'SummonWeather', cityId: early.players[0].headquartersCityId, weather: 'rain' }).ok).toBe(false);
  const state = arena(5, 2, 'squirtle', 'snorlax');
  const before = damageMax(state);
  const cityId = state.players[0].headquartersCityId;
  const rained = act(state, { type: 'SummonWeather', cityId, weather: 'rain' });
  expect(rained.ok).toBe(true);
  if (!rained.ok) return;
  const next = rained.state;
  expect(next.expansion!.essences!.stock[0].tide).toBe(50 - ERA_ABILITY_RULES.weatherCost);
  expect(damageMax(next)).toBeGreaterThan(before);
  const hp = next.units[9001].hp, preview = previewAttack(observe(next, 0), 9000, { kind: 'unit', id: 9001 });
  resolveAttack(next, 9000, { kind: 'unit', id: 9001 });
  if (preview.ok) { expect(hp - next.units[9001].hp).toBeLessThanOrEqual(preview.damage.max); expect(hp - next.units[9001].hp).toBeGreaterThanOrEqual(Math.min(hp, preview.damage.min)); }
  expect(act(next, { type: 'SummonWeather', cityId, weather: 'sun' }).ok).toBe(false); // cooldown
  const sun = arena(5, 2, 'charmander', 'snorlax'); sun.expansion!.eraAbilities!.fields = [{ ownerId: 1, weather: 'rain', center: { q: 8, r: 6 }, untilRound: 5 }];
  expect(damageMax(sun)).toBeLessThan(damageMax(arena(5, 2, 'charmander', 'snorlax')));
});

test('Mega, Z-Move, Dynamax and Tera follow unlocks, costs and limits', () => {
  const locked = arena(5, 4, 'blastoise', 'snorlax');
  expect(act(locked, { type: 'MegaEvolve', unitId: 9000 }).ok).toBe(false);
  const state = arena(5, 12, 'blastoise', 'snorlax');
  const plain = damageMax(state);
  expect(act(state, { type: 'MegaEvolve', unitId: 9001 }).ok).toBe(false);
  const mega = act(state, { type: 'MegaEvolve', unitId: 9000 });
  expect(mega.ok).toBe(true);
  if (!mega.ok) return;
  expect(damageMax(mega.state)).toBeGreaterThan(plain);
  expect(observe(mega.state, 1).expansion!.eraAbilities!.units[9000]).toEqual({ mega: true });
  const z = act(mega.state, { type: 'PrimeZMove', unitId: 9000 });
  expect(z.ok).toBe(true);
  if (!z.ok) return;
  expect(observe(z.state, 1).expansion!.eraAbilities!.units[9000]).toEqual({ mega: true });
  expect(damageMax(z.state)).toBeGreaterThanOrEqual(damageMax(mega.state) * 1.9);
  resolveAttack(z.state, 9000, { kind: 'unit', id: 9001 });
  expect(z.state.expansion!.eraAbilities!.units[9000].zPrimed).toBeUndefined();
  const non = arena(5, 12, 'squirtle', 'snorlax');
  expect(act(non, { type: 'MegaEvolve', unitId: 9000 }).ok).toBe(false);
  const tera = act(arena(5, 12, 'squirtle', 'pikachu'), { type: 'Terastallize', unitId: 9000, typeId: 'grass' });
  expect(tera.ok && tera.state.expansion!.eraAbilities!.units[9000].tera).toBe('grass');
  const dyn = act(arena(5, 12, 'squirtle', 'snorlax'), { type: 'Dynamax', unitId: 9000 });
  expect(dyn.ok && dyn.state.expansion!.eraAbilities!.units[9000].dynamaxUntilRound).toBe(1 + ERA_ABILITY_RULES.dynamaxRounds - 1);
});

test('night boosts dark/ghost attacks; friendship grants territory XP after Gold/Silver', () => {
  // Clefairy (fairy) takes neutral ghost damage; normal types would be immune.
  const day = arena(5, 1, 'gastly', 'clefairy'), night = arena(5, 1, 'gastly', 'clefairy');
  night.round = 3;
  expect(damageMax(night)).toBeGreaterThan(damageMax(day));
  const xp = night.units[9000].xp;
  resolveEraAbilityRound(night);
  expect(night.units[9000].xp).toBe(xp + ERA_ABILITY_RULES.friendshipXp);
  const v4 = arena(4, 1, 'gastly', 'clefairy'); v4.round = 3;
  expect(damageMax(v4)).toBe(damageMax(arena(4, 1, 'gastly', 'clefairy')));
});

test('gameplay v5 keeps exact save/load and replay', () => {
  const session = new GameSession({ ...setup(5), multiplayer: undefined, players: [
    { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'ai', personality: 'aggressive', leaderId: 'misty' }] });
  for (let turn = 0; turn < 40; turn++) {
    const current = session.getState();
    if (current.outcome) break;
    expect(session.submit({ actorId: current.activePlayerId, expectedSeq: current.commandSeq, action: { type: 'EndTurn' } }).ok).toBe(true);
  }
  const saved = session.save(), loaded = new GameSession(setup(5));
  loaded.load(saved);
  expect(loaded.save()).toBe(saved);
  expect(canonicalSerialize(replay(session.exportLog()))).toBe(canonicalSerialize(session.getState()));
  expect(session.aiInvalidCommands).toEqual([]);
}, 30_000);
