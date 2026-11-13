import { describe, expect, test } from 'vitest';
import { GYM_RULES_V24 } from '../../src/content/gym-circuit.ts';
import { WORLD24_CONTENT, contentFor } from '../../src/content/units.ts';
import type { SpeciesId } from '../../src/content/species.ts';
import { CIVILIZATION_CONTENT } from '../../src/content/civilization-systems.ts';
import { applyCivilizationAction, resolveCivilizationRound } from '../../src/core/civilization-systems.ts';
import { createGame } from '../../src/core/game.ts';
import { hexDistance, hexToIndex, neighbors } from '../../src/core/hex.ts';
import { isMapUnit } from '../../src/core/model.ts';
import type { Command, GameSetup, GameState, VisibleEvent } from '../../src/core/model.ts';
import { step } from '../../src/core/step.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { challengeReplay, effectTone, finalHp, leagueMatchReplay, multiplierText, snapshotChallenge } from '../../src/browser/battle-replay.ts';
import type { ChallengeAction } from '../../src/browser/battle-replay.ts';
import type { BattleTrace } from '../../src/core/civilization-systems.ts';

// depth-v26 §2.5 (presentation only): replays rebuilt from real authority results add up strike by strike.
const content = WORLD24_CONTENT;
const setup = (seed = 31): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 24,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur' }, { id: 1, controller: 'ai' }] });
function teamAt(state: GameState, gymId: number, species: SpeciesId[]): number[] {
  const gym = state.expansion!.gymCircuit!.gyms.find(item => item.id === gymId)!;
  const spots = [gym.position, ...neighbors(gym.position, state.map)].filter(hex => hexToIndex(hex, state.map) !== null);
  for (const unit of Object.values(state.units)) if (isMapUnit(unit) && spots.some(hex => hexDistance(hex, unit.position, state.map) === 0)) delete state.units[unit.id];
  const ids = species.map((speciesId, index) => {
    const id = state.nextEntityId++;
    state.units[id] = createMapUnit({ kind: 'pokemon', speciesId }, id, 0, spots[index], content, 0, 1);
    return id;
  });
  refreshKnowledge(state, content);
  return ids;
}
const challenge = (state: GameState, action: ChallengeAction) => {
  const before = observe(state, 0, content), snapshot = snapshotChallenge(before, action)!;
  const result = step(state, { actorId: 0, expectedSeq: state.commandSeq, action } as Command, content);
  if (!result.ok) throw new Error(result.reason);
  const payload = result.events.map(event => event.payload).find(item => item.type === 'GymChallenged' || item.type === 'EliteFourChallenged') as VisibleEvent['payload'];
  return { snapshot, payload, view: observe(result.state, 0, content) };
};

describe('battle replay model', () => {
  test('a gym challenge (one challenger hurt) replays every strike from the snapshot and ends at the HP the authority wrote back', () => {
    const state = createGame(setup()), gym = state.expansion!.gymCircuit!.gyms[0]!;
    const ids = teamAt(state, gym.id, ['ivysaur', 'pikachu']);
    state.units[ids[1]!]!.hp = 20;
    const { snapshot, payload, view } = challenge(state, { type: 'ChallengeGym', gymId: gym.id, unitIds: ids });
    if (payload.type !== 'GymChallenged') throw new Error('expected a gym result');
    const replay = challengeReplay(view, snapshot, payload)!;
    expect(replay).not.toBeNull();
    expect(replay.kind).toBe('gym');
    const battle = replay.battles[0]!;
    expect(battle.home.map(item => item.hp)).toEqual([content.species.ivysaur.maxHp, 20]);
    expect(battle.strikes).toHaveLength((payload.battle as BattleTrace).rounds.reduce((sum, round) => sum + round.strikes.length, 0));
    expect(battle.winner === 'home').toBe(payload.victory);
    // The authority keeps at least 1 HP; the replay's last HP is the battle's.
    const after = finalHp(battle);
    ids.forEach((id, index) => expect(view.units.find(unit => unit.id === id)!.hp).toBe(Math.max(1, after.get(`challenger-0-${index}`)!)));
  });

  test('a mismatched snapshot (wrong HP) is refused rather than shown wrong', () => {
    const state = createGame(setup(32)), gym = state.expansion!.gymCircuit!.gyms[0]!;
    const ids = teamAt(state, gym.id, ['charmeleon']);
    const { snapshot, payload, view } = challenge(state, { type: 'ChallengeGym', gymId: gym.id, unitIds: ids });
    if (payload.type !== 'GymChallenged') throw new Error('expected a gym result');
    const struck = (payload.battle as BattleTrace).rounds.some(round => round.strikes.some(strike => strike.defenderId === 'challenger-0-0' && strike.defenderHpAfter > 0));
    if (struck) expect(challengeReplay(view, { ...snapshot, team: snapshot.team.map(member => ({ ...member, hp: member.hp - 7 })) }, payload)).toBeNull();
  });

  test('the Elite Four replays as consecutive battles with the between-battle heal', () => {
    const state = createGame(setup()), circuit = state.expansion!.gymCircuit!;
    const ids = teamAt(state, circuit.gyms[0]!.id, ['venusaur', 'charizard', 'blastoise', 'dragonite', 'gengar', 'snorlax']);
    circuit.badges[0] = circuit.gyms.slice(0, GYM_RULES_V24.gymCount).map(item => item.id);
    const { snapshot, payload, view } = challenge(state, { type: 'ChallengeEliteFour', unitIds: ids });
    if (payload.type !== 'EliteFourChallenged') throw new Error('expected an Elite Four result');
    const replay = challengeReplay(view, snapshot, payload)!;
    expect(replay.battles).toHaveLength(payload.battles.length);
    if (replay.battles.length > 1) expect(replay.battles[1]!.healed).toBe(GYM_RULES_V24.eliteFour.healPercentBetween);
  });

  test('a sanctuary guardian challenge and every league match of a season replay', () => {
    const civilization: GameSetup = { seed: 9001, width: 24, height: 16, expansionVersion: 1, multiplayer: true,
      players: [{ id: 0, controller: 'human', starterId: 'bulbasaur' }, { id: 1, controller: 'human', starterId: 'charmander' }] };
    const state = createGame(civilization), world = CIVILIZATION_CONTENT.world, civ = state.expansion!.civilization, site = civ.sanctuaries[0]!;
    state.activePlayerId = 0; state.players[0]!.gold = 1000;
    const ids = Array.from({ length: 6 }, (_, index) => 900 + index);
    ids.forEach((id, index) => { state.units[id] = createMapUnit({ kind: 'pokemon', speciesId: 'dragonite' }, id, 0, { q: site.position.q + (index < 3 ? index : 0), r: site.position.r + (index < 3 ? 0 : 3) }, world, 0, 1); });
    state.units[899] = createMapUnit({ kind: 'logistics', role: 'settler' }, 899, 0, site.position);
    applyCivilizationAction(state, 0, { type: 'EstablishSanctuary', siteId: site.id, unitId: 899 });
    refreshKnowledge(state, world);
    const action = { type: 'ChallengeGuardian' as const, siteId: site.id, unitIds: ids.slice(0, 3) };
    const snapshot = snapshotChallenge(observe(state, 0, world), action)!;
    const event = applyCivilizationAction(state, 0, action).find(item => item.type === 'GuardianChallenged');
    if (event?.type !== 'GuardianChallenged') throw new Error('expected a guardian result');
    const replay = challengeReplay(observe(state, 0, world), snapshot, event)!;
    expect(replay.kind).toBe('guardian');
    expect(replay.battles[0]!.arena).toBe('altar');

    for (const id of ids) state.units[id]!.actionLeft = 1;
    state.round = 1; civ.championship.nextRound = 1;
    applyCivilizationAction(state, 0, { type: 'RegisterChampionshipTeam', unitIds: ids });
    const resolved = resolveCivilizationRound(state).find(item => item.type === 'ChampionshipResolved');
    if (resolved?.type !== 'ChampionshipResolved') throw new Error('expected a season');
    const view = observe(state, 0, world);
    for (const match of resolved.season.matches) {
      const league = leagueMatchReplay(view, resolved.season, match.label, entrant => entrant.entrantId)!;
      expect(league, match.label).not.toBeNull();
      expect(league.battles[0]!.winner === 'home').toBe(match.winnerEntrantId === match.entrantIds[0]);
    }
  });

  test('matchup wording', () => {
    expect([effectTone(220), effectTone(50), effectTone(0), effectTone(100)]).toEqual(['super', 'weak', 'none', 'normal']);
    expect([multiplierText(220), multiplierText(50), multiplierText(100), multiplierText(484)]).toEqual(['×2.2', '×0.5', '×1', '×4.84']);
  });
});

// Gameplay v26: relay traces (turns of send / switch / strike / faint) replay one Pokémon per side.
describe('battle replay model: v26 relay battles', () => {
  const v26Setup = (seed = 31): GameSetup => ({ ...setup(seed), gameplayVersion: 26 });
  const v26 = contentFor(v26Setup());
  const relayChallenge = (state: GameState, action: ChallengeAction) => {
    const snapshot = snapshotChallenge(observe(state, 0, v26), action)!;
    const result = step(state, { actorId: 0, expectedSeq: state.commandSeq, action } as Command, v26);
    if (!result.ok) throw new Error(result.reason);
    const payload = result.events.map(event => event.payload).find(item => item.type === 'GymChallenged' || item.type === 'EliteFourChallenged') as VisibleEvent['payload'];
    return { snapshot, payload, view: observe(result.state, 0, v26) };
  };
  const place = (state: GameState, gymId: number, species: SpeciesId[]) => {
    const ids = teamAt(state, gymId, species);
    for (const id of ids) state.units[id] = createMapUnit({ kind: 'pokemon', speciesId: (state.units[id] as { speciesId: SpeciesId }).speciesId }, id, 0, (state.units[id] as { position: { q: number; r: number } }).position, v26, 0, 1);
    refreshKnowledge(state, v26);
    return ids;
  };

  test('a gym relay replays strike by strike, with the lead and every switch-in, ending at the HP written back', () => {
    const state = createGame(v26Setup()), gym = state.expansion!.gymCircuit!.gyms[0]!;
    const ids = place(state, gym.id, ['ivysaur']);
    const { snapshot, payload, view } = relayChallenge(state, { type: 'ChallengeGym', gymId: gym.id, unitIds: ids });
    if (payload.type !== 'GymChallenged' || !('turns' in payload.battle)) throw new Error('expected a relay gym result');
    const replay = challengeReplay(view, snapshot, payload)!;
    expect(replay).not.toBeNull();
    const battle = replay.battles[0]!;
    expect(battle.format).toBe('relay');
    expect(battle.lead).toEqual({ home: payload.battle.lineups.home[0], away: payload.battle.lineups.away[0] });
    expect(battle.strikes).toHaveLength(payload.battle.turns.flatMap(turn => turn.acts).filter(act => act.kind === 'strike').length);
    expect(battle.rounds).toBe(payload.battle.turns.length - 1);
    expect(battle.winner === 'home').toBe(payload.victory);
    const sends = payload.battle.turns.slice(1).flatMap(turn => turn.acts).filter(act => act.kind === 'send' || act.kind === 'switch').length;
    // Sends after the last strike (the loser's next Pokémon when time ran out) ride on no strike.
    const acts = payload.battle.turns.flatMap(turn => turn.acts), afterLast = acts.length - 1 - [...acts].reverse().findIndex(act => act.kind === 'strike');
    const trailing = acts.slice(afterLast + 1).filter(act => act.kind === 'send' || act.kind === 'switch').length;
    expect(battle.strikes.reduce((sum, strike) => sum + (strike.sentIn?.length ?? 0), 0)).toBe(sends - trailing);
    ids.forEach((id, index) => expect(view.units.find(unit => unit.id === id)!.hp).toBe(Math.max(1, finalHp(battle).get(`challenger-0-${index}`)!)));
  });

  test('the Elite Four relay replays every battle with the heal in between', () => {
    const state = createGame(v26Setup()), circuit = state.expansion!.gymCircuit!;
    const ids = place(state, circuit.gyms[0]!.id, ['venusaur', 'charizard', 'blastoise', 'dragonite', 'gengar', 'snorlax']);
    circuit.badges[0] = circuit.gyms.slice(0, GYM_RULES_V24.gymCount).map(item => item.id);
    const { snapshot, payload, view } = relayChallenge(state, { type: 'ChallengeEliteFour', unitIds: ids });
    if (payload.type !== 'EliteFourChallenged') throw new Error('expected an Elite Four result');
    const replay = challengeReplay(view, snapshot, payload)!;
    expect(replay.battles).toHaveLength(payload.battles.length);
    expect(replay.battles.every(battle => battle.format === 'relay')).toBe(true);
  });

  test('a v26 guardian challenge and every relay match of a conference season replay', () => {
    const civilization: GameSetup = { seed: 9001, width: 24, height: 16, expansionVersion: 1, multiplayer: true, gameplayVersion: 26, roundLimit: 100, eraProgression: 'simple-v1',
      players: [{ id: 0, controller: 'human', starterId: 'bulbasaur' }, { id: 1, controller: 'human', starterId: 'charmander' }] };
    const world = contentFor(civilization), content = { ...CIVILIZATION_CONTENT, world };
    const state = createGame(civilization), civ = state.expansion!.civilization, site = civ.sanctuaries[0]!;
    state.activePlayerId = 0; state.players[0]!.gold = 1000;
    const ids = Array.from({ length: 6 }, (_, index) => 900 + index);
    ids.forEach((id, index) => { state.units[id] = createMapUnit({ kind: 'pokemon', speciesId: 'dragonite' }, id, 0, { q: site.position.q + (index < 3 ? index : 0), r: site.position.r + (index < 3 ? 0 : 3) }, world, 0, 1); });
    state.units[899] = createMapUnit({ kind: 'logistics', role: 'settler' }, 899, 0, site.position);
    applyCivilizationAction(state, 0, { type: 'EstablishSanctuary', siteId: site.id, unitId: 899 }, content);
    refreshKnowledge(state, world);
    const action = { type: 'ChallengeGuardian' as const, siteId: site.id, unitIds: ids.slice(0, 3) };
    const snapshot = snapshotChallenge(observe(state, 0, world), action)!;
    const event = applyCivilizationAction(state, 0, action, content).find(item => item.type === 'GuardianChallenged');
    if (event?.type !== 'GuardianChallenged' || !('turns' in event.battle)) throw new Error('expected a relay guardian result');
    const replay = challengeReplay(observe(state, 0, world), snapshot, event)!;
    expect(replay.battles[0]!.format).toBe('relay');

    for (const id of ids) state.units[id]!.actionLeft = 1;
    state.round = 1; civ.championship.nextRound = 1;
    applyCivilizationAction(state, 0, { type: 'RegisterChampionshipTeam', unitIds: ids }, content);
    const resolved = resolveCivilizationRound(state, content).find(item => item.type === 'ChampionshipResolved');
    if (resolved?.type !== 'ChampionshipResolved') throw new Error('expected a season');
    const view = observe(state, 0, world);
    for (const match of resolved.season.matches) {
      expect('turns' in match.battle).toBe(true);
      const league = leagueMatchReplay(view, resolved.season, match.label, entrant => entrant.entrantId)!;
      expect(league, match.label).not.toBeNull();
      expect(league.battles[0]!.format).toBe('relay');
      expect(league.battles[0]!.winner === 'home').toBe(match.winnerEntrantId === match.entrantIds[0]);
    }
  });
});
