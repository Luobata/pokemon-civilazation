import type { KnockdownRecord } from '../src/core/model.ts';
import type { MatchResult } from './simulate.ts';
import { PERSONALITIES } from './matches.ts';
import { mean, ratio, threshold, winCredit } from './statistics.ts';

export function eligibleKnockdown(record: KnockdownRecord): boolean {
  return record.source.ownerId !== null && record.source.kind === 'pokemon' && record.target.kind === 'pokemon';
}
export function withoutTypeAdvantage(record: KnockdownRecord): boolean {
  return eligibleKnockdown(record) && record.effectiveness <= 100;
}
export function compactResult(result: MatchResult) {
  const { rounds, ...telemetry } = result.telemetry;
  return { id: result.id, seed: result.seed, mode: result.mode, leg: result.leg, personalities: result.personalities,
    winners: result.winners, kind: result.kind, round: result.round, aborted: result.aborted, defect: result.defect, legacyAborted: result.legacyAborted, invalid: result.invalid,
    exception: result.exception, commandLimitReached: result.commandLimitReached, commandCount: result.commandCount,
    starters: result.starters, outcome: result.outcome, telemetry, completedRounds: rounds.length };
}
export type GameMetrics = ReturnType<typeof compactResult>;
export function eligibleSnowball(game: Pick<GameMetrics, 'aborted' | 'defect' | 'telemetry'>): boolean {
  return !game.aborted && !game.defect && game.telemetry.reachedRound30End && game.telemetry.round30Leader !== null;
}
export function summarizeGames(games: GameMetrics[]) {
  const valid = games.filter(game => !game.aborted && !game.defect && game.kind !== null);
  const gameRatio = (sample: GameMetrics[], numerator: (game: GameMetrics) => number) => ratio(sample.map(game => ({ seed: game.seed, successes: numerator(game), trials: 1 })));
  const conquest = gameRatio(valid, game => Number(game.kind === 'conquest'));
  const duration = mean(valid.map(game => ({ seed: game.seed, value: game.round })));
  const aborted = gameRatio(games, game => Number(game.aborted));
  const captures = mean(valid.map(game => ({ seed: game.seed, value: Object.values(game.telemetry.activity).reduce((sum, seat) => sum + seat.captureAttempts, 0) })));
  const neutral = ratio(valid.map(game => ({ seed: game.seed, successes: game.telemetry.knockdowns.filter(withoutTypeAdvantage).length,
    trials: game.telemetry.knockdowns.filter(eligibleKnockdown).length })));
  const snowballGames = valid.filter(eligibleSnowball);
  const snowball = gameRatio(snowballGames, game => winCredit(game.winners, game.telemetry.round30Leader!));
  const duels = valid.filter(game => game.mode === '1v1');
  const firstSeat = gameRatio(duels, game => winCredit(game.winners, 0));
  const pairs = [...new Set(duels.map(game => [...game.personalities].sort().join('/')))];
  // Include configured pairs even when every game in one pair was invalid.
  for (const game of games.filter(game => game.mode === '1v1')) {
    const pair = [...game.personalities].sort().join('/'); if (!pairs.includes(pair)) pairs.push(pair);
  }
  const pairwise = pairs.sort().map(pair => ({ pair, results: pair.split('/').map(personality => {
    const sample = duels.filter(game => [...game.personalities].sort().join('/') === pair);
    const stat = gameRatio(sample, game => winCredit(game.winners, game.personalities.indexOf(personality as typeof PERSONALITIES[number])));
    return { personality, ...stat, target: threshold(stat.pointEstimate, 0.4, 0.6, true) };
  }) }));
  const fourPlayerWinners = PERSONALITIES.map(personality => ({ personality, ...gameRatio(valid.filter(game => game.mode === '1v3'), game =>
    game.personalities.reduce((sum, seat, id) => sum + (seat === personality ? winCredit(game.winners, id) : 0), 0)) }));
  return {
    attempted: games.length, valid: valid.length, independentSeeds: new Set(games.map(game => game.seed)).size,
    earlyEndingBeforeRound30Count: valid.filter(game => game.round < 30).length,
    snowballExclusions: { aborted: games.filter(game => game.aborted).length, defect: games.filter(game => game.defect).length, noRound30End: valid.filter(game => !game.telemetry.reachedRound30End).length,
      tiedRound30Lead: valid.filter(game => game.telemetry.reachedRound30End && game.telemetry.round30Leader === null).length },
    conquest: { ...conquest, target: threshold(conquest.pointEstimate, 0.4, null, true) },
    meanEndRound: { ...duration, target: threshold(duration.value, 70, 95, false) },
    firstSeat: { ...firstSeat, target: threshold(firstSeat.pointEstimate, null, 0.55, true) }, pairwise, fourPlayerWinners,
    withoutTypeAdvantage: { ...neutral, target: threshold(neutral.pointEstimate, 0.25, null, true, true) },
    snowball: { ...snowball, target: threshold(snowball.pointEstimate, null, 0.75, true) },
    captureAttemptsPerGame: { ...captures, target: threshold(captures.value, 3, 10, false) },
    aborted: { ...aborted, target: threshold(aborted.pointEstimate, null, 0.05, true) },
    invalidCommandCount: games.reduce((sum, game) => sum + game.invalid.length, 0),
    fogRejectionCount: games.reduce((sum, game) => sum + game.invalid.filter(item => item.category === 'fog').length, 0),
    defectRejectionCount: games.reduce((sum, game) => sum + game.invalid.filter(item => item.category === 'defect').length, 0),
    defectGameCount: games.filter(game => game.defect).length,
    exceptionCount: games.filter(game => game.exception !== null).length, commandLimitCount: games.filter(game => game.commandLimitReached).length,
  };
}
