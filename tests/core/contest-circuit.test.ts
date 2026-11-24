// Gameplay v27 ⑦ (docs/design/pace-v27.md §8): the contest circuit — entry from any own city (halls still add points), placing prizes
// (1st: a TM of the category's first type, free and without a badge, + 1 era score; 2nd / 3rd gold; others XP), the AI's entrant, v26 neutrality.
import { describe, expect, test } from 'vitest';
import { contentFor } from '../../src/content/units.ts';
import type { Content } from '../../src/content/units.ts';
import { EVENTS_TUNING } from '../../src/content/pace-v27.ts';
import { createGame } from '../../src/core/game.ts';
import { hexToIndex, neighbors } from '../../src/core/hex.ts';
import type { Hex } from '../../src/core/hex.ts';
import { isMapUnit } from '../../src/core/model.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';
import { step } from '../../src/core/step.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { CONTEST_CATEGORIES, CONTEST_CATEGORY_INFO, seasonCategory, viewContestEntryBlocker } from '../../src/core/contest-seasons.ts';
import { CIRCUIT_PRIZE_TYPES, contestEntryCityIds } from '../../src/core/contest-circuit.ts';
import { goldSinkQuote } from '../../src/core/gold-sinks.ts';
import { planNext } from '../../src/ai/plan.ts';
import { depthWorldCards } from '../../src/browser/late-game-ui.ts';

const setup = (gameplayVersion: 27, players = 2): GameSetup => ({ seed: 31, width: 24, height: 16, roundLimit: 100 as const, expansionVersion: 1 as const,
  eraProgression: 'simple-v1' as const, gameplayVersion, players: [
    { id: 0, controller: 'human' as const, starterId: 'bulbasaur' as const }, ...Array.from({ length: players - 1 }, (_, index) => ({ id: index + 1, controller: 'ai' as const })),
  ] });
const order = (state: GameState, action: Command['action'], content: Content, actorId = 0) => step(state, { actorId, expectedSeq: state.commandSeq, action }, content);
const ok = (result: ReturnType<typeof step>) => { if (!result.ok) throw new Error(result.reason); return result; };
const capital = (state: GameState, playerId = 0) => state.cities[state.players[playerId].headquartersCityId];
function besideCity(state: GameState, playerId: number, content: Content, speciesId = 'bulbasaur'): number {
  const city = capital(state, playerId);
  const taken = new Set([...Object.values(state.units).filter(isMapUnit), ...Object.values(state.cities)].map(item => hexToIndex(item.position, state.map)));
  const at = neighbors(city.position, state.map).find(hex => { const index = hexToIndex(hex, state.map); return index !== null && !taken.has(index) && state.map.tiles[index] !== 'ocean' && content.moveCosts[state.map.tiles[index]] < 3; }) as Hex;
  const id = state.nextEntityId++;
  state.units[id] = createMapUnit({ kind: 'pokemon', speciesId } as Parameters<typeof createMapUnit>[0], id, playerId, at, content, 0, 1);
  refreshKnowledge(state, content);
  return id;
}

describe('v27 contest circuit', () => {
  test('the prize TM is the category\'s first type; entry cities are every own city', () => {
    for (const category of CONTEST_CATEGORIES) expect(CIRCUIT_PRIZE_TYPES[category]).toBe(CONTEST_CATEGORY_INFO[category].types[0]);
    expect(contestEntryCityIds([5], [9, 3, 5], contentFor(setup(27)))).toEqual([3, 5, 9]);
  });
  test('EnterContest without a contest hall is accepted from beside any own city (view mirror agrees)', () => {
    const state = createGame(setup(27)), content = contentFor(state.setup);
    const unitId = besideCity(state, 0, content);
    state.round = 42;
    const view = observe(state, 0, content);
    const result = order(state, { type: 'EnterContest', unitId }, content);
    expect(result.ok).toBe(true);
    expect(viewContestEntryBlocker(view, unitId, content)).toBeNull();
    const card = depthWorldCards(view, content).find(item => item.id === 'season')!;
    expect(card.tip).toContain('不需要大赛馆');
    expect(card.tip).toContain('奖品');
    expect(card.action?.available).toBe(true);
  });
  test('placing prizes: TM + era score to the winner, gold to 2nd and 3rd, XP to the others; the TM is free and needs no badge', () => {
    const state = createGame(setup(27, 4)), content = contentFor(state.setup);
    state.round = 42;
    const entrants = [0, 1, 2, 3].map(id => besideCity(state, id, content));
    let next = state;
    for (const [id, unitId] of entrants.entries()) { next.activePlayerId = id; next = ok(order(next, { type: 'EnterContest', unitId }, content, id)).state; }
    next.activePlayerId = next.turnOrder[0];
    next.round = 45;
    const ledger = next.expansion!.contestSeasons!.entries;
    const ranked = Object.entries(ledger).map(([id, entry]) => ({ id: Number(id), score: entry.score })).sort((a, b) => b.score - a.score || a.id - b.id).map(item => item.id);
    const gold = next.turnOrder.map(id => next.players[id].gold), xp = entrants.map(id => next.units[id].xp);
    const era = next.turnOrder.map(id => next.expansion!.eraHonors!.players[id].score);
    let after = next, events: ReturnType<typeof step> extends infer R ? R extends { ok: true; events: infer E } ? E : never : never = [];
    for (const actor of next.turnOrder) { const ended = ok(order(after, { type: 'EndTurn' }, content, actor)); after = ended.state; events = [...events, ...ended.events]; }
    const prizes = events.map(event => event.payload).find(event => event.type === 'ContestCircuitPrizes');
    if (!prizes || prizes.type !== 'ContestCircuitPrizes') throw new Error('no prizes');
    const category = seasonCategory(state.setup.seed, 0), tm = CIRCUIT_PRIZE_TYPES[category];
    expect(prizes.prizes.map(item => item.playerId)).toEqual(ranked);
    expect(prizes.prizes[0]).toMatchObject({ place: 1, tm, eraScore: 1 });
    expect(after.expansion!.goldSinks!.prizeTms![ranked[0]]).toEqual([tm]);
    expect(after.expansion!.eraHonors!.players[ranked[0]].byMilestone.contestSeasonWon).toBe(1);
    expect(after.expansion!.eraHonors!.players[ranked[0]].score - era[ranked[0]]).toBeGreaterThanOrEqual(1);
    expect(prizes.prizes[1]).toMatchObject({ place: 2, gold: EVENTS_TUNING.circuitGold[0] });
    void gold;
    expect(prizes.prizes[2]).toMatchObject({ place: 3, gold: EVENTS_TUNING.circuitGold[1] });
    expect(prizes.prizes[3]).toMatchObject({ place: 4, xp: EVENTS_TUNING.circuitEntrantXp, unitId: entrants[ranked[3]] });
    expect(after.units[entrants[ranked[3]]].xp - xp[ranked[3]]).toBeGreaterThanOrEqual(EVENTS_TUNING.circuitEntrantXp);
    // The winner sees the prize TM among its free TMs, and teaching it is free without a badge (the authority agrees).
    const winner = ranked[0], view = observe(after, winner, content);
    expect(view.expansion!.goldSinks!.prizeTms).toEqual([tm]);
    expect(view.expansion!.goldSinks!.freeTms).toContain(tm);
    const pupil = Object.values(after.units).find(unit => unit.ownerId === winner && unit.kind === 'pokemon' && isMapUnit(unit)
      && content.species[unit.speciesId].typeId !== tm && content.species[unit.speciesId].secondaryTypeId !== tm)!;
    const action = { type: 'TeachMove' as const, unitId: pupil.id, typeId: tm };
    after.activePlayerId = winner;
    expect(goldSinkQuote(after, winner, action, content)).toEqual({ ok: true, gold: 0, free: true });
    const taught = ok(step(after, { actorId: winner, expectedSeq: after.commandSeq, action }, content));
    expect(taught.state.expansion!.goldSinks!.prizeTms![winner]).toEqual([]);
    expect(taught.state.expansion!.goldSinks!.moves[pupil.id]).toBe(tm);
  });
  test('v26: no prizes, no prize TM field', () => {
    const state = createGame(setup(27)), content = contentFor(state.setup);
    expect(state.expansion!.goldSinks!.prizeTms).toBeUndefined();
    expect(observe(state, 0, content).expansion!.goldSinks!.prizeTms).toBeUndefined();
  });
  test('AI: once the category is announced every personality enters from a city without a hall', () => {
    for (const personality of ['expansion', 'aggressive', 'conservative'] as const) {
      const base = setup(27);
      const state = createGame({ ...base, players: [base.players[0], { id: 1, controller: 'ai', personality }] }), content = contentFor(state.setup);
      besideCity(state, 1, content);
      state.round = 42; state.activePlayerId = 1;
      let current = state, entered = false;
      for (let guard = 0; guard < 40 && !entered; guard++) {
        const view = observe(current, 1, content);
        const command = planNext(view);
        if (command.action.type === 'EndTurn') break;
        const result = step(current, command, content);
        if (!result.ok) break;
        entered = command.action.type === 'EnterContest';
        current = result.state;
      }
      expect(entered, personality).toBe(true);
    }
  });
});
