// Gameplay v26 P3 (docs/design/depth-v26.md §3): rival duels — equal size, reach (field and city gate), stakes, the visit's end, the prize,
// the streak, the conference rival, and real AI games without refused duel commands.
import { describe, expect, test } from 'vitest';
import { contentFor } from '../../src/content/units.ts';
import { RIVAL_RULES_V24 } from '../../src/content/rivals.ts';
import type { SpeciesId } from '../../src/content/species.ts';
import { createGame } from '../../src/core/game.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from '../../src/core/hex.ts';
import { isMapUnit } from '../../src/core/model.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';
import { step } from '../../src/core/step.ts';
import { createMapUnit } from '../../src/core/unit.ts';
import { observe, refreshKnowledge } from '../../src/core/vision.ts';
import { conferenceRivals, settleConferenceRivals, viewRivalDuelBlocker } from '../../src/core/rival-duels.ts';
import { planNext } from '../../src/ai/plan.ts';
import { RULE_QUERIES } from '../../src/ai/query.ts';
import { rememberCityRejection } from '../../src/ai/memory.ts';
import type { RejectedCitySite } from '../../src/ai/memory.ts';

const setup = (gameplayVersion: 25 | 26, seed = 31): GameSetup => ({ seed, width: 24, height: 16, roundLimit: 100, expansionVersion: 1, eraProgression: 'simple-v1', gameplayVersion,
  players: [{ id: 0, controller: 'human', starterId: 'bulbasaur' }, { id: 1, controller: 'ai' }, { id: 2, controller: 'ai' }] });
const v26 = contentFor(setup(26));
const order = (state: GameState, action: Command['action'], content = v26) => step(state, { actorId: 0, expectedSeq: state.commandSeq, action }, content);

/** A visit under way: rival Pokémon of `rivalSpecies` on free land tiles next to a free land tile, own Pokémon around them. */
function duelScene(rivalSpecies: SpeciesId[], ownSpecies: SpeciesId[], content = v26, version: 25 | 26 = 26) {
  const state = createGame(setup(version), content), rivals = state.expansion!.rivals!;
  const land = (index: number) => state.map.tiles[index] !== 'ocean' && state.map.tiles[index] !== 'mountain';
  const capital = state.cities[state.players[0].headquartersCityId];
  // A land tile 3–4 from the capital with a ring of land around it.
  const centre = state.map.tiles.map((_, index) => index).find(index => land(index) && [3, 4].includes(hexDistance(indexToHex(index, state.map), capital.position, state.map))
    && neighbors(indexToHex(index, state.map), state.map).filter(hex => land(hexToIndex(hex, state.map)!)).length === 6)!;
  const spots = [indexToHex(centre, state.map), ...neighbors(indexToHex(centre, state.map), state.map)];
  for (const unit of Object.values(state.units)) if (isMapUnit(unit) && spots.some(hex => hexDistance(hex, unit.position, state.map) <= 1)) delete state.units[unit.id];
  const ledger = rivals.byPlayer[0];
  ledger.encounter = 1; ledger.arrivedAtRound = state.round; ledger.fought = []; delete ledger.pending;
  const rivalIds = rivalSpecies.map((speciesId, index) => {
    const id = state.nextEntityId++;
    state.units[id] = createMapUnit({ kind: 'pokemon', speciesId }, id, null, spots[index], content);
    (state.units[id] as { wildHome: null }).wildHome = null;
    rivals.unitTargets[id] = 0; rivals.spirit[id] = 0;
    return id;
  });
  ledger.activeUnitIds = rivalIds;
  const ownIds = ownSpecies.map((speciesId, index) => {
    const id = state.nextEntityId++;
    state.units[id] = createMapUnit({ kind: 'pokemon', speciesId }, id, 0, spots[rivalSpecies.length + index], content, 0, 1);
    return id;
  });
  refreshKnowledge(state, content);
  return { state, rivalIds, ownIds };
}

describe('v26 ChallengeRival (§3.1)', () => {
  test('equal size, in reach, once per round; refused before v26', () => {
    const { state, ownIds } = duelScene(['charmander'], ['pidgey', 'rattata']);
    const view = observe(state, 0, v26);
    expect(viewRivalDuelBlocker(view, ownIds)).toBe('invalid-team');
    expect(order(state, { type: 'ChallengeRival', unitIds: ownIds, stake: 'serious' })).toMatchObject({ ok: false });
    expect(viewRivalDuelBlocker(view, [ownIds[0]])).toBeNull();
    const result = order(state, { type: 'ChallengeRival', unitIds: [ownIds[0]], stake: 'spar' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.rng).not.toEqual(state.rng);
    expect(result.state.units[ownIds[0]]!.actionLeft).toBe(0);
    // Once per round, even with another Pokémon.
    expect(step(result.state, { actorId: 0, expectedSeq: result.state.commandSeq, action: { type: 'ChallengeRival', unitIds: [ownIds[1]], stake: 'spar' } }, v26).ok).toBe(false);
    const v25 = contentFor(setup(25)), old = duelScene(['charmander'], ['pidgey'], v25, 25);
    expect(order(old.state, { type: 'ChallengeRival', unitIds: old.ownIds, stake: 'spar' }, v25)).toMatchObject({ ok: false });
  });
  test('a won serious duel ends the visit with the full reward and the proof (+1 era point); full HP pays ×1.5 gold', () => {
    // A strong water Pokémon against one stage-1 fire rival: the duel is won with any seed.
    const { state, ownIds, rivalIds } = duelScene(['charmander'], ['blastoise']);
    const gold = state.players[0].gold, result = order(state, { type: 'ChallengeRival', unitIds: ownIds, stake: 'serious' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const events = result.events.map(event => event.payload);
    expect(events.find(event => event.type === 'RivalDuel')).toMatchObject({ victory: true, stake: 'serious' });
    expect(events.find(event => event.type === 'RivalDefeated')).toMatchObject({ proof: true, gold: Math.floor(RIVAL_RULES_V24.rewards[0].gold * 1.5) });
    expect(result.state.players[0].gold).toBe(gold + Math.floor(RIVAL_RULES_V24.rewards[0].gold * 1.5));
    expect(result.state.units[rivalIds[0]]).toBeUndefined();
    expect(result.state.expansion!.rivals!.byPlayer[0].outcomes).toEqual(['defeated']);
    expect(result.state.expansion!.rivals!.byPlayer[0].duels).toEqual({ spar: 0, serious: 1, won: 1 });
  });
  test('a friendly win pays half once and the rival stays; a lost serious duel pays a prize and fires the rival up', () => {
    const won = duelScene(['charmander'], ['blastoise']);
    const first = order(won.state, { type: 'ChallengeRival', unitIds: won.ownIds, stake: 'spar' });
    expect(first.ok && first.events.map(event => event.payload).find(event => event.type === 'RivalDuel')).toMatchObject({ victory: true, gold: Math.round(RIVAL_RULES_V24.rewards[0].gold / 2) });
    expect(first.ok && first.state.units[won.rivalIds[0]]).toBeTruthy();
    // A weak lone Pokémon against a fired-up rival loses.
    const lost = duelScene(['charizard'], ['caterpie']);
    lost.state.players[0].gold = 1000;
    const spirit = lost.state.expansion!.rivals!.spirit[lost.rivalIds[0]];
    const result = order(lost.state, { type: 'ChallengeRival', unitIds: lost.ownIds, stake: 'serious' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const event = result.events.map(item => item.payload).find(item => item.type === 'RivalDuel');
    expect(event).toMatchObject({ victory: false, prize: 30 });
    expect(result.state.players[0].gold).toBe(970);
    expect(result.state.expansion!.rivals!.spirit[lost.rivalIds[0]]).toBe(spirit + 3);
    expect(result.state.units[lost.ownIds[0]]!.hp).toBeGreaterThanOrEqual(1);
  });
  test('the conference rival: after the three visits, from round 100, in the first season the civilization enters; beating it pays', () => {
    const state = createGame(setup(26)), ledger = state.expansion!.rivals!.byPlayer[0];
    ledger.encounter = 3; ledger.outcomes = ['departed', 'departed', 'departed'];
    const power = (slot: number) => 1000 + slot;
    state.round = 99;
    expect(conferenceRivals(state, v26, 4, [0], 5, power, 2)).toEqual([]);
    state.round = 100;
    const [rival] = conferenceRivals(state, v26, 4, [0], 5, power, 2);
    expect(rival).toMatchObject({ entrantId: 'rival-0', targetPlayerId: 0, name: ledger.name });
    expect(rival.roster).toHaveLength(6);
    expect(rival.roster.every(member => v26.species[member.speciesId].stage === 3)).toBe(true);
    const gold = state.players[0].gold;
    const events = settleConferenceRivals(state, [rival], [{ entrantIds: ['player-0', 'rival-0'], winnerEntrantId: 'player-0' }]);
    expect(events).toEqual([{ type: 'RivalConferenceBeaten', playerId: 0, gold: 100, eraScore: 2 }]);
    expect(state.players[0].gold).toBe(gold + 100);
    expect(conferenceRivals(state, v26, 5, [0], 5, power, 2)).toEqual([]);
  });
});

test('real AI v26 games: duels happen and no duel command is refused', () => {
  let state = createGame({ ...setup(26, 33), players: [{ id: 0, controller: 'ai', personality: 'aggressive' }, { id: 1, controller: 'ai', personality: 'conservative' }, { id: 2, controller: 'ai', personality: 'expansion' }] });
  const content = contentFor(state.setup), rejected: string[] = [], memory: RejectedCitySite[] = [];
  let duels = 0;
  while (!state.outcome && state.round <= 30) {
    const view = observe(state, state.activePlayerId, content);
    let command = planNext(view, { ...RULE_QUERIES, content }, memory), result = step(state, command, content);
    if (!result.ok) {
      rejected.push(`${command.action.type}:${result.reason}`);
      rememberCityRejection(memory, view, command, result.reason);
      command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      result = step(state, command, content);
    }
    if (!result.ok) throw new Error(result.reason);
    duels += result.events.filter(event => event.payload.type === 'RivalDuel').length;
    state = result.state;
  }
  expect(rejected.filter(reason => reason.startsWith('ChallengeRival'))).toEqual([]);
  expect(duels).toBeGreaterThan(0);
}, 180_000);
