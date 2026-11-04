// Gameplay v12: era score and golden / dark ages (Civilization 6 eras). Points come only from events
// already produced by other systems; the age of a new era is decided by the previous era's average.
import { ERA_AGES, ERA_HONOR_RULES, ERA_MILESTONES } from '../content/era-honors.ts';
import type { EraAge, EraMilestone } from '../content/era-honors.ts';
import { eraState, gameplayAtLeast } from '../content/eras.ts';
import type { PolicyEffects } from '../content/policies.ts';
import type { SpeciesId } from '../content/species.ts';
import type { EventPayload, GameState } from './model.ts';

export type EraHonorRecord = { eraIndex: number; rounds: number; score: number; age: EraAge };
export type EraHonorPlayerState = {
  eraIndex: number; eraStartRound: number; score: number; age: EraAge;
  byMilestone: Partial<Record<EraMilestone, number>>;
  /** Finished eras, oldest first. */
  history: EraHonorRecord[];
};
export type EraHonorState = { players: Record<number, EraHonorPlayerState> };
export type EraHonorView = EraHonorPlayerState & { goldenRatePermille: number; darkRatePermille: number; minimumRounds: number };
export type EraHonorEvent = { type: 'EraAgeBegan'; playerId: number; eraIndex: number; age: EraAge; previousScore: number; previousRounds: number };

export const usesEraHonors = (state: Pick<GameState, 'setup' | 'expansion'>) =>
  state.expansion !== undefined && state.setup.eraProgression !== undefined && gameplayAtLeast(state.setup, 12);

export function initializeEraHonors(state: GameState): void {
  if (!usesEraHonors(state)) return;
  state.expansion!.eraHonors = { players: Object.fromEntries(state.turnOrder.map(id => [id,
    { eraIndex: 0, eraStartRound: state.round, score: 0, age: 'normal' as EraAge, byMilestone: {}, history: [] }])) };
}

/** Age chosen from an era's average points per round (integer permille math). */
export function ageFor(score: number, rounds: number): EraAge {
  if (rounds < ERA_HONOR_RULES.minimumRounds) return 'normal';
  const rate = Math.floor(score * 1000 / rounds);
  return rate >= ERA_HONOR_RULES.goldenRatePermille ? 'golden' : rate < ERA_HONOR_RULES.darkRatePermille ? 'dark' : 'normal';
}

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
  for (const [playerId, milestone] of milestones(before, after, events)) {
    const record = ledger.players[playerId];
    if (!record) continue;
    record.score += ERA_MILESTONES[milestone].points;
    record.byMilestone[milestone] = (record.byMilestone[milestone] ?? 0) + 1;
  }
  const output: EventPayload[] = [];
  for (const playerId of [...after.turnOrder].sort((a, b) => a - b)) {
    const record = ledger.players[playerId], player = after.players[playerId];
    if (!record || player.eliminated) continue;
    const index = eraState(player, after.setup.eraProgression)?.index ?? 0;
    if (index === record.eraIndex) continue;
    const rounds = after.round - record.eraStartRound;
    const age = ageFor(record.score, rounds);
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
    const delta = ERA_AGES[record.age].satisfaction;
    if (delta) world.satisfaction = Math.max(0, Math.min(100, world.satisfaction + delta));
  }
  return [];
}

export function eraAgeOf(state: Pick<GameState, 'expansion'>, playerId: number): EraAge {
  return state.expansion?.eraHonors?.players[playerId]?.age ?? 'normal';
}
export const ageEffects = (age: EraAge | undefined): PolicyEffects => age ? ERA_AGES[age].policy : {};
export const ageLeaguePoints = (age: EraAge | undefined): number => age ? ERA_AGES[age].leaguePoints : 0;

export function observeEraHonors(state: GameState, playerId: number): EraHonorView | undefined {
  const record = state.expansion?.eraHonors?.players[playerId];
  if (!record) return undefined;
  return { ...(JSON.parse(JSON.stringify(record)) as EraHonorPlayerState), goldenRatePermille: ERA_HONOR_RULES.goldenRatePermille,
    darkRatePermille: ERA_HONOR_RULES.darkRatePermille, minimumRounds: ERA_HONOR_RULES.minimumRounds };
}
