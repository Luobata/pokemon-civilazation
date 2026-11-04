import { contentFor } from '../src/content/units.ts';
import { PROMOTION_TRAIT_IDS } from '../src/content/promotions.ts';
import type { PromotionTrait } from '../src/content/promotions.ts';
import { DISTRICT_IDS } from '../src/content/districts.ts';
import { GOVERNMENT_IDS } from '../src/content/policies.ts';
import type { GovernmentId } from '../src/content/policies.ts';
import type { DistrictId } from '../src/content/districts.ts';
import type { GameEvent } from '../src/core/model.ts';
import { isGameplayVersion } from '../src/content/eras.ts';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONTENT,  } from '../src/content/units.ts';
import type { Content } from '../src/content/units.ts';
import { CLASSIC_LEADER_IDS, LEADER_IDS } from '../src/content/leaders.ts';
import type { LeaderId } from '../src/content/leaders.ts';
import { AI_THRESHOLDS } from '../src/ai/thresholds.ts';
import { RULE_QUERIES } from '../src/ai/query.ts';
import { rememberCityRejection } from '../src/ai/memory.ts';
import type { RejectedCitySite } from '../src/ai/memory.ts';
import { planNext } from '../src/ai/plan.ts';
import { createGame } from '../src/core/game.ts';
import type { EraProgression, GameplayVersion } from '../src/content/eras.ts';
import { LATEST_GAMEPLAY_VERSION } from '../src/content/eras.ts';
import { observe } from '../src/core/vision.ts';
import { step } from '../src/core/step.ts';
import { hexDistance, hexToIndex } from '../src/core/hex.ts';
import { compareScores, scorePlayer } from '../src/core/victory.ts';
import { canonicalSerialize } from '../src/core/snapshot.ts';
import type { AiPersonality, Command, GameSetup, GameState, Score, GameOutcome } from '../src/core/model.ts';
import { classifyRejection } from './rejections.ts';
import { collectTelemetry, createTelemetry, finalizeTelemetry } from './telemetry.ts';
import type { CityAttackEvent, CombatRole, ProgressionBand, WarEpisode } from './telemetry.ts';
import { COMBAT_ROLES, emptyBandCounts, emptyRoleByBandCounts, emptyRoleCounts, PROGRESSION_BANDS } from './telemetry.ts';
import { mean, ratio, wilson95 } from './statistics.ts';

export type RoundLimit = 100 | 200 | 300;
export const PERSONALITIES: AiPersonality[] = ['expansion', 'aggressive', 'conservative'];
export type EraCliOption = 'none' | EraProgression;
const eraProgressionValue = (value: 'none' | 'simple' | 'full'): EraProgression | null => value === 'none' ? null : value === 'simple' ? 'simple-v1' : 'full-v1';
const eraCliValue = (value: EraProgression | undefined): EraCliOption => value ?? 'none';
export type LeaderBalanceConfig = {
  seeds: number;
  seedStart?: number;
  expansionVersion?: 1;
  eraProgression?: EraProgression;
  gameplayVersion?: GameplayVersion;
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
  districtCompletions?: Record<DistrictId, number>;
  /** v11+: GovernmentChanged events per government (adoptions, including switches). */
  governmentAdoptions?: Record<GovernmentId, number>;
  /** v12+: one entry per era change: the age chosen and the finished era's points per round (permille). */
  eraAges?: { playerId: number; eraIndex: number; age: string; ratePermille: number; rounds: number }[];
  /** v13+: UnitPromoted events per trait. */
  promotions?: Record<PromotionTrait, number>;
  /** v14+: owned Pokémon at the end of the game, by species (deployed and recovering). */
  finalSpecies?: Record<string, number>;
  id: string;
  seed: number;
  personality: AiPersonality;
  rotation: number;
  leaderBySeat: Record<number, LeaderId>;
  status: 'completed' | 'defect' | 'aborted';
  outcomeKind: GameOutcome['kind'] | null;
  winners: number[];
  eliminatedSeats: number[];
  round: number;
  commandCount: number;
  ranking: Score[];
  scoreByLeader: Record<LeaderId, Score & { seat: number; rank: number; winCredit: number }>;
  startingBySeat: StartingPosition[];
  rejections: RejectionSummary;
  exception: string | null;
  activityByLeader: Record<LeaderId, LeaderActivityMetrics>;
  cityEvents: CityAttackEvent[];
  cityEventLogTruncated: boolean;
  warEpisodes: WarEpisode[];
  eliminations: { round: number; seq: number; playerId: number }[];
  progressionBySeat: ProgressionSeatResult[];
  eraProgression: EraCliOption;
};

export type LeaderActivityMetrics = {
  peakCities: number;
  attacks: number;
  captureAttempts: number;
  captureSuccesses: number;
  activeAbilities: number;
  recruitedLeaderUnits: number;
  leaderBuildings: number;
  resolvedCityAttacks: number;
  cityCaptures: number;
  cityLosses: number;
  hqAttacks: number;
  hqCaptures: number;
  firstCityAttackRound: number | null;
  firstHQAttackRound: number | null;
  siegeCraftRound: number | null;
  warDeclarations: number;
  peaceAgreements: number;
  warRounds: number;
  cityAttacksByRole: Record<CombatRole, number>;
  cityCapturesByRole: Record<CombatRole, number>;
  cityAttacksByProgressionBand: Record<ProgressionBand, number>;
  cityCapturesByProgressionBand: Record<ProgressionBand, number>;
  cityAttacksByRoleAndProgressionBand: Record<ProgressionBand, Record<CombatRole, number>>;
  finalCombatUnitsByRole: Record<CombatRole, number>;
  peakCombatUnitsByRole: Record<CombatRole, number>;
  eraArrivalRounds: Record<number, number>;
};

export type ProgressionSeatResult = {
  seat: number;
  leaderId: LeaderId;
  techCount: number;
  finalCombatUnitsByRole: Record<CombatRole, number>;
  peakCombatUnitsByRole: Record<CombatRole, number>;
  cityAttacksByProgressionBand: Record<ProgressionBand, number>;
  cityCapturesByProgressionBand: Record<ProgressionBand, number>;
  cityAttacksByRoleAndProgressionBand: Record<ProgressionBand, Record<CombatRole, number>>;
  eraArrivalRounds: Record<number, number>;
};

/** Classic four for older rules; all leaders from gameplay v4. */
export function leaderRoster(config: Pick<LeaderBalanceConfig, 'gameplayVersion'>): readonly LeaderId[] {
  return (config.gameplayVersion ?? 0) >= 4 ? LEADER_IDS : CLASSIC_LEADER_IDS;
}
export function leaderBalanceCases(config: LeaderBalanceConfig): LeaderBalanceCase[] {
  const cases: LeaderBalanceCase[] = [];
  const seedStart = config.seedStart ?? 1;
  for (let seed = seedStart; seed < seedStart + config.seeds; seed++) {
    for (const personality of PERSONALITIES) {
      // Cyclic design: table r seats roster[r..r+3]; every leader plays every seat exactly once.
      const roster = leaderRoster(config);
      for (let rotation = 0; rotation < roster.length; rotation++) {
        const leaderBySeat = Object.fromEntries([0, 1, 2, 3].map(seat => [seat, roster[(seat + rotation) % roster.length]])) as Record<number, LeaderId>;
        cases.push({
          id: `leaders-s${seed}-${personality}-r${rotation}`,
          seed,
          personality,
          rotation,
          leaderBySeat,
          setup: {
            seed,
            ...(config.expansionVersion === 1 ? { expansionVersion: 1 as const } : {}),
            ...(config.expansionVersion === 1 && config.eraProgression !== undefined ? { eraProgression: config.eraProgression } : {}),
            ...(config.expansionVersion === 1 && config.eraProgression !== undefined && config.gameplayVersion !== undefined ? { gameplayVersion: config.gameplayVersion } : {}),
            width: config.width,
            height: config.height,
            roundLimit: config.roundLimit,
            players: [0, 1, 2, 3].map(seat => ({ id: seat, controller: 'ai' as const, personality, leaderId: leaderBySeat[seat] })),
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

function emptyLeaderActivity(): LeaderActivityMetrics {
  return {
    peakCities: 0, attacks: 0, captureAttempts: 0, captureSuccesses: 0, activeAbilities: 0, recruitedLeaderUnits: 0, leaderBuildings: 0,
    resolvedCityAttacks: 0, cityCaptures: 0, cityLosses: 0, hqAttacks: 0, hqCaptures: 0, firstCityAttackRound: null, firstHQAttackRound: null,
    siegeCraftRound: null, warDeclarations: 0, peaceAgreements: 0, warRounds: 0, cityAttacksByRole: emptyRoleCounts(),
    cityCapturesByRole: emptyRoleCounts(), cityAttacksByProgressionBand: emptyBandCounts(), cityCapturesByProgressionBand: emptyBandCounts(),
    cityAttacksByRoleAndProgressionBand: emptyRoleByBandCounts(), finalCombatUnitsByRole: emptyRoleCounts(), peakCombatUnitsByRole: emptyRoleCounts(),
    eraArrivalRounds: {},
  };
}
function cloneRoleByBand(source: Record<ProgressionBand, Record<CombatRole, number>>): Record<ProgressionBand, Record<CombatRole, number>> {
  return Object.fromEntries(PROGRESSION_BANDS.map(band => [band, { ...source[band] }])) as Record<ProgressionBand, Record<CombatRole, number>>;
}
function leaderActivity(source: ReturnType<typeof createTelemetry>['activity'][number]): LeaderActivityMetrics {
  return {
    peakCities: source.peakCities, attacks: source.attacks, captureAttempts: source.captureAttempts, captureSuccesses: source.captureSuccesses,
    activeAbilities: source.activeAbilities, recruitedLeaderUnits: source.recruitedLeaderUnits, leaderBuildings: source.leaderBuildings,
    resolvedCityAttacks: source.resolvedCityAttacks, cityCaptures: source.cityCaptures, cityLosses: source.cityLosses,
    hqAttacks: source.hqAttacks, hqCaptures: source.hqCaptures, firstCityAttackRound: source.firstCityAttackRound,
    firstHQAttackRound: source.firstHQAttackRound, siegeCraftRound: source.siegeCraftRound,
    warDeclarations: source.warDeclarations, peaceAgreements: source.peaceAgreements, warRounds: source.warRounds,
    cityAttacksByRole: { ...source.cityAttacksByRole }, cityCapturesByRole: { ...source.cityCapturesByRole },
    cityAttacksByProgressionBand: { ...source.cityAttacksByProgressionBand }, cityCapturesByProgressionBand: { ...source.cityCapturesByProgressionBand },
    cityAttacksByRoleAndProgressionBand: cloneRoleByBand(source.cityAttacksByRoleAndProgressionBand), eraArrivalRounds: { ...source.eraArrivalRounds },
    finalCombatUnitsByRole: { ...source.combatUnitsByRole }, peakCombatUnitsByRole: { ...source.peakCombatUnitsByRole },
  };
}

function addRejection(summary: RejectionSummary, item: { round: number; seq: number; actorId: number; actionType: Command['action']['type']; reason: string; category: 'fog' | 'defect' }): void {
  summary.total++;
  summary[item.category]++;
  summary.byReason[item.reason] = (summary.byReason[item.reason] ?? 0) + 1;
  if (summary.examples.length < 20) summary.examples.push(item);
}

function startingPositions(state: GameState, content: Content = CONTENT): StartingPosition[] {
  return Object.values(state.players).map(player => {
    const city = state.cities[player.headquartersCityId];
    const tileIndex = hexToIndex(city.position, state.map)!;
    const base = { food: 2, production: 1, gold: 1, research: 0 };
    for (const workedTileId of city.workedTileIds) {
      const yieldToAdd = content.biomes[state.map.tiles[workedTileId]];
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

function finalRanking(state: GameState, content: Content = CONTENT): Score[] {
  return state.outcome?.ranking ?? Object.keys(state.players).map(Number)
    .map(id => scorePlayer(state, id, content)).sort((a, b) => compareScores(a, b) || a.playerId - b.playerId);
}

export function simulateLeaderCase(match: LeaderBalanceCase, onState?: (state: GameState) => void): LeaderGameResult {
  const content = contentFor(match.setup);
  let state: GameState;
  try {
    state = createGame(match.setup, content);
  } catch (error) {
    const emptyScores = Object.fromEntries(LEADER_IDS.map(leaderId => [leaderId, null])) as Record<LeaderId, never>;
    return {
      id: match.id, seed: match.seed, personality: match.personality, rotation: match.rotation, leaderBySeat: match.leaderBySeat,
      status: 'defect', outcomeKind: null, winners: [], eliminatedSeats: [], round: 0, commandCount: 0, ranking: [], scoreByLeader: emptyScores,
      startingBySeat: [], rejections: emptyRejections(), exception: String(error),
      activityByLeader: Object.fromEntries(LEADER_IDS.map(leaderId => [leaderId, emptyLeaderActivity()])) as LeaderGameResult['activityByLeader'],
      cityEvents: [], cityEventLogTruncated: false, warEpisodes: [], eliminations: [], progressionBySeat: [], eraProgression: eraCliValue(match.setup.eraProgression),
    };
  }
  const telemetry = createTelemetry(state, content), memory: RejectedCitySite[] = [], rejections = emptyRejections();
  const startingBySeat = startingPositions(state, content);
  const districtCompletions = Object.fromEntries(DISTRICT_IDS.map(kind => [kind, 0])) as Record<DistrictId, number>;
  const governmentAdoptions = Object.fromEntries(GOVERNMENT_IDS.map(id => [id, 0])) as Record<GovernmentId, number>;
  const eraAges: NonNullable<LeaderGameResult['eraAges']> = [];
  const promotions = Object.fromEntries(PROMOTION_TRAIT_IDS.map(id => [id, 0])) as Record<PromotionTrait, number>;
  const countDistricts = (events: readonly GameEvent[]) => {
    for (const event of events) {
      if (event.payload.type === 'DistrictCompleted') districtCompletions[event.payload.kind]++;
      if (event.payload.type === 'GovernmentChanged') governmentAdoptions[event.payload.governmentId]++;
      if (event.payload.type === 'UnitPromoted') promotions[event.payload.trait]++;
      if (event.payload.type === 'EraAgeBegan') eraAges.push({ playerId: event.payload.playerId, eraIndex: event.payload.eraIndex, age: event.payload.age,
        ratePermille: event.payload.previousRounds ? Math.floor(event.payload.previousScore * 1000 / event.payload.previousRounds) : 0, rounds: event.payload.previousRounds });
    }
  };
  let exception: string | null = null;
  try {
    while (!state.outcome && state.commandSeq < 100_000) {
      onState?.(state);
      const view = observe(state, state.activePlayerId, content);
      const command = planNext(view, { ...RULE_QUERIES, content, ai: AI_THRESHOLDS }, memory);
      const result = step(state, command, content);
      if (result.ok) {
        collectTelemetry(telemetry, state, result.state, command, result.events, content);
        countDistricts(result.events);
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
      countDistricts(ended.events);
      state = ended.state;
    }
    onState?.(state);
  } catch (error) {
    exception = String(error);
  }
  finalizeTelemetry(telemetry, state, content);
  const ranking = finalRanking(state, content);
  const scoreByLeader = Object.fromEntries(Object.entries(match.leaderBySeat).map(([seatText, leaderId]) => {
    const seat = Number(seatText), score = ranking.find(item => item.playerId === seat)!;
    return [leaderId, { ...score, seat, rank: ranking.findIndex(item => item.playerId === seat) + 1, winCredit: state.outcome?.winners.includes(seat) ? 1 / state.outcome.winners.length : 0 }];
  })) as LeaderGameResult['scoreByLeader'];
  const commandLimitReached = !state.outcome && state.commandSeq >= 100_000;
  const hasDefect = exception !== null || (!state.outcome && state.commandSeq < 100_000) || rejections.defect > 0;
  return {
    id: match.id, seed: match.seed, personality: match.personality, rotation: match.rotation, leaderBySeat: match.leaderBySeat,
    status: commandLimitReached ? 'aborted' : hasDefect ? 'defect' : 'completed',
    outcomeKind: state.outcome?.kind ?? null, winners: state.outcome?.winners ?? [], eliminatedSeats: Object.values(state.players).filter(player => player.eliminated).map(player => player.id), round: state.round, commandCount: state.commandSeq,
    ranking, scoreByLeader, startingBySeat, rejections, exception,
    activityByLeader: Object.fromEntries(Object.entries(match.leaderBySeat).map(([seatText, leaderId]) => [leaderId, leaderActivity(telemetry.activity[Number(seatText)])])) as LeaderGameResult['activityByLeader'],
    cityEvents: telemetry.cityEvents, cityEventLogTruncated: telemetry.cityEventLogTruncated,
    warEpisodes: telemetry.warEpisodes, eliminations: telemetry.eliminations,
    progressionBySeat: Object.values(state.players).map(player => {
      const source = telemetry.activity[player.id], score = ranking.find(item => item.playerId === player.id)!;
      return {
        seat: player.id, leaderId: player.leaderId!, techCount: score.techs,
        finalCombatUnitsByRole: { ...source.combatUnitsByRole }, peakCombatUnitsByRole: { ...source.peakCombatUnitsByRole },
        cityAttacksByProgressionBand: { ...source.cityAttacksByProgressionBand }, cityCapturesByProgressionBand: { ...source.cityCapturesByProgressionBand },
        cityAttacksByRoleAndProgressionBand: cloneRoleByBand(source.cityAttacksByRoleAndProgressionBand),
        eraArrivalRounds: { ...source.eraArrivalRounds },
      };
    }),
    eraProgression: eraCliValue(match.setup.eraProgression),
    ...((match.setup.gameplayVersion ?? 0) >= 10 ? { districtCompletions } : {}),
    ...((match.setup.gameplayVersion ?? 0) >= 11 ? { governmentAdoptions } : {}),
    ...((match.setup.gameplayVersion ?? 0) >= 12 ? { eraAges } : {}),
    ...((match.setup.gameplayVersion ?? 0) >= 13 ? { promotions } : {}),
    ...((match.setup.gameplayVersion ?? 0) >= 14 ? { finalSpecies: Object.fromEntries(Object.entries(Object.values(state.units)
      .reduce<Record<string, number>>((counts, unit) => { if (unit.ownerId !== null && unit.kind === 'pokemon') counts[unit.speciesId] = (counts[unit.speciesId] ?? 0) + 1; return counts; }, {}))
      .sort(([a], [b]) => a < b ? -1 : 1)) } : {}),
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
  conquest?: LeaderConquestAggregate;
  eraArrivals?: Record<number, { reached: number; meanRound: number | null }>;
  winShare: ReturnType<typeof ratio>;
  wilson95: [number, number] | null;
  meanScore: ReturnType<typeof mean>;
  meanRank: ReturnType<typeof mean>;
  meanCities: ReturnType<typeof mean>;
  meanPopulation: ReturnType<typeof mean>;
  meanTechs: ReturnType<typeof mean>;
  meanKnockdowns: ReturnType<typeof mean>;
  meanPeakCities: ReturnType<typeof mean>;
  meanActiveAbilities: ReturnType<typeof mean>;
  meanRecruitedLeaderUnits: ReturnType<typeof mean>;
  meanLeaderBuildings: ReturnType<typeof mean>;
  meanResolvedCityAttacks: ReturnType<typeof mean>;
  meanCityCaptures: ReturnType<typeof mean>;
  meanCityLosses: ReturnType<typeof mean>;
  meanHQAttacks: ReturnType<typeof mean>;
  meanHQCaptures: ReturnType<typeof mean>;
  meanFirstCityAttackRound: ReturnType<typeof mean>;
  meanFirstHQAttackRound: ReturnType<typeof mean>;
  meanSiegeCraftRound: ReturnType<typeof mean>;
  meanWarRounds: ReturnType<typeof mean>;
  cityAttacksByRole: Record<CombatRole, number>;
  cityCapturesByRole: Record<CombatRole, number>;
  cityAttacksByProgressionBand: Record<ProgressionBand, number>;
  cityCapturesByProgressionBand: Record<ProgressionBand, number>;
  cityAttacksByRoleAndProgressionBand: Record<ProgressionBand, Record<CombatRole, number>>;
  meanFinalCombatUnitsByRole: Record<CombatRole, number | null>;
  meanPeakCombatUnitsByRole: Record<CombatRole, number | null>;
  eliminatedCount: number;
  splitWinCount: number;
  starting: StartingAggregate;
  byPersonality: Record<AiPersonality, { observations: number; winCredit: number; meanScore: number }>;
};

type EraArrivalAggregate = Record<number, { reached: number; meanRound: number | null }>;

function aggregateEraArrivals(rows: Record<number, number>[]): EraArrivalAggregate {
  const indices = [...new Set(rows.flatMap(row => Object.keys(row).map(Number)))].sort((a, b) => a - b);
  return Object.fromEntries(indices.map(index => {
    const rounds = rows.map(row => row[index]).filter((round): round is number => round !== undefined);
    return [index, { reached: rounds.length, meanRound: rounds.length ? rounds.reduce((sum, round) => sum + round, 0) / rounds.length : null }];
  }));
}

type LeaderConquestAggregate = {
  meanResolvedCityAttacks: number | null;
  meanCityCaptures: number | null;
  meanCityLosses: number | null;
  meanHQAttacks: number | null;
  meanHQCaptures: number | null;
  meanFirstCityAttackRound: number | null;
  meanFirstHQAttackRound: number | null;
  meanSiegeCraftRound: number | null;
  meanWarRounds: number | null;
  cityAttacksByRole: Record<CombatRole, number>;
  cityCapturesByRole: Record<CombatRole, number>;
  cityAttacksByProgressionBand: Record<ProgressionBand, number>;
  cityCapturesByProgressionBand: Record<ProgressionBand, number>;
  cityAttacksByRoleAndProgressionBand: Record<ProgressionBand, Record<CombatRole, number>>;
  meanFinalCombatUnitsByRole: Record<CombatRole, number | null>;
  meanPeakCombatUnitsByRole: Record<CombatRole, number | null>;
};

function sumRoleCounts(rows: Record<CombatRole, number>[]): Record<CombatRole, number> {
  const output = emptyRoleCounts();
  for (const row of rows) for (const role of COMBAT_ROLES) output[role] += row[role];
  return output;
}
function sumBandCounts(rows: Record<ProgressionBand, number>[]): Record<ProgressionBand, number> {
  const output = emptyBandCounts();
  for (const row of rows) for (const band of PROGRESSION_BANDS) output[band] += row[band];
  return output;
}
function sumRoleByBandCounts(rows: Record<ProgressionBand, Record<CombatRole, number>>[]): Record<ProgressionBand, Record<CombatRole, number>> {
  const output = emptyRoleByBandCounts();
  for (const row of rows) for (const band of PROGRESSION_BANDS) for (const role of COMBAT_ROLES) output[band][role] += row[band][role];
  return output;
}
function meanRoleCounts(rows: Record<CombatRole, number>[]): Record<CombatRole, number | null> {
  return Object.fromEntries(COMBAT_ROLES.map(role => [role, rows.length ? rows.reduce((sum, row) => sum + row[role], 0) / rows.length : null])) as Record<CombatRole, number | null>;
}
function leaderConquestAggregate(rows: LeaderActivityMetrics[]): LeaderConquestAggregate {
  const average = (values: (number | null)[]) => {
    const available = values.filter((value): value is number => value !== null);
    return available.length ? available.reduce((sum, value) => sum + value, 0) / available.length : null;
  };
  return {
    meanResolvedCityAttacks: average(rows.map(row => row.resolvedCityAttacks)),
    meanCityCaptures: average(rows.map(row => row.cityCaptures)),
    meanCityLosses: average(rows.map(row => row.cityLosses)),
    meanHQAttacks: average(rows.map(row => row.hqAttacks)),
    meanHQCaptures: average(rows.map(row => row.hqCaptures)),
    meanFirstCityAttackRound: average(rows.map(row => row.firstCityAttackRound)),
    meanFirstHQAttackRound: average(rows.map(row => row.firstHQAttackRound)),
    meanSiegeCraftRound: average(rows.map(row => row.siegeCraftRound)),
    meanWarRounds: average(rows.map(row => row.warRounds)),
    cityAttacksByRole: sumRoleCounts(rows.map(row => row.cityAttacksByRole)),
    cityCapturesByRole: sumRoleCounts(rows.map(row => row.cityCapturesByRole)),
    cityAttacksByProgressionBand: sumBandCounts(rows.map(row => row.cityAttacksByProgressionBand)),
    cityCapturesByProgressionBand: sumBandCounts(rows.map(row => row.cityCapturesByProgressionBand)),
    cityAttacksByRoleAndProgressionBand: sumRoleByBandCounts(rows.map(row => row.cityAttacksByRoleAndProgressionBand)),
    meanFinalCombatUnitsByRole: meanRoleCounts(rows.map(row => row.finalCombatUnitsByRole)),
    meanPeakCombatUnitsByRole: meanRoleCounts(rows.map(row => row.peakCombatUnitsByRole)),
  };
}

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
  const present = LEADER_IDS.filter(leaderId => valid.some(game => game.scoreByLeader[leaderId]));
  const leaders: LeaderAggregate[] = (present.length ? present : CLASSIC_LEADER_IDS).map(leaderId => {
    const observations = valid.flatMap(game => game.scoreByLeader[leaderId] ? [{ game, score: game.scoreByLeader[leaderId] }] : []);
    const activityRows = observations.map(({ game }) => game.activityByLeader[leaderId]);
    const activityMean = (key: keyof Pick<LeaderActivityMetrics, 'resolvedCityAttacks' | 'cityCaptures' | 'cityLosses' | 'hqAttacks' | 'hqCaptures' | 'firstCityAttackRound' | 'firstHQAttackRound' | 'siegeCraftRound' | 'warRounds'>) =>
      mean(observations.flatMap(({ game }) => {
        const value = game.activityByLeader[leaderId][key];
        return value === null ? [] : [{ seed: game.seed, value }];
      }));
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
      meanActiveAbilities: mean(observations.map(({ game }) => ({ seed: game.seed, value: game.activityByLeader[leaderId].activeAbilities }))),
      meanRecruitedLeaderUnits: mean(observations.map(({ game }) => ({ seed: game.seed, value: game.activityByLeader[leaderId].recruitedLeaderUnits }))),
      meanLeaderBuildings: mean(observations.map(({ game }) => ({ seed: game.seed, value: game.activityByLeader[leaderId].leaderBuildings }))),
      conquest: leaderConquestAggregate(activityRows),
      eraArrivals: aggregateEraArrivals(activityRows.map(row => row.eraArrivalRounds)),
      meanResolvedCityAttacks: activityMean('resolvedCityAttacks'),
      meanCityCaptures: activityMean('cityCaptures'),
      meanCityLosses: activityMean('cityLosses'),
      meanHQAttacks: activityMean('hqAttacks'),
      meanHQCaptures: activityMean('hqCaptures'),
      meanFirstCityAttackRound: activityMean('firstCityAttackRound'),
      meanFirstHQAttackRound: activityMean('firstHQAttackRound'),
      meanSiegeCraftRound: activityMean('siegeCraftRound'),
      meanWarRounds: activityMean('warRounds'),
      cityAttacksByRole: sumRoleCounts(activityRows.map(row => row.cityAttacksByRole)),
      cityCapturesByRole: sumRoleCounts(activityRows.map(row => row.cityCapturesByRole)),
      cityAttacksByProgressionBand: sumBandCounts(activityRows.map(row => row.cityAttacksByProgressionBand)),
      cityCapturesByProgressionBand: sumBandCounts(activityRows.map(row => row.cityCapturesByProgressionBand)),
      cityAttacksByRoleAndProgressionBand: sumRoleByBandCounts(activityRows.map(row => row.cityAttacksByRoleAndProgressionBand)),
      meanFinalCombatUnitsByRole: meanRoleCounts(activityRows.map(row => row.finalCombatUnitsByRole)),
      meanPeakCombatUnitsByRole: meanRoleCounts(activityRows.map(row => row.peakCombatUnitsByRole)),
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
  const allActivities = valid.flatMap(game => Object.values(game.activityByLeader));
  const conquest = leaderConquestAggregate(allActivities);
  const endedWars = valid.flatMap(game => game.warEpisodes.map(episode => ({ seed: game.seed, episode }))).filter(({ episode }) => episode.status !== 'active-at-end');
  const conquestSummary = {
    gamesWithCityAttack: valid.filter(game => Object.values(game.activityByLeader).some(row => row.resolvedCityAttacks > 0)).length,
    gamesWithCityCapture: valid.filter(game => Object.values(game.activityByLeader).some(row => row.cityCaptures > 0)).length,
    gamesWithHQAttack: valid.filter(game => Object.values(game.activityByLeader).some(row => row.hqAttacks > 0)).length,
    gamesWithHQCapture: valid.filter(game => Object.values(game.activityByLeader).some(row => row.hqCaptures > 0)).length,
    eliminationEvents: valid.reduce((sum, game) => sum + game.eliminations.length, 0),
    cityEventLogTruncatedGames: valid.filter(game => game.cityEventLogTruncated).length,
    ...conquest,
  };
  const warSummary = {
    episodes: valid.reduce((sum, game) => sum + game.warEpisodes.length, 0),
    declarations: valid.reduce((sum, game) => sum + Object.values(game.activityByLeader).reduce((inner, row) => inner + row.warDeclarations, 0), 0),
    peaceAgreements: valid.reduce((sum, game) => sum + Object.values(game.activityByLeader).reduce((inner, row) => inner + row.peaceAgreements, 0) / 2, 0),
    endedEpisodes: endedWars.length,
    activeWarsAtEnd: valid.reduce((sum, game) => sum + game.warEpisodes.filter(episode => episode.status === 'active-at-end').length, 0),
    meanWarRounds: conquest.meanWarRounds,
    meanEpisodeDuration: mean(endedWars.map(({ seed, episode }) => ({ seed, value: episode.rounds! }))),
  };
  const progressionSummary = {
    selectedEras: Object.fromEntries((['none', 'simple-v1', 'full-v1'] as const).map(option => [option, valid.filter(game => game.eraProgression === option).length])),
    cityAttacksByProgressionBand: conquest.cityAttacksByProgressionBand,
    cityCapturesByProgressionBand: conquest.cityCapturesByProgressionBand,
    cityAttacksByRoleAndProgressionBand: conquest.cityAttacksByRoleAndProgressionBand,
    eraArrivals: aggregateEraArrivals(valid.flatMap(game => game.progressionBySeat.map(seat => seat.eraArrivalRounds))),
  };
  return {
    conquest: conquestSummary,
    war: warSummary,
    progression: progressionSummary,
    attemptedGames: games.length,
    completedGames: valid.length,
    defectGames: games.filter(game => game.status === 'defect').length,
    abortedGames: games.filter(game => game.status === 'aborted').length,
    exceptionGames: games.filter(game => game.exception !== null).length,
    splitWinGames: valid.filter(game => game.winners.length > 1).length,
    outcomeKinds: Object.fromEntries((['conquest', 'score', 'playerDefeat', 'pokedex', 'origin', 'championship', 'contest', 'faith'] as const).map(kind => [kind, valid.filter(game => game.outcomeKind === kind).length])),
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

export type LeaderBalanceAggregate = ReturnType<typeof aggregateLeaderGames>;

export type LeaderBalanceReport = {
  schemaVersion: 1;
  metadata: {
    command: string[];
    nodeVersion: string;
    gitHead: string | null;
    config: LeaderBalanceConfig;
    seedStart: number;
    seedValues: number[];
    expansion: boolean;
    eraProgression: EraCliOption;
    gamesPlanned: number;
    scheduleSha256: string;
    toolSha256: string;
    contentVersion: string;
    contentSha256: string;
    deterministic: true;
  };
  aggregate: LeaderBalanceAggregate;
  acceptance?: LeaderBalanceAcceptance;
  warnings: string[];
  games: LeaderGameResult[];
};

export const LEADER_BALANCE_ACCEPTANCE_THRESHOLDS = {
  minimumWinShare: 0.15,
  maximumWinShare: 0.35,
  maximumWinShareSpread: 0.15,
  minimumMeanActiveAbilities: 0.25,
  minimumMeanRecruitedLeaderUnits: 0.1,
  minimumMeanLeaderBuildings: 0.1,
} as const;

type LeaderBalanceAcceptanceCheck = {
  id: string;
  passes: boolean;
  value: number | null;
  minimum?: number;
  maximum?: number;
  failingLeaders: LeaderId[];
};

export type LeaderBalanceAcceptance = {
  status: 'pass' | 'fail';
  thresholds: typeof LEADER_BALANCE_ACCEPTANCE_THRESHOLDS;
  checks: LeaderBalanceAcceptanceCheck[];
};

export function evaluateLeaderBalanceAcceptance(aggregate: LeaderBalanceAggregate, plannedGames: number): LeaderBalanceAcceptance {
  const shares = aggregate.leaders.map(leader => ({ leader, value: leader.winShare.pointEstimate }));
  const availableShares = shares.filter((item): item is { leader: LeaderAggregate; value: number } => item.value !== null);
  const minimumShare = availableShares.length ? Math.min(...availableShares.map(item => item.value)) : null;
  const maximumShare = availableShares.length ? Math.max(...availableShares.map(item => item.value)) : null;
  const spread = minimumShare === null || maximumShare === null ? null : maximumShare - minimumShare;
  const check = (id: string, passes: boolean, value: number | null, limits: { minimum?: number; maximum?: number } = {}, failingLeaders: LeaderId[] = []): LeaderBalanceAcceptanceCheck =>
    ({ id, passes, value, ...limits, failingLeaders });
  const withinWinShare = aggregate.leaders.every(leader => leader.winShare.pointEstimate !== null
    && leader.winShare.pointEstimate >= LEADER_BALANCE_ACCEPTANCE_THRESHOLDS.minimumWinShare
    && leader.winShare.pointEstimate <= LEADER_BALANCE_ACCEPTANCE_THRESHOLDS.maximumWinShare);
  const meanAtLeast = (key: 'meanActiveAbilities' | 'meanRecruitedLeaderUnits' | 'meanLeaderBuildings', minimum: number) => {
    const values = aggregate.leaders.map(leader => ({ leader, value: leader[key].value }));
    return {
      passes: values.every(item => item.value !== null && item.value >= minimum),
      minimumValue: values.every(item => item.value !== null) ? Math.min(...values.map(item => item.value as number)) : null,
      failingLeaders: values.filter(item => item.value === null || item.value < minimum).map(item => item.leader.leaderId),
    };
  };
  const activity = meanAtLeast('meanActiveAbilities', LEADER_BALANCE_ACCEPTANCE_THRESHOLDS.minimumMeanActiveAbilities);
  const recruitment = meanAtLeast('meanRecruitedLeaderUnits', LEADER_BALANCE_ACCEPTANCE_THRESHOLDS.minimumMeanRecruitedLeaderUnits);
  const buildings = meanAtLeast('meanLeaderBuildings', LEADER_BALANCE_ACCEPTANCE_THRESHOLDS.minimumMeanLeaderBuildings);
  const checks = [
    check('planned-games-completed', aggregate.attemptedGames === plannedGames && aggregate.completedGames === plannedGames && aggregate.leaders.every(leader => leader.observations === aggregate.completedGames), aggregate.completedGames, { minimum: plannedGames }),
    check('zero-defects', aggregate.defectGames === 0, aggregate.defectGames, { maximum: 0 }),
    check('zero-aborts', aggregate.abortedGames === 0, aggregate.abortedGames, { maximum: 0 }),
    check('zero-exceptions', aggregate.exceptionGames === 0, aggregate.exceptionGames, { maximum: 0 }),
    check('win-share-band', withinWinShare, minimumShare === null || maximumShare === null ? null : maximumShare * 100, { minimum: LEADER_BALANCE_ACCEPTANCE_THRESHOLDS.minimumWinShare * 100, maximum: LEADER_BALANCE_ACCEPTANCE_THRESHOLDS.maximumWinShare * 100 }, shares.filter(item => item.value === null || item.value < LEADER_BALANCE_ACCEPTANCE_THRESHOLDS.minimumWinShare || item.value > LEADER_BALANCE_ACCEPTANCE_THRESHOLDS.maximumWinShare).map(item => item.leader.leaderId)),
    check('win-share-spread', spread !== null && spread <= LEADER_BALANCE_ACCEPTANCE_THRESHOLDS.maximumWinShareSpread, spread === null ? null : spread * 100, { maximum: LEADER_BALANCE_ACCEPTANCE_THRESHOLDS.maximumWinShareSpread * 100 }),
    check('active-ability-usage', activity.passes, activity.minimumValue, { minimum: LEADER_BALANCE_ACCEPTANCE_THRESHOLDS.minimumMeanActiveAbilities }, activity.failingLeaders),
    check('leader-recruitment-usage', recruitment.passes, recruitment.minimumValue, { minimum: LEADER_BALANCE_ACCEPTANCE_THRESHOLDS.minimumMeanRecruitedLeaderUnits }, recruitment.failingLeaders),
    check('leader-building-usage', buildings.passes, buildings.minimumValue, { minimum: LEADER_BALANCE_ACCEPTANCE_THRESHOLDS.minimumMeanLeaderBuildings }, buildings.failingLeaders),
  ];
  return { status: checks.every(item => item.passes) ? 'pass' : 'fail', thresholds: LEADER_BALANCE_ACCEPTANCE_THRESHOLDS, checks };
}

export function runLeaderBalance(config: LeaderBalanceConfig, context?: { command?: string[]; nodeVersion?: string; gitHead?: string | null }): LeaderBalanceReport {
  const seedStart = config.seedStart ?? 1;
  const matches = leaderBalanceCases(config);
  const games = matches.map(match => simulateLeaderCase(match));
  const aggregate = aggregateLeaderGames(games);
  const content = contentFor(config);
  const scheduleSha256 = createHash('sha256').update(canonicalSerialize(matches)).digest('hex');
  const toolSha256 = createHash('sha256').update(readFileSync(new URL('./leader-balance.ts', import.meta.url))).digest('hex');
  const contentJson = JSON.parse(JSON.stringify(content));
  const contentSha256 = createHash('sha256').update(canonicalSerialize(contentJson)).digest('hex');
  return {
    schemaVersion: 1,
    metadata: {
      command: context?.command ?? ['node', 'tools/leader-balance.ts', '--seeds', String(config.seeds), '--seed-start', String(seedStart), '--expansion', config.expansionVersion === 1 ? 'true' : 'false', '--round-limit', String(config.roundLimit)],
      nodeVersion: context?.nodeVersion ?? process.version,
      gitHead: context?.gitHead ?? null,
      config, seedStart, seedValues: Array.from({ length: config.seeds }, (_, index) => seedStart + index), expansion: config.expansionVersion === 1,
      eraProgression: eraCliValue(config.eraProgression), gamesPlanned: matches.length,
      scheduleSha256, toolSha256, contentVersion: content.version, contentSha256, deterministic: true,
    },
    aggregate,
    acceptance: evaluateLeaderBalanceAcceptance(aggregate, matches.length),
    warnings: [
      `样本仅 ${config.seeds} 个地图种子 × ${PERSONALITIES.length} 种性格 × ${leaderRoster(config).length} 个座位轮换，不能推断校准完成或长期平衡。`,
      '同一种子与性格的四局共享地形、初始位置和初始随机流；胜负观测不是互相独立的地图样本。',
      '本工具只诊断现有规则，不调整任何数值，也不覆盖不同人类操作、多人网络局或主动技能路线。',
      ...(config.eraProgression === undefined ? [] : [`本批显式选择时代进度：${eraCliValue(config.eraProgression)}；时间分段基于科技完成数量，不等同于完整时代规则。`]),
    ],
    games,
  };
}

export function parseLeaderBalanceArgs(args: string[]): { config: LeaderBalanceConfig; output?: string } {
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!['--seeds', '--seed-start', '--expansion', '--eras', '--gameplay', '--round-limit', '--out'].includes(key)
      || !args[index + 1] || args[index + 1].startsWith('--') || Object.hasOwn(flags, key)) {
      throw new Error(`Usage: node tools/leader-balance.ts --seeds <1..100> [--seed-start <1..>] [--expansion <true|false>] [--eras <none|simple|full>] [--gameplay <0..14>] --round-limit <100|200|300> [--out <file.json>]`);
    }
    flags[key] = args[index + 1];
  }
  const seeds = Number(flags['--seeds'] ?? 2), seedStart = Number(flags['--seed-start'] ?? 1), roundLimit = Number(flags['--round-limit'] ?? 100);
  const expansion = flags['--expansion'] ?? 'false', era = flags['--eras'] ?? 'none';
  if (!Number.isSafeInteger(seeds) || seeds < 1 || seeds > 100 || !Number.isSafeInteger(seedStart) || seedStart < 1
    || !Number.isSafeInteger(seedStart + seeds - 1) || !['100', '200', '300'].includes(String(roundLimit))
    || !['true', 'false'].includes(expansion) || !['none', 'simple', 'full'].includes(era)) {
    throw new Error('Expected --seeds 1..100, --seed-start >=1, --expansion true|false, --eras none|simple|full, and --round-limit 100|200|300');
  }
  if (expansion === 'false' && era !== 'none') throw new Error('--eras simple|full requires --expansion true');
  const eraProgression = eraProgressionValue(era as 'none' | 'simple' | 'full');
  const gameplay = Number(flags['--gameplay'] ?? (eraProgression === null ? 0 : LATEST_GAMEPLAY_VERSION));
  if (!Number.isSafeInteger(gameplay) || gameplay < 0 || (gameplay !== 0 && !isGameplayVersion(gameplay)) || (gameplay > 0 && eraProgression === null)) throw new Error('--gameplay 1.. requires --eras simple|full');
  return {
    config: {
      seeds, seedStart, ...(expansion === 'true' ? { expansionVersion: 1 as const } : {}),
      ...(eraProgression === null ? {} : { eraProgression }), ...(gameplay > 0 ? { gameplayVersion: gameplay as GameplayVersion } : {}), roundLimit: roundLimit as RoundLimit, width: 24, height: 16,
    },
    output: flags['--out'],
  };
}

function formatNumber(value: number | null, digits = 2): string {
  return value === null ? '—' : value.toFixed(digits);
}
function formatAcceptanceLimits(check: { minimum?: number; maximum?: number }): string {
  if (check.minimum !== undefined && check.maximum !== undefined) return `${check.minimum}–${check.maximum}`;
  if (check.minimum !== undefined) return `≥ ${check.minimum}`;
  if (check.maximum !== undefined) return `≤ ${check.maximum}`;
  return '—';
}

export function renderLeaderBalanceMarkdown(report: LeaderBalanceReport): string {
  const a = report.aggregate, acceptance = report.acceptance ?? evaluateLeaderBalanceAcceptance(a, report.metadata.gamesPlanned);
  const rows = a.leaders.map(leader => `| ${leader.leaderId} | ${leader.observations} | ${formatNumber(leader.winShare.pointEstimate === null ? null : leader.winShare.pointEstimate * 100)}% (${formatNumber(leader.wilson95?.[0] === undefined ? null : leader.wilson95[0] * 100)}–${formatNumber(leader.wilson95?.[1] === undefined ? null : leader.wilson95[1] * 100)}%) | ${formatNumber(leader.meanScore.value)} | ${formatNumber(leader.meanRank.value)} | ${formatNumber(leader.meanCities.value)} | ${formatNumber(leader.meanPeakCities.value)} | ${formatNumber(leader.meanActiveAbilities.value)} | ${formatNumber(leader.meanRecruitedLeaderUnits.value)} | ${formatNumber(leader.meanLeaderBuildings.value)} | ${leader.eliminatedCount} |`).join('\n');
  const personalityRows = a.leaders.flatMap(leader => PERSONALITIES.map(personality => {
    const item = leader.byPersonality[personality];
    return `| ${leader.leaderId} | ${personality} | ${item.observations} | ${formatNumber(item.observations ? item.winCredit / item.observations * 100 : null)}% | ${formatNumber(item.meanScore)} |`;
  })).join('\n');

  const acceptanceRows = acceptance.checks.map(item => `| ${item.id} | ${formatAcceptanceLimits(item)} | ${item.value === null ? '—' : item.value.toFixed(2)} | ${item.passes ? '通过' : '失败'} | ${item.failingLeaders.join(', ') || '—'} |`).join('\n');
  const rankedLeaders = [...a.leaders].sort((x, y) => (y.winShare.pointEstimate ?? 0) - (x.winShare.pointEstimate ?? 0));
  const top = rankedLeaders[0], bottom = rankedLeaders.at(-1)!;
  const shareSummary = top.winShare.pointEstimate === null || bottom.winShare.pointEstimate === null
    ? '本批没有足够的完成局来计算领袖胜率；先解决运行健康问题，再解读平衡指标。'
    : `本批描述性胜利份额最高为 ${top.leaderId}（${(top.winShare.pointEstimate * 100).toFixed(2)}%），最低为 ${bottom.leaderId}（${(bottom.winShare.pointEstimate * 100).toFixed(2)}%）。两者的 Wilson 区间存在重叠或接近，且只有 ${report.metadata.config.seeds} 个地图种子，因此这只能作为下一批扩样方向，不能推出强度结论。`;
  const conquest = a.conquest;
  const conquestSection = conquest ? `
## 征服瓶颈诊断

- 发生城市攻击/城市占领/HQ攻击/HQ占领的完成局：${conquest.gamesWithCityAttack} / ${conquest.gamesWithCityCapture} / ${conquest.gamesWithHQAttack} / ${conquest.gamesWithHQCapture}
- 每个座位平均：城市攻击 ${formatNumber(conquest.meanResolvedCityAttacks)}，城市占领 ${formatNumber(conquest.meanCityCaptures)}，城市失去 ${formatNumber(conquest.meanCityLosses)}，HQ攻击 ${formatNumber(conquest.meanHQAttacks)}，HQ占领 ${formatNumber(conquest.meanHQCaptures)}
- 首次城市攻击/HQ攻击/攻城科技平均轮次：${formatNumber(conquest.meanFirstCityAttackRound)} / ${formatNumber(conquest.meanFirstHQAttackRound)} / ${formatNumber(conquest.meanSiegeCraftRound)}
- 淘汰事件：${conquest.eliminationEvents}；详细城市事件截断层：${conquest.cityEventLogTruncatedGames}
- 城市攻击角色：${JSON.stringify(conquest.cityAttacksByRole)}；城市占领角色：${JSON.stringify(conquest.cityCapturesByRole)}

这些是真实结算事件计数，不是从总攻击数反推。首次指标只对发生事件的座位取平均；没有事件时显示为空。` : '';
  const war = a.war;
  const warSection = war ? `
## 战争持续时间诊断

- 战争段/宣战/停战协议/终局仍处于战争：${war.episodes} / ${war.declarations} / ${formatNumber(war.peaceAgreements, 0)} / ${war.activeWarsAtEnd}
- 已结束战争段平均持续：${formatNumber(war.meanEpisodeDuration.value)} 轮
- 每个座位平均战争轮次：${formatNumber(war.meanWarRounds)}

战争段由外交状态从和平转战争开始，由转和平或终局收束；终局未和约会标记为 active-at-end。` : '';
  const progression = a.progression;
  const actualEraSection = progression?.eraArrivals ? `
## 实际时代到达诊断

- 到达指标来自每回合 \`eraState(player, setup.eraProgression).index\` 的首次出现轮次；第 1 轮初始时代会记录为 round 1。
- 全部座位到达汇总：${JSON.stringify(progression.eraArrivals)}
- 各领袖平均到达轮次和到达人数见下表；未启用时代规则时为空。

| 领袖 | ${Object.keys(progression.eraArrivals).map(index => `时代${index}`).join(' | ')} |
| --- | ${Object.keys(progression.eraArrivals).map(() => ' --- ').join('|')} |
${a.leaders.map(leader => `| ${leader.leaderId} | ${Object.keys(progression.eraArrivals).map(index => {
    const item = leader.eraArrivals?.[Number(index)];
    return item ? `${item.meanRound === null ? '—' : item.meanRound.toFixed(2)}（${item.reached}）` : '—';
  }).join(' | ')} |`).join('\n')}
` : '';
  const progressionSection = progression ? `
## 科技数量分段诊断（非实际时代）


- 报告配置：${report.metadata.eraProgression === 'none' ? '未启用时代规则' : `时代规则 ${report.metadata.eraProgression}`}
- 诊断分段按攻击方已完成科技数划分：0–3 项 early，4–6 项 middle，7 项及以上 late；这只是时间代理，明确不等同于实际时代。
- 城市攻击分段：${JSON.stringify(progression.cityAttacksByProgressionBand)}；城市占领分段：${JSON.stringify(progression.cityCapturesByProgressionBand)}
- 分段×角色城市攻击：${JSON.stringify(progression.cityAttacksByRoleAndProgressionBand)}
` : '';
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
- 模式：${report.metadata.expansion ? '扩展 v1' : '旧版'}；时代选项 ${report.metadata.eraProgression}；种子范围 ${report.metadata.seedValues[0]}–${report.metadata.seedValues.at(-1)!}
- 内容版本：${report.metadata.contentVersion}（SHA-256：${report.metadata.contentSha256}）

## 预注册验收

验收结论：**${acceptance.status === 'pass' ? '通过' : '未通过'}**。这些阈值是运行前设定的机械检查；Wilson 区间和座位轮换仅作描述，不能当作独立样本显著性证明。

| 检查 | 阈值 | 实际值 | 结果 | 未达标领袖 |
| --- | ---: | ---: | --- | --- |
${acceptanceRows}

## 本批观察

${shareSummary}${conquestSection}${warSection}${actualEraSection}${progressionSection}

## 领袖汇总

| 领袖 | 完成观测 | 胜利份额（描述性 95% Wilson 区间） | 平均终局分 | 平均排名 | 平均城市 | 峰值城市 | 平均技能 | 平均招募 | 平均建筑 | 被淘汰 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows}

## 性格分层

| 领袖 | 性格 | 观测 | 胜利份额 | 平均终局分 |
| --- | --- | ---: | ---: | ---: |
${personalityRows}

## 运行健康

- 完成/缺陷/中止：${a.completedGames} / ${a.defectGames} / ${a.abortedGames}
- 平分胜利局数：${a.splitWinGames}
- 结局分布：征服 ${a.outcomeKinds.conquest}，计分 ${a.outcomeKinds.score}，人类失败 ${a.outcomeKinds.playerDefeat}，图鉴 ${a.outcomeKinds.pokedex}，起源 ${a.outcomeKinds.origin}，冠军 ${a.outcomeKinds.championship}
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
