// Gameplay v26 lane 2 (docs/design/depth-v26.md §5, §7.2, §8, §4.2): gold sinks, contest seasons, legend race, raids, the near-victory
// warning, tile sharing, the opening gift and the evolution-goal milestones. Authority, view mirrors and v25 neutrality.
import { describe, expect, test } from 'vitest';
import { contentFor } from '../../src/content/units.ts';
import type { Content } from '../../src/content/units.ts';
import { lateTuning } from '../../src/content/depth-v26.ts';
import { LEGEND_WONDER_IDS } from '../../src/content/legend-wonders.ts';
const LEGEND = LEGEND_WONDER_IDS[0];
import { createGame } from '../../src/core/game.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from '../../src/core/hex.ts';
import type { Hex } from '../../src/core/hex.ts';
import { isMapUnit } from '../../src/core/model.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';
import { reachablePaths } from '../../src/core/movement.ts';
import { step } from '../../src/core/step.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { goldSinkQuote, viewGoldSinkQuote, taughtMoveType } from '../../src/core/gold-sinks.ts';
import { contestScore, seasonCategory, seasonRounds } from '../../src/core/contest-seasons.ts';
import { hasMet, observeLegendRace, raceStage } from '../../src/core/legend-race.ts';
import { raidRounds } from '../../src/core/raids.ts';
import { victoryProgress } from '../../src/core/victory-watch.ts';
import { evolutionLines, firstFinalOfLine } from '../../src/core/evolution-goals.ts';
import { previewAttack } from '../../src/core/preview.ts';
import { planNext } from '../../src/ai/plan.ts';
import { depthWorldCards } from '../../src/browser/late-game-ui.ts';
import { deserializeSave, serializeSave } from '../../src/app/save.ts';
import { gameVersions } from '../../src/core/versions.ts';

const setup = (gameplayVersion: 25 | 26, seed = 31): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100 as const, expansionVersion: 1 as const,
  eraProgression: 'simple-v1' as const, gameplayVersion, players: [
    { id: 0, controller: 'human' as const, starterId: 'bulbasaur' as const }, { id: 1, controller: 'ai' as const },
  ] });
const game = (version: 25 | 26 = 26) => { const state = createGame(setup(version)); return { state, content: contentFor(state.setup) }; };
const order = (state: GameState, action: Command['action'], content: Content, actorId = 0) => step(state, { actorId, expectedSeq: state.commandSeq, action }, content);
const ok = (result: ReturnType<typeof step>) => { if (!result.ok) throw new Error(result.reason); return result; };
/** A free land tile next to `around` (no unit, no city). */
function freeNear(state: GameState, around: Hex, content: Content): Hex {
  const taken = new Set([...Object.values(state.units).filter(isMapUnit), ...Object.values(state.cities)].map(item => hexToIndex(item.position, state.map)));
  const ring = [...neighbors(around, state.map), ...neighbors(around, state.map).flatMap(hex => neighbors(hex, state.map))];
  return ring.find(hex => { const index = hexToIndex(hex, state.map); return index !== null && !taken.has(index) && state.map.tiles[index] !== 'ocean' && content.moveCosts[state.map.tiles[index]] < 3; })!;
}
function place(state: GameState, content: Content, unit: Parameters<typeof createMapUnit>[0], at: Hex, owner: number | null = 0): number {
  const id = state.nextEntityId++;
  state.units[id] = createMapUnit(unit, id, owner, at, content, 0, 1);
  refreshKnowledge(state, content);
  return id;
}
const capital = (state: GameState, playerId = 0) => state.cities[state.players[playerId].headquartersCityId];

describe('v26 gold sinks', () => {
  test('RushProduction: price per production left, once per city per round, completes at the round end; legends cannot be bought', () => {
    const { state, content } = game(), city = capital(state);
    state.players[0].gold = 1000;
    const queued = ok(order(state, { type: 'SetProductionQueue', cityId: city.id, orders: [{ item: { kind: 'logistics', defId: 'settler' } }] }, content)).state;
    const cost = content.units.settler.trainCost;
    const quote = goldSinkQuote(queued, 0, { type: 'RushProduction', cityId: city.id }, content);
    expect(quote).toEqual({ ok: true, gold: cost * lateTuning(content).rushUnitGold });
    expect(viewGoldSinkQuote(observe(queued, 0, content), { type: 'RushProduction', cityId: city.id }, content)).toEqual(quote);
    const rushed = ok(order(queued, { type: 'RushProduction', cityId: city.id }, content)).state;
    expect(rushed.players[0].gold).toBe(1000 - cost * lateTuning(content).rushUnitGold);
    expect(order(rushed, { type: 'RushProduction', cityId: city.id }, content).ok).toBe(false);
    let next = rushed;
    for (const actor of [0, 1]) next = ok(order(next, { type: 'EndTurn' }, content, actor)).state;
    expect(Object.values(next.units).some(unit => unit.ownerId === 0 && unit.kind === 'logistics' && unit.role === 'settler')).toBe(true);
    const legend = structuredClone(rushed);
    legend.cities[city.id].queue = [{ id: 999, progress: 0, item: { kind: 'legend', defId: LEGEND } }];
    expect(goldSinkQuote(legend, 0, { type: 'RushProduction', cityId: city.id }, content).ok).toBe(false);
  });
  test('v25 refuses every gold sink; v26 TMs need a badge essence and are read by taughtMoveType', () => {
    const v25 = game(25);
    expect(order(v25.state, { type: 'RushProduction', cityId: capital(v25.state).id }, v25.content).ok).toBe(false);
    const { state, content } = game(), unitId = place(state, content, { kind: 'pokemon', speciesId: 'charmander' }, freeNear(state, capital(state).position, content));
    state.players[0].gold = 500;
    expect(goldSinkQuote(state, 0, { type: 'TeachMove', unitId, typeId: 'water' }, content)).toEqual({ ok: false, reason: 'tm-badge' });
    const gym = state.expansion!.gymCircuit!.gyms.find(item => item.typeId === 'water' || item.typeId === 'ice')!;
    state.expansion!.gymCircuit!.badges[0] = [gym.id];
    const quote = goldSinkQuote(state, 0, { type: 'TeachMove', unitId, typeId: gym.typeId }, content);
    expect(quote).toEqual({ ok: true, gold: 0, free: true });
    const taught = ok(order(state, { type: 'TeachMove', unitId, typeId: gym.typeId }, content)).state;
    expect(taughtMoveType(taught, unitId)).toBe(gym.typeId);
    expect(taught.players[0].gold).toBe(500);
    const other = gym.typeId === 'water' ? 'ice' : 'water';
    expect(goldSinkQuote(taught, 0, { type: 'TeachMove', unitId, typeId: other }, content)).toEqual({ ok: true, gold: lateTuning(content).tmGold });
    expect(observe(taught, 0, content).expansion!.goldSinks!.moves[unitId]).toBe(gym.typeId);
    expect(observe(taught, 1, content).expansion!.goldSinks!.moves[unitId]).toBeUndefined();
  });
  test('SpecialTraining needs a Pokémon Center next to the unit; RushRecovery brings a recovering Pokémon back', () => {
    const { state, content } = game(), city = capital(state), unitId = place(state, content, { kind: 'pokemon', speciesId: 'rattata' }, freeNear(state, city.position, content));
    state.players[0].gold = 500;
    const near = hexDistance(state.units[unitId].position!, city.position, state.map) <= 1;
    expect(goldSinkQuote(state, 0, { type: 'SpecialTraining', unitId }, content)).toEqual({ ok: false, reason: 'no-training-ground' });
    state.cities[city.id].buildingIds.push('trainingGround');
    if (near) {
      const trained = ok(order(state, { type: 'SpecialTraining', unitId }, content)).state;
      expect(trained.units[unitId].xp).toBe(lateTuning(content).trainingXp);
      expect(trained.units[unitId].actionLeft).toBe(0);
    }
    const hurt = structuredClone(state);
    hurt.units[unitId] = { ...hurt.units[unitId], location: 'recovering', position: null, cityId: city.id, roundsLeft: 3, hp: 1, actionLeft: 0 } as never;
    expect(goldSinkQuote(hurt, 0, { type: 'RushRecovery', unitId }, content)).toEqual({ ok: true, gold: Math.min(45, 15 * 3) });
    const back = ok(order(hurt, { type: 'RushRecovery', unitId }, content)).state;
    expect(isMapUnit(back.units[unitId])).toBe(true);
    expect(back.units[unitId].hp).toBe(Math.floor(content.species.rattata.maxHp / 4));
  });
});

describe('v26 contest seasons', () => {
  test('season rounds, a fixed category rotation, the score formula', () => {
    const { state, content } = game();
    expect(seasonRounds(content, 200)).toEqual([45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195]);
    const categories = [0, 1, 2, 3, 4].map(index => seasonCategory(state.setup.seed, index));
    expect(new Set(categories).size).toBe(5);
    // Bulbasaur in "cute" (grass): 20 + stage 10 + 0 veteran + 1 hall × 5.
    expect(contestScore(content, 'bulbasaur', 0, undefined, 1, 'cute')).toBe(35);
    expect(contestScore(content, 'bulbasaur', 120, 'normal', 9, 'cute')).toBe(40 + 10 + 2 + 20);
  });
  test('EnterContest: closed before the announcement; at the season round placings add appeal and a ribbon', () => {
    const { state, content } = game(), city = capital(state);
    const unitId = place(state, content, { kind: 'pokemon', speciesId: 'bulbasaur' }, freeNear(state, city.position, content));
    state.expansion!.contests![0].halls = [city.id];
    expect(order(state, { type: 'EnterContest', unitId }, content).ok).toBe(false);
    state.round = 42;
    const near = hexDistance(state.units[unitId].position!, city.position, state.map) <= 1;
    if (!near) return;
    const entered = ok(order(state, { type: 'EnterContest', unitId }, content)).state;
    expect(entered.expansion!.contestSeasons!.entries[0].unitId).toBe(unitId);
    expect(observe(entered, 1, content).expansion!.contestSeasons!.entrants).toEqual([0]);
    entered.round = 45;
    const before = entered.expansion!.contests![0].appeal;
    let next = entered;
    for (const actor of [0, 1]) next = ok(order(next, { type: 'EndTurn' }, content, actor)).state;
    expect(next.expansion!.contests![0].appeal - before).toBeGreaterThanOrEqual(lateTuning(content).seasonRewards[0]);
    expect(next.expansion!.contestSeasons!.ribbons[0]).toBe(1);
    expect(next.expansion!.contestSeasons!.last?.placings[0].playerId).toBe(0);
  });
});

describe('v26 legend race', () => {
  test('stages, met civilizations only, no rounds or cities in the view', () => {
    expect(raceStage(0, 100)).toBe('started');
    expect(raceStage(50, 100)).toBe('half');
    expect(raceStage(85, 100)).toBe('final');
    const { state, content } = game(), rival = capital(state, 1);
    rival.queue = [{ id: 900, progress: 0, item: { kind: 'legend', defId: LEGEND } }];
    const met = hasMet(state, 0, 1);
    expect(observeLegendRace(state, 0, content)).toEqual(met ? [{ legendId: LEGEND, playerId: 1, stage: 'started' }] : []);
    state.knowledge[0].lastKnownCities = {}; state.knowledge[0].rememberedTiles = {};
    expect(observeLegendRace(state, 0, content)).toEqual([]);
    expect(observe(state, 0, content).expansion!.legends!.race).toEqual([]);
    expect(observe(createGame(setup(25)), 0, contentFor(setup(25))).expansion!.legends!.race).toBeUndefined();
  });
});

describe('v26 raids, the near-victory warning, the opening gift, evolution goals', () => {
  test('raid rounds and the raid view stay quiet before round 90', () => {
    const { state, content } = game();
    expect(raidRounds(content, 200)).toEqual([90, 110, 130, 150, 170, 190]);
    expect(observe(state, 0, content).expansion!.raids).toEqual({ nextRound: 90, held: 0, active: null });
  });
  test('a raid appears the round before 90 and a knocked-out boss goes to the top damage dealer', () => {
    const { state, content } = game();
    state.round = 89;
    let next = state;
    for (const actor of [0, 1]) next = ok(order(next, { type: 'EndTurn' }, content, actor)).state;
    const raid = next.expansion!.raids!.active!;
    expect(raid).not.toBeNull();
    const boss = next.units[raid.unitId];
    // Every civilization gets a raid card; only those that explored the den see where it is.
    for (const playerId of [0, 1]) {
      const card = depthWorldCards(observe(next, playerId, content), content).find(item => item.id === 'raid')!;
      expect(card.title).toContain('极巨巢穴');
      expect(card.tileIndex === undefined).toBe(!next.knowledge[playerId].exploredTileIds.includes(raid.tileIndex));
    }
    expect(boss.hp).toBe(lateTuning(content).raidBaseHp + 2 * lateTuning(content).raidHpPerCiv);
    expect(Object.values(next.cities).every(city => hexDistance(city.position, indexToHex(raid.tileIndex, next.map), next.map) >= 3)).toBe(true);
    // Knock it out with a strong own Pokémon next to it.
    const at = neighbors(boss.position!, next.map).find(hex => { const index = hexToIndex(hex, next.map); return index !== null && next.map.tiles[index] !== 'ocean'
      && !Object.values(next.units).some(unit => isMapUnit(unit) && hexDistance(unit.position, hex, next.map) === 0); })!;
    const hitter = place(next, content, { kind: 'pokemon', speciesId: 'venusaur' }, at);
    next.units[raid.unitId].hp = 1;
    const won = ok(order(next, { type: 'Attack', unitId: hitter, target: { kind: 'unit', id: raid.unitId } }, content));
    expect(won.state.expansion!.raids!.active).toBeNull();
    expect(won.events.map(event => event.payload.type)).toContain('RaidDefeated');
    expect(Object.values(won.state.units).some(unit => unit.ownerId === 0 && unit.kind === 'pokemon' && unit.speciesId === raid.speciesId)).toBe(true);
  });
  test('victory progress is in percent and the alarm fires once at 75%', () => {
    const { state, content } = game();
    expect(victoryProgress(state, 0).contest).toBe(0);
    state.expansion!.contests![0].appeal = 400;
    expect(victoryProgress(state, 0).contest).toBe(80);
    let next = state;
    for (const actor of [0, 1]) next = ok(order(next, { type: 'EndTurn' }, content, actor)).state;
    expect(next.expansion!.victoryWatch![0].contest).toBe(state.round);
    expect(observe(next, 1, content).expansion!.victoryWatch).toEqual([{ playerId: 0, route: 'contest', percent: 80, round: state.round }]);
  });
  test('domestication gives three Poké Balls once (v26 only)', () => {
    for (const version of [25, 26] as const) {
      const { state, content } = game(version);
      state.players[0].research.techId = 'domestication';
      state.players[0].research.progressByTech.domestication = 999;
      let next = state;
      for (const actor of [0, 1]) next = ok(order(next, { type: 'EndTurn' }, content, actor)).state;
      expect(next.players[0].research.unlockedIds).toContain('domestication');
      expect(next.players[0].ballInventory.pokeBall).toBe(version === 26 ? 3 : 0);
    }
  });
  test('final forms and first-of-line', () => {
    const { content } = game();
    const { finals, root } = evolutionLines(content);
    expect(finals.has('venusaur')).toBe(true);
    expect(finals.has('ivysaur')).toBe(false);
    expect(root.get('venusaur')).toBe('bulbasaur');
    expect(firstFinalOfLine(content, [], 'venusaur')).toBe(true);
    expect(firstFinalOfLine(content, ['venusaur'], 'venusaur')).toBe(false);
  });
});

describe('v26 tile sharing', () => {
  test('a Pokémon may stop on its settler; the settler cannot be targeted while escorted; v25 keeps every unit blocking', () => {
    for (const version of [25, 26] as const) {
      const { state, content } = game(version), city = capital(state);
      const settlerAt = freeNear(state, city.position, content);
      const settler = place(state, content, { kind: 'logistics', role: 'settler' }, settlerAt);
      const near = neighbors(settlerAt, state.map).find(hex => { const index = hexToIndex(hex, state.map); return index !== null && state.map.tiles[index] !== 'ocean'
        && content.moveCosts[state.map.tiles[index]] < 3 && !Object.values(state.units).some(unit => isMapUnit(unit) && hexDistance(unit.position, hex, state.map) === 0)
        && !Object.values(state.cities).some(item => hexDistance(item.position, hex, state.map) === 0); })!;
      const escort = place(state, content, { kind: 'pokemon', speciesId: 'rattata' }, near);
      const paths = reachablePaths(observe(state, 0, content), escort, content);
      const target = hexToIndex(settlerAt, state.map)!;
      expect(Boolean(paths[target])).toBe(version === 26);
      if (version === 25) continue;
      const moved = ok(order(state, { type: 'Move', unitId: escort, to: settlerAt }, content)).state;
      expect(hexDistance(moved.units[escort].position!, settlerAt, moved.map)).toBe(0);
      // An enemy at war next to them may only target the Pokémon.
      const enemyAt = neighbors(settlerAt, moved.map).find(hex => { const index = hexToIndex(hex, moved.map); return index !== null && moved.map.tiles[index] !== 'ocean'
        && !Object.values(moved.units).some(unit => isMapUnit(unit) && hexDistance(unit.position, hex, moved.map) === 0)
        && !Object.values(moved.cities).some(item => hexDistance(item.position, hex, moved.map) === 0); })!;
      const enemy = place(moved, content, { kind: 'pokemon', speciesId: 'rattata' }, enemyAt, 1);
      const pair = moved.diplomacy.find(item => item.a === 0 && item.b === 1)!;
      pair.status = 'war';
      moved.activePlayerId = 1;
      expect(order(moved, { type: 'Attack', unitId: enemy, target: { kind: 'unit', id: settler } }, content, 1).ok).toBe(false);
      expect(previewAttack(observe(moved, 1, content), enemy, { kind: 'unit', id: settler }, content)).toEqual({ ok: false, reason: 'escorted' });
      expect(order(moved, { type: 'Attack', unitId: enemy, target: { kind: 'unit', id: escort } }, content, 1).ok).toBe(true);
    }
  });
});

describe('v26 AI', () => {
  test('a rich AI spends gold through the sinks without refused commands', () => {
    const { state, content } = game(), city = capital(state, 1);
    state.players[1].gold = 2000;
    state.activePlayerId = 1;
    let current = ok(order(state, { type: 'SetProductionQueue', cityId: city.id, orders: [{ item: { kind: 'logistics', defId: 'settler' } }] }, content, 1)).state;
    const actions: string[] = [];
    for (let index = 0; index < 30; index++) {
      const command = planNext(observe(current, 1, content));
      actions.push(command.action.type);
      if (command.action.type === 'EndTurn') break;
      current = ok(step(current, command, content)).state;
    }
    expect(actions).toContain('RushProduction');
    expect(current.players[1].gold).toBeLessThan(2000);
  });
});

describe('v26 saves', () => {
  test('a v26 save replays with the content derived from its setup (its regional Pokédex), not the stock base', () => {
    const { state, content } = game();
    let current = state;
    const commands: Command[] = [];
    for (let index = 0; index < 40; index++) {
      const command = planNext(observe(current, current.activePlayerId, content));
      const result = step(current, command, content);
      if (!result.ok) break;
      current = result.state; commands.push(command);
    }
    const log = { version: 1 as const, ...gameVersions(current.setup), contentVersion: current.contentVersion, setup: current.setup, commands };
    expect(deserializeSave(serializeSave(current, log)).state.commandSeq).toBe(commands.length);
  });
});
