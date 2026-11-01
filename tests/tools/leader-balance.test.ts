import { expect, test } from 'vitest';
import { LEADER_IDS } from '../../src/content/leaders.ts';
import { createGame } from '../../src/core/game.ts';
import type { Command, GameEvent } from '../../src/core/model.ts';
import { collectTelemetry, createTelemetry } from '../../tools/telemetry.ts';
import {
  aggregateLeaderGames,
  leaderBalanceCases,
  parseLeaderBalanceArgs,
  evaluateLeaderBalanceAcceptance,
  renderLeaderBalanceMarkdown,
  simulateLeaderCase,
} from '../../tools/leader-balance.ts';

const config = { seeds: 1, roundLimit: 100 as const, width: 24, height: 16 };

test('leader schedule rotates every leader through every seat for every personality', () => {
  const cases = leaderBalanceCases(config);
  expect(cases).toHaveLength(12);
  for (const seed of [1]) {
    for (const personality of ['expansion', 'aggressive', 'conservative'] as const) {
      const group = cases.filter(item => item.seed === seed && item.personality === personality);
      expect(group).toHaveLength(4);
      for (const seat of [0, 1, 2, 3]) {
        expect(new Set(group.map(item => item.leaderBySeat[seat]))).toEqual(new Set(LEADER_IDS));
      }
      for (const leaderId of LEADER_IDS) {
        expect(new Set(group.map(item => Number(Object.entries(item.leaderBySeat).find(([, id]) => id === leaderId)![0])))).toEqual(new Set([0, 1, 2, 3]));
      }
    }
  }
});

test('seed scheduling and expansion setup are explicit and backward compatible', () => {
  const legacy = leaderBalanceCases({ seeds: 2, roundLimit: 100, width: 24, height: 16 });
  expect([...new Set(legacy.map(item => item.seed))]).toEqual([1, 2]);
  expect(legacy.every(item => item.setup.expansionVersion === undefined)).toBe(true);

  const expanded = leaderBalanceCases({ seeds: 2, seedStart: 11, expansionVersion: 1, roundLimit: 100, width: 24, height: 16 });
  expect([...new Set(expanded.map(item => item.seed))]).toEqual([11, 12]);
  expect(expanded).toHaveLength(24);
  expect(expanded.every(item => item.setup.expansionVersion === 1)).toBe(true);
  expect(createGame(expanded[0].setup).contentVersion).toBe('expansion-v1');
});

test('leader fields do not consume generation RNG or move starting positions', () => {
  const cases = leaderBalanceCases(config).filter(item => item.personality === 'expansion');
  const states = cases.map(item => createGame(item.setup));
  for (const state of states.slice(1)) {
    expect(state.rng).toEqual(states[0].rng);
    expect(Object.values(state.cities).map(city => city.position).sort((a, b) => a.q - b.q || a.r - b.r))
      .toEqual(Object.values(states[0].cities).map(city => city.position).sort((a, b) => a.q - b.q || a.r - b.r));
    expect(Object.values(state.players).map(player => player.starterId)).toEqual(Object.values(states[0].players).map(player => player.starterId));
  }
});

test('arguments are bounded and default to a manageable legacy batch', () => {
  expect(parseLeaderBalanceArgs([]).config).toEqual({ seeds: 2, seedStart: 1, roundLimit: 100, width: 24, height: 16 });
  expect(parseLeaderBalanceArgs(['--seeds', '1', '--round-limit', '200', '--out', '/tmp/leaders.json'])).toEqual({
    config: { seeds: 1, seedStart: 1, roundLimit: 200, width: 24, height: 16 }, output: '/tmp/leaders.json',
  });
  expect(parseLeaderBalanceArgs(['--seeds', '2', '--seed-start', '11', '--expansion', 'true', '--round-limit', '100']).config).toEqual({
    seeds: 2, seedStart: 11, expansionVersion: 1, roundLimit: 100, width: 24, height: 16,
  });
  for (const args of [
    ['--seeds', '0'], ['--seed-start', '0'], ['--expansion', 'yes'], ['--round-limit', '150'], ['--unknown', '1'], ['--seeds'],
  ]) expect(() => parseLeaderBalanceArgs(args)).toThrow(/Usage|Expected --seeds/);
});

test('telemetry counts real leader events and valid expansion commands', () => {
  const setup = leaderBalanceCases({ seeds: 1, expansionVersion: 1, roundLimit: 100, width: 24, height: 16 })[0].setup;
  const state = createGame(setup);
  const telemetry = createTelemetry(state);
  const leaderId = state.players[0].leaderId!;
  const ability: Command = { actorId: 0, expectedSeq: 0, action: { type: 'UseLeaderAbility' } };
  const abilityEvents: GameEvent[] = [
    { seq: 1, index: 0, payload: { type: 'LeaderAbilityUsed', playerId: 0, leaderId } },
    { seq: 1, index: 1, payload: { type: 'LeaderUnitRecruited', playerId: 0, leaderId, cityId: 0, unitId: 10 } },
    { seq: 1, index: 2, payload: { type: 'LeaderBuildingBuilt', playerId: 0, leaderId, cityId: 0 } },
  ];
  collectTelemetry(telemetry, state, state, ability, abilityEvents);
  expect(telemetry.activity[0]).toMatchObject({ activeAbilities: 1, recruitedLeaderUnits: 1, leaderBuildings: 1, expansionActions: 1 });

  const offering: Command = { actorId: 0, expectedSeq: 1, action: { type: 'MakeOffering', cityId: 0, resource: 'food' } };
  collectTelemetry(telemetry, state, state, offering, []);
  expect(telemetry.activity[0].expansionActions).toBe(2);
});

test('one deterministic full game produces leader scores and honest report warnings', () => {
  const first = simulateLeaderCase(leaderBalanceCases(config)[0]);
  const second = simulateLeaderCase(leaderBalanceCases(config)[0]);
  expect(first).toEqual(second);
  expect(first.status).toBe('completed');
  expect(first.round).toBe(100);
  expect(first.rejections.total).toBe(0);
  expect(Object.values(first.scoreByLeader).map(score => score.total)).toHaveLength(4);
  const aggregate = aggregateLeaderGames([first]);
  expect(aggregate.attemptedGames).toBe(1);
  expect(Object.keys(aggregate.outcomeKinds)).toEqual(['conquest', 'score', 'playerDefeat', 'pokedex', 'origin', 'championship']);
  const acceptance = evaluateLeaderBalanceAcceptance(aggregate, 1);
  expect(acceptance.status).toBe('fail');
  expect(acceptance.checks.map(item => item.id)).toContain('win-share-spread');
  expect(aggregate.leaders.reduce((sum, leader) => sum + leader.winShare.numerator, 0)).toBeCloseTo(1);
  const markdown = renderLeaderBalanceMarkdown({
    schemaVersion: 1,
    metadata: { command: ['node', 'tools/leader-balance.ts'], nodeVersion: 'test', gitHead: 'test', config, seedStart: 1, seedValues: [1], expansion: false, gamesPlanned: 1, scheduleSha256: 'test', toolSha256: 'test', contentVersion: 'test', contentSha256: 'test', deterministic: true },
    aggregate, warnings: ['样本仅诊断使用。'], games: [first],
  });
  expect(markdown).toContain('预注册验收');
  expect(markdown).toContain('验收结论：**未通过**');
  expect(markdown).toContain('这不是平衡通过结论');
  expect(markdown).toContain('样本仅诊断使用');
}, 30_000);
