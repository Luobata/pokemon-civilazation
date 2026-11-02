import { expect, test } from 'vitest';
import { GameSession, replay } from '../../src/app/session.ts';
import { EXPANSION_CONTENT } from '../../src/content/units.ts';
import { CHARTERS, POLICY_SWAP_GOLD } from '../../src/content/policies.ts';
import { createGame } from '../../src/core/game.ts';
import { cityYield } from '../../src/core/city.ts';
import { observe } from '../../src/core/vision.ts';
import { step } from '../../src/core/step.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { fitsSlots, policyEffects, resolvePolicyRound } from '../../src/core/policies.ts';
import { parseAuditAction } from '../../src/audit/commands.ts';
import { planPolicyAction } from '../../src/ai/policy-plan.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';
import type { GameplayVersion } from '../../src/content/eras.ts';

function setup(gameplayVersion?: GameplayVersion): GameSetup {
  return { seed: 12345, width: 24, height: 16, expansionVersion: 1, multiplayer: true, eraProgression: 'simple-v1',
    ...(gameplayVersion ? { gameplayVersion } : {}), players: [
      { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' },
      { id: 1, controller: 'human', starterId: 'charmander', leaderId: 'lance' },
    ] };
}
const act = (state: GameState, action: Command['action']) => step(state, { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action });
function adopt(state: GameState, ...ids: (keyof typeof CHARTERS)[]) {
  state.expansion!.policies![0].adopted = [...ids].sort();
}

test('policies exist only in gameplay v3 and the parser validates card lists', () => {
  expect(createGame(setup(3)).expansion?.policies?.[0]).toMatchObject({ adopted: [], slotted: [], charterId: null, freeSwap: true });
  expect(createGame(setup(2)).expansion).not.toHaveProperty('policies');
  expect(observe(createGame(setup(2)), 0).expansion).not.toHaveProperty('policies');
  expect(act(createGame(setup(2)), { type: 'SetCharter', charterId: 'gymCode' }).ok).toBe(false);
  expect(parseAuditAction({ type: 'SetPolicies', policyIds: ['marketDay', 'gymChallenge'] })).toEqual({ type: 'SetPolicies', policyIds: ['marketDay', 'gymChallenge'] });
  expect(() => parseAuditAction({ type: 'SetPolicies', policyIds: ['marketDay', 'marketDay'] })).toThrow();
  expect(() => parseAuditAction({ type: 'SetPolicies', policyIds: ['bogus'] })).toThrow();
});

test('charters require prerequisites and complete in round settlement, granting slots and a free swap', () => {
  const state = createGame(setup(3));
  expect(act(state, { type: 'SetCharter', charterId: 'rangerCharter' }).ok).toBe(false);
  const chosen = act(state, { type: 'SetCharter', charterId: 'gymCode' });
  expect(chosen.ok).toBe(true);
  if (!chosen.ok) return;
  const next = chosen.state, ledger = next.expansion!.policies![0];
  ledger.freeSwap = false;
  ledger.progressByCharter.gymCode = CHARTERS.gymCode.cost - 1;
  const events = resolvePolicyRound(next);
  expect(events).toContainEqual({ type: 'CharterAdopted', playerId: 0, charterId: 'gymCode' });
  expect(ledger).toMatchObject({ adopted: ['gymCode'], charterId: null, freeSwap: true });
  expect(observe(next, 0).expansion!.policies).toMatchObject({ slots: { military: 1, economic: 1, wild: 0 }, unlockedPolicies: ['gymChallenge', 'harvestFestival', 'researchGrant'] });
  expect(observe(next, 1).expansion!.policies!.adopted).toEqual([]);
});

test('slots constrain cards; wild slots take either kind', () => {
  expect(fitsSlots(['gymCode'], ['gymChallenge', 'harvestFestival'])).toBe(true);
  expect(fitsSlots(['gymCode'], ['harvestFestival', 'researchGrant'])).toBe(false);
  expect(fitsSlots(['gymCode', 'rangerCharter', 'breederAssociation'], ['harvestFestival', 'researchGrant'])).toBe(true);
  expect(fitsSlots(['gymCode'], ['marketDay'])).toBe(false);
});

test('first change is free, later changes cost gold; effects apply to yields', () => {
  const state = createGame(setup(3)); adopt(state, 'gymCode');
  const city = state.cities[state.players[0].headquartersCityId];
  const before = cityYield(state, city).research;
  const set = act(state, { type: 'SetPolicies', policyIds: ['researchGrant'] });
  expect(set.ok).toBe(true);
  if (!set.ok) return;
  // Oak has affinity for the research grant: +1 base, +1 affinity.
  expect(cityYield(set.state, set.state.cities[city.id]).research).toBe(before + 2);
  expect(set.state.players[0].gold).toBe(state.players[0].gold);
  set.state.players[0].gold = POLICY_SWAP_GOLD - 1;
  expect(act(set.state, { type: 'SetPolicies', policyIds: ['harvestFestival'] }).ok).toBe(false);
  set.state.players[0].gold = POLICY_SWAP_GOLD;
  const paid = act(set.state, { type: 'SetPolicies', policyIds: ['harvestFestival'] });
  expect(paid.ok && paid.state.players[0].gold).toBe(0);
});

test('leader affinity amplifies matching cards', () => {
  expect(policyEffects({ leaderId: 'lance' }, ['gymChallenge']).trainedXp).toBe(22);
  expect(policyEffects({ leaderId: 'oak' }, ['gymChallenge']).trainedXp).toBe(15);
  expect(policyEffects({ leaderId: 'joy' }, ['nurseCorps']).healing).toBe(4);
});

test('AI picks a charter, then fills slots by personality and leader', () => {
  const state = createGame({ ...setup(3), multiplayer: undefined, players: [
    { id: 0, controller: 'ai', personality: 'aggressive', leaderId: 'lance' }, { id: 1, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }] });
  expect(planPolicyAction(observe(state, 0))).toEqual({ type: 'SetCharter', charterId: 'gymCode' });
  adopt(state, 'gymCode');
  state.expansion!.policies![0].charterId = 'rangerCharter';
  expect(planPolicyAction(observe(state, 0))).toEqual({ type: 'SetPolicies', policyIds: ['gymChallenge', 'harvestFestival'] });
});

test('gameplay v3 keeps exact save/load and replay with AI charters', () => {
  const session = new GameSession({ ...setup(3), multiplayer: undefined, players: [
    { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId: 'oak' }, { id: 1, controller: 'ai', personality: 'expansion', leaderId: 'joy' }] });
  for (let turn = 0; turn < 40; turn++) {
    const current = session.getState();
    if (current.outcome) break;
    expect(session.submit({ actorId: current.activePlayerId, expectedSeq: current.commandSeq, action: { type: 'EndTurn' } }).ok).toBe(true);
  }
  const saved = session.save(), loaded = new GameSession(setup(3));
  loaded.load(saved);
  expect(loaded.save()).toBe(saved);
  expect(canonicalSerialize(replay(session.exportLog()))).toBe(canonicalSerialize(session.getState()));
  expect(session.getState().expansion!.policies![1].adopted.length).toBeGreaterThan(0);
  void EXPANSION_CONTENT;
});

test('gameplay v3 raises the Pokédex victory target; earlier packs keep 18', () => {
  expect(createGame(setup(3)).expansion!.world.victory.targetDocumentedSpecies).toBe(21);
  expect(createGame(setup(2)).expansion!.world.victory.targetDocumentedSpecies).toBe(18);
  expect(createGame(setup()).expansion!.world.victory.targetDocumentedSpecies).toBe(18);
});
