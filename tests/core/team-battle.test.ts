// Gameplay v26 P1 (docs/design/depth-v26.md §2): singles relay battles — rules, the gym / Elite Four / guardian / conference integration,
// seeds from state.rng, the preview = authority interface and the AI lineups (real AI games, no refused commands).
import { describe, expect, test } from 'vitest';
import { contentFor } from '../../src/content/units.ts';
import { DEPTH26_TUNING } from '../../src/content/depth-v26.ts';
import { GYM_RULES_V24 } from '../../src/content/gym-circuit.ts';
import type { SpeciesId } from '../../src/content/species.ts';
import { createGame } from '../../src/core/game.ts';
import { leaderTeam, leaderTeamFor, viewGymBlocker } from '../../src/core/gym-circuit.ts';
import { championshipNpcEntrants, guardianFighter } from '../../src/core/civilization-systems.ts';
import { hexDistance, hexToIndex, neighbors } from '../../src/core/hex.ts';
import { isMapUnit } from '../../src/core/model.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';
import { randomBelow } from '../../src/core/rng.ts';
import { step } from '../../src/core/step.ts';
import { bestAttack, estimateTeamBattle, resolveTeamBattle, veteranBonus } from '../../src/core/team-battle.ts';
import type { BattleTraceV26, RelayFighter } from '../../src/core/team-battle.ts';
import { estimateLineup, lineupFighters, viewGymSpec } from '../../src/core/team-battle-views.ts';
import { chooseLineup } from '../../src/ai/battle-plan.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { planNext } from '../../src/ai/plan.ts';
import { RULE_QUERIES } from '../../src/ai/query.ts';
import { rememberCityRejection } from '../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../src/ai/memory.ts';

const setup = (gameplayVersion: 25 | 26, seed = 31): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur' }, { id: 1, controller: 'ai' }, { id: 2, controller: 'ai' }] });
const v26 = contentFor(setup(26));
const fighter = (id: string, speciesId: SpeciesId, extra: Partial<RelayFighter> = {}): RelayFighter => {
  const species = v26.species[speciesId];
  return { id, unitId: null, speciesId, typeIds: [species.typeId, ...(species.secondaryTypeId ? [species.secondaryTypeId] : [])], hp: species.maxHp, maxHp: species.maxHp,
    attack: species.attack, defense: species.defense, power: species.power, speed: 1, veteran: 0, ...extra };
};
const strikes = (trace: BattleTraceV26) => trace.turns.flatMap(turn => turn.acts.filter(act => act.kind === 'strike'));

describe('v26 relay rules (§2.1)', () => {
  test('the faster class strikes first; equal speed: higher attack, then the challenger', () => {
    const trace = resolveTeamBattle([fighter('a', 'squirtle', { speed: 1 })], [fighter('b', 'squirtle', { speed: 4 })], 7, 'grassland');
    expect(strikes(trace)[0]).toMatchObject({ side: 'away' });
    const tie = resolveTeamBattle([fighter('a', 'squirtle')], [fighter('b', 'squirtle')], 7, 'grassland');
    expect(strikes(tie)[0]).toMatchObject({ side: 'home' });
    const stronger = resolveTeamBattle([fighter('a', 'squirtle')], [fighter('b', 'squirtle', { attack: 99 })], 7, 'grassland');
    expect(strikes(stronger)[0]).toMatchObject({ side: 'away' });
  });
  test('each strike uses the best of the attacker\'s types (a TM type counts), at the type-research multiplier', () => {
    const tm = fighter('a', 'pidgey', { typeIds: ['normal', 'flying', 'electric'] }), foe = fighter('b', 'squirtle');
    expect(bestAttack(tm, foe)).toEqual({ typeId: 'electric', effectiveness: 220 });
    const trace = resolveTeamBattle([tm], [foe], 3, 'grassland');
    expect(strikes(trace).filter(act => act.side === 'home').every(act => act.kind === 'strike' && act.typeId === 'electric')).toBe(true);
  });
  test('one automatic switch per side: a lead that takes ≥ ×2 and deals ≤ ×1 gives way to a bench member taking ≤ ×0.5; it skips that turn', () => {
    // Bulbasaur leads against Charmander (fire beats grass, grass does ×1 or less); Squirtle resists fire.
    const trace = resolveTeamBattle([fighter('bulba', 'bulbasaur'), fighter('squirt', 'squirtle')], [fighter('char', 'charmander')], 11, 'grassland');
    const switches = trace.turns.flatMap(turn => turn.acts.filter(act => act.kind === 'switch'));
    expect(switches).toEqual([{ kind: 'switch', side: 'home', id: 'squirt' }]);
    const first = trace.turns[1].acts;
    expect(first.filter(act => act.kind === 'strike').map(act => act.kind === 'strike' && act.side)).toEqual(['away']);
    expect(first.find(act => act.kind === 'strike')).toMatchObject({ defenderId: 'squirt' });
  });
  test('a fainted Pokémon is replaced at once by the next in order; HP is written back; the turn limit judges by HP shares', () => {
    const home = [fighter('h1', 'pidgey', { hp: 5 }), fighter('h2', 'charmander')], away = [fighter('a1', 'bulbasaur')];
    const trace = resolveTeamBattle(home, away, 5, 'grassland');
    const acts = trace.turns.flatMap(turn => turn.acts);
    const faint = acts.findIndex(act => act.kind === 'faint' && act.id === 'h1');
    expect(faint).toBeGreaterThan(0);
    expect(acts[faint + 1]).toEqual({ kind: 'send', side: 'home', id: 'h2' });
    expect(home[0].hp).toBe(0);
    expect(away[0].hp).toBe(trace.winnerSide === 'away' ? away[0].hp : 0);
    // Two walls that barely scratch each other: 60 turns, then the larger HP share wins.
    const wall = (id: string, hp: number) => fighter(id, 'squirtle', { hp, maxHp: 1000, attack: 1, defense: 900 });
    const long = resolveTeamBattle([wall('w1', 900)], [wall('w2', 800)], 9, 'grassland');
    expect(long.turns.length - 1).toBe(60);
    expect(long.winnerSide).toBe('home');
  });
  test('deterministic for a seed; the estimate is a multiple of 5 and never changes the inputs', () => {
    const team = () => [fighter('a', 'charmander'), fighter('b', 'pidgey')], foes = () => [fighter('c', 'squirtle'), fighter('d', 'geodude')];
    expect(resolveTeamBattle(team(), foes(), 99, 'forest')).toEqual(resolveTeamBattle(team(), foes(), 99, 'forest'));
    const home = team(), estimate = estimateTeamBattle(home, foes(), 'grassland');
    expect(estimate % 5).toBe(0);
    expect(home).toEqual(team());
  });
  test('历练: +1 attack and defence per 50 XP, at most 5; none before v26', () => {
    expect([0, 49, 50, 149, 250, 999].map(xp => veteranBonus(xp, v26))).toEqual([0, 0, 1, 2, 5, 5]);
    expect(veteranBonus(250, contentFor(setup(25)))).toBe(0);
  });
});

/** Own Pokémon on and next to a gym (the gym tile first). */
function teamAt(state: GameState, gymId: number, species: SpeciesId[]): number[] {
  const gym = state.expansion!.gymCircuit!.gyms.find(item => item.id === gymId)!;
  const spots = [gym.position, ...neighbors(gym.position, state.map)].filter(hex => hexToIndex(hex, state.map) !== null);
  for (const unit of Object.values(state.units)) if (isMapUnit(unit) && spots.some(hex => hexDistance(hex, unit.position, state.map) === 0)) delete state.units[unit.id];
  const ids = species.map((speciesId, index) => {
    const id = state.nextEntityId++;
    state.units[id] = createMapUnit({ kind: 'pokemon', speciesId }, id, 0, spots[index], v26, 0, 1);
    return id;
  });
  refreshKnowledge(state, v26);
  return ids;
}
const order = (state: GameState, action: Command['action']) => step(state, { actorId: 0, expectedSeq: state.commandSeq, action }, v26);

describe('v26 gyms, guardians, Elite Four and conference (§2.2)', () => {
  test('equal-size gyms at gymPowerPercent of the table; the battle draws its seed from state.rng; preview = authority', () => {
    const state = createGame(setup(26)), gym = state.expansion!.gymCircuit!.gyms[0];
    expect(leaderTeamFor(0, v26)).toMatchObject({ members: 1, power: Math.floor(GYM_RULES_V24.teams[0].power * DEPTH26_TUNING.gymPowerPercent / 100) });
    expect(leaderTeam(gym, 0, state.setup.seed, v26)).toHaveLength(1);
    const ids = teamAt(state, gym.id, ['charmander', 'pidgey']);
    const view = observe(state, 0, v26);
    expect(viewGymBlocker(view, gym.id, ids)).toBe('invalid-team');
    expect(order(state, { type: 'ChallengeGym', gymId: gym.id, unitIds: ids })).toMatchObject({ ok: false, reason: 'invalid-command' });
    expect(viewGymBlocker(view, gym.id, [ids[0]])).toBeNull();
    const rng = { ...state.rng }, seed = randomBelow(rng, 2 ** 31);
    const result = order(state, { type: 'ChallengeGym', gymId: gym.id, unitIds: [ids[0]] });
    expect(result.ok).toBe(true);
    const event = result.ok ? result.events.map(item => item.payload).find(payload => payload.type === 'GymChallenged') : undefined;
    expect(event?.type === 'GymChallenged' && 'format' in event.battle && event.battle.seed).toBe(seed);
    expect(result.ok && result.state.rng).not.toEqual(state.rng);
    // The preview spec builds the same leader team the authority fought.
    const spec = viewGymSpec(view, gym.id, v26)!;
    expect(spec.size).toEqual({ min: 1, max: 1 });
    expect(spec.opponents[0].map(member => member.speciesId)).toEqual(leaderTeam(gym, 0, state.setup.seed, v26).map(member => member.speciesId));
    expect(estimateLineup(spec, lineupFighters(view, [ids[0]], v26)) % 5).toBe(0);
  });
  test('v25 gyms keep the v24 auto-battle and public seed (state.rng untouched)', () => {
    const v25 = contentFor(setup(25)), state = createGame(setup(25)), gym = state.expansion!.gymCircuit!.gyms[0];
    const spots = [gym.position, ...neighbors(gym.position, state.map)];
    for (const unit of Object.values(state.units)) if (isMapUnit(unit) && spots.some(hex => hexDistance(hex, unit.position, state.map) === 0)) delete state.units[unit.id];
    const ids = ['charmander', 'pidgey'].map((speciesId, index) => {
      const id = state.nextEntityId++;
      state.units[id] = createMapUnit({ kind: 'pokemon', speciesId: speciesId as SpeciesId }, id, 0, spots[index], v25, 0, 1);
      return id;
    });
    refreshKnowledge(state, v25);
    const result = step(state, { actorId: 0, expectedSeq: state.commandSeq, action: { type: 'ChallengeGym', gymId: gym.id, unitIds: ids } }, v25);
    expect(result.ok).toBe(true);
    expect(result.ok && result.state.rng).toEqual(state.rng);
  });
  test('guardians: species attack and defence, HP 150% at 620 to 200% at 860', () => {
    const site = (challengePower: number) => ({ id: 'x', guardianSpeciesId: 'machamp' as SpeciesId, challengePower });
    const species = v26.species.machamp;
    expect(guardianFighter(site(620), v26)).toMatchObject({ attack: species.attack, defense: species.defense, maxHp: Math.floor(species.maxHp * 1.5) });
    expect(guardianFighter(site(860), v26).maxHp).toBe(species.maxHp * 2);
    expect(guardianFighter(site(740), v26).maxHp).toBe(Math.floor(species.maxHp * 175 / 100));
  });
  test('conference NPC teams: six per season, six regional Pokémon each, original names, more power per slot and season', () => {
    const teams = championshipNpcEntrants(31, 1, v26), later = championshipNpcEntrants(31, 4, v26);
    expect(teams).toHaveLength(6);
    expect(teams.every(team => team.roster.length === 6 && team.name.length > 0)).toBe(true);
    const regional = new Set(v26.regionalDex!.speciesIds);
    expect(teams.every(team => team.roster.every(member => regional.has(member.speciesId)))).toBe(true);
    expect(championshipNpcEntrants(31, 1, v26)).toEqual(teams);
    const total = (team: (typeof teams)[number]) => team.roster.reduce((sum, member) => sum + member.maxHp + member.attack + member.defense, 0);
    expect(total(later[0]) / total(teams[0])).toBeGreaterThan(1);
  });
});

describe('v26 AI lineups (§2.4)', () => {
  test('chooseLineup picks the counter: against a fire leader it sends the water Pokémon, whatever the id order', () => {
    const state = createGame(setup(26)), gym = state.expansion!.gymCircuit!.gyms.find(item => item.typeId === 'fire') ?? state.expansion!.gymCircuit!.gyms[0];
    gym.typeId = 'fire';
    const ids = teamAt(state, gym.id, ['bulbasaur', 'squirtle']);
    const view = observe(state, 0, v26), spec = { ...viewGymSpec(view, gym.id, v26)!, onSite: [] };
    const choice = chooseLineup(view, spec, v26)!;
    expect(choice.unitIds).toEqual([ids[1]]);
  });
  test('real AI v26 games: no refused team commands, relay events only', () => {
    let state = createGame({ ...setup(26, 33), players: [{ id: 0, controller: 'ai', personality: 'aggressive' }, { id: 1, controller: 'ai', personality: 'conservative' }, { id: 2, controller: 'ai', personality: 'expansion' }] });
    const content = contentFor(state.setup), rejected: string[] = [], formats = new Set<string>(), memory: RejectedCitySite[] = [];
    while (!state.outcome && state.round <= 45) {
      const view = observe(state, state.activePlayerId, content);
      let command = planNext(view, { ...RULE_QUERIES, content }, memory), result = step(state, command, content);
      if (!result.ok) {
        rejected.push(`${command.action.type}:${result.reason}`);
        rememberCityRejection(memory, view, command, result.reason);
        command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
        result = step(state, command, content);
      }
      if (!result.ok) throw new Error(result.reason);
      for (const { payload } of result.events) if ((payload.type === 'GymChallenged' || payload.type === 'GuardianChallenged') && 'format' in payload.battle) formats.add(payload.battle.format);
      state = result.state;
    }
    expect(rejected.filter(reason => /Challenge|Register/.test(reason))).toEqual([]);
    expect([...formats]).toEqual(['relay']);
  }, 120_000);
});
