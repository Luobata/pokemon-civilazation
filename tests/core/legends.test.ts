import { expect, test } from 'vitest';
import { ROSTER_CONTENT } from '../../src/content/units.ts';
import { LEGEND_RULES, LEGEND_WONDERS, legendCost } from '../../src/content/legend-wonders.ts';
import type { LegendWonderId } from '../../src/content/legend-wonders.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';
import { RULE_QUERIES } from '../../src/ai/query.ts';
import { planNext } from '../../src/ai/plan.ts';
import { rememberCityRejection } from '../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../src/ai/memory.ts';
import { replay } from '../../src/app/session.ts';
import type { CommandLog } from '../../src/app/session.ts';
import { createGame } from '../../src/core/game.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { cityYield } from '../../src/core/city.ts';
import { hexToIndex, indexToHex } from '../../src/core/hex.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { gameVersions } from '../../src/core/versions.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { playerPolicyEffects } from '../../src/core/policies.ts';
import { completeLegendWonder, legendWonderBlocker, recordLegends } from '../../src/core/legends.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';

const duel = (gameplayVersion: GameplayVersion): GameSetup => ({ seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1', gameplayVersion,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'misty' }] });
const hq = (state: GameState, playerId: number) => state.cities[state.players[playerId].headquartersCityId];
const queueWonder = (state: GameState, playerId: number, legendId: LegendWonderId) => step({ ...state, activePlayerId: playerId },
  { actorId: playerId, expectedSeq: state.commandSeq, action: { type: 'SetProductionQueue', cityId: hq(state, playerId).id, orders: [{ item: { kind: 'legend', defId: legendId } }] } });

test('legend wonders exist only from v15; trace sites do not touch the world or its RNG', () => {
  expect(createGame(duel(14)).expansion).not.toHaveProperty('legends');
  const v14 = createGame(duel(14)), v15 = createGame(duel(15));
  expect(v15.rng).toEqual(v14.rng);
  expect(v15.map).toEqual(v14.map);
  expect(v15.expansion!.world).toEqual(v14.expansion!.world);
  const ledger = v15.expansion!.legends!;
  // Simple eras: the seven gen 1–3 trace legends get a site; no site sits on a city or another site.
  expect(Object.keys(ledger.sites).sort()).toEqual(['articuno', 'entei', 'latias', 'moltres', 'raikou', 'suicune', 'zapdos']);
  const tiles = Object.values(ledger.sites) as number[];
  expect(new Set(tiles).size).toBe(tiles.length);
  for (const city of Object.values(v15.cities)) expect(tiles).not.toContain(hexToIndex(city.position, v15.map));
  expect(gameVersions(v15.setup)).toEqual({ schemaVersion: 10, rulesVersion: 'legends-v15' });
});

test('a Pokémon on a trace site finds the clue (with 野外观察); clues are private', () => {
  const state = createGame(duel(15));
  const site = state.expansion!.legends!.sites.articuno!;
  state.units[9000] = createMapUnit({ kind: 'pokemon', speciesId: 'pidgey' }, 9000, 0, indexToHex(site, state.map), ROSTER_CONTENT);
  expect(recordLegends(state, [])).toEqual([]); // no 野外观察 yet
  state.players[0].research.unlockedIds.push('fieldObservation');
  expect(recordLegends(state, [])).toEqual([{ type: 'LegendClueFound', playerId: 0, legendId: 'articuno' }]);
  expect(state.expansion!.legends!.clues[0]).toContain('articuno');
  expect(state.expansion!.legends!.clues[1]).not.toContain('articuno');
  refreshKnowledge(state);
  expect(observe(state, 0).expansion!.legends!.clues).toContain('articuno');
  expect(observe(state, 1).expansion!.legends!.clues).not.toContain('articuno');
});

test('starting a wonder needs a clue, the generation and the site; completion is unique and refunds rivals', () => {
  const state = createGame(duel(15));
  const ledger = state.expansion!.legends!;
  expect(queueWonder(state, 0, 'mew').ok).toBe(false); // no clue
  ledger.clues[0] = ['mew']; ledger.clues[1] = ['mew'];
  expect(legendWonderBlocker(state, hq(state, 0), 'mew')).toBeNull();
  expect(queueWonder(state, 0, 'mew').ok).toBe(true);
  ledger.clues[0] = ['mew', 'raikou'];
  expect(legendWonderBlocker(state, hq(state, 0), 'raikou')).toBe('legend-generation'); // generation 2
  // Both civilizations build 梦幻; player 0 finishes first, player 1's progress is refunded at 50%.
  hq(state, 0).queue = [{ id: 1, progress: legendCost('mew'), item: { kind: 'legend', defId: 'mew' } }];
  hq(state, 1).queue = [{ id: 2, progress: 60, item: { kind: 'legend', defId: 'mew' } }];
  const gold = state.players[1].gold;
  const events = completeLegendWonder(state, hq(state, 0) as GameState['cities'][number] & { ownerId: number }, 'mew');
  expect(events).toContainEqual({ type: 'LegendWonderCompleted', playerId: 0, legendId: 'mew', public: true });
  expect(events).toContainEqual({ type: 'LegendWonderLost', playerId: 1, legendId: 'mew', cityId: hq(state, 1).id, refund: 60 * LEGEND_RULES.lostRefundPermille / 1000 });
  expect(state.players[1].gold).toBe(gold + 30);
  expect(hq(state, 1).queue).toEqual([]);
  expect(legendWonderBlocker(state, hq(state, 1), 'mew')).toBe('legend-built');
  expect(observe(state, 1).expansion!.legends!.wonders).toEqual([{ legendId: 'mew', ownerId: 0, round: state.round }]);
});

test('a wonder adds its city yield and empire effect, and changes hands with the city', () => {
  const state = createGame(duel(15));
  const city = hq(state, 0), before = cityYield(state, city), effects = playerPolicyEffects(state, 0);
  state.expansion!.legends!.wonders.articuno = { cityId: city.id, builderId: 0, round: 1 };
  const after = cityYield(state, city);
  expect(after.research - before.research).toBe(LEGEND_WONDERS.articuno.cityYield.research);
  expect(playerPolicyEffects(state, 0).visionBonus).toBe(effects.visionBonus + 1);
  city.ownerId = 1;
  expect(playerPolicyEffects(state, 0).visionBonus).toBe(effects.visionBonus);
  expect(playerPolicyEffects(state, 1).visionBonus).toBeGreaterThanOrEqual(1);
});

test('a real v15 AI game finds clues, builds wonders and replays exactly', () => {
  const setup: GameSetup = { seed: 31, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion: 15, players: [
    { id: 0, controller: 'ai', personality: 'expansion', leaderId: 'oak' }, { id: 1, controller: 'ai', personality: 'conservative', leaderId: 'joy' },
    { id: 2, controller: 'ai', personality: 'aggressive', leaderId: 'lance' }] };
  let state = createGame(setup);
  const commands: Command[] = [], memory: RejectedCitySite[] = [];
  while (!state.outcome && state.round < 85) {
    const view = observe(state, state.activePlayerId);
    let command = planNext(view, { ...RULE_QUERIES, content: ROSTER_CONTENT }, memory);
    let result = step(state, command);
    if (!result.ok) {
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command);
    }
    if (!result.ok) throw new Error(result.reason);
    state = result.state; commands.push(command);
  }
  const ledger = state.expansion!.legends!;
  expect(Object.values(ledger.clues).flat().length).toBeGreaterThan(3);
  expect(Object.keys(ledger.wonders).length).toBeGreaterThan(0);
  const log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands };
  expect(state.schemaVersion).toBe(10);
  expect(canonicalSerialize(replay(log))).toBe(canonicalSerialize(state));
}, 120_000);
