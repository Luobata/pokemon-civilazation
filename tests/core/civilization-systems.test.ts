import { traceStrikes, traceTurns } from '../../src/core/team-battle.ts';
import { describe, expect, test } from 'vitest';
import { CIVILIZATION_CONTENT } from '../../src/content/civilization-systems.ts';
import type { CivilizationContent } from '../../src/content/civilization-systems.ts';
import { createGame } from '../../src/core/game.ts';
import { step } from '../../src/core/step.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { hexDistance, hexToIndex } from '../../src/core/hex.ts';
import type { GameSetup, GameState } from '../../src/core/model.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import {
  applyCivilizationAction, consumeCivilizationProduction, initializeCivilization, isCivilizationAction,
  observeCivilization, planCivilizationAction, resolveCivilizationRound, validateCivilizationAction,
} from '../../src/core/civilization-systems.ts';

const setup: GameSetup = {
  seed: 9001, width: 24, height: 16, expansionVersion: 1, multiplayer: true,
  players: [
    { id: 0, controller: 'human', starterId: 'bulbasaur' },
    { id: 1, controller: 'human', starterId: 'charmander' },
  ],
};
function fixture(content: CivilizationContent = CIVILIZATION_CONTENT): GameState {
  const useSetup = content === CIVILIZATION_CONTENT ? setup : { ...setup, expansionVersion: undefined };
  const state = createGame(useSetup);
  if (!state.expansion?.civilization) initializeCivilization(state, content);
  state.activePlayerId = 0;
  state.players[0]!.gold = 1000;
  state.players[1]!.gold = 1000;
  return state;
}
function strongTeam(state: GameState, ownerId: number, firstId: number, speciesId: 'dragonite' | 'clefable' | 'venusaur' = 'dragonite'): number[] {
  const base = { q: 0, r: 0 };
  const ids = Array.from({ length: 6 }, (_, index) => firstId + index);
  for (const [index, id] of ids.entries()) {
    state.units[id] = createMapUnit({ kind: 'pokemon', speciesId }, id, ownerId,
      { q: base.q + index, r: base.r }, CIVILIZATION_CONTENT.world, index * 20, 1);
  }
  return ids;
}
function placeAtSite(state: GameState, siteIndex: number, unitIds: number[]): void {
  const civilization = state.expansion!.civilization;
  const site = civilization.sanctuaries[siteIndex]!;
  for (const [index, unitId] of unitIds.entries()) {
    const unit = state.units[unitId]!;
    unit.location = 'map';
    unit.position = index === 0 ? { ...site.position } : { q: site.position.q + index, r: site.position.r };
    unit.hp = CIVILIZATION_CONTENT.world.species[unit.kind === 'pokemon' ? unit.speciesId : 'bulbasaur'].maxHp;
    unit.actionLeft = 1;
  }
}

function establishSanctuary(state: GameState, siteIndex = 0) {
  const site = state.expansion!.civilization.sanctuaries[siteIndex]!;
  const unitId = state.nextEntityId++;
  state.units[unitId] = createMapUnit({ kind: 'logistics', role: 'settler' }, unitId, 0, site.position);
  applyCivilizationAction(state, 0, { type: 'EstablishSanctuary', siteId: site.id, unitId });
  return site;
}

describe('versioned initialization', () => {
  test('legacy state stays absent and expansion initialization is deterministic', () => {
    const legacySetup = { ...setup, expansionVersion: undefined };
    expect(createGame(legacySetup).expansion).toBeUndefined();
    const first = createGame(setup), second = createGame(setup);
    expect(canonicalSerialize(first)).toBe(canonicalSerialize(second));
    expect(first.expansion!.civilization.sanctuaries.map(site => [site.id, site.position]))
      .toEqual(second.expansion!.civilization.sanctuaries.map(site => [site.id, site.position]));
  });
});

describe('S23 faith and one-shot phantoms', () => {
  test('all four civilizations receive distinct names in every phantom category', () => {
    const state = createGame({ ...setup, players: [...setup.players,
      { id: 2, controller: 'human', starterId: 'squirtle' },
      { id: 3, controller: 'human', starterId: 'bulbasaur' },
    ] });
    const players = Object.values(state.expansion!.civilization.players);
    for (const player of players) player.offeringPoints = 300;
    for (const category of ['scientist', 'engineer', 'merchant', 'general', 'artist'] as const) {
      for (const playerId of [0, 1, 2, 3]) applyCivilizationAction(state, playerId, { type: 'SummonPhantom', category });
      expect(new Set(players.map(player => player.phantomNameLedger[category])).size).toBe(4);
    }
  });

  test('offerings require a controlled sanctuary, pay exact resources, and are limited once per city per round', () => {
    const state = fixture(), city = state.cities[state.players[0]!.headquartersCityId]!;
    city.food = 30;
    expect(validateCivilizationAction(state, 0, { type: 'MakeOffering', cityId: city.id, resource: 'food' })).toBe('sanctuary-not-owned');
    establishSanctuary(state);
    const events = applyCivilizationAction(state, 0, { type: 'MakeOffering', cityId: city.id, resource: 'food' });
    expect(events).toHaveLength(1);
    expect(city.food).toBe(20);
    expect(state.expansion!.civilization.players[0]).toMatchObject({ offeringPoints: 5, lifetimeOfferings: 5 });
    expect(validateCivilizationAction(state, 0, { type: 'MakeOffering', cityId: city.id, resource: 'gold' })).toBe('offering-already-made');
    resolveCivilizationRound(state);
    expect(state.expansion!.civilization.players[0]!.offeredThisRoundByCity).toEqual({});
    state.players[0]!.gold = 30;
    applyCivilizationAction(state, 0, { type: 'MakeOffering', cityId: city.id, resource: 'gold' });
    expect(state.players[0]!.gold).toBe(10);
  });

  test('all five phantoms summon at escalating cost, activate once, and have named hall-of-fame records', () => {
    const state = fixture(), civilization = state.expansion!.civilization;
    civilization.players[0]!.offeringPoints = 300;
    const city = state.cities[state.players[0]!.headquartersCityId]!;
    city.food = 100;
    city.queue = [{ id: 77, progress: 0, item: { kind: 'building', defId: 'meetingHall' } }];
    state.players[0]!.research.techId = 'domestication';
    const team = strongTeam(state, 0, 800);
    for (const category of ['scientist', 'engineer', 'merchant', 'general', 'artist'] as const) {
      applyCivilizationAction(state, 0, { type: 'SummonPhantom', category });
    }
    expect(civilization.players[0]!.summonedPhantomIds).toEqual(['scientist', 'engineer', 'merchant', 'general', 'artist']);
    expect([30, 45, 60, 75, 90].reduce((sum, value) => sum + value, 0)).toBe(300);
    expect(civilization.players[0]!.offeringPoints).toBe(0);
    const before = state.players[0]!.research.progressByTech.domestication!;
    applyCivilizationAction(state, 0, { type: 'ActivatePhantom', phantomId: 'scientist' });
    expect(state.players[0]!.research.progressByTech.domestication).toBe(20);
    expect(state.players[0]!.research.unlockedIds).toContain('domestication');
    expect(state.players[0]!.research.reserve).toBe(before + 20);
    applyCivilizationAction(state, 0, { type: 'ActivatePhantom', phantomId: 'engineer', cityId: city.id });
    expect(civilization.pendingProductionByCity[city.id]).toEqual({ playerId: 0, amount: 40 });
    expect(consumeCivilizationProduction(state, city.id)).toBe(40);
    expect(city.queue[0]!.progress).toBe(40);
    const gold = state.players[0]!.gold;
    applyCivilizationAction(state, 0, { type: 'ActivatePhantom', phantomId: 'merchant' });
    expect(state.players[0]!.gold).toBe(gold + 60);
    applyCivilizationAction(state, 0, { type: 'ActivatePhantom', phantomId: 'general', unitIds: team });
    expect(team.map(id => state.units[id]!.xp)).toEqual(team.map((_, index) => index * 20 + 20));
    const food = city.food;
    applyCivilizationAction(state, 0, { type: 'ActivatePhantom', phantomId: 'artist', cityId: city.id });
    expect(city.food).toBe(food + 40);
    expect(civilization.players[0]!.hallOfFame).toEqual(['artist', 'engineer', 'general', 'merchant', 'scientist']);
    expect(new Set(Object.values(civilization.players[0]!.phantomNameLedger)).size).toBe(5);
    expect(validateCivilizationAction(state, 0, { type: 'ActivatePhantom', phantomId: 'merchant' })).toBe('phantom-unavailable');
  });
});

describe('S24–S26 sanctuaries, guardian battles, and origin victory', () => {
  test('sanctuary challenges require ownership and local ready Pokémon, then wear HP and consume action points', () => {
    const state = fixture(), civilization = state.expansion!.civilization;
    const site = civilization.sanctuaries[0]!, team = strongTeam(state, 0, 810).slice(0, 3);
    placeAtSite(state, 0, team);
    const establishment = createMapUnit({ kind: 'logistics', role: 'settler' }, 809, 0, site.position);
    state.units[809] = establishment;
    const events = applyCivilizationAction(state, 0, { type: 'EstablishSanctuary', siteId: site.id, unitId: 809 });
    expect(events[0]).toMatchObject({ type: 'SanctuaryEstablished', playerId: 0 });
    expect(site.ownerId).toBe(0);
    state.units[team[1]!]!.position = { q: site.position.q + 10, r: site.position.r };
    expect(validateCivilizationAction(state, 0, { type: 'ChallengeGuardian', siteId: site.id, unitIds: team })).toBe('unit-not-local');
    placeAtSite(state, 0, team);
    state.units[team[1]!]!.actionLeft = 0;
    expect(validateCivilizationAction(state, 0, { type: 'ChallengeGuardian', siteId: site.id, unitIds: team })).toBe('unit-not-local');
    placeAtSite(state, 0, team);
    const challenge = applyCivilizationAction(state, 0, { type: 'ChallengeGuardian', siteId: site.id, unitIds: team })
      .find(event => event.type === 'GuardianChallenged');
    expect(challenge).toBeDefined();
    if (challenge?.type !== 'GuardianChallenged') throw new Error('missing challenge');
    const replayState = structuredClone(state), replaySite = replayState.expansion!.civilization.sanctuaries[0]!;
    replaySite.challengeRoundByPlayer = {};
    replaySite.guardianDefeated = false;
    delete replayState.expansion!.civilization.tabletOwners[replaySite.tabletId];
    for (const unitId of team) {
      replayState.units[unitId]!.actionLeft = 1;
      replayState.units[unitId]!.hp = CIVILIZATION_CONTENT.world.species.dragonite.maxHp;
    }
    const replay = applyCivilizationAction(replayState, 0, { type: 'ChallengeGuardian', siteId: site.id, unitIds: team })
      .find(event => event.type === 'GuardianChallenged');
    expect(replay).toEqual(challenge);
    expect(traceTurns(challenge.battle)).toBeGreaterThan(0);
    expect(traceStrikes(challenge.battle).every(strike => strike.damage >= 0)).toBe(true);
    expect(team.map(id => state.units[id]!.actionLeft)).toEqual([0, 0, 0]);
    expect(team.map(id => state.units[id]!.hp).every(hp => hp >= 1)).toBe(true);
    expect(validateCivilizationAction(state, 0, { type: 'ChallengeGuardian', siteId: site.id, unitIds: team })).toBe('guardian-unavailable');
  });

  test('claiming all four tablets through guardian battles triggers origin victory', () => {
    const originContent = structuredClone(CIVILIZATION_CONTENT);
    for (const site of originContent.sanctuaries.definitions) {
      site.guardianSpeciesId = 'dragonite';
      site.challengePower = 300;
    }
    const state = fixture(originContent), civilization = state.expansion!.civilization;
    const fullTeam = strongTeam(state, 0, 830, 'clefable'), team = fullTeam.slice(0, 3);
    for (const [siteIndex, site] of civilization.sanctuaries.entries()) {
      placeAtSite(state, siteIndex, team);
      establishSanctuary(state, siteIndex);
      const event = applyCivilizationAction(state, 0, { type: 'ChallengeGuardian', siteId: site.id, unitIds: team })
        .find(item => item.type === 'GuardianChallenged');
      if (event?.type !== 'GuardianChallenged' || !event.victory) throw new Error(`guardian ${site.id} was not defeated`);
      expect(civilization.tabletOwners[site.tabletId]).toBe(0);
      for (const unitId of team) {
        state.units[unitId]!.actionLeft = 1;
        state.units[unitId]!.hp = CIVILIZATION_CONTENT.world.species.dragonite.maxHp;
      }
    }
    expect(civilization.victory).toMatchObject({ kind: 'origin', playerId: 0 });
    expect(state.outcome).toMatchObject({ kind: 'origin', winners: [0] });
  });
});

describe('S27 recurring league championship', () => {
  test('six-unit registrations fill NPC slots and resolve a traced five-match bracket', () => {
    const state = fixture(), civilization = state.expansion!.civilization, team = strongTeam(state, 0, 850);
    state.round = 1;
    civilization.championship.nextRound = 1;
    const registration = applyCivilizationAction(state, 0, { type: 'RegisterChampionshipTeam', unitIds: team });
    expect(registration[0]).toMatchObject({ type: 'ChampionshipTeamRegistered', power: team.reduce((total, id) => {
      const unit = state.units[id]!, species = CIVILIZATION_CONTENT.world.species[unit.kind === 'pokemon' ? unit.speciesId : 'bulbasaur'];
      return total + species.maxHp + species.attack + species.defense + Math.floor(unit.xp / 10);
    }, 0) });
    const events = resolveCivilizationRound(state);
    const event = events.find(item => item.type === 'ChampionshipResolved');
    if (event?.type !== 'ChampionshipResolved') throw new Error('missing championship');
    const season = event.season;
    expect(season.entrants).toHaveLength(6);
    expect(season.entrants.every(entrant => entrant.roster.length === 6)).toBe(true);
    expect(season.matches.map(match => match.label)).toEqual(['preliminary-1', 'preliminary-2', 'semifinal-1', 'semifinal-2', 'final']);
    expect(season.matches.every(match => traceTurns(match.battle) > 0)).toBe(true);
    expect(civilization.championship.registrations).toEqual({});
    expect(civilization.championship.nextRound).toBe(21);
    expect(civilization.championship.history).toHaveLength(1);
  });

  test('a second championship title ends the game', () => {
    const state = fixture(), civilization = state.expansion!.civilization, team = strongTeam(state, 0, 870, 'venusaur');
    civilization.championship.nextRound = 1;
    state.round = 1;
    applyCivilizationAction(state, 0, { type: 'RegisterChampionshipTeam', unitIds: team });
    resolveCivilizationRound(state);
    const first = civilization.championship.history[0]!;
    if (first.championPlayerId !== 0) throw new Error('strong deterministic roster did not win season one');
    state.round = civilization.championship.nextRound;
    for (const unitId of team) {
      state.units[unitId]!.hp = CIVILIZATION_CONTENT.world.species.venusaur.maxHp;
      state.units[unitId]!.actionLeft = 1;
    }
    applyCivilizationAction(state, 0, { type: 'RegisterChampionshipTeam', unitIds: team });
    resolveCivilizationRound(state);
    expect(civilization.championship.titlesByPlayer[0]).toBe(2);
    expect(civilization.victory).toMatchObject({ kind: 'championship', playerId: 0, season: 2 });
    expect(state.outcome).toMatchObject({ kind: 'championship', winners: [0] });
  });
});

describe('S28 alliances, trade, trust, and betrayal', () => {
  test('mutual agreements pay on cadence and betrayal applies permanent-record penalties', () => {
    const state = fixture(), civilization = state.expansion!.civilization, relation = civilization.relations['0:1']!;
    applyCivilizationAction(state, 0, { type: 'ProposeAlliance', targetPlayerId: 1 });
    applyCivilizationAction(state, 1, { type: 'RespondAlliance', targetPlayerId: 0, accept: true });
    applyCivilizationAction(state, 0, { type: 'ProposeTrade', targetPlayerId: 1 });
    applyCivilizationAction(state, 1, { type: 'RespondTrade', targetPlayerId: 0, accept: true });
    expect(relation.allianceSinceRound).toBe(state.round);
    relation.tradeSinceRound = state.round - 5;
    const gold0 = state.players[0]!.gold, gold1 = state.players[1]!.gold;
    const events = resolveCivilizationRound(state);
    expect(events.filter(event => event.type === 'TradeSettled')).toHaveLength(2);
    expect(state.players[0]!.gold).toBe(gold0 + 4);
    expect(state.players[1]!.gold).toBe(gold1 + 4);
    expect(relation.trust).toBe(1);
    state.players[0]!.gold = 50;
    applyCivilizationAction(state, 0, { type: 'BetrayAlliance', targetPlayerId: 1 });
    expect(state.players[0]!.gold).toBe(30);
    expect(relation).toMatchObject({ allianceSinceRound: null, tradeSinceRound: null, trust: -50, betrayedBy: [0] });
    expect(relation.betrayalCooldownUntilRound).toBe(state.round + 10);
    expect(validateCivilizationAction(state, 0, { type: 'ProposeAlliance', targetPlayerId: 1 })).toBe('proposal-unavailable');
  });

  test('war automatically dissolves both agreement types', () => {
    const state = fixture(), relation = state.expansion!.civilization.relations['0:1']!;
    relation.allianceSinceRound = 1;
    relation.tradeSinceRound = 1;
    state.diplomacy[0]!.status = 'war';
    const events = resolveCivilizationRound(state);
    expect(events.some(event => event.type === 'AllianceChanged')).toBe(true);
    expect(relation.allianceSinceRound).toBeNull();
    expect(relation.tradeSinceRound).toBeNull();
  });
});

describe('observation and deterministic planning', () => {
  test('views hide invisible tablets, expose only own relations, and never alias authority', () => {
    const setup3: GameSetup = { ...setup, players: [
      { id: 0, controller: 'human', starterId: 'bulbasaur' },
      { id: 1, controller: 'human', starterId: 'charmander' },
      { id: 2, controller: 'human', starterId: 'squirtle' },
    ] };
    const state = createGame(setup3), civilization = state.expansion!.civilization;
    civilization.tabletOwners[civilization.sanctuaries[0]!.tabletId] = 1;
    civilization.championship.history.push({
      season: 1, round: 1, entrants: [], matches: [], championEntrantId: 'npc-1-1', championPlayerId: null,
    });
    const hidden = new Set<number>();
    const hiddenView = observeCivilization(state, 0, hidden);
    expect(hiddenView.sanctuaries).toEqual([]);
    expect(hiddenView.tabletOwners).toEqual({});
    expect(hiddenView.relations.map(relation => relation.targetPlayerId)).toEqual([1, 2]);
    const visible = new Set(civilization.sanctuaries.map(site => hexToIndex(site.position, state.map)!));
    const view = observeCivilization(state, 0, visible);
    expect(view.sanctuaries).toHaveLength(4);
    expect(view.tabletOwners[civilization.sanctuaries[0]!.tabletId]).toBe(1);
    view.player.offeringPoints = 999;
    view.championship.history.length = 0;
    view.sanctuaries[0]!.ownerId = 2;
    expect(civilization.players[0]!.offeringPoints).toBe(0);
    expect(civilization.championship.history).toHaveLength(1);
    expect(civilization.sanctuaries[0]!.ownerId).toBeNull();
  });

  test('action guard accepts clean actions and planner never repeats a city offering', () => {
    const state = fixture(), city = state.cities[state.players[0]!.headquartersCityId]!, civilization = state.expansion!.civilization;
    city.food = 30;
    establishSanctuary(state);
    const visible = new Set(civilization.sanctuaries.map(site => hexToIndex(site.position, state.map)!));
    const view = observeCivilization(state, 0, visible);
    expect(view.planning.canOffer).toBe(true);
    const planned = planCivilizationAction(view);
    expect(planned).toEqual({ type: 'MakeOffering', cityId: city.id, resource: 'food' });
    expect(isCivilizationAction(planned)).toBe(true);
    expect(isCivilizationAction({ type: 'ChallengeGuardian', siteId: 'x' })).toBe(false);
    applyCivilizationAction(state, 0, planned!);
    const nextView = observeCivilization(state, 0, visible);
    const next = planCivilizationAction(nextView);
    expect(next).not.toEqual({ type: 'MakeOffering', cityId: city.id, resource: 'gold' });
    expect(hexDistance(city.position, state.cities[state.players[1]!.headquartersCityId]!.position, state.map)).toBeGreaterThan(1);
  });

  test('planner establishes a sanctuary when an eligible unit is already on a visible site', () => {
    const state = fixture(), civilization = state.expansion!.civilization, site = civilization.sanctuaries[0]!;
    const unit = Object.values(state.units).find(candidate => candidate.ownerId === 0 && candidate.kind === 'pokemon');
    if (!unit || unit.location !== 'map') throw new Error('missing deployed starter');
    unit.position = { ...site.position };
    const visible = new Set(civilization.sanctuaries.map(candidate => hexToIndex(candidate.position, state.map)!));
    const planned = planCivilizationAction(observeCivilization(state, 0, visible));
    expect(planned).toEqual({ type: 'EstablishSanctuary', siteId: site.id, unitId: unit.id });
    expect(validateCivilizationAction(state, 0, planned!)).toBeNull();
    const result = step(state, { actorId: 0, expectedSeq: state.commandSeq, action: planned! });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    const challengedState = result.state;
    for (const city of Object.values(challengedState.cities).filter(city => city.ownerId === 0)) city.food = 0;
    challengedState.players[0]!.gold = 0;
    const strongerNearby = strongTeam(challengedState, 0, 820).slice(1, 4);
    placeAtSite(challengedState, 0, strongerNearby);
    challengedState.units[strongerNearby[0]!]!.position = { q: site.position.q + 2, r: site.position.r };
    const challengeView = observeCivilization(challengedState, 0, visible);
    const challenge = planCivilizationAction(challengeView);
    expect(challenge).toMatchObject({ type: 'ChallengeGuardian', siteId: site.id });
    expect(challenge?.type === 'ChallengeGuardian' && challenge.unitIds.includes(unit.id)).toBe(true);
    expect(validateCivilizationAction(challengedState, 0, challenge!)).toBeNull();
    const challengeResult = step(challengedState, { actorId: 0, expectedSeq: challengedState.commandSeq, action: challenge! });
    expect(challengeResult.ok).toBe(true);
  });

  test('planner commands remain valid during war and after the counterpart is eliminated', () => {
    const prepare = (war: boolean, eliminated: boolean) => {
      const state = fixture(), civilization = state.expansion!.civilization;
      const city = state.cities[state.players[0]!.headquartersCityId]!;
      city.food = 30;
      establishSanctuary(state);
      civilization.relations['0:1']!.allianceProposal = { proposerId: 1, proposedRound: state.round };
      if (war) state.diplomacy[0]!.status = 'war';
      if (eliminated) state.players[1]!.eliminated = true;
      const visible = new Set(civilization.sanctuaries.map(site => hexToIndex(site.position, state.map)!));
      return { state, view: observeCivilization(state, 0, visible), city };
    };

    const war = prepare(true, false);
    expect(war.view.relations[0]).toMatchObject({ atPeace: false, targetEliminated: false });
    const warAction = planCivilizationAction(war.view);
    expect(warAction).toEqual({ type: 'MakeOffering', cityId: war.city.id, resource: 'food' });
    expect(validateCivilizationAction(war.state, 0, warAction!)).toBeNull();
    const warResult = step(war.state, { actorId: 0, expectedSeq: war.state.commandSeq, action: warAction! });
    expect(warResult.ok).toBe(true);

    const eliminated = prepare(false, true);
    expect(eliminated.view.relations[0]).toMatchObject({ atPeace: true, targetEliminated: true });
    const eliminatedAction = planCivilizationAction(eliminated.view);
    expect(eliminatedAction).toEqual({ type: 'MakeOffering', cityId: eliminated.city.id, resource: 'food' });
    expect(validateCivilizationAction(eliminated.state, 0, eliminatedAction!)).toBeNull();
    const eliminatedResult = step(eliminated.state, { actorId: 0, expectedSeq: eliminated.state.commandSeq, action: eliminatedAction! });
    expect(eliminatedResult.ok).toBe(true);
  });

  test('proposal cooldown planning mirrors the exact validation boundary', () => {
    const state = fixture(), civilization = state.expansion!.civilization;
    state.round = 11;
    state.players[0]!.gold = 0;
    state.cities[state.players[0]!.headquartersCityId]!.food = 0;
    civilization.relations['0:1']!.allianceLastProposalRound = 1;
    civilization.relations['0:1']!.tradeSinceRound = 1;
    const visible = new Set(civilization.sanctuaries.map(site => hexToIndex(site.position, state.map)!));
    expect(planCivilizationAction(observeCivilization(state, 0, visible))).toBeNull();

    state.round = 12;
    const planned = planCivilizationAction(observeCivilization(state, 0, visible));
    expect(planned).toEqual({ type: 'ProposeAlliance', targetPlayerId: 1 });
    expect(validateCivilizationAction(state, 0, planned!)).toBeNull();
    const result = step(state, { actorId: 0, expectedSeq: state.commandSeq, action: planned! });
    expect(result.ok).toBe(true);
  });

  test('gold offerings preserve a leader reserve and stop after all phantoms are complete', () => {
    const state = fixture(), civilization = state.expansion!.civilization;
    const city = state.cities[state.players[0]!.headquartersCityId]!;
    city.food = 0;
    establishSanctuary(state);
    civilization.relations['0:1']!.allianceSinceRound = 1;
    civilization.relations['0:1']!.tradeSinceRound = 1;
    state.players[0]!.gold = 119;
    const visible = new Set(civilization.sanctuaries.map(site => hexToIndex(site.position, state.map)!));
    expect(planCivilizationAction(observeCivilization(state, 0, visible))).toBeNull();

    state.players[0]!.gold = 120;
    expect(planCivilizationAction(observeCivilization(state, 0, visible)))
      .toEqual({ type: 'MakeOffering', cityId: city.id, resource: 'gold' });

    civilization.players[0]!.hallOfFame = [...CIVILIZATION_CONTENT.phantoms.definitions.map(definition => definition.id)];
    state.players[0]!.gold = 1000;
    city.food = 100;
    expect(planCivilizationAction(observeCivilization(state, 0, visible))).toBeNull();
  });
});
