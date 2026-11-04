import { expect, test } from 'vitest';
import { EXPANSION_CONTENT } from '../../src/content/units.ts';
import { GOVERNMENT_SWAP_GOLD } from '../../src/content/policies.ts';
import type { LeaderId } from '../../src/content/leaders.ts';
import { replay } from '../../src/app/session.ts';
import type { CommandLog } from '../../src/app/session.ts';
import { gameVersions } from '../../src/core/versions.ts';
import { deserializeSave, serializeSave } from '../../src/app/save.ts';
import { canonicalSerialize } from '../../src/core/snapshot.ts';
import { createGame } from '../../src/core/game.ts';
import { step } from '../../src/core/step.ts';
import { observe } from '../../src/core/vision.ts';
import { playerPolicyEffects, slotCounts } from '../../src/core/policies.ts';
import type { Command, GameSetup, GameState } from '../../src/core/model.ts';

const setup = (gameplayVersion: 10 | 11, leaderId: LeaderId = 'brock'): GameSetup => ({ seed: 31, width: 24, height: 16, roundLimit: 100, expansionVersion: 1,
  eraProgression: 'simple-v1', gameplayVersion, multiplayer: true, players: [
    { id: 0, controller: 'human', starterId: 'bulbasaur', leaderId }, { id: 1, controller: 'human', starterId: 'squirtle', leaderId: 'oak' }] });

function driver(gameplayVersion: 10 | 11, leaderId?: LeaderId) {
  let state = createGame(setup(gameplayVersion, leaderId), EXPANSION_CONTENT);
  const commands: Command[] = [];
  const issue = (action: Command['action']) => {
    const command = { actorId: state.activePlayerId, expectedSeq: state.commandSeq, action };
    const result = step(state, command, EXPANSION_CONTENT);
    if (result.ok) { state = result.state; commands.push(command); }
    return result;
  };
  const endRound = () => { const round = state.round; do issue({ type: 'EndTurn' }); while (state.round === round); };
  const adopt = (charterId: 'gymCode' | 'tradeGuild') => {
    expect(issue({ type: 'SetCharter', charterId }).ok).toBe(true);
    for (let guard = 0; guard < 80 && !state.expansion!.policies![0].adopted.includes(charterId); guard++) endRound();
    expect(state.expansion!.policies![0].adopted).toContain(charterId);
  };
  return { get state(): GameState { return state; }, set state(next: GameState) { state = next; }, issue, endRound, adopt, commands };
}

test('v10 ledgers have no government fields; v11 starts with none chosen and a free first choice', () => {
  expect(Object.keys(createGame(setup(10), EXPANSION_CONTENT).expansion!.policies![0])).not.toContain('government');
  const ledger = createGame(setup(11), EXPANSION_CONTENT).expansion!.policies![0];
  expect(ledger).toMatchObject({ government: null, governmentFreeSwap: true });
  const v10 = driver(10);
  expect(v10.issue({ type: 'SetGovernment', governmentId: 'gymLeague' })).toMatchObject({ ok: false });
});

test('governments unlock from charters, add slots and effects, and cost gold to change outside free windows', () => {
  const game = driver(11);
  expect(game.issue({ type: 'SetGovernment', governmentId: 'gymLeague' })).toMatchObject({ ok: false });
  game.adopt('gymCode');
  const view = observe(game.state, 0, EXPANSION_CONTENT);
  expect(view.expansion!.policies!.availableGovernments).toEqual(['gymLeague', 'researchSociety', 'ranchCommons']);
  expect(view.expansion!.policies!.governmentSwapCost).toBe(0);
  const gold = game.state.players[0].gold;
  expect(game.issue({ type: 'SetGovernment', governmentId: 'researchSociety' }).ok).toBe(true);
  expect(game.state.players[0].gold).toBe(gold);
  expect(slotCounts(game.state.expansion!.policies![0].adopted, 'researchSociety')).toEqual({ military: 1, economic: 2, wild: 0 });
  expect(playerPolicyEffects(game.state, 0).cityResearch).toBe(1);
  // Not free any more: a second change costs gold, refused without it.
  game.state.players[0].gold = GOVERNMENT_SWAP_GOLD - 1;
  expect(game.issue({ type: 'SetGovernment', governmentId: 'ranchCommons' })).toMatchObject({ ok: false });
  game.state.players[0].gold = GOVERNMENT_SWAP_GOLD + 5;
  expect(game.issue({ type: 'SetGovernment', governmentId: 'ranchCommons' }).ok).toBe(true);
  expect(game.state.players[0].gold).toBe(5);
  expect(game.issue({ type: 'SetGovernment', governmentId: 'ranchCommons' })).toMatchObject({ ok: false });
  // A charter that unlocks a new government grants another free change.
  game.adopt('tradeGuild');
  expect(game.state.expansion!.policies![0].governmentFreeSwap).toBe(true);
  expect(game.issue({ type: 'SetGovernment', governmentId: 'merchantAssembly' }).ok).toBe(true);
  expect(game.state.players[0].gold).toBeGreaterThanOrEqual(0);
}, 60_000);

test('changing government drops cards that no longer fit and makes the next card change free', () => {
  const game = driver(11);
  game.adopt('gymCode');
  expect(game.issue({ type: 'SetGovernment', governmentId: 'gymLeague' }).ok).toBe(true);
  expect(game.issue({ type: 'SetPolicies', policyIds: ['gymChallenge', 'harvestFestival'] }).ok).toBe(true);
  game.state.players[0].gold = 500;
  // gymLeague gave the second military slot only for one military card; researchSociety still fits 1+1.
  expect(game.issue({ type: 'SetGovernment', governmentId: 'researchSociety' }).ok).toBe(true);
  const ledger = game.state.expansion!.policies![0];
  expect(ledger.slotted).toEqual(['gymChallenge', 'harvestFestival']);
  expect(ledger.freeSwap).toBe(true);
  expect(game.issue({ type: 'SetPolicies', policyIds: ['gymChallenge', 'harvestFestival', 'researchGrant'] }).ok).toBe(true);
  expect(game.issue({ type: 'SetGovernment', governmentId: 'gymLeague' }).ok).toBe(true);
  // Two economic cards no longer fit one economic slot: the highest ID is dropped.
  expect(game.state.expansion!.policies![0].slotted).toEqual(['gymChallenge', 'harvestFestival']);
}, 60_000);

test('the leader’s preferred government gets +50% on each effect', () => {
  const oak = driver(11, 'oak'), brock = driver(11, 'brock');
  for (const game of [oak, brock]) { game.adopt('gymCode'); expect(game.issue({ type: 'SetGovernment', governmentId: 'researchSociety' }).ok).toBe(true); }
  expect(playerPolicyEffects(oak.state, 0).cityResearch).toBe(2);
  expect(playerPolicyEffects(brock.state, 0).cityResearch).toBe(1);
}, 60_000);

test('v11 saves and command logs replay exactly', () => {
  const game = driver(11);
  game.adopt('gymCode');
  expect(game.issue({ type: 'SetGovernment', governmentId: 'ranchCommons' }).ok).toBe(true);
  game.endRound();
  const state = game.state, log: CommandLog = { version: 1, ...gameVersions(state.setup), contentVersion: state.contentVersion, setup: state.setup, commands: game.commands };
  expect(state.schemaVersion).toBe(6);
  expect(state.rulesVersion).toBe('governments-v11');
  expect(canonicalSerialize(replay(log))).toBe(canonicalSerialize(state));
  expect(canonicalSerialize(deserializeSave(serializeSave(state, log)).state)).toBe(canonicalSerialize(state));
  expect(() => replay({ ...log, schemaVersion: 5 })).toThrow();
}, 60_000);
