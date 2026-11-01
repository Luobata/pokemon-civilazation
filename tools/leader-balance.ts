import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONTENT } from '../src/content/units.ts';
import { LEADER_IDS } from '../src/content/leaders.ts';
import type { LeaderId } from '../src/content/leaders.ts';
import { AI_THRESHOLDS } from '../src/ai/thresholds.ts';
import { RULE_QUERIES } from '../src/ai/query.ts';
import { rememberCityRejection } from '../src/ai/memory.ts';
import type { RejectedCitySite } from '../src/ai/memory.ts';
import { planNext } from '../src/ai/plan.ts';
import { createGame } from '../src/core/game.ts';
import { observe } from '../src/core/vision.ts';
import { step } from '../src/core/step.ts';
import { hexDistance, hexToIndex } from '../src/core/hex.ts';
import { compareScores, scorePlayer } from '../src/core/victory.ts';
import { canonicalSerialize } from '../src/core/snapshot.ts';
import type { AiPersonality, Command, GameSetup, GameState, Score } from '../src/core/model.ts';
import { classifyRejection } from './rejections.ts';
import { collectTelemetry, createTelemetry } from './telemetry.ts';
import { mean, ratio, wilson95 } from './statistics.ts';

export type RoundLimit = 100 | 200 | 300;
export const PERSONALITIES: AiPersonality[] = ['expansion', 'aggressive', 'conservative'];
export type LeaderBalanceConfig = {
  seeds: number;
  roundLimit: RoundLimit;
  width: number;
  height: number;
};
export type LeaderBalanceCase = {
  id: string;
  seed: number;
  personality: AiPersonality;
  rotation: number;
  leaderBySeat: Record<number, LeaderId>;
  setup: GameSetup;
};
export type StartingPosition = {
  seat: number;
  leaderId: LeaderId;
  starterId: string;
  hqBiome: string;
  nearestRivalDistance: number;
  baseFood: number;
  baseProduction: number;
  baseGold: number;
  baseResearch: number;
};
export type RejectionSummary = {
  total: number;
  fog: number;
  defect: number;
  byReason: Record<string, number>;
  examples: { round: number; seq: number; actorId: number; actionType: Command['action']['type']; reason: string; category: 'fog' | 'defect' }[];
};
export type LeaderGameResult = {
  id: string;
  seed: number;
  personality: AiPersonality;
  rotation: number;
  leaderBySeat: Record<number, LeaderId>;
  status: 'completed' | 'defect' | 'aborted';
  outcomeKind: 'conquest' | 'score' | 'playerDefeat' | null;
  winners: number[];
  eliminatedSeats: number[];
  round: number;
  commandCount: number;
  ranking: Score[];
  scoreByLeader: Record<LeaderId, Score & { seat: number; rank: number; winCredit: number }>;
  startingBySeat: StartingPosition[];
  rejections: RejectionSummary;
  exception: string | null;
  activityByLeader: Record<LeaderId, { peakCities: number; attacks: number; captureAttempts: number; captureSuccesses: number }>;
};

export function leaderBalanceCases(config: LeaderBalanceConfig): LeaderBalanceCase[] {
  const cases: LeaderBalanceCase[] = [];
  for (let seed = 1; seed <= config.seeds; seed++) {
    for (const personality of PERSONALITIES) {
      for (let rotation = 0; rotation < LEADER_IDS.length; rotation++) {
        const leaderBySeat = Object.fromEntries(LEADER_IDS.map((leaderId, seat) => [seat, LEADER_IDS[(seat + rotation) % LEADER_IDS.length]])) as Record<number, LeaderId>;
        cases.push({
          id: `leaders-s${seed}-${personality}-r${rotation}`,
          seed,
          personality,
          rotation,
          leaderBySeat,
          setup: {
            seed,
            width: config.width,
            height: config.height,
            roundLimit: config.roundLimit,
            players: LEADER_IDS.map((_, seat) => ({ id: seat, controller: 'ai' as const, personality, leaderId: leaderBySeat[seat] })),
          },
        });
      }
    }
  }
  return cases;
}

function emptyRejections(): RejectionSummary {
  return { total: 0, fog: 0, defect: 0, byReason: {}, examples: [] };
}

function addRejection(summary: RejectionSummary, item: { round: number; seq: number; actorId: number; actionType: Command['action']['type']; reason: string; category: 'fog' | 'defect' }): void {
  summary.total++;
  summary[item.category]++;
  summary.byReason[item.reason] = (summary.byReason[item.reason] ?? 0) + 1;
  if (summary.examples.length < 20) summary.examples.push(item);
}

function startingPositions(state: GameState): StartingPosition[] {
  return Object.values(state.players).map(player => {
    const city = state.cities[player.headquartersCityId];
    const tileIndex = hexToIndex(city.position, state.map)!;
    const base = { food: 2, production: 1, gold: 1, research: 0 };
    for (const workedTileId of city.workedTileIds) {
      const yieldToAdd = CONTENT.biomes[state.map.tiles[workedTileId]];
      base.food += yieldToAdd.food;
      base.production += yieldToAdd.production;
      base.gold += yieldToAdd.gold;
      base.research += yieldToAdd.research;
    }
    return {
      seat: player.id,
      leaderId: player.leaderId!,
      starterId: player.starterId,
      hqBiome: state.map.tiles[tileIndex],
      nearestRivalDistance: Math.min(...Object.values(state.players)
        .filter(other => other.id !== player.id)
        .map(other => hexDistance(city.position, state.cities[other.headquartersCityId].position))),
      baseFood: base.food,
      baseProduction: base.production,
      baseGold: base.gold,
      baseResearch: base.research,
    };
  });
}

function finalRanking(state: GameState): Score[] {
  return state.outcome?.ranking ?? Object.keys(state.players).map(Number)
    .map(id => scorePlayer(state, id)).sort((a, b) => compareScores(a, b) || a.playerId - b.playerId);
}

export function simulateLeaderCase(match: LeaderBalanceCase): LeaderGameResult {
  const content = CONTENT;
  let state: GameState;
  try {
    state = createGame(match.setup, content);
  } catch (error) {
    const emptyScores = Object.fromEntries(LEADER_IDS.map(leaderId => [leaderId, null])) as Record<LeaderId, never>;
    return {
      id: match.id, seed: match.seed, personality: match.personality, rotation: match.rotation, leaderBySeat: match.leaderBySeat,
      status: 'defect', outcomeKind: null, winners: [], eliminatedSeats: [], round: 0, commandCount: 0, ranking: [], scoreByLeader: emptyScores,
      startingBySeat: [], rejections: emptyRejections(), exception: String(error),
      activityByLeader: Object.fromEntries(LEADER_IDS.map(leaderId => [leaderId, { peakCities: 0, attacks: 0, captureAttempts: 0, captureSuccesses: 0 }])) as LeaderGameResult['activityByLeader'],
    };
  }
  const telemetry = createTelemetry(state, content), memory: RejectedCitySite[] = [], rejections = emptyRejections();
  const startingBySeat = startingPositions(state);
  let exception: string | null = null;
  try {
    while (!state.outcome && state.commandSeq < 100_000) {
      const view = observe(state, state.activePlayerId, content);
      const command = planNext(view, { ...RULE_QUERIES, content, ai: AI_THRESHOLDS }, memory);
      const result = step(state, command, content);
      if (result.ok) {
        collectTelemetry(telemetry, state, result.state, command, result.events, content);
        state = result.state;
        continue;
      }
      const category = classifyRejection(state, command, result.reason, content);
      addRejection(rejections, { round: state.round, seq: state.commandSeq, actorId: command.actorId, actionType: command.action.type, reason: result.reason, category });
      rememberCityRejection(memory, view, command, result.reason);
      const end: Command = { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } };
      const ended = step(state, end, content);
      if (!ended.ok) break;
      collectTelemetry(telemetry, state, ended.state, end, ended.events, content);
      state = ended.state;
    }
  } catch (error) {
    exception = String(error);
  }
  const ranking = finalRanking(state);
  const scoreByLeader = Object.fromEntries(LEADER_IDS.map((leaderId, seat) => {
    const score = ranking.find(item => item.playerId === seat)!;
    return [leaderId, { ...score, seat, rank: ranking.findIndex(item => item.playerId === seat) + 1, winCredit: state.outcome?.winners.includes(seat) ? 1 / state.outcome.winners.length : 0 }];
  })) as LeaderGameResult['scoreByLeader'];
  const commandLimitReached = !state.outcome && state.commandSeq >= 100_000;
  const hasDefect = exception !== null || (!state.outcome && state.commandSeq < 100_000) || rejections.defect > 0;
  return {
    id: match.id, seed: match.seed, personality: match.personality, rotation: match.rotation, leaderBySeat: match.leaderBySeat,
    status: commandLimitReached ? 'aborted' : hasDefect ? 'defect' : 'completed',
    outcomeKind: state.outcome?.kind ?? null, winners: state.outcome?.winners ?? [], eliminatedSeats: Object.values(state.players).filter(player => player.eliminated).map(player => player.id), round: state.round, commandCount: state.commandSeq,
    ranking, scoreByLeader, startingBySeat, rejections, exception,
    activityByLeader: Object.fromEntries(LEADER_IDS.map((leaderId, seat) => [leaderId, {
      peakCities: telemetry.activity[seat].peakCities, attacks: telemetry.activity[seat].attacks,
      captureAttempts: telemetry.activity[seat].captureAttempts, captureSuccesses: telemetry.activity[seat].captureSuccesses,
    }])) as LeaderGameResult['activityByLeader'],
  };
}

type NumericStartingKey = 'nearestRivalDistance' | 'baseFood' | 'baseProduction' | 'baseGold' | 'baseResearch';
type StartingAggregate = {
  observations: number;
  meanNearestRivalDistance: number | null;
  meanBaseFood: number | null;
  meanBaseProduction: number | null;
  meanBaseGold: number | null;
  meanBaseResearch: number | null;
  starters: Record<string, number>;
  hqBiomes: Record<string, number>;
};
type LeaderAggregate = {
  leaderId: LeaderId;
  observations: number;
  winShare: ReturnType<typeof ratio>;
  wilson95: [number, number] | null;
  meanScore: ReturnType<typeof mean>;
  meanRank: ReturnType<typeof mean>;
  meanCities: ReturnType<typeof mean>;
  meanPopulation: ReturnType<typeof mean>;
  meanTechs: ReturnType<typeof mean>;
  meanKnockdowns: ReturnType<typeof mean>;
  meanPeakCities: ReturnType<typeof mean>;
  eliminatedCount: number;
  splitWinCount: number;
  starting: StartingAggregate;
  byPersonality: Record<AiPersonality, { observations: number; winCredit: number; meanScore: number }>;
};

function aggregateStarting(samples: StartingPosition[]): StartingAggregate {
  const average = (key: NumericStartingKey) => samples.length ? samples.reduce((sum, sample) => sum + sample[key], 0) / samples.length : null;
  const starters: Record<string, number> = {}, hqBiomes: Record<string, number> = {};
  for (const sample of samples) {
    starters[sample.starterId] = (starters[sample.starterId] ?? 0) + 1;
    hqBiomes[sample.hqBiome] = (hqBiomes[sample.hqBiome] ?? 0) + 1;
  }
  return {
    observations: samples.length,
    meanNearestRivalDistance: average('nearestRivalDistance'), meanBaseFood: average('baseFood'),
    meanBaseProduction: average('baseProduction'), meanBaseGold: average('baseGold'), meanBaseResearch: average('baseResearch'),
    starters, hqBiomes,
  };
}

function emptyPersonalityRecord(): Record<AiPersonality, { observations: number; winCredit: number; meanScore: number }> {
  return Object.fromEntries(PERSONALITIES.map(personality => [personality, { observations: 0, winCredit: 0, meanScore: 0 }])) as Record<AiPersonality, { observations: number; winCredit: number; meanScore: number }>;
}

export function aggregateLeaderGames(games: LeaderGameResult[]) {
  const valid = games.filter(game => game.status === 'completed');
  const leaders: LeaderAggregate[] = LEADER_IDS.map(leaderId => {
    const observations = valid.flatMap(game => game.scoreByLeader[leaderId] ? [{ game, score: game.scoreByLeader[leaderId] }] : []);
    const winSamples = observations.map(({ game, score }) => ({ seed: game.seed, successes: score.winCredit, trials: 1 }));
    const winShare = ratio(winSamples);
    const scoreSamples = observations.map(({ game, score }) => ({ seed: game.seed, value: score.total }));
    const byPersonality = emptyPersonalityRecord();
    for (const personality of PERSONALITIES) {
      const rows = observations.filter(({ game }) => game.personality === personality);
      byPersonality[personality] = { observations: rows.length, winCredit: rows.reduce((sum, { score }) => sum + score.winCredit, 0), meanScore: rows.length ? rows.reduce((sum, { score }) => sum + score.total, 0) / rows.length : 0 };
    }
    return {
      leaderId, observations: observations.length, winShare, wilson95: wilson95(winShare.numerator, winShare.n),
      meanScore: mean(scoreSamples),
      meanRank: mean(observations.map(({ game, score }) => ({ seed: game.seed, value: score.rank }))),
      meanCities: mean(observations.map(({ game, score }) => ({ seed: game.seed, value: score.cities }))),
      meanPopulation: mean(observations.map(({ game, score }) => ({ seed: game.seed, value: score.population }))),
      meanTechs: mean(observations.map(({ game, score }) => ({ seed: game.seed, value: score.techs }))),
      meanKnockdowns: mean(observations.map(({ game, score }) => ({ seed: game.seed, value: score.knockdowns }))),
      meanPeakCities: mean(observations.map(({ game }) => ({ seed: game.seed, value: game.activityByLeader[leaderId].peakCities }))),
      eliminatedCount: observations.filter(({ game }) => game.eliminatedSeats.includes(game.scoreByLeader[leaderId].seat)).length,
      splitWinCount: observations.filter(({ game, score }) => game.winners.length > 1 && game.winners.includes(score.seat)).length,
      starting: aggregateStarting(valid.flatMap(game => game.startingBySeat.filter(start => start.leaderId === leaderId))),
      byPersonality,
    };
  });
  const seats = [0, 1, 2, 3].map(seat => ({ seat, ...aggregateStarting(valid.flatMap(game => game.startingBySeat.filter(start => start.seat === seat))) }));
  const byReason = games.reduce((all, game) => {
    for (const [reason, count] of Object.entries(game.rejections.byReason)) all[reason] = (all[reason] ?? 0) + count;
    return all;
  }, {} as Record<string, number>);
  return {
    attemptedGames: games.length,
    completedGames: valid.length,
    defectGames: games.filter(game => game.status === 'defect').length,
    abortedGames: games.filter(game => game.status === 'aborted').length,
    exceptionGames: games.filter(game => game.exception !== null).length,
    splitWinGames: valid.filter(game => game.winners.length > 1).length,
    outcomeKinds: Object.fromEntries(['conquest', 'score', 'playerDefeat'].map(kind => [kind, valid.filter(game => game.outcomeKind === kind).length])),
    rejections: {
      total: games.reduce((sum, game) => sum + game.rejections.total, 0),
      fog: games.reduce((sum, game) => sum + game.rejections.fog, 0),
      defect: games.reduce((sum, game) => sum + game.rejections.defect, 0),
      byReason,
    },
    meanEndRound: mean(valid.map(game => ({ seed: game.seed, value: game.round }))),
    leaders, startingBySeat: seats,
  };
}

export type LeaderBalanceReport = {
  schemaVersion: 1;
  metadata: {
    command: string[];
    nodeVersion: string;
    gitHead: string | null;
    config: LeaderBalanceConfig;
    seedValues: number[];
    gamesPlanned: number;
    scheduleSha256: string;
    toolSha256: string;
    contentVersion: string;
    deterministic: true;
  };
  aggregate: ReturnType<typeof aggregateLeaderGames>;
  warnings: string[];
  games: LeaderGameResult[];
};

export function runLeaderBalance(config: LeaderBalanceConfig, context?: { command?: string[]; nodeVersion?: string; gitHead?: string | null }): LeaderBalanceReport {
  const matches = leaderBalanceCases(config);
  const games = matches.map(simulateLeaderCase);
  const scheduleSha256 = createHash('sha256').update(canonicalSerialize(matches)).digest('hex');
  const toolSha256 = createHash('sha256').update(readFileSync(new URL('./leader-balance.ts', import.meta.url))).digest('hex');
  return {
    schemaVersion: 1,
    metadata: {
      command: context?.command ?? ['node', 'tools/leader-balance.ts', '--seeds', String(config.seeds), '--round-limit', String(config.roundLimit)],
      nodeVersion: context?.nodeVersion ?? process.version,
      gitHead: context?.gitHead ?? null,
      config, seedValues: Array.from({ length: config.seeds }, (_, index) => index + 1), gamesPlanned: matches.length,
      scheduleSha256, toolSha256, contentVersion: CONTENT.version, deterministic: true,
    },
    aggregate: aggregateLeaderGames(games),
    warnings: [
      `样本仅 ${config.seeds} 个地图种子 × ${PERSONALITIES.length} 种性格 × ${LEADER_IDS.length} 个座位轮换，不能推断校准完成或长期平衡。`,
      '同一种子与性格的四局共享地形、初始位置和初始随机流；胜负观测不是互相独立的地图样本。',
      '本工具只诊断现有规则，不调整任何数值，也不覆盖不同人类操作、多人网络局或主动技能路线。',
    ],
    games,
  };
}

export function parseLeaderBalanceArgs(args: string[]): { config: LeaderBalanceConfig; output?: string } {
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!['--seeds', '--round-limit', '--out'].includes(key) || !args[index + 1] || args[index + 1].startsWith('--') || Object.hasOwn(flags, key)) {
      throw new Error('Usage: node tools/leader-balance.ts --seeds <1..100> --round-limit <100|200|300> [--out <file.json>]');
    }
    flags[key] = args[index + 1];
  }
  const seeds = Number(flags['--seeds'] ?? 2), roundLimit = Number(flags['--round-limit'] ?? 100);
  if (!Number.isSafeInteger(seeds) || seeds < 1 || seeds > 100 || ![100, 200, 300].includes(roundLimit)) {
    throw new Error('Expected --seeds 1..100 and --round-limit 100|200|300');
  }
  return { config: { seeds, roundLimit: roundLimit as RoundLimit, width: 24, height: 16 }, output: flags['--out'] };
}

function formatNumber(value: number | null, digits = 2): string {
  return value === null ? '—' : value.toFixed(digits);
}

export function renderLeaderBalanceMarkdown(report: LeaderBalanceReport): string {
  const a = report.aggregate;
  const rows = a.leaders.map(leader => `| ${leader.leaderId} | ${leader.observations} | ${formatNumber(leader.winShare.pointEstimate === null ? null : leader.winShare.pointEstimate * 100)}% (${formatNumber(leader.wilson95?.[0] === undefined ? null : leader.wilson95[0] * 100)}–${formatNumber(leader.wilson95?.[1] === undefined ? null : leader.wilson95[1] * 100)}%) | ${formatNumber(leader.meanScore.value)} | ${formatNumber(leader.meanRank.value)} | ${formatNumber(leader.meanCities.value)} | ${formatNumber(leader.meanPeakCities.value)} | ${leader.eliminatedCount} |`).join('\n');
  const personalityRows = a.leaders.flatMap(leader => PERSONALITIES.map(personality => {
    const item = leader.byPersonality[personality];
    return `| ${leader.leaderId} | ${personality} | ${item.observations} | ${formatNumber(item.observations ? item.winCredit / item.observations * 100 : null)}% | ${formatNumber(item.meanScore)} |`;
  })).join('\n');

const rankedLeaders = [...a.leaders].sort((x, y) => (y.winShare.pointEstimate ?? 0) - (x.winShare.pointEstimate ?? 0));
const top = rankedLeaders[0], bottom = rankedLeaders.at(-1)!;
  const startRows = a.startingBySeat.map(seat => `| ${seat.seat} | ${seat.observations} | ${formatNumber(seat.meanNearestRivalDistance)} | ${formatNumber(seat.meanBaseFood)} | ${formatNumber(seat.meanBaseProduction)} | ${formatNumber(seat.meanBaseGold)} | ${formatNumber(seat.meanBaseResearch)} | ${JSON.stringify(seat.starters)} |`).join('\n');
  return `# 领袖长期平衡诊断报告

## 结论边界

这不是平衡通过结论。本批共 ${a.attemptedGames} 局，完成 ${a.completedGames} 局；配置为 ${report.metadata.config.seeds} 个种子 × ${PERSONALITIES.length} 种 AI 性格 × ${LEADER_IDS.length} 个领袖座位轮换。同组共享地图，不能把每局当作独立地图样本，也不能据此声称数值已校准。

## 执行与可复现

- 命令：\`${report.metadata.command.join(' ')}\`
- Node：${report.metadata.nodeVersion}；Git HEAD：${report.metadata.gitHead ?? '未记录'}
- 地图：${report.metadata.config.width}×${report.metadata.config.height}，轮数上限 ${report.metadata.config.roundLimit}
- 编排 SHA-256：\`${report.metadata.scheduleSha256}\`
- 工具源码 SHA-256：\`${report.metadata.toolSha256}\`
- 内容版本：${report.metadata.contentVersion}

## 本批观察

本批描述性胜利份额最高为 ${top.leaderId}（${(top.winShare.pointEstimate! * 100).toFixed(2)}%），最低为 ${bottom.leaderId}（${(bottom.winShare.pointEstimate! * 100).toFixed(2)}%）。两者的 Wilson 区间存在重叠或接近，且只有 ${report.metadata.config.seeds} 个地图种子，因此这只能作为下一批扩样方向，不能推出强度结论。

## 领袖汇总

| 领袖 | 完成观测 | 胜利份额（描述性 95% Wilson 区间） | 平均终局分 | 平均排名 | 平均城市 | 峰值城市 | 被淘汰 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows}

## 性格分层

| 领袖 | 性格 | 观测 | 胜利份额 | 平均终局分 |
| --- | --- | ---: | ---: | ---: |
${personalityRows}

## 运行健康

- 完成/缺陷/中止：${a.completedGames} / ${a.defectGames} / ${a.abortedGames}
- 平分胜利局数：${a.splitWinGames}
- 结局分布：征服 ${a.outcomeKinds.conquest}，计分 ${a.outcomeKinds.score}，人类失败 ${a.outcomeKinds.playerDefeat}
- 拒绝命令：${a.rejections.total}（迷雾 ${a.rejections.fog}，缺陷 ${a.rejections.defect}）
- 异常局数：${a.exceptionGames}
- 平均结束轮：${formatNumber(a.meanEndRound.value)}

## 开局公平性诊断

| 座位 | 观测 | 最近对手 | 初始食物 | 初始生产 | 初始金币 | 初始科研 | 御三家分布 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
${startRows}

初始产出只统计总部基础产出与开局自动工作地块，刻意不包含御三家与领袖加成。座位轮换让每位领袖覆盖全部座位，但上表仍用于暴露少数种子中的起点差异。

## 警告

${report.warnings.map(warning => `- ${warning}`).join('\n')}
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { config, output } = parseLeaderBalanceArgs(process.argv.slice(2));
  const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const report = runLeaderBalance(config, { command: ['node', 'tools/leader-balance.ts', ...process.argv.slice(2)], nodeVersion: process.version, gitHead });
  const json = JSON.stringify(report, null, 2);
  if (output) {
    const destination = resolve(output);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, json);
  }
  console.log(json);
  if (report.aggregate.defectGames || report.aggregate.abortedGames || report.aggregate.exceptionGames) process.exitCode = 1;
}
