/**
 * Balance metrics (docs/design/review-2026-11/4-balance.md §3.1, §5): per-game rows derived from a `balance-run` game record,
 * aggregate estimates with intervals, the §5 acceptance lines and the November targets. Pure functions only.
 */
import type { AiPersonality, GameOutcome } from '../src/core/model.ts';
import type { LeaderId } from '../src/content/leaders.ts';
import { LEADER_IDS } from '../src/content/leaders.ts';
import { COMBAT_ROLES } from './telemetry.ts';
import type { CombatRole } from './telemetry.ts';
import { wilson95 } from './statistics.ts';
import type { BalanceGameRecord, CurveSeat } from './balance-run.ts';

export type OutcomeKind = GameOutcome['kind'];
export const OUTCOME_KINDS: readonly OutcomeKind[] = ['conquest', 'score', 'pokedex', 'contest', 'faith', 'championship', 'origin', 'playerDefeat'];
export const SNOWBALL_ROUNDS = [30, 60, 100] as const;
export type SeatMetrics = {
  seat: number;
  leaderId: LeaderId;
  personality: AiPersonality;
  /** Win credit: 1 for a sole winner, 1/k for a k-way split, 0 otherwise. */
  credit: number;
  rank: number;
  score: number;
  cities: number;
  peakCities: number;
  eliminatedRound: number | null;
  /** First end of round at which the civ owned at least 2 / 3 / 4 cities (founded or captured); null = never. */
  secondCity: number | null;
  thirdCity: number | null;
  fourthCity: number | null;
  /** First end of round with at least one researched technology; null = never. */
  firstTech: number | null;
  /** Era index → first round in that era (index 0 = the starting era, round 1). */
  eras: Record<number, number>;
  firstWar: number | null;
  firstCityLost: number | null;
  peakRoles: Record<CombatRole, number>;
};
export type GameMetrics = {
  id: string;
  seed: number;
  group: string;
  rotation: number;
  roundLimit: number;
  status: 'completed' | 'defect' | 'aborted';
  exception: boolean;
  outcome: OutcomeKind | null;
  winners: number[];
  endRound: number;
  eliminated: number;
  /** Rounds of the first war declaration, first attack on a civilization's city, first civilization city captured. */
  firstWar: number | null;
  firstCityAttack: number | null;
  firstCityLost: number | null;
  /** Unique score leader (alive civs) at the end of rounds 30 / 60 / 100; null if tied or the game ended by then. */
  leaderAt: Record<string, number | null>;
  leaderChanges: number;
  /** Earliest round from which the sole winner led the score every remaining round; null if the winner did not lead at the end. */
  decidedRound: number | null;
  gini: number;
  seats: SeatMetrics[];
};

/** Only samples where the civ is still alive count (an eliminated civ's score, cities and techs are frozen). */
function firstRoundWhere(record: BalanceGameRecord, seatIndex: number, test: (sample: BalanceGameRecord['samples'][number]) => boolean): number | null {
  return record.samples.find(sample => sample.e[seatIndex] === 0 && test(sample))?.r ?? null;
}
export function uniqueLeader(sample: { s: number[]; e: number[] }): number | null {
  let best = -Infinity, leader: number | null = null;
  sample.s.forEach((score, seat) => {
    if (sample.e[seat]) return;
    if (score > best) { best = score; leader = seat; } else if (score === best) leader = null;
  });
  return leader;
}
export function gini(values: readonly number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (values.length === 0 || total <= 0) return 0;
  let differences = 0;
  for (const a of values) for (const b of values) differences += Math.abs(a - b);
  return differences / (2 * values.length * total);
}
/** One `metrics.jsonl` row, derived only from the record (case, `simulateLeaderCase` result, round samples). */
export function gameMetrics(record: BalanceGameRecord): GameMetrics {
  const { result, samples } = record, seats = Object.keys(record.case.leaderBySeat).map(Number).sort((a, b) => a - b);
  const civEvents = result.cityEvents.filter(event => event.defenderId >= 0 && event.attackerId >= 0);
  const minimum = (values: number[]) => values.length ? Math.min(...values) : null;
  const leaders = samples.map(uniqueLeader);
  let leaderChanges = 0, previous: number | null = null;
  for (const leader of leaders) {
    if (leader === null) continue;
    if (previous !== null && leader !== previous) leaderChanges++;
    previous = leader;
  }
  let decidedRound: number | null = null;
  if (result.winners.length === 1 && leaders.at(-1) === result.winners[0]) {
    let index = samples.length - 1;
    while (index > 0 && leaders[index - 1] === result.winners[0]) index--;
    decidedRound = samples[index].r;
  }
  const leaderAt = Object.fromEntries(SNOWBALL_ROUNDS.map(round => {
    const sample = samples.find(item => item.r === round);
    return [String(round), sample && !sample.final && result.round > round ? uniqueLeader(sample) : null];
  }));
  return {
    id: record.case.id, seed: record.case.seed, group: record.case.group, rotation: record.case.rotation, roundLimit: record.case.setup.roundLimit ?? 100,
    status: result.status, exception: result.exception !== null, outcome: result.outcomeKind, winners: result.winners, endRound: result.round,
    eliminated: result.eliminatedSeats.length,
    firstWar: minimum(result.warEpisodes.map(episode => episode.startRound)),
    firstCityAttack: minimum(civEvents.map(event => event.round)),
    firstCityLost: minimum(civEvents.filter(event => event.captured).map(event => event.round)),
    leaderAt, leaderChanges, decidedRound, gini: gini(result.ranking.map(score => score.total)),
    seats: seats.map((seat, index) => {
      const leaderId = record.case.leaderBySeat[seat], activity = result.activityByLeader[leaderId], score = result.scoreByLeader[leaderId];
      const progression = result.progressionBySeat.find(row => row.seat === seat);
      const cityRound = (count: number) => firstRoundWhere(record, index, sample => sample.c[index] >= count);
      return {
        seat, leaderId, personality: record.case.personalityBySeat[seat], credit: score?.winCredit ?? 0, rank: score?.rank ?? seats.length,
        score: score?.total ?? 0, cities: score?.cities ?? 0, peakCities: activity?.peakCities ?? 0,
        eliminatedRound: result.eliminations.find(item => item.playerId === seat)?.round ?? null,
        secondCity: cityRound(2), thirdCity: cityRound(3), fourthCity: cityRound(4),
        firstTech: firstRoundWhere(record, index, sample => sample.t[index] >= 1),
        eras: { ...(progression?.eraArrivalRounds ?? {}) },
        firstWar: minimum(result.warEpisodes.filter(episode => episode.a === seat || episode.b === seat).map(episode => episode.startRound)),
        firstCityLost: minimum(civEvents.filter(event => event.captured && event.defenderId === seat).map(event => event.round)),
        peakRoles: { ...(activity?.peakCombatUnitsByRole ?? Object.fromEntries(COMBAT_ROLES.map(role => [role, 0])) as Record<CombatRole, number>) },
      };
    }),
  };
}
export type CurveRow = Omit<CurveSeat, 'seat'> & { id: string; seed: number; group: string; round: number; seat: number; leaderId: LeaderId; personality: AiPersonality };
/** `curves.jsonl` rows: one per game × snapshot round (every 10) × seat. */
export function gameCurveRows(record: BalanceGameRecord): CurveRow[] {
  return record.curves.flatMap(point => point.seats.map(seat => ({ id: record.case.id, seed: record.case.seed, group: record.case.group, round: point.round,
    leaderId: record.case.leaderBySeat[seat.seat], personality: record.case.personalityBySeat[seat.seat], ...seat })));
}

// ---------------------------------------------------------------- statistics

/** Linear-interpolation quantile (type 7) of finite or infinite values; any +∞ at the upper neighbour gives +∞. */
export function quantile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b), h = (sorted.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
  if (!Number.isFinite(sorted[hi])) return Infinity;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}
export const median = (values: readonly number[]) => quantile(values, 0.5);
export const meanOf = (values: readonly number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
/** Never reached counts as +∞ (so the median says "half the civs got there by round X"). */
export const orNever = (value: number | null) => value ?? Infinity;
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const BOOTSTRAP_RESAMPLES = 2000;
const BOOTSTRAP_SEED = 20261109;
function bySeed(games: readonly GameMetrics[]): Map<number, GameMetrics[]> {
  const groups = new Map<number, GameMetrics[]>();
  for (const game of games) {
    if (!groups.has(game.seed)) groups.set(game.seed, []);
    groups.get(game.seed)!.push(game);
  }
  return groups;
}
function percentileInterval(draws: number[]): [number, number] | null {
  const finite = draws.filter(value => !Number.isNaN(value));
  if (finite.length < BOOTSTRAP_RESAMPLES / 2) return null;
  return [quantile(finite, 0.025)!, quantile(finite, 0.975)!];
}
/**
 * 95% percentile interval from a seed-cluster bootstrap: maps are shared by every game of a seed, so seeds (not games) are
 * resampled. With a second sample on the same seeds the resampled seeds are shared (paired); otherwise independent.
 */
export function bootstrapInterval(games: readonly GameMetrics[], statistic: (games: GameMetrics[]) => number | null,
  other?: readonly GameMetrics[]): [number, number] | null {
  const random = mulberry32(BOOTSTRAP_SEED), groups = bySeed(games), seeds = [...groups.keys()].sort((a, b) => a - b);
  const otherGroups = other ? bySeed(other) : null, otherSeeds = otherGroups ? [...otherGroups.keys()].sort((a, b) => a - b) : [];
  const paired = otherGroups !== null && seeds.length === otherSeeds.length && seeds.every((seed, index) => seed === otherSeeds[index]);
  if (seeds.length < 2 || (otherGroups && otherSeeds.length < 2)) return null;
  const draw = (keys: number[], source: Map<number, GameMetrics[]>, picks: number[]) => picks.flatMap(pick => source.get(keys[pick])!);
  const draws: number[] = [];
  for (let resample = 0; resample < BOOTSTRAP_RESAMPLES; resample++) {
    const picks = seeds.map(() => Math.floor(random() * seeds.length));
    const value = statistic(draw(seeds, groups, picks));
    if (!otherGroups) { draws.push(value ?? NaN); continue; }
    const otherPicks = paired ? picks : otherSeeds.map(() => Math.floor(random() * otherSeeds.length));
    const base = statistic(draw(otherSeeds, otherGroups, otherPicks));
    draws.push(value === null || base === null ? NaN : value - base);
  }
  return percentileInterval(draws);
}
/** Newcombe's hybrid score interval for p1 − p2 from the two Wilson intervals. */
export function newcombeInterval(s1: number, n1: number, s2: number, n2: number): [number, number] | null {
  const a = wilson95(s1, n1), b = wilson95(s2, n2);
  if (!a || !b) return null;
  const p1 = s1 / n1, p2 = s2 / n2, d = p1 - p2;
  return [d - Math.sqrt((p1 - a[0]) ** 2 + (b[1] - p2) ** 2), d + Math.sqrt((a[1] - p1) ** 2 + (p2 - b[0]) ** 2)];
}

// ---------------------------------------------------------------- measures

export type Measure = {
  id: string;
  label: string;
  unit: 'share' | 'round' | 'number';
  /** Shares: successes / n (Wilson interval). */
  share?: (games: GameMetrics[]) => { successes: number; n: number };
  /** Everything else: a statistic with a seed-cluster bootstrap interval. */
  value?: (games: GameMetrics[]) => number | null;
  note?: string;
};
export type Estimate = { id: string; value: number | null; interval: [number, number] | null; n: number; successes?: number; method: 'wilson' | 'bootstrap' };
const completed = (games: GameMetrics[]) => games.filter(game => game.status === 'completed');
const civs = (games: GameMetrics[]) => completed(games).flatMap(game => game.seats);
const shareOf = (games: GameMetrics[], test: (game: GameMetrics) => boolean) => ({ successes: completed(games).filter(test).length, n: completed(games).length });
function outcomeShares(games: GameMetrics[]): Map<OutcomeKind, number> {
  const valid = completed(games), shares = new Map<OutcomeKind, number>();
  for (const kind of OUTCOME_KINDS) shares.set(kind, valid.length ? valid.filter(game => game.outcome === kind).length / valid.length : 0);
  return shares;
}
export function roleShares(games: GameMetrics[]): Record<CombatRole, number> | null {
  const totals = Object.fromEntries(COMBAT_ROLES.map(role => [role, 0])) as Record<CombatRole, number>;
  for (const seat of civs(games)) for (const role of COMBAT_ROLES) totals[role] += seat.peakRoles[role] ?? 0;
  const sum = COMBAT_ROLES.reduce((total, role) => total + totals[role], 0);
  return sum ? Object.fromEntries(COMBAT_ROLES.map(role => [role, totals[role] / sum])) as Record<CombatRole, number> : null;
}
const leaderWon = (round: number) => (games: GameMetrics[]) => {
  const eligible = completed(games).filter(game => game.leaderAt[String(round)] !== null);
  return { successes: eligible.filter(game => game.winners.includes(game.leaderAt[String(round)]!)).length, n: eligible.length };
};
const civMedian = (pick: (seat: SeatMetrics) => number | null, filter: (seat: SeatMetrics) => boolean = () => true) =>
  (games: GameMetrics[]) => median(civs(games).filter(filter).map(seat => orNever(pick(seat))));
const reachedMedian = (pick: (seat: SeatMetrics) => number | null) =>
  (games: GameMetrics[]) => median(civs(games).map(pick).filter((value): value is number => value !== null));
const civNever = (pick: (seat: SeatMetrics) => number | null) => (games: GameMetrics[]) =>
  ({ successes: civs(games).filter(seat => pick(seat) === null).length, n: civs(games).length });
const gameMedian = (pick: (game: GameMetrics) => number | null) => (games: GameMetrics[]) => median(completed(games).map(game => orNever(pick(game))));
const eraArrival = (index: number) => (seat: SeatMetrics) => seat.eras[index] ?? null;

export const MEASURES: Measure[] = [
  { id: 'firstTechMedian', label: '第一项科技（每个文明，中位）', unit: 'round', value: civMedian(seat => seat.firstTech), note: '全部文明；从未研究出科技记为 ∞' },
  { id: 'secondCityMedian', label: '第二座城（每个文明，中位）', unit: 'round', value: civMedian(seat => seat.secondCity), note: '全部文明；从未达到记为 ∞' },
  { id: 'thirdCityMedian', label: '第三座城（每个文明，中位）', unit: 'round', value: civMedian(seat => seat.thirdCity), note: '全部文明；从未达到（含被消灭）记为 ∞' },
  { id: 'thirdCityReachedMedian', label: '第三座城（只算达到的文明，中位）', unit: 'round', value: reachedMedian(seat => seat.thirdCity), note: '旧口径，仅供对照' },
  { id: 'fourthCityMedian', label: '第四座城（每个文明，中位）', unit: 'round', value: civMedian(seat => seat.fourthCity) },
  { id: 'neverSecondCity', label: '从未有第二座城的文明', unit: 'share', share: civNever(seat => seat.secondCity) },
  { id: 'neverThirdCity', label: '从未有第三座城的文明', unit: 'share', share: civNever(seat => seat.thirdCity) },
  { id: 'era1Median', label: '第二世代到达（每个文明，中位）', unit: 'round', value: civMedian(eraArrival(1)) },
  { id: 'era2Median', label: '第三世代到达（每个文明，中位）', unit: 'round', value: civMedian(eraArrival(2)) },
  { id: 'era2Reached', label: '到达第三世代的文明', unit: 'share', share: games => ({ successes: civs(games).filter(seat => seat.eras[2] !== undefined).length, n: civs(games).length }) },
  { id: 'firstWarMedian', label: '首次宣战（每局，中位）', unit: 'round', value: gameMedian(game => game.firstWar) },
  { id: 'firstCityAttackMedian', label: '首次攻打文明城市（每局，中位）', unit: 'round', value: gameMedian(game => game.firstCityAttack) },
  { id: 'firstCityLostMedian', label: '首次有文明失城（每局，中位）', unit: 'round', value: gameMedian(game => game.firstCityLost) },
  { id: 'endP10', label: '结束轮 P10', unit: 'round', value: games => quantile(completed(games).map(game => game.endRound), 0.1) },
  { id: 'endMedian', label: '结束轮 中位', unit: 'round', value: games => median(completed(games).map(game => game.endRound)) },
  { id: 'endP90', label: '结束轮 P90', unit: 'round', value: games => quantile(completed(games).map(game => game.endRound), 0.9) },
  { id: 'endMean', label: '结束轮 平均', unit: 'round', value: games => meanOf(completed(games).map(game => game.endRound)) },
  { id: 'fullLength', label: '打满轮数（积分胜利）', unit: 'share', share: games => shareOf(games, game => game.outcome === 'score') },
  { id: 'endedBefore80', label: '第 80 轮前结束（结束轮 < 80）', unit: 'share', share: games => shareOf(games, game => game.endRound < 80) },
  { id: 'endedBy100', label: '第 100 轮内结束', unit: 'share', share: games => shareOf(games, game => game.endRound <= 100) },
  { id: 'conquest', label: '征服份额', unit: 'share', share: games => shareOf(games, game => game.outcome === 'conquest') },
  { id: 'maxVictoryShare', label: '最大单一胜利方式份额', unit: 'share', value: games => completed(games).length ? Math.max(...outcomeShares(games).values()) : null },
  { id: 'victoryKinds5', label: '份额 ≥ 5% 的胜利方式数', unit: 'number', value: games => completed(games).length ? [...outcomeShares(games).values()].filter(share => share >= 0.05).length : null },
  { id: 'leader30Won', label: '第 30 轮领先者最终获胜', unit: 'share', share: leaderWon(30) },
  { id: 'leader60Won', label: '第 60 轮领先者最终获胜', unit: 'share', share: leaderWon(60) },
  { id: 'leader100Won', label: '第 100 轮领先者最终获胜', unit: 'share', share: leaderWon(100) },
  { id: 'leaderChanges', label: '每局领先者更替（平均）', unit: 'number', value: games => meanOf(completed(games).map(game => game.leaderChanges)) },
  { id: 'decidedBy60', label: '第 60 轮已决出（胜者此后一直领先）', unit: 'share', share: games => shareOf(games, game => game.decidedRound !== null && game.decidedRound <= 60) },
  { id: 'decidedBy100', label: '第 100 轮已决出', unit: 'share', share: games => shareOf(games, game => game.decidedRound !== null && game.decidedRound <= 100) },
  { id: 'gini', label: '终局分数基尼系数（平均）', unit: 'number', value: games => meanOf(completed(games).map(game => game.gini)) },
  { id: 'eliminatedPerGame', label: '每局被消灭的文明（平均）', unit: 'number', value: games => meanOf(completed(games).map(game => game.eliminated)) },
  { id: 'peakCities', label: '每文明峰值城数（平均）', unit: 'number', value: games => meanOf(civs(games).map(seat => seat.peakCities)) },
  { id: 'peakCitiesExpansion', label: '扩张型文明峰值城数（平均）', unit: 'number', value: games => meanOf(civs(games).filter(seat => seat.personality === 'expansion').map(seat => seat.peakCities)) },
  { id: 'maxRoleShare', label: '兵种峰值最高单项占比', unit: 'share', value: games => { const shares = roleShares(games); return shares ? Math.max(...Object.values(shares)) : null; } },
  { id: 'navalShare', label: '水面单位峰值占比', unit: 'share', value: games => roleShares(games)?.naval ?? null },
];
const MEASURE_BY_ID = new Map(MEASURES.map(measure => [measure.id, measure]));
export function measure(id: string): Measure {
  const found = MEASURE_BY_ID.get(id);
  if (!found) throw new Error(`Unknown measure ${id}`);
  return found;
}
export function estimate(games: GameMetrics[], id: string): Estimate {
  const item = measure(id);
  if (item.share) {
    const { successes, n } = item.share(games);
    return { id, value: n ? successes / n : null, interval: wilson95(successes, n), n, successes, method: 'wilson' };
  }
  return { id, value: item.value!(games), interval: bootstrapInterval(games, item.value!), n: completed(games).length, method: 'bootstrap' };
}
export type Delta = { value: number | null; interval: [number, number] | null };
/** Candidate − reference with a 95% interval (Newcombe for shares, seed-cluster bootstrap otherwise; paired when the seeds match). */
export function delta(candidate: GameMetrics[], reference: GameMetrics[], id: string): Delta {
  const item = measure(id);
  if (item.share) {
    const a = item.share(candidate), b = item.share(reference);
    return { value: a.n && b.n ? a.successes / a.n - b.successes / b.n : null, interval: newcombeInterval(a.successes, a.n, b.successes, b.n) };
  }
  const a = item.value!(candidate), b = item.value!(reference);
  const value = a === null || b === null ? null : a - b;
  return { value: value === null || Number.isNaN(value) ? null : value, interval: bootstrapInterval(candidate, item.value!, reference) };
}

// ---------------------------------------------------------------- outcomes, leaders, personalities

export function outcomeTable(games: GameMetrics[]) {
  const valid = completed(games);
  return OUTCOME_KINDS.map(kind => {
    const count = valid.filter(game => game.outcome === kind).length;
    return { kind, count, n: valid.length, share: valid.length ? count / valid.length : null, interval: wilson95(count, valid.length) };
  }).filter(row => row.count > 0 || !['origin', 'playerDefeat'].includes(row.kind));
}
export type GroupRow = { key: string; appearances: number; credit: number; rate: number | null; interval: [number, number] | null; meanScore: number | null; meanRank: number | null;
  peakCities: number | null; thirdCity: number | null; firstTech: number | null; eliminated: number };
function groupRow(key: string, seats: SeatMetrics[]): GroupRow {
  const credit = seats.reduce((sum, seat) => sum + seat.credit, 0);
  return { key, appearances: seats.length, credit, rate: seats.length ? credit / seats.length : null, interval: wilson95(credit, seats.length),
    meanScore: meanOf(seats.map(seat => seat.score)), meanRank: meanOf(seats.map(seat => seat.rank)), peakCities: meanOf(seats.map(seat => seat.peakCities)),
    thirdCity: median(seats.map(seat => orNever(seat.thirdCity))), firstTech: median(seats.map(seat => orNever(seat.firstTech))),
    eliminated: seats.filter(seat => seat.eliminatedRound !== null).length };
}
export function leaderTable(games: GameMetrics[]): (GroupRow & { byPersonality: Record<string, { appearances: number; rate: number | null }> })[] {
  const seats = civs(games);
  return LEADER_IDS.map(leaderId => {
    const rows = seats.filter(seat => seat.leaderId === leaderId);
    return { ...groupRow(leaderId, rows), byPersonality: Object.fromEntries((['expansion', 'aggressive', 'conservative'] as const).map(personality => {
      const subset = rows.filter(seat => seat.personality === personality);
      return [personality, { appearances: subset.length, rate: subset.length ? subset.reduce((sum, seat) => sum + seat.credit, 0) / subset.length : null }];
    })) };
  });
}
export function personalityTable(games: GameMetrics[]) {
  const seats = civs(games);
  return (['expansion', 'aggressive', 'conservative'] as const).map(personality => {
    const groupGames = completed(games).filter(game => game.group === personality);
    return { ...groupRow(personality, seats.filter(seat => seat.personality === personality)), games: groupGames.length,
      endMedian: median(groupGames.map(game => game.endRound)), outcomes: Object.fromEntries(OUTCOME_KINDS.map(kind => [kind, groupGames.filter(game => game.outcome === kind).length]).filter(([, count]) => count)) };
  });
}

// ---------------------------------------------------------------- acceptance (§5) and November targets

export type CheckStatus = 'pass' | 'fail' | 'n/a';
export type Check = { id: string; label: string; line: string; measure: string | null; value: number | null; interval: [number, number] | null;
  status: CheckStatus; confidence: 'clear' | 'marginal' | null; detail: string; target?: true };
/** Pass iff the point estimate is inside [min, max]; `marginal` when the 95% interval crosses a bound, `clear` otherwise. */
export function judge(value: number | null, interval: [number, number] | null, min: number | null, max: number | null): { status: CheckStatus; confidence: 'clear' | 'marginal' | null } {
  if (value === null || Number.isNaN(value)) return { status: 'n/a', confidence: null };
  const inside = (x: number) => (min === null || x >= min) && (max === null || x <= max);
  const status: CheckStatus = inside(value) ? 'pass' : 'fail';
  if (!interval) return { status, confidence: null };
  const crosses = (min !== null && interval[0] < min && interval[1] >= min) || (max !== null && interval[0] <= max && interval[1] > max);
  return { status, confidence: crosses ? 'marginal' : 'clear' };
}
type LineDef = { id: string; measure: string; min: number | null; max: number | null; label?: string; target?: true };
/**
 * November targets (README step 1), defined precisely:
 * - first tech ≤ 8: median over every civ in every completed game of the first end of round with ≥ 1 technology (never → ∞);
 * - third city ≤ 22: median over every civ of the first end of round owning ≥ 3 cities, founded or captured (never, including
 *   civs eliminated first or games that ended first → ∞), so a civ that never gets there pushes the median up instead of dropping out;
 * - median end 130–160: median of the final round over completed games.
 */
export const NOVEMBER_TARGETS: LineDef[] = [
  { id: 'target-first-tech', measure: 'firstTechMedian', min: null, max: 8, target: true },
  { id: 'target-third-city', measure: 'thirdCityMedian', min: null, max: 22, target: true },
  { id: 'target-median-end', measure: 'endMedian', min: 130, max: 160, target: true },
];
/** §5 balance-gate lines (4-balance.md); the per-leader / per-personality bands are 0.6–1.4 / 0.8–1.8 of the fair share 1/players. */
export const GATE_LINES: LineDef[] = [
  { id: 'max-victory-share', measure: 'maxVictoryShare', min: null, max: 0.35 },
  { id: 'victory-diversity', measure: 'victoryKinds5', min: 5, max: null },
  { id: 'conquest-share', measure: 'conquest', min: 0.10, max: 0.30 },
  { id: 'full-length-share', measure: 'fullLength', min: 0.10, max: 0.25 },
  { id: 'median-end', measure: 'endMedian', min: 130, max: 160 },
  { id: 'ended-before-80', measure: 'endedBefore80', min: null, max: 0.15 },
  { id: 'round60-leader-wins', measure: 'leader60Won', min: null, max: 0.55 },
  { id: 'leader-changes', measure: 'leaderChanges', min: 3, max: null },
  { id: 'peak-cities', measure: 'peakCities', min: 5, max: null },
  { id: 'peak-cities-expansion', measure: 'peakCitiesExpansion', min: 7, max: null },
  { id: 'second-city-median', measure: 'secondCityMedian', min: null, max: 15 },
  { id: 'never-second-city', measure: 'neverSecondCity', min: null, max: 0.05 },
  { id: 'max-role-share', measure: 'maxRoleShare', min: null, max: 0.35 },
  { id: 'naval-share', measure: 'navalShare', min: 0.04, max: null },
];
function lineText(line: { min: number | null; max: number | null }, unit: Measure['unit']): string {
  const format = (value: number) => unit === 'share' ? `${Math.round(value * 100)}%` : String(value);
  if (line.min !== null && line.max !== null) return `${format(line.min)}–${format(line.max)}`;
  return line.min !== null ? `≥ ${format(line.min)}` : `≤ ${format(line.max!)}`;
}
function lineCheck(games: GameMetrics[], line: LineDef): Check {
  const item = measure(line.measure), result = estimate(games, line.measure);
  return { id: line.id, label: line.label ?? item.label, line: lineText(line, item.unit), measure: line.measure, value: result.value, interval: result.interval,
    ...judge(result.value, result.interval, line.min, line.max), detail: item.note ?? '', ...(line.target ? { target: true as const } : {}) };
}
function bandCheck(id: string, label: string, rows: { key: string; appearances: number; rate: number | null }[], min: number, max: number, expected: readonly string[], applicable: boolean): Check {
  if (!applicable) return { id, label, line: `${Math.round(min * 100)}%–${Math.round(max * 100)}%`, measure: null, value: null, interval: null, status: 'n/a', confidence: null, detail: '只在混合性格局（--mix mixed）里有意义' };
  const missing = expected.filter(key => !rows.some(row => row.key === key && row.appearances > 0));
  const rates = rows.filter(row => row.rate !== null).map(row => row.rate!);
  const failing = rows.filter(row => row.rate === null || row.rate < min || row.rate > max);
  const low = rates.length ? Math.min(...rates) : null, high = rates.length ? Math.max(...rates) : null;
  return { id, label, line: `${Math.round(min * 100)}%–${Math.round(max * 100)}%${expected.length > 3 ? `，${expected.length} 位全部上场` : ''}`, measure: null, value: null,
    interval: low === null || high === null ? null : [low, high], status: missing.length || failing.length ? 'fail' : 'pass', confidence: null,
    detail: [missing.length ? `未上场：${missing.join('、')}` : '', failing.map(row => `${row.key} ${row.rate === null ? '—' : (row.rate * 100).toFixed(1) + '%'}`).join('、')].filter(Boolean).join('；') || '全部在线内' };
}
export function acceptance(games: GameMetrics[], context: { players: number; mix: 'same' | 'mixed' }): { checks: Check[]; targets: Check[] } {
  const fair = 1 / context.players;
  const leaders = leaderTable(games), personalities = personalityTable(games);
  const unhealthy = games.filter(game => game.status !== 'completed' || game.exception).length;
  const checks: Check[] = [
    ...GATE_LINES.map(line => lineCheck(games, line)),
    bandCheck('leader-win-band', '每位领袖胜率（按出场折算）', leaders.map(row => ({ key: row.key, appearances: row.appearances, rate: row.rate })), 0.6 * fair, 1.4 * fair, LEADER_IDS, true),
    bandCheck('personality-win-band', '每种性格在混合局里的胜率', personalities.map(row => ({ key: row.key, appearances: row.appearances, rate: row.rate })), 0.8 * fair, 1.8 * fair, ['expansion', 'aggressive', 'conservative'], context.mix === 'mixed'),
    { id: 'health', label: '0 异常 / 0 中止 / 0 缺陷', line: '= 0', measure: null, value: unhealthy, interval: null, status: unhealthy ? 'fail' : 'pass', confidence: null,
      detail: `${games.length} 局：${games.filter(game => game.status === 'completed').length} 完成，${games.filter(game => game.status === 'defect').length} 缺陷，${games.filter(game => game.status === 'aborted').length} 中止` },
  ];
  return { checks, targets: NOVEMBER_TARGETS.map(line => lineCheck(games, line)) };
}

// ---------------------------------------------------------------- curves

export const CURVE_FIELDS = ['cities', 'population', 'food', 'production', 'gold', 'research', 'techs', 'army', 'score'] as const;
export type CurveField = (typeof CURVE_FIELDS)[number];
/** Per snapshot round: civs alive in games still running at that round; mean and P10 / P90 per field. */
export function curveTable(rows: CurveRow[]) {
  const rounds = [...new Set(rows.map(row => row.round))].sort((a, b) => a - b);
  return rounds.map(round => {
    const alive = rows.filter(row => row.round === round && row.alive);
    return { round, civs: alive.length, games: new Set(alive.map(row => row.id)).size, fields: Object.fromEntries(CURVE_FIELDS.map(field => {
      const values = alive.map(row => row[field]);
      return [field, { mean: meanOf(values), p10: quantile(values, 0.1), p90: quantile(values, 0.9) }];
    })) as Record<CurveField, { mean: number | null; p10: number | null; p90: number | null }> };
  });
}
