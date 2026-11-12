import { describe, expect, test } from 'vitest';
import { ESSENCE_IDS } from '../../src/content/essences.ts';
import { ELITE_FOUR, GYM_RULES_V24, HOME_GYMS } from '../../src/content/gym-circuit.ts';
import { WORLD24_CONTENT } from '../../src/content/units.ts';
import { gymTeamPower } from '../../src/content/world24-tuning.ts';
import type { SpeciesId } from '../../src/content/species.ts';
import { dualEffectiveness } from '../../src/core/combat-math.ts';
import { createGame } from '../../src/core/game.ts';
import { leaderTeam, placeGyms, viewGymBlocker, viewGymTeam } from '../../src/core/gym-circuit.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from '../../src/core/hex.ts';
import { isMapUnit } from '../../src/core/model.ts';
import type { Command, GameState } from '../../src/core/model.ts';
import { landRule, routeCosts, routeDistances } from '../../src/core/reach.ts';
import { step } from '../../src/core/step.ts';
import { classTrainingBlocker, stateBadges } from '../../src/core/unit-classes.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';

const setup = (gameplayVersion: 23 | 24, players = 4, seed = 31) => ({ seed, width: 24, height: 16, roundLimit: 100 as const, expansionVersion: 1 as const,
  eraProgression: 'simple-v1' as const, gameplayVersion, players: [
    { id: 0, controller: 'human' as const, starterId: 'bulbasaur' as const },
    ...Array.from({ length: players - 1 }, (_, index) => ({ id: index + 1, controller: 'ai' as const })),
  ] });
const content = WORLD24_CONTENT;
const order = (state: GameState, action: Command['action'], actorId = 0) => step(state, { actorId, expectedSeq: state.commandSeq, action }, content);
/** Clears the gym's surroundings and puts own Pokémon on it (first) and next to it. */
function teamAt(state: GameState, gymId: number, species: SpeciesId[], playerId = 0): number[] {
  const gym = state.expansion!.gymCircuit!.gyms.find(item => item.id === gymId)!;
  const spots = [gym.position, ...neighbors(gym.position, state.map)].filter(hex => hexToIndex(hex, state.map) !== null);
  for (const unit of Object.values(state.units)) if (isMapUnit(unit) && spots.some(hex => hexDistance(hex, unit.position, state.map) === 0)) delete state.units[unit.id];
  return species.map((speciesId, index) => {
    const id = state.nextEntityId++;
    state.units[id] = createMapUnit({ kind: 'pokemon', speciesId }, id, playerId, spots[index], content, 0, 1);
    return id;
  }).map((id, index, all) => { if (index === all.length - 1) refreshKnowledge(state, content); return id; });
}

describe('v24 B gym circuit: placement', () => {
  test('eight or more neutral gyms; each civilization has a home gym its starter beats, 5–8 land travel away; every essence present', () => {
    for (const seed of [31, 32, 33, 34]) {
      const state = createGame(setup(24, 4, seed));
      const gyms = state.expansion!.gymCircuit!.gyms;
      expect(gyms.length).toBeGreaterThanOrEqual(GYM_RULES_V24.gymCount);
      expect(new Set(ESSENCE_IDS.filter(id => gyms.some(gym => gym.essence === id))).size).toBe(ESSENCE_IDS.length);
      const capitals = Object.values(state.players).map(player => state.cities[player.headquartersCityId]);
      for (const player of Object.values(state.players)) {
        const home = gyms.find(gym => gym.homeOf === player.id)!;
        expect(home.leader).toBe(HOME_GYMS[player.starterId].leader);
        expect(dualEffectiveness(content.species[player.starterId].typeId, [home.typeId])).toBeGreaterThan(100);
        // Land travel cost (move costs, hills, river crossings) 5–8; when no tile qualifies, 5–8 land steps.
        const capital = hexToIndex(state.cities[player.headquartersCityId].position, state.map)!;
        const cost = routeCosts(state.map, capital, landRule(state.map), content).get(home.tileIndex)!;
        const steps = routeDistances(state.map, capital, landRule(state.map)).get(home.tileIndex)!;
        expect((cost >= 5 && cost <= 8) || (steps >= 5 && steps <= 8), `seed ${seed} player ${player.id}: cost ${cost}, steps ${steps}`).toBe(true);
      }
      // A2 passage rules: no gym on water, a peak or a landmark.
      expect(gyms.every(gym => landRule(state.map)(gym.tileIndex))).toBe(true);
      for (const gym of gyms) {
        expect(state.map.tiles[gym.tileIndex]).not.toBe('ocean');
        expect(capitals.every(city => hexDistance(city.position, gym.position, state.map) >= GYM_RULES_V24.minCapitalDistance)).toBe(true);
      }
    }
    expect(createGame(setup(23)).expansion!.gymCircuit).toBeUndefined();
  });

  test('v24 terrain: at least two gyms across water and the rest by continent quota (40×26, four civilizations)', () => {
    for (const seed of [31, 32, 33, 34, 35, 36]) {
      const state = createGame({ ...setup(24, 4, seed), width: 40, height: 26 });
      const gyms = state.expansion!.gymCircuit!.gyms, rule = landRule(state.map);
      expect(gyms.filter(gym => gym.overseas).length, `seed ${seed}`).toBeGreaterThanOrEqual(GYM_RULES_V24.minOverseas);
      const capitals = state.turnOrder.map(id => hexToIndex(state.cities[state.players[id].headquartersCityId].position, state.map)!);
      const routes = capitals.map(tile => routeDistances(state.map, tile, rule));
      // Each continent (capitals that reach each other over land) gets gyms in proportion to its civilizations.
      const groups = [...new Set(capitals.map((_, seat) => capitals.findIndex((tile, j) => j === seat || routes[seat].has(tile))))];
      const per = groups.map(group => gyms.filter(gym => routes[group].has(gym.tileIndex)).length
        / capitals.filter((_, seat) => capitals.findIndex((tile, j) => j === seat || routes[seat].has(tile)) === group).length);
      expect(Math.max(...per) - Math.min(...per), `seed ${seed}: ${per}`).toBeLessThanOrEqual(0.5);
    }
  });

  test('placement takes a stand rule: with islands on the map, two gyms go across water', () => {
    // Two continents (columns 2–11 and 18–27) and four one-tile islands in the strait.
    const map = { width: 30, height: 20 };
    const islands = new Set([[14, 3], [15, 8], [14, 13], [15, 17]].map(([col, row]) => row * map.width + col));
    const land = (index: number) => { const col = index % map.width, row = Math.floor(index / map.width);
      return row >= 1 && row <= 18 && ((col >= 2 && col <= 11) || (col >= 18 && col <= 27)) || islands.has(index); };
    const at = (col: number, row: number) => row * map.width + col;
    const gyms = placeGyms({ map, seed: 7, taken: new Set(), canStand: land, capitals: [
      { playerId: 0, starterId: 'bulbasaur', tileIndex: at(5, 5) }, { playerId: 1, starterId: 'charmander', tileIndex: at(6, 14) },
      { playerId: 2, starterId: 'squirtle', tileIndex: at(23, 5) }, { playerId: 3, starterId: 'squirtle', tileIndex: at(22, 14) }] });
    expect(gyms.filter(gym => gym.overseas).length).toBeGreaterThanOrEqual(GYM_RULES_V24.minOverseas);
    expect(gyms.filter(gym => gym.overseas).every(gym => islands.has(gym.tileIndex))).toBe(true);
    expect(gyms.filter(gym => gym.homeOf !== undefined).length).toBe(4);
    for (const a of gyms) for (const b of gyms) if (a.id < b.id) expect(hexDistance(indexToHex(a.tileIndex, map), indexToHex(b.tileIndex, map), map)).toBeGreaterThanOrEqual(3);
    // Same input, same placement (stableSeed only).
    expect(placeGyms({ map, seed: 7, taken: new Set(), canStand: land, capitals: [
      { playerId: 0, starterId: 'bulbasaur', tileIndex: at(5, 5) }, { playerId: 1, starterId: 'charmander', tileIndex: at(6, 14) },
      { playerId: 2, starterId: 'squirtle', tileIndex: at(23, 5) }, { playerId: 3, starterId: 'squirtle', tileIndex: at(22, 14) }] })).toEqual(gyms);
  });

  test('no city may be founded on a gym tile (authority and AI site check agree)', () => {
    const state = createGame(setup(24, 2));
    const gym = state.expansion!.gymCircuit!.gyms[0];
    for (const city of Object.values(state.cities)) if (city.ownerId === 1) city.position = { q: 999, r: 999 };
    const settler = Object.values(state.units).find(unit => unit.ownerId === 0 && unit.kind === 'logistics')!;
    if (isMapUnit(settler)) settler.position = { ...gym.position };
    for (const unit of Object.values(state.units)) if (unit.id !== settler.id && isMapUnit(unit) && hexDistance(unit.position, gym.position, state.map) === 0) delete state.units[unit.id];
    expect(order(state, { type: 'FoundCity', unitId: settler.id })).toEqual({ ok: false, reason: 'invalid-city-site' });
  });
});

describe('v24 B gym circuit: challenges', () => {
  test('leader strength follows the badges the challenger holds', () => {
    const state = createGame(setup(24, 2)), gym = state.expansion!.gymCircuit!.gyms[0];
    for (const [badges, row] of GYM_RULES_V24.teams.entries()) {
      const team = leaderTeam(gym, badges, state.setup.seed, content);
      expect(team.length).toBe(row.members);
      const power = team.reduce((sum, member) => sum + member.maxHp + member.attack + member.defense, 0);
      expect(Math.abs(power - gymTeamPower(content, badges))).toBeLessThanOrEqual(3 * row.members);
      expect(team.every(member => content.species[member.speciesId].typeId === gym.typeId || content.species[member.speciesId].secondaryTypeId === gym.typeId)).toBe(true);
    }
  });

  test('ChallengeGym: refusals, a win (badge, gold, essence, XP), cooldown and the view agree with the authority', () => {
    const state = createGame(setup(24, 2)), circuit = state.expansion!.gymCircuit!, gym = circuit.gyms.find(item => item.homeOf === 0)!;
    const ids = teamAt(state, gym.id, ['venusaur', 'charizard', 'blastoise']);
    const view = observe(state, 0, content);
    expect([...viewGymTeam(view, gym.id, content)].sort((a, b) => a - b)).toEqual(ids);
    expect(viewGymBlocker(view, gym.id, ids)).toBeNull();
    expect(order(state, { type: 'ChallengeGym', gymId: gym.id, unitIds: [] })).toEqual({ ok: false, reason: 'invalid-command' });
    expect(order(state, { type: 'ChallengeGym', gymId: gym.id, unitIds: ids.slice(1) })).toEqual({ ok: false, reason: 'invalid-command' });
    expect(viewGymBlocker(view, gym.id, ids.slice(1))).toBe('unit-not-on-site');
    expect(order(state, { type: 'ChallengeGym', gymId: 999, unitIds: ids })).toEqual({ ok: false, reason: 'invalid-command' });
    const gold = state.players[0].gold, essence = state.expansion!.essences!.stock[0][gym.essence];
    const result = order(state, { type: 'ChallengeGym', gymId: gym.id, unitIds: ids });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.map(item => item.payload).find(payload => payload.type === 'GymChallenged')).toMatchObject({ type: 'GymChallenged', victory: true, badges: 1 });
    const after = result.state;
    expect(after.expansion!.gymCircuit!.badges[0]).toEqual([gym.id]);
    expect(after.players[0].gold).toBe(gold + GYM_RULES_V24.reward.goldPerBadge);
    expect(after.expansion!.essences!.stock[0][gym.essence]).toBe(essence + GYM_RULES_V24.reward.essence);
    expect(ids.every(id => after.units[id].actionLeft === 0 && after.units[id].xp === GYM_RULES_V24.reward.xp && after.units[id].hp >= 1)).toBe(true);
    // Replays are byte-identical (stableSeed, no state.rng).
    const again = order(state, { type: 'ChallengeGym', gymId: gym.id, unitIds: ids });
    expect(again.ok && JSON.stringify(again.state)).toBe(JSON.stringify(after));
    expect(after.rng).toEqual(state.rng);
    // The badge is public, the same gym cannot be won twice.
    expect(observe(after, 1, content).expansion!.gymCircuit!.badges[0]).toEqual([gym.id]);
    for (const id of ids) after.units[id].actionLeft = 1;
    expect(order(after, { type: 'ChallengeGym', gymId: gym.id, unitIds: ids })).toEqual({ ok: false, reason: 'invalid-command' });
    expect(viewGymBlocker(observe(after, 0, content), gym.id, ids)).toBe('gym-won');
  });

  test('a lost challenge puts the gym on a 3-round cooldown; units keep at least 1 HP', () => {
    const state = createGame(setup(24, 2)), gym = state.expansion!.gymCircuit!.gyms.find(item => item.homeOf === 1)!;
    state.expansion!.gymCircuit!.badges[0] = [];
    const ids = teamAt(state, gym.id, ['caterpie']);
    state.units[ids[0]].hp = 5;
    const result = order(state, { type: 'ChallengeGym', gymId: gym.id, unitIds: ids });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.some(item => item.payload.type === 'GymChallenged' && !item.payload.victory)).toBe(true);
    expect(result.state.units[ids[0]].hp).toBe(1);
    const after = result.state;
    after.units[ids[0]].actionLeft = 1;
    expect(viewGymBlocker(observe(after, 0, content), gym.id, ids)).toBe('gym-cooldown');
    expect(order(after, { type: 'ChallengeGym', gymId: gym.id, unitIds: ids })).toEqual({ ok: false, reason: 'invalid-command' });
    after.round += GYM_RULES_V24.cooldownRounds;
    expect(viewGymBlocker(observe(after, 0, content), gym.id, ids)).toBeNull();
  });

  test('a circuit badge unlocks the final forms of its essence (v19 badge gate)', () => {
    const state = createGame(setup(24, 2)), circuit = state.expansion!.gymCircuit!;
    const tide = circuit.gyms.find(gym => gym.essence === 'tide')!;
    const player = state.players[0];
    player.research.unlockedIds = Object.keys(content.techs) as typeof player.research.unlockedIds;
    const blocker = () => classTrainingBlocker(state, player, 'full-v1', stateBadges(state, 0), 'blastoise', content);
    const before = blocker();
    circuit.badges[0] = [tide.id];
    expect(stateBadges(state, 0).has('tide')).toBe(true);
    if (before?.kind === 'badge') expect(blocker()?.kind).not.toBe('badge');
  });

  test('Elite Four: eight badges, six Pokémon, five battles; a win is one championship title, once per game', () => {
    const state = createGame(setup(24, 2)), circuit = state.expansion!.gymCircuit!;
    const ids = teamAt(state, circuit.gyms[0].id, ['venusaur', 'charizard', 'blastoise', 'dragonite', 'metagross', 'snorlax']);
    expect(order(state, { type: 'ChallengeEliteFour', unitIds: ids })).toEqual({ ok: false, reason: 'invalid-command' });
    circuit.badges[0] = circuit.gyms.slice(0, GYM_RULES_V24.gymCount).map(gym => gym.id);
    expect(order(state, { type: 'ChallengeEliteFour', unitIds: ids.slice(0, 5) })).toEqual({ ok: false, reason: 'invalid-command' });
    const result = order(state, { type: 'ChallengeEliteFour', unitIds: ids });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const event = result.events.map(item => item.payload).find(payload => payload.type === 'EliteFourChallenged') as { victory: boolean; reached: number; battles: unknown[] };
    expect(event.battles.length).toBe(event.victory ? ELITE_FOUR.length : event.reached + 1);
    const after = result.state;
    expect(after.expansion!.civilization.championship.titlesByPlayer[0] ?? 0).toBe(event.victory ? 1 : 0);
    expect(after.expansion!.gymCircuit!.eliteFour[0]).toEqual({ lastRound: state.round, won: event.victory });
    for (const id of ids) after.units[id].actionLeft = 1;
    after.round += GYM_RULES_V24.eliteFour.cooldownRounds;
    // Won: never again (6A). Lost: again after the cooldown.
    expect(order(after, { type: 'ChallengeEliteFour', unitIds: ids }).ok).toBe(!event.victory);
  });
});
