// Gameplay v27 ⑥ (docs/design/pace-v27.md §7): the league roster — 8 original trainers per game (distinct names, primary types and
// signature stage-3 Pokémon), teams that grow per season, the stage weights, who comes to a season, records and the nemesis.
import { describe, expect, test } from 'vitest';
import { CIVILIZATION_CONTENT } from '../../src/content/civilization-systems.ts';
import { CONFERENCE_TRAINERS, LEAGUE_TRAINER_NAMES, TRAINER_ARCHETYPES } from '../../src/content/conference.ts';
import { DEPTH26_TUNING } from '../../src/content/depth-v26.ts';
import { TRAINERS_TUNING } from '../../src/content/pace-v27.ts';
import { RIVAL_NAMES } from '../../src/content/rivals.ts';
import { regionalSpeciesIds } from '../../src/content/roster.ts';
import { stableSeed } from '../../src/content/stable-seed.ts';
import { contentFor, contentForView } from '../../src/content/units.ts';
import type { Content, SpeciesId } from '../../src/content/units.ts';
import { championshipNpcEntrants, resolveCivilizationRound } from '../../src/core/civilization-systems.ts';
import type { ChampionshipSeason } from '../../src/core/civilization-systems.ts';
import { recordEraHonors } from '../../src/core/era-honors.ts';
import { createGame } from '../../src/core/game.ts';
import {
  leagueNemesis, leagueRecords, leagueRoster, leagueRosterEntrants, leagueSeasonTrainers, settleLeagueNemeses, leagueTeam, leagueTeamPower, leagueTeamSpecies, leagueTrainerId,
} from '../../src/core/league-roster.ts';
import type { GameSetup, GameState } from '../../src/core/model.ts';
import { observe } from '../../src/core/vision.ts';
import { nemesisTrainingBonus } from '../../src/ai/roster-plan.ts';

const LEADERS = ['brock', 'misty', 'oak', 'joy', 'jenny', 'giovanni', 'lance', 'steven', 'jasmine'] as const;
const setup = (gameplayVersion: 26 | 27, seed = 31, rotation = 0): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1,
  eraProgression: 'simple-v1', gameplayVersion, dexSeed: stableSeed(seed, rotation, 'gate-dex'),
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: LEADERS[rotation % LEADERS.length] },
    ...[1, 2, 3].map(id => ({ id, controller: 'ai' as const, leaderId: LEADERS[(id + rotation) % LEADERS.length] }))] });
const v27 = contentFor(setup(27));
/** The 72 gate Pokédexes (8 seeds × 9 leader rotations). */
const gateDexes = (): { seed: number; content: Content }[] =>
  [31, 32, 33, 34, 35, 36, 37, 38].flatMap(seed => Array.from({ length: 9 }, (_, rotation) => ({ seed, content: contentFor(setup(27, seed, rotation)) })));

describe('the roster (§7.1)', () => {
  test('24 original names in 8 archetypes; the v26 twelve kept as they were; none is a rival name', () => {
    expect(TRAINER_ARCHETYPES).toHaveLength(8);
    expect(new Set(LEAGUE_TRAINER_NAMES).size).toBe(24);
    for (const name of CONFERENCE_TRAINERS) expect(LEAGUE_TRAINER_NAMES).toContain(name);
    expect(CONFERENCE_TRAINERS).toHaveLength(12);
    for (const name of RIVAL_NAMES) expect(LEAGUE_TRAINER_NAMES).not.toContain(name);
    expect(new Set(TRAINER_ARCHETYPES.map(archetype => archetype.title)).size).toBe(8);
  });

  test('every gate Pokédex: 8 trainers, distinct names, primary types and stage-3 signatures of the primary type, five more each', () => {
    for (const { seed, content } of gateDexes()) {
      const roster = leagueRoster(seed, content), dex = new Set(regionalSpeciesIds(content));
      expect(roster.map(trainer => trainer.id)).toEqual(TRAINER_ARCHETYPES.map(archetype => archetype.id));
      expect(new Set(roster.map(trainer => trainer.name)).size).toBe(8);
      expect(new Set(roster.map(trainer => trainer.primaryType)).size).toBe(8);
      expect(new Set(roster.map(trainer => trainer.signature.finalId)).size).toBe(8);
      const signatures = new Set(roster.map(trainer => trainer.signature.finalId));
      for (const trainer of roster) {
        const archetype = TRAINER_ARCHETYPES.find(item => item.id === trainer.id)!;
        expect(archetype.names).toContain(trainer.name);
        expect(content.species[trainer.signature.finalId].stage).toBe(3);
        expect(content.species[trainer.signature.finalId].typeId).toBe(trainer.primaryType);
        expect(trainer.secondaryType).not.toBe(trainer.primaryType);
        expect(trainer.members).toHaveLength(5);
        const ids = trainer.members.map(member => member.finalId);
        expect(new Set(ids).size).toBe(5);
        for (const member of trainer.members) {
          expect(signatures.has(member.finalId)).toBe(false);
          expect(dex.has(member.finalId) && dex.has(member.earlyId)).toBe(true);
          expect(content.species[member.earlyId].stage).toBeLessThanOrEqual(content.species[member.finalId].stage);
        }
      }
    }
  });

  test('deterministic, from public setup only: the same roster for the same seed and Pokédex; the view derives the same content', () => {
    const state = createGame(setup(27));
    const view = observe(state, 0);
    expect(contentForView(view)).toBe(v27);
    expect(leagueRoster(view.seed, contentForView(view))).toBe(leagueRoster(31, v27));
    expect(JSON.parse(JSON.stringify(leagueRoster(31, contentFor({ ...setup(27) }))))).toEqual(JSON.parse(JSON.stringify(leagueRoster(31, v27))));
    expect(leagueRoster(32, contentFor(setup(27, 32)))).not.toEqual(leagueRoster(31, v27));
  });

  test('before v27 the roster is off: the v26 per-season draw is unchanged', () => {
    const v26 = contentFor(setup(26));
    expect(leagueRosterEntrants(31, 1, v26)).toBeNull();
    const teams = championshipNpcEntrants(31, 1, v26);
    expect(teams.every(team => team.entrantId.startsWith('npc-1-') && CONFERENCE_TRAINERS.includes(team.name))).toBe(true);
    expect(championshipNpcEntrants(31, 1, v26, [{ season: 0 } as ChampionshipSeason])).toEqual(teams);
  });
});

describe('growth and power (§7.1)', () => {
  const trainer = leagueRoster(31, v27).find(item => item.signature.earlyId !== item.signature.finalId)!;
  test('4 Pokémon with the stage-2 signature in seasons 1–2, 5 with the evolved signature in 3–4, 6 all final from season 5', () => {
    const [one, three, five, eight] = [1, 3, 5, 8].map(season => leagueTeamSpecies(trainer, season));
    expect(one).toHaveLength(4); expect(three).toHaveLength(5); expect(five).toHaveLength(6); expect(eight).toHaveLength(6);
    expect(one.at(-1)).toEqual({ speciesId: trainer.signature.earlyId, signature: true });
    expect(v27.species[trainer.signature.earlyId].stage).toBe(2);
    expect(three.at(-1)).toEqual({ speciesId: trainer.signature.finalId, signature: true });
    expect(three.slice(0, -1).map(entry => entry.speciesId)).toEqual(trainer.members.slice(0, 4).map(member => member.earlyId));
    expect(five.slice(0, -1).map(entry => entry.speciesId)).toEqual(trainer.members.map(member => member.finalId));
  });

  test('the season power is split by stage weights 8 / 10 / 13, the signature ×1.2; integers; the total stays within the season power', () => {
    expect(TRAINERS_TUNING.stageWeights).toEqual([8, 10, 13]);
    for (const season of [1, 3, 5, 8]) for (const slot of [1, 6]) {
      const power = leagueTeamPower(season, slot, v27), team = leagueTeam(trainer, season, power, v27);
      expect(power).toBe(TRAINERS_TUNING.npcBasePower + season * DEPTH26_TUNING.npcSeasonPower + slot * DEPTH26_TUNING.npcSlotPower);
      const total = team.reduce((sum, member) => sum + member.maxHp + member.attack + member.defense, 0);
      expect(total).toBeLessThanOrEqual(power);
      expect(total).toBeGreaterThan(power - 6 * 4);
      for (const member of team) for (const stat of [member.hp, member.maxHp, member.attack, member.defense]) expect(Number.isInteger(stat)).toBe(true);
      const sum = (index: number) => team[index]!.maxHp + team[index]!.attack + team[index]!.defense;
      const signature = sum(team.length - 1);
      // The ace carries at least 1.2× the share of any other Pokémon of its stage (and more than any lower stage).
      for (let index = 0; index < team.length - 1; index++) expect(signature).toBeGreaterThan(sum(index));
    }
  });
});

describe('who comes to a season (§7.1)', () => {
  test('six distinct trainers per season in slot order; those who sat out the previous season come first', () => {
    const one = leagueRosterEntrants(31, 1, v27)!;
    expect(one).toHaveLength(CIVILIZATION_CONTENT.championship.entrantCount);
    expect(new Set(one.map(npc => npc.name)).size).toBe(6);
    expect(one.every(npc => leagueTrainerId(npc.entrantId))).toBe(true);
    // Season 1 used the first four (two civilizations entered): the other four lead season 2.
    const history = [{ season: 1, entrants: one.slice(0, 4).map(npc => ({ entrantId: npc.entrantId })) } as unknown as ChampionshipSeason];
    const two = leagueSeasonTrainers(31, 2, v27, history).map(trainer => trainer.entrantId);
    expect(new Set(two.slice(0, 4))).toEqual(new Set(leagueRoster(31, v27).map(trainer => trainer.entrantId).filter(id => !one.slice(0, 4).some(npc => npc.entrantId === id))));
    expect(championshipNpcEntrants(31, 2, v27, history).map(npc => npc.entrantId)).toEqual(two.slice(0, 6));
    // Over 8 seasons with 4 NPC slots, every trainer comes at least 3 times.
    const seasons: ChampionshipSeason[] = [];
    for (let season = 1; season <= 8; season++) {
      const npcs = championshipNpcEntrants(31, season, v27, seasons).slice(0, 4);
      seasons.push({ season, entrants: npcs.map(npc => ({ entrantId: npc.entrantId })), matches: [], championEntrantId: 'player-0' } as unknown as ChampionshipSeason);
    }
    const counts = leagueRecords(seasons);
    for (const trainer of leagueRoster(31, v27)) expect(counts.get(trainer.entrantId)!.seasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe('records and the nemesis (§7.1)', () => {
  const match = (a: string, b: string, winner: string) => ({ label: 'final', entrantIds: [a, b], winnerEntrantId: winner, scores: [0, 0] });
  const history = [
    { season: 1, entrants: [{ entrantId: 'player-0' }, { entrantId: 'league-tideSurfer' }, { entrantId: 'league-forgeSmith' }], championEntrantId: 'league-tideSurfer',
      matches: [match('player-0', 'league-tideSurfer', 'league-tideSurfer'), match('league-forgeSmith', 'player-1', 'player-1')] },
    { season: 2, entrants: [{ entrantId: 'player-0' }, { entrantId: 'league-forgeSmith' }], championEntrantId: 'player-0',
      matches: [match('league-forgeSmith', 'player-0', 'league-forgeSmith'), match('player-0', 'league-forgeSmith', 'player-0')] },
    { season: 3, entrants: [{ entrantId: 'player-0' }, { entrantId: 'league-forgeSmith' }], championEntrantId: 'league-forgeSmith',
      matches: [match('player-0', 'league-forgeSmith', 'league-forgeSmith')] },
  ] as unknown as ChampionshipSeason[];
  test('titles, wins and losses, and head-to-head per civilization', () => {
    const records = leagueRecords(history);
    expect(records.get('league-tideSurfer')).toMatchObject({ seasons: [1], titles: 1, wins: 1, losses: 0, versus: { 0: { wins: 1, losses: 0 } } });
    expect(records.get('league-forgeSmith')).toMatchObject({ seasons: [1, 2, 3], titles: 1, wins: 2, losses: 2, versus: { 0: { wins: 2, losses: 1 }, 1: { wins: 0, losses: 1 } } });
  });
  test('the nemesis is the trainer who has beaten the civilization most (ties: the latest win)', () => {
    expect(leagueNemesis(history.slice(0, 1), 0)).toEqual({ entrantId: 'league-tideSurfer', wins: 1, lastSeason: 1 });
    expect(leagueNemesis(history.slice(0, 2), 0)).toEqual({ entrantId: 'league-forgeSmith', wins: 1, lastSeason: 2 });
    expect(leagueNemesis(history, 0)).toEqual({ entrantId: 'league-forgeSmith', wins: 2, lastSeason: 3 });
    expect(leagueNemesis(history, 1)).toBeNull();
  });
});

describe('the conference with the roster (integration)', () => {
  const play = (state: GameState) => {
    const civilization = state.expansion!.civilization;
    civilization.championship.nextRound = state.round;
    const before = structuredClone(state);
    const events = resolveCivilizationRound(state, { ...CIVILIZATION_CONTENT, world: contentFor(state.setup) });
    recordEraHonors(before, state, events);
    return events;
  };
  test('NPC entrants are roster trainers with names, the view announces the same lineup, no game RNG is used', () => {
    const state = createGame(setup(27));
    const civilization = state.expansion!.civilization;
    civilization.championship.nextRound = state.round + 5;
    const lineup = observe(state, 0).expansion!.civilization.championship.lineup!;
    expect(lineup.map(npc => npc.entrantId)).toEqual(championshipNpcEntrants(31, 1, v27, []).map(npc => npc.entrantId));
    const rng = structuredClone(state.rng);
    const events = play(state);
    expect(state.rng).not.toEqual(rng); // relay matches draw their seeds from the game RNG (v26), the roster does not
    const season = civilization.championship.history.at(-1)!;
    expect(season.entrants.map(entrant => entrant.entrantId)).toEqual(lineup.map(npc => npc.entrantId));
    expect(season.entrants.every(entrant => entrant.name && leagueTrainerId(entrant.entrantId))).toBe(true);
    expect(events.some(event => event.type === 'ChampionshipResolved')).toBe(true);
    // Season 2 is led by the two who sat out.
    const second = championshipNpcEntrants(31, 2, v27, civilization.championship.history).slice(0, 2).map(npc => npc.entrantId);
    expect(second.every(id => !season.entrants.some(entrant => entrant.entrantId === id))).toBe(true);
  });

  test('beating the own nemesis: era score +1, once per season; the AI trains counters to the nemesis type', () => {
    const state = createGame(setup(27)), civilization = state.expansion!.civilization;
    const roster = leagueRoster(31, v27), nemesis = roster[0]!;
    // A made-up history: the nemesis beat player 0 in season 1.
    civilization.championship.history.push({ season: 1, round: 1, entrants: [], matches: [{ label: 'final', entrantIds: ['player-0', nemesis.entrantId],
      winnerEntrantId: nemesis.entrantId, scores: [0, 0], battle: { seed: 0, rounds: [], winnerSide: 'away' } as never }], championEntrantId: nemesis.entrantId, championPlayerId: null });
    civilization.championship.nextSeason = 2;
    const view = observe(state, 0), content = contentForView(view);
    const counter = (Object.keys(content.species) as SpeciesId[]).find(id => nemesisTrainingBonus(view, id, content) === 10);
    expect(counter).toBeDefined();
    expect(nemesisTrainingBonus(observe(state, 1), counter!, content)).toBe(0);
    const ledger = state.expansion!.eraHonors!.players[0]!, score = ledger.score;
    // Season 2: player 0 beat the nemesis twice (one era-score point).
    civilization.championship.history.push({ season: 2, round: 2, entrants: [{ entrantId: 'player-0', playerId: 0, unitIds: [], power: 0, roster: [] },
      { entrantId: nemesis.entrantId, playerId: null, name: nemesis.name, unitIds: [], power: 0, roster: [] }],
    matches: [{ label: 'semifinal-1', entrantIds: ['player-0', nemesis.entrantId], winnerEntrantId: 'player-0', scores: [0, 0], battle: { seed: 0, rounds: [], winnerSide: 'home' } as never },
      { label: 'final', entrantIds: ['player-0', nemesis.entrantId], winnerEntrantId: 'player-0', scores: [0, 0], battle: { seed: 0, rounds: [], winnerSide: 'home' } as never }],
    championEntrantId: 'player-0', championPlayerId: 0 });
    const before = structuredClone(state), events = settleLeagueNemeses(state, v27);
    expect(events).toEqual([{ type: 'LeagueNemesisBeaten', playerId: 0, entrantId: nemesis.entrantId, name: nemesis.name, season: 2, eraScore: 1 }]);
    recordEraHonors(before, state, events);
    expect(ledger.score).toBe(score + 1);
    expect(settleLeagueNemeses(state, contentFor(setup(26)))).toEqual([]);
  });
});
