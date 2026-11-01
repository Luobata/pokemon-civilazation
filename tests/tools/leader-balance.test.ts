import { expect, test } from 'vitest';
import { LEADER_IDS } from '../../src/content/leaders.ts';
import { createGame } from '../../src/core/game.ts';
import {
  aggregateLeaderGames,
  leaderBalanceCases,
  parseLeaderBalanceArgs,
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

test('arguments are bounded and default to a manageable 24-game batch', () => {
  expect(parseLeaderBalanceArgs([]).config).toEqual({ seeds: 2, roundLimit: 100, width: 24, height: 16 });
  expect(parseLeaderBalanceArgs(['--seeds', '1', '--round-limit', '200', '--out', '/tmp/leaders.json'])).toEqual({
    config: { seeds: 1, roundLimit: 200, width: 24, height: 16 }, output: '/tmp/leaders.json',
  });
  for (const args of [['--seeds', '0'], ['--round-limit', '150'], ['--unknown', '1']]) expect(() => parseLeaderBalanceArgs(args)).toThrow(/Usage|Expected --seeds/);
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
  expect(aggregate.leaders.reduce((sum, leader) => sum + leader.winShare.numerator, 0)).toBeCloseTo(1);
  const markdown = renderLeaderBalanceMarkdown({
    schemaVersion: 1,
    metadata: { command: ['node', 'tools/leader-balance.ts'], nodeVersion: 'test', gitHead: 'test', config, seedValues: [1], gamesPlanned: 1, scheduleSha256: 'test', toolSha256: 'test', contentVersion: 'test', deterministic: true },
    aggregate, warnings: ['样本仅诊断使用。'], games: [first],
  });
  expect(markdown).toContain('这不是平衡通过结论');
  expect(markdown).toContain('样本仅诊断使用');
}, 30_000);
