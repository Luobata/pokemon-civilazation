import { describe, expect, test } from 'vitest';
import { CIVILIZATION_CONTENT } from '../../src/content/civilization-systems.ts';
import { createGame } from '../../src/core/game.ts';
import { applyCivilizationAction, observeCivilization, planCivilizationAction, validateCivilizationAction } from '../../src/core/civilization-systems.ts';
import type { GameSetup, GameState } from '../../src/core/model.ts';

const setup: GameSetup = {
  seed: 4321, width: 24, height: 16, expansionVersion: 1, multiplayer: true,
  players: [
    { id: 0, controller: 'ai', personality: 'aggressive', leaderId: 'oak' },
    { id: 1, controller: 'ai', leaderId: 'lance' },
    { id: 2, controller: 'ai', leaderId: 'jenny' },
    { id: 3, controller: 'ai', leaderId: 'joy' },
  ],
};

function allianceFixture(): GameState {
  const state = createGame(setup);
  state.activePlayerId = 0;
  state.players[0].gold = 0;
  for (const city of Object.values(state.cities).filter(city => city.ownerId === 0)) city.food = 0;
  return state;
}

function view(state: GameState) {
  return observeCivilization(state, 0, new Set<number>());
}

function quietPlayer(state: GameState) {
  const player = state.expansion!.civilization.players[0]!;
  player.hallOfFame = CIVILIZATION_CONTENT.phantoms.definitions.map(definition => definition.id);
  return player;
}

describe('civilization planning policy', () => {
  test('without policy the planner keeps its legacy alliance choice', () => {
    const state = allianceFixture();
    quietPlayer(state);
    const planned = planCivilizationAction(view(state));
    expect(planned).toEqual({ type: 'ProposeAlliance', targetPlayerId: 1 });
  });

  test('a one-ally policy skips a second alliance but still trades', () => {
    const state = allianceFixture();
    quietPlayer(state);
    state.expansion!.civilization.relations['0:1']!.allianceSinceRound = 1;
    const observed = view(state);
    expect(planCivilizationAction(observed)).toEqual({ type: 'ProposeAlliance', targetPlayerId: 2 });
    expect(planCivilizationAction(observed, CIVILIZATION_CONTENT, { maximumAllies: 1, blockedAllianceTargetPlayerIds: [] }))
      .toEqual({ type: 'ProposeTrade', targetPlayerId: 1 });
  });

  test('a blocked strategic target is skipped for another eligible civilization', () => {
    const state = allianceFixture();
    quietPlayer(state);
    const observed = view(state);
    expect(planCivilizationAction(observed)).toEqual({ type: 'ProposeAlliance', targetPlayerId: 1 });
    const planned = planCivilizationAction(observed, CIVILIZATION_CONTENT, {
      maximumAllies: 1,
      blockedAllianceTargetPlayerIds: [1],
    });
    expect(planned).toEqual({ type: 'ProposeAlliance', targetPlayerId: 2 });
    expect(validateCivilizationAction(state, 0, planned!)).toBeNull();
  });

  test('incoming alliance proposals are rejected legally at the cap or when blocked', () => {
    for (const blocked of [false, true]) {
      const state = allianceFixture();
      quietPlayer(state);
      state.expansion!.civilization.relations['0:1']!.allianceSinceRound = 1;
      state.expansion!.civilization.relations['0:2']!.allianceProposal = { proposerId: 2, proposedRound: state.round };
      const planned = planCivilizationAction(view(state), CIVILIZATION_CONTENT, {
        maximumAllies: 1,
        blockedAllianceTargetPlayerIds: blocked ? [2] : [],
      });
      expect(planned).toEqual({ type: 'RespondAlliance', targetPlayerId: 2, accept: false });
      expect(validateCivilizationAction(state, 0, planned!)).toBeNull();
      const events = applyCivilizationAction(state, 0, planned!);
      expect(events).toMatchObject([{ type: 'AllianceChanged', status: 'dissolved' }]);
      expect(state.expansion!.civilization.relations['0:2']!.allianceProposal).toBeNull();
      expect(state.expansion!.civilization.relations['0:2']!.allianceSinceRound).toBeNull();
    }
  });

  test('the final two living civilizations may dissolve their alliance without betrayal penalties', () => {
    const lastTwo = { ...setup, players: setup.players.slice(0, 2) };
    const state = createGame(lastTwo);
    state.activePlayerId = 0;
    state.players[0].gold = 100;
    quietPlayer(state);
    const relation = state.expansion!.civilization.relations['0:1']!;
    relation.allianceSinceRound = 1;
    relation.tradeSinceRound = 1;
    const cooldownBefore = relation.betrayalCooldownUntilRound;
    const planned = planCivilizationAction(view(state), CIVILIZATION_CONTENT, {
      maximumAllies: 0,
      blockedAllianceTargetPlayerIds: [],
    });
    expect(planned).toEqual({ type: 'DissolveAlliance', targetPlayerId: 1 });
    expect(validateCivilizationAction(state, 0, planned!)).toBeNull();
    applyCivilizationAction(state, 0, planned!);
    expect(relation).toMatchObject({
      allianceSinceRound: null,
      tradeSinceRound: 1,
      trust: 0,
      betrayalCooldownUntilRound: cooldownBefore,
      betrayedBy: [],
    });
    expect(state.players[0].gold).toBe(100);
  });

  test('eliminated relations do not consume the alliance cap', () => {
    const state = allianceFixture();
    quietPlayer(state);
    state.players[1].eliminated = true;
    state.expansion!.civilization.relations['0:1']!.allianceSinceRound = 1;
    const planned = planCivilizationAction(view(state), CIVILIZATION_CONTENT, {
      maximumAllies: 1,
      blockedAllianceTargetPlayerIds: [],
    });
    expect(planned).toEqual({ type: 'ProposeAlliance', targetPlayerId: 2 });
    expect(validateCivilizationAction(state, 0, planned!)).toBeNull();
  });
});
