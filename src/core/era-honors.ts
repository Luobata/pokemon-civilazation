// Gameplay v12: era score and golden / dark ages (Civilization 6 eras). Points come only from events
// already produced by other systems; the age of a new era is decided by the previous era's average.
import { ERA_AGES, ERA_HONOR_RULES, ERA_HONOR_RULES_V22, ERA_MILESTONES } from '../content/era-honors.ts';
import type { AgeLines, EraAge, EraMilestone } from '../content/era-honors.ts';
import { GYM_RULES_V24 } from '../content/gym-circuit.ts';
import { eraState, gameplayAtLeast } from '../content/eras.ts';
import type { PolicyEffects } from '../content/policies.ts';
import type { SpeciesId } from '../content/species.ts';
import type { EventPayload, GameState } from './model.ts';
import { blankDedication, dedicationDeeds, dedicationPicks, goldenDedicationEffects, isHeroic, promisePoints, usesDedications } from './dedications.ts';
import type { DedicationLedger } from './dedications.ts';
import type { DedicationId } from '../content/dedications.ts';

/** v22 only: `dedications` chosen in that era and `heroic` (absent before, so older states serialize unchanged). */
export type EraHonorRecord = { eraIndex: number; rounds: number; score: number; age: EraAge; dedications?: DedicationId[]; heroic?: true };
export type EraHonorPlayerState = {
  eraIndex: number; eraStartRound: number; score: number; age: EraAge;
  byMilestone: Partial<Record<EraMilestone, number>>;
  /** Finished eras, oldest first. */
  history: EraHonorRecord[];
  /** Gameplay v22 only: era dedications. */
  dedication?: DedicationLedger;
};
export type EraHonorState = { players: Record<number, EraHonorPlayerState> };
export type EraHonorView = EraHonorPlayerState & { goldenRatePermille: number; darkRatePermille: number; minimumRounds: number };
/** v22 adds `heroic` (when true) and `dedicationPicks` (cards to choose now). */
export type EraHonorEvent = { type: 'EraAgeBegan'; playerId: number; eraIndex: number; age: EraAge; previousScore: number; previousRounds: number; heroic?: true; dedicationPicks?: number };

export const usesEraHonors = (state: Pick<GameState, 'setup' | 'expansion'>) =>
  state.expansion !== undefined && state.setup.eraProgression !== undefined && gameplayAtLeast(state.setup, 12);

export function initializeEraHonors(state: GameState): void {
  if (!usesEraHonors(state)) return;
  const dedications = usesDedications(state);
  state.expansion!.eraHonors = { players: Object.fromEntries(state.turnOrder.map(id => [id,
    { eraIndex: 0, eraStartRound: state.round, score: 0, age: 'normal' as EraAge, byMilestone: {}, history: [], ...(dedications ? { dedication: blankDedication() } : {}) }])) };
}

/** Age chosen from an era's average points per round (integer permille math). */
export function ageFor(score: number, rounds: number, lines: AgeLines = ERA_HONOR_RULES): EraAge {
  if (rounds < ERA_HONOR_RULES.minimumRounds) return 'normal';
  const rate = Math.floor(score * 1000 / rounds);
  return rate >= lines.goldenRatePermille ? 'golden' : rate < lines.darkRatePermille ? 'dark' : 'normal';
}
/** v22 games (dedications) use their own golden / dark lines; older rules keep the v12 lines. */
export const ageLines = (state: Pick<GameState, 'setup' | 'expansion'>): AgeLines => usesDedications(state) ? ERA_HONOR_RULES_V22 : ERA_HONOR_RULES;

const documentedCount = (state: GameState, playerId: number) => Object.values(state.expansion?.world.players[playerId]?.pokedex ?? {} as Record<SpeciesId, { observed: boolean; battled: boolean; captured: boolean }>)
  .filter(record => record.observed && (record.battled || record.captured)).length;

/** Milestones in one transaction, attributed to the acting civilization. */
function milestones(before: GameState, after: GameState, events: readonly EventPayload[]): [number, EraMilestone][] {
  const found: [number, EraMilestone][] = [];
  const owner = (cityId: number) => after.cities[cityId]?.ownerId ?? null;
  for (const event of events) {
    switch (event.type) {
      case 'CityFounded': { const id = owner(event.cityId); if (id !== null) found.push([id, 'cityFounded']); break; }
      case 'DistrictCompleted': { const id = owner(event.cityId); if (id !== null) found.push([id, 'districtCompleted']); break; }
      case 'Evolved': case 'WorldStoneEvolution': found.push([event.playerId, 'evolution']); break;
      case 'Captured': if (event.success) found.push([event.playerId, 'capture']); break;
      case 'CharterAdopted': found.push([event.playerId, 'charterAdopted']); break;
      case 'WorldNestCleared': found.push([event.playerId, 'nestCleared']); break;
      case 'SanctuaryEstablished': found.push([event.playerId, 'sanctuaryEstablished']); break;
      case 'GuardianChallenged': if (event.victory) found.push([event.playerId, 'guardianDefeated']); break;
      case 'FaithFounded': found.push([event.playerId, 'faithFounded']); break;
      case 'ContestHallBuilt': found.push([event.playerId, 'contestHallBuilt']); break;
      case 'DiscoveryMade': found.push([event.playerId, 'discovery']); break;
      case 'LegendWonderCompleted': found.push([event.playerId, 'legendWonder']); break;
      // v24 B / C: badges 1, 4 and 8; the Elite Four; a rival's n-th visit beaten scores n points.
      case 'GymChallenged': if (event.victory && (GYM_RULES_V24.eraBadges as readonly number[]).includes(event.badges)) found.push([event.playerId, 'gymBadge']); break;
      case 'EliteFourChallenged': if (event.victory) found.push([event.playerId, 'eliteFour']); break;
      case 'RivalDefeated': for (let visit = 0; visit < event.encounter; visit++) found.push([event.playerId, 'rivalDefeated']); break;
      case 'BattleResolved':
        if (event.capturedCity && event.target.kind === 'city') { const id = owner(event.target.id); if (id !== null) found.push([id, 'cityCaptured']); }
        break;
      default: break;
    }
  }
  for (const playerId of after.turnOrder) {
    const gained = documentedCount(after, playerId) - documentedCount(before, playerId);
    for (let index = 0; index < gained; index++) found.push([playerId, 'documentedSpecies']);
  }
  return found;
}

/** Called once per command after every other system: adds points, then starts new eras' ages. */
export function recordEraHonors(before: GameState, after: GameState, events: readonly EventPayload[]): EventPayload[] {
  const ledger = after.expansion?.eraHonors;
  if (!ledger) return [];
  const found = milestones(before, after, events);
  for (const [playerId, milestone] of found) {
    const record = ledger.players[playerId];
    if (!record) continue;
    record.score += ERA_MILESTONES[milestone].points;
    record.byMilestone[milestone] = (record.byMilestone[milestone] ?? 0) + 1;
  }
  // v22: the chosen dedications' promises add to the same era score.
  if (Object.values(ledger.players).some(record => record.dedication)) for (const [playerId, deed] of dedicationDeeds(before, after, events, found)) {
    const record = ledger.players[playerId];
    if (!record?.dedication) continue;
    for (const [id, points] of promisePoints(record, deed)) {
      record.score += points;
      record.dedication.progress[id] = (record.dedication.progress[id] ?? 0) + points;
    }
  }
  const output: EventPayload[] = [];
  for (const playerId of [...after.turnOrder].sort((a, b) => a - b)) {
    const record = ledger.players[playerId], player = after.players[playerId];
    if (!record || player.eliminated) continue;
    const index = eraState(player, after.setup.eraProgression)?.index ?? 0;
    if (index === record.eraIndex) continue;
    const rounds = after.round - record.eraStartRound;
    const age = ageFor(record.score, rounds, ageLines(after));
    if (record.dedication) {
      // v22: the finished era remembers its cards; the new one asks for 1 card (3 in a heroic age).
      const heroic = isHeroic(record.age, age), picks = dedicationPicks(age, heroic);
      record.history.push({ eraIndex: record.eraIndex, rounds, score: record.score, age: record.age, dedications: [...record.dedication.chosen], ...(record.dedication.heroic ? { heroic: true as const } : {}) });
      output.push({ type: 'EraAgeBegan', playerId, eraIndex: index, age, previousScore: record.score, previousRounds: rounds, ...(heroic ? { heroic: true as const } : {}), dedicationPicks: picks });
      Object.assign(record, { eraIndex: index, eraStartRound: after.round, score: 0, age, byMilestone: {}, dedication: { pending: picks, heroic, chosen: [], progress: {} } });
      continue;
    }
    record.history.push({ eraIndex: record.eraIndex, rounds, score: record.score, age: record.age });
    output.push({ type: 'EraAgeBegan', playerId, eraIndex: index, age, previousScore: record.score, previousRounds: rounds });
    Object.assign(record, { eraIndex: index, eraStartRound: after.round, score: 0, age, byMilestone: {} });
  }
  return output;
}

/** Round effect of the current age on satisfaction (other effects are read where they apply). */
export function resolveEraHonorRound(state: GameState): EventPayload[] {
  const ledger = state.expansion?.eraHonors;
  if (!ledger) return [];
  for (const playerId of [...state.turnOrder].sort((a, b) => a - b)) {
    const record = ledger.players[playerId], world = state.expansion!.world.players[playerId];
    if (!record || !world || state.players[playerId].eliminated) continue;
    const delta = ERA_AGES[record.age].satisfaction + goldenDedicationEffects(record).satisfaction;
    if (delta) world.satisfaction = Math.max(0, Math.min(100, world.satisfaction + delta));
  }
  return [];
}

export function eraAgeOf(state: Pick<GameState, 'expansion'>, playerId: number): EraAge {
  return state.expansion?.eraHonors?.players[playerId]?.age ?? 'normal';
}
export const ageEffects = (age: EraAge | undefined): PolicyEffects => age ? ERA_AGES[age].policy : {};
export const ageLeaguePoints = (age: EraAge | undefined): number => age ? ERA_AGES[age].leaguePoints : 0;
type AgeHolder = { age: EraAge; dedication?: DedicationLedger } | undefined;
/** Effects of an era-honor record (state or view). v22: a golden age's fixed bonus is replaced by the chosen cards' golden effects. */
export function honorEffects(record: AgeHolder): PolicyEffects {
  if (!record?.dedication) return ageEffects(record?.age);
  return record.age === 'golden' ? goldenDedicationEffects(record).policy : ageEffects(record.age);
}
export function honorLeaguePoints(record: AgeHolder): number {
  if (!record?.dedication) return ageLeaguePoints(record?.age);
  return record.age === 'golden' ? goldenDedicationEffects(record).leaguePoints : ageLeaguePoints(record.age);
}
export const eraHonorRecord = (state: Pick<GameState, 'expansion'>, playerId: number) => state.expansion?.eraHonors?.players[playerId];

export function observeEraHonors(state: GameState, playerId: number): EraHonorView | undefined {
  const record = state.expansion?.eraHonors?.players[playerId];
  if (!record) return undefined;
  const lines = ageLines(state);
  return { ...(JSON.parse(JSON.stringify(record)) as EraHonorPlayerState), goldenRatePermille: lines.goldenRatePermille,
    darkRatePermille: lines.darkRatePermille, minimumRounds: ERA_HONOR_RULES.minimumRounds };
}
