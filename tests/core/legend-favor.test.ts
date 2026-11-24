// Gameplay v27 ④ (docs/design/pace-v27.md §5): legend favour — +15% legend cost per legend owned (read every round, follows the
// city), the view mirror, the race stage against the builder's own cost, the legend trail of a lost race, and v26 neutrality.
import { describe, expect, test } from 'vitest';
import { contentFor } from '../../src/content/units.ts';
import type { Content } from '../../src/content/units.ts';
import { LEGEND_WONDER_IDS, legendCost } from '../../src/content/legend-wonders.ts';
import { ECONOMY_TUNING } from '../../src/content/pace-v27.ts';
import { createGame } from '../../src/core/game.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';
import { step } from '../../src/core/step.ts';
import { observe } from '../../src/core/vision.ts';
import { legendFavorCost, ownedLegends, viewLegendCost, viewLegendFavorPercent } from '../../src/core/legend-favor.ts';
import { completeLegendWonder } from '../../src/core/legends.ts';

const setup = (gameplayVersion: 27): GameSetup => ({ seed: 31, width: 24, height: 16, roundLimit: 100 as const, expansionVersion: 1 as const,
  eraProgression: 'simple-v1' as const, gameplayVersion, players: [
    { id: 0, controller: 'human' as const, starterId: 'bulbasaur' as const }, { id: 1, controller: 'ai' as const },
  ] });
const game = (version: 27 = 27) => { const state = createGame(setup(version)); return { state, content: contentFor(state.setup) }; };
const order = (state: GameState, action: Command['action'], content: Content, actorId = 0) => step(state, { actorId, expectedSeq: state.commandSeq, action }, content);
const ok = (result: ReturnType<typeof step>) => { if (!result.ok) throw new Error(result.reason); return result; };
const capital = (state: GameState, playerId = 0) => state.cities[state.players[playerId].headquartersCityId];
const [A, B, C] = LEGEND_WONDER_IDS;
const own = (state: GameState, id: typeof A, playerId = 0) => { state.expansion!.legends!.wonders[id] = { cityId: capital(state, playerId).id, builderId: playerId, round: 1 }; };

describe('v27 legend favour', () => {
  test('cost = stock × (100 + 15 × owned) / 100; owned follows the city; authority = view', () => {
    const { state, content } = game(), item = { kind: 'legend' as const, defId: C };
    expect(legendFavorCost(state, 0, item, legendCost(C), content)).toBe(legendCost(C));
    own(state, A); own(state, B);
    expect(ownedLegends(state, 0)).toBe(2);
    expect(legendFavorCost(state, 0, item, legendCost(C), content)).toBe(Math.floor(legendCost(C) * (100 + 2 * ECONOMY_TUNING.legendFavorPercent) / 100));
    expect(viewLegendCost(observe(state, 0, content), C, content)).toBe(legendFavorCost(state, 0, item, legendCost(C), content));
    expect(viewLegendFavorPercent(observe(state, 0, content), content)).toBe(130);
    // Player 1 owns none: its cost is the stock cost, and the private count is not in its view.
    expect(legendFavorCost(state, 1, item, legendCost(C), content)).toBe(legendCost(C));
    expect(viewLegendFavorPercent(observe(state, 1, content), content)).toBe(100);
    // A captured city's wonder counts for its new owner.
    capital(state).ownerId = 1;
    expect(ownedLegends(state, 0)).toBe(0);
    expect(ownedLegends(state, 1)).toBe(2);
  });

  test('a legend under way costs more once another is finished: the order completes at the favoured cost, progress kept', () => {
    const { state, content } = game(), city = capital(state);
    state.expansion!.legends!.clues[0] = [C];
    city.queue = [{ id: state.nextEntityId++, progress: legendCost(C), item: { kind: 'legend', defId: C } }];
    own(state, A);
    let next = state;
    for (const actor of [0, 1]) next = ok(order(next, { type: 'EndTurn' }, content, actor)).state;
    expect(next.expansion!.legends!.wonders[C]).toBeUndefined();
    expect(capital(next).queue[0].progress).toBeGreaterThan(legendCost(C));
    expect(observe(next, 0, content).expansion!.legends!.building[0].cost).toBe(Math.floor(legendCost(C) * 115 / 100));
  });

  test('a lost race refunds half as gold and leaves 25% as a legend trail for the city\'s next legend', () => {
    const { state, content } = game(), mine = capital(state, 0), theirs = capital(state, 1);
    mine.queue = [{ id: state.nextEntityId++, progress: 80, item: { kind: 'legend', defId: A } }];
    const gold = state.players[0].gold;
    const events = completeLegendWonder(state, theirs as typeof theirs & { ownerId: number }, A, content);
    expect(events).toContainEqual(expect.objectContaining({ type: 'LegendWonderLost', playerId: 0, refund: 40, trail: 20 }));
    expect(state.players[0].gold).toBe(gold + 40);
    expect(state.expansion!.cityProjects!.legendTrail[mine.id]).toBe(20);
    expect(observe(state, 0, content).expansion!.cityProjects!.legendTrail).toEqual({ [mine.id]: 20 });
    expect(observe(state, 1, content).expansion!.cityProjects!.legendTrail).toEqual({});
    // The next legend queued in the city starts with the trail (consumed once).
    state.expansion!.legends!.clues[0] = [B];
    const queued = ok(order(state, { type: 'SetProductionQueue', cityId: mine.id, orders: [{ item: { kind: 'legend', defId: B } }] }, content)).state;
    expect(capital(queued).queue[0].progress).toBe(20);
    expect(queued.expansion!.cityProjects!.legendTrail[mine.id]).toBeUndefined();
  });
});
