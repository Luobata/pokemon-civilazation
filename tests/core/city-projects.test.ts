// Gameplay v27 ③ (docs/design/pace-v27.md §4): repeatable city projects — cost scaling, requirements, one per queue, rushing, each
// project's effect, the deterministic hatch species, the rehearsal → season score hand-off, fog (own view only) and v26 neutrality.
import { describe, expect, test } from 'vitest';
import { contentFor } from '../../src/content/units.ts';
import type { Content } from '../../src/content/units.ts';
import { CITY_PROJECT_IDS, ECONOMY_TUNING, cityProjectCost } from '../../src/content/pace-v27.ts';
import type { CityProjectId } from '../../src/content/pace-v27.ts';
import { lateTuning } from '../../src/content/depth-v26.ts';
import { createGame } from '../../src/core/game.ts';
import { hexDistance } from '../../src/core/hex.ts';
import { isMapUnit } from '../../src/core/model.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';
import { step } from '../../src/core/step.ts';
import { observe } from '../../src/core/vision.ts';
import { productionCost } from '../../src/core/city.ts';
import { goldSinkQuote, viewGoldSinkQuote } from '../../src/core/gold-sinks.ts';
import { cityProjectBlocker, hatchSpecies, projectCost, rehearsalScoreBonus, stateCityProjectInput, viewCityProjectInput } from '../../src/core/city-projects.ts';
import { seasonScoreBonus } from '../../src/core/contest-circuit.ts';
import { seasonRounds } from '../../src/core/contest-seasons.ts';
import { cityProjectCandidates } from '../../src/ai/project-plan.ts';
import { planNext } from '../../src/ai/plan.ts';

const setup = (gameplayVersion: 26 | 27, seed = 31): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100 as const, expansionVersion: 1 as const,
  eraProgression: 'simple-v1' as const, gameplayVersion, players: [
    { id: 0, controller: 'human' as const, starterId: 'bulbasaur' as const }, { id: 1, controller: 'ai' as const },
  ] });
const game = (version: 26 | 27 = 27) => { const state = createGame(setup(version)); return { state, content: contentFor(state.setup) }; };
const order = (state: GameState, action: Command['action'], content: Content, actorId = 0) => step(state, { actorId, expectedSeq: state.commandSeq, action }, content);
const ok = (result: ReturnType<typeof step>) => { if (!result.ok) throw new Error(result.reason); return result; };
const capital = (state: GameState, playerId = 0) => state.cities[state.players[playerId].headquartersCityId];
const queue = (state: GameState, content: Content, id: CityProjectId, cityId = capital(state).id) =>
  order(state, { type: 'SetProductionQueue', cityId, orders: [{ item: { kind: 'project', defId: id } }] }, content);
/** Gives the capital a district of `kind` (on a tile no other district uses). */
function giveDistrict(state: GameState, kind: 'gardenDistrict' | 'researchDistrict' | 'gymDistrict', tileIndex: number) {
  state.expansion!.districts!.tiles[tileIndex] = { cityId: capital(state).id, kind, tileIndex, builtAtRound: 0 };
}
/** Fills the head order and ends the round (both players end their turns). */
function finishRound(state: GameState, content: Content): GameState {
  const city = capital(state);
  city.queue[0].progress = productionCost(city.queue[0].item, content, 0, 0, state.expansion?.cityProjects?.done[0] ?? {});
  let next = state;
  for (const actor of [0, 1]) next = ok(order(next, { type: 'EndTurn' }, content, actor)).state;
  return next;
}
const projectEvents = (result: ReturnType<typeof step>) => result.ok ? result.events.map(event => event.payload).filter(payload => payload.type === 'CityProjectCompleted') : [];

describe('v27 city projects: cost and requirements', () => {
  test('cost = base × (100 + 20 × completions) / 100: 1st 100%, 5th 180%, 10th 280%', () => {
    const content = game().content;
    for (const id of CITY_PROJECT_IDS) {
      const base = ECONOMY_TUNING.projectCost[id];
      expect(cityProjectCost(content, id, 0)).toBe(base);
      expect(cityProjectCost(content, id, 4)).toBe(Math.floor(base * 180 / 100));
      expect(cityProjectCost(content, id, 9)).toBe(Math.floor(base * 280 / 100));
      expect(productionCost({ kind: 'project', defId: id }, content, 30, 30, { [id]: 2 })).toBe(Math.floor(base * 140 / 100));
    }
  });

  test('v26 refuses a project; v27 accepts a festival anywhere, one project per queue, and checks each requirement (state = view)', () => {
    const v26 = game(26);
    expect(queue(v26.state, v26.content, 'festival').ok).toBe(false);
    const { state, content } = game(), city = capital(state);
    expect(ok(queue(state, content, 'festival')).state.cities[city.id].queue[0].item).toEqual({ kind: 'project', defId: 'festival' });
    expect(order(state, { type: 'SetProductionQueue', cityId: city.id, orders: [{ item: { kind: 'project', defId: 'festival' } }, { item: { kind: 'project', defId: 'festival' } }] }, content).ok).toBe(false);
    for (const id of ['hatchEgg', 'gymDrill', 'fieldReport', 'contestRehearsal'] as const) expect(queue(state, content, id).ok).toBe(false);
    const view = observe(state, 0, content), viewCity = view.economy.cities.find(item => item.id === city.id)!;
    for (const id of CITY_PROJECT_IDS) expect(cityProjectBlocker(viewCityProjectInput(view, viewCity, content), id)).toBe(cityProjectBlocker(stateCityProjectInput(state, city, content), id));
    expect(cityProjectBlocker(stateCityProjectInput(state, city, content), 'hatchEgg')).toBe('garden');
    giveDistrict(state, 'gardenDistrict', 1); giveDistrict(state, 'researchDistrict', 2);
    city.buildingIds.push('trainingGround'); state.expansion!.contests![0].halls.push(city.id);
    for (const id of CITY_PROJECT_IDS) expect(queue(state, content, id).ok).toBe(true);
    // A queued project blocks a second one in the same city (the card shows why).
    const queued = ok(queue(state, content, 'festival')).state;
    expect(cityProjectBlocker(stateCityProjectInput(queued, capital(queued), content), 'gymDrill')).toBe('queued');
    // The field report closes once every technology is researched.
    state.players[0].research.unlockedIds = Object.keys(content.techs) as typeof state.players[0]['research']['unlockedIds'];
    expect(queue(state, content, 'fieldReport').ok).toBe(false);
  });

  test('rushing a project costs 4 gold per production left (like a building), at the scaled cost; authority = view', () => {
    const { state, content } = game();
    state.players[0].gold = 5000;
    state.expansion!.cityProjects = { done: { 0: { festival: 3 } }, rehearsal: {}, festival: {}, legendTrail: {} };
    const queued = ok(queue(state, content, 'festival')).state, cityId = capital(queued).id;
    const cost = cityProjectCost(content, 'festival', 3);
    expect(projectCost(observe(queued, 0, content), 'festival', content)).toBe(cost);
    const quote = goldSinkQuote(queued, 0, { type: 'RushProduction', cityId }, content);
    expect(quote).toEqual({ ok: true, gold: cost * lateTuning(content).rushBuildingGold });
    expect(viewGoldSinkQuote(observe(queued, 0, content), { type: 'RushProduction', cityId }, content)).toEqual(quote);
    const rushed = ok(order(queued, { type: 'RushProduction', cityId }, content)).state;
    expect(capital(rushed).queue[0].progress).toBe(cost);
    let next = rushed;
    for (const actor of [0, 1]) next = ok(order(next, { type: 'EndTurn' }, content, actor)).state;
    expect(next.expansion!.cityProjects!.done[0].festival).toBe(4);
    expect(capital(next).queue).toHaveLength(0);
  });
});

describe('v27 city projects: effects', () => {
  test('festival: +10 satisfaction and one era-score point per 10 rounds; the count rises the next cost', () => {
    const { state, content } = game();
    const before = state.expansion!.world.players[0].satisfaction, era = state.expansion!.eraHonors!.players[0].score;
    let next = finishRound(ok(queue(state, content, 'festival')).state, content);
    // The round end then applies the usual satisfaction decay (4 per round).
    expect(next.expansion!.world.players[0].satisfaction).toBe(Math.max(0, Math.min(100, before + ECONOMY_TUNING.festivalSatisfaction) - 4));
    expect(next.expansion!.eraHonors!.players[0].byMilestone.festival).toBe(1);
    expect(next.expansion!.eraHonors!.players[0].score).toBeGreaterThanOrEqual(era + 1);
    expect(projectCost(observe(next, 0, content), 'festival', content)).toBe(cityProjectCost(content, 'festival', 1));
    next = finishRound(ok(queue(next, content, 'festival')).state, content);
    expect(next.expansion!.eraHonors!.players[0].byMilestone.festival).toBe(1);
    expect(next.expansion!.cityProjects!.done[0].festival).toBe(2);
  });

  test('field report adds science through the reserve; gym drill trains up to 6 own Pokémon in or next to the city', () => {
    const { state, content } = game(), city = capital(state);
    giveDistrict(state, 'researchDistrict', 2);
    state.players[0].research.techId = null;
    const reserve = state.players[0].research.reserve;
    const reported = finishRound(ok(queue(state, content, 'fieldReport')).state, content);
    expect(reported.players[0].research.reserve).toBeGreaterThanOrEqual(reserve + ECONOMY_TUNING.reportScience);
    city.buildingIds.push('trainingGround');
    const near = Object.values(state.units).filter(isMapUnit).filter(unit => unit.ownerId === 0 && unit.kind === 'pokemon' && hexDistance(unit.position, city.position, state.map) <= 1);
    expect(near.length).toBeGreaterThan(0);
    const xp = new Map(near.map(unit => [unit.id, unit.xp]));
    const result = ok(queue(state, content, 'gymDrill')).state;
    const drilled = finishRound(result, content);
    for (const unit of near.slice(0, ECONOMY_TUNING.drillUnits)) expect(drilled.units[unit.id].xp).toBeGreaterThanOrEqual(xp.get(unit.id)! + ECONOMY_TUNING.drillXp);
  });

  test('hatch: a registered stage-1 species (fewest owned, then id), 50 XP, beside the city; no new Pokédex record; same result twice', () => {
    const { state, content } = game();
    giveDistrict(state, 'gardenDistrict', 1);
    const species = hatchSpecies(state, 0, content)!;
    expect(content.species[species].stage).toBe(1);
    expect(state.players[0].registeredSpeciesIds).toContain(species);
    const registered = [...state.players[0].registeredSpeciesIds];
    const queued = ok(queue(state, content, 'hatchEgg')).state;
    const run = () => finishRound(structuredClone(queued), content);
    const a = run(), b = run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const hatched = Object.values(a.units).filter(unit => !queued.units[unit.id] && unit.ownerId === 0 && unit.kind === 'pokemon' && unit.speciesId === species);
    expect(hatched).toHaveLength(1);
    expect(hatched[0].xp).toBe(ECONOMY_TUNING.hatchXp);
    expect(isMapUnit(hatched[0]) && hexDistance(hatched[0].position, capital(a).position, a.map)).toBe(1);
    expect(a.players[0].registeredSpeciesIds).toEqual(registered);
  });

  test('rehearsal: +15 appeal and +10 to the next season entry, once per season; the circuit reads it via seasonScoreBonus', () => {
    const { state, content } = game(), city = capital(state);
    state.expansion!.contests![0].halls.push(city.id);
    const appeal = state.expansion!.contests![0].appeal;
    const once = finishRound(ok(queue(state, content, 'contestRehearsal')).state, content);
    expect(once.expansion!.contests![0].appeal).toBeGreaterThanOrEqual(appeal + ECONOMY_TUNING.rehearsalAppeal);
    expect(rehearsalScoreBonus(once, 0, content)).toBe(ECONOMY_TUNING.rehearsalScore);
    expect(seasonScoreBonus(once, 0, content)).toBe(ECONOMY_TUNING.rehearsalScore);
    expect(rehearsalScoreBonus(once, 1, content)).toBe(0);
    const twice = finishRound(ok(queue(once, content, 'contestRehearsal')).state, content);
    expect(twice.expansion!.cityProjects!.rehearsal[0]).toBe(once.expansion!.cityProjects!.rehearsal[0]);
    // After the season round the bonus no longer applies (it was for that season).
    const after = structuredClone(twice); after.round = seasonRounds(content, 100)[0] + 1;
    expect(rehearsalScoreBonus(after, 0, content)).toBe(0);
  });

  test('fog: the project ledger is in the owner\'s view only; completion events go to the owner', () => {
    const { state, content } = game();
    const queued = ok(queue(state, content, 'festival')).state;
    capital(queued).queue[0].progress = cityProjectCost(content, 'festival', 0);
    const result = order(ok(order(queued, { type: 'EndTurn' }, content, 0)).state, { type: 'EndTurn' }, content, 1);
    expect(projectEvents(result)).toHaveLength(1);
    const next = ok(result).state;
    expect(observe(next, 0, content).expansion!.cityProjects!.done.festival).toBe(1);
    expect(observe(next, 1, content).expansion!.cityProjects!.done).toEqual({});
    expect(observe(createGame(setup(26)), 0).expansion!.cityProjects).toBeUndefined();
  });
});

describe('v27 city projects: AI', () => {
  test('an idle city with nothing else to build gets a project; the candidate passes the authority', () => {
    const { state, content } = game(), city = capital(state, 1);
    state.activePlayerId = 1;
    const view = observe(state, 1, content);
    const candidates = cityProjectCandidates(view, city.id, content);
    expect(candidates).toHaveLength(1);
    expect(order(state, { type: 'SetProductionQueue', cityId: city.id, orders: [{ item: candidates[0].item }] }, content, 1).ok).toBe(true);
    expect(cityProjectCandidates(observe(createGame(setup(26)), 1), city.id, contentFor(setup(26)))).toEqual([]);
  });

  test('AI v27 games run a few rounds without refused commands, and some idle city queues a project', () => {
    const { state, content } = game();
    state.players[0].controller = 'ai';
    let current = state, projects = 0;
    for (let index = 0; index < 2000 && current.round <= 8 && !current.outcome; index++) {
      const command = planNext(observe(current, current.activePlayerId, content));
      if (command.action.type === 'SetProductionQueue' && command.action.orders.some(item => item.item.kind === 'project')) projects++;
      current = ok(step(current, command, content)).state;
    }
    expect(projects).toBeGreaterThan(0);
  }, 60_000);
});
