// Declarative lifecycle registry for all expansion subsystems (init, action dispatch, round resolution, event recording).
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import type { Content } from '../content/units.ts';
import { applyBondAction, initializeBonds, isBondAction, resolveBondRound, syncBonds, validateBondAction } from './bonds.ts';
import { applyCityNetworkAction, initializeCityNetwork, isCityNetworkAction, resolveCityNetworkRound, validateCityNetworkAction } from './city-network.ts';
import { applyCivilizationAction, initializeCivilization, isCivilizationAction, resolveCivilizationRound, validateCivilizationAction } from './civilization-systems.ts';
import { applyContestSeasonAction, initializeContestSeasons, isContestSeasonAction, resolveContestSeasonRound, validateContestSeasonAction } from './contest-seasons.ts';
import { applyContestAction, initializeContests, isContestAction, resolveContestRound, validateContestAction } from './contests.ts';
import { applyDedicationAction, isDedicationAction, validateDedicationAction } from './dedications.ts';
import { initializeDiscoveries, recordDiscoveries } from './discoveries.ts';
import { initializeDistricts } from './districts.ts';
import { applyEraAbilityAction, initializeEraAbilities, isEraAbilityAction, resolveEraAbilityRound, validateEraAbilityAction } from './era-abilities.ts';
import { initializeEraHonors, recordEraHonors, resolveEraHonorRound } from './era-honors.ts';
import { applyEssenceAction, initializeEssences, isEssenceAction, resolveEssenceRound, validateEssenceAction } from './essences.ts';
import { expansionActionType, parseExpansionAction } from './expansion-commands.ts';
import type { ExpansionState } from './expansion-model.ts';
import { applyFaithAction, initializeFaith, isFaithAction, resolveFaithRound, validateFaithAction } from './faith-legends.ts';
import { applyGoldSinkAction, initializeGoldSinks, isGoldSinkAction, resolveGoldSinkRound, validateGoldSinkAction } from './gold-sinks.ts';
import { applyGymCircuitAction, initializeGymCircuit, isGymCircuitAction, validateGymCircuitAction } from './gym-circuit.ts';
import { applyImprovementAction, initializeImprovements, isImprovementAction, resolveImprovementRound, validateImprovementAction } from './improvements.ts';
import { initializeLandmarks, recordLandmarks, resolveLandmarkRound } from './landmarks.ts';
import { applyLeaderAction, initializeLeaders, isLeaderAction, validateLeaderAction } from './leader-systems.ts';
import { recordLegendRace } from './legend-race.ts';
import { initializeLegends, recordLegends } from './legends.ts';
import { applyMaxRaidAction, isMaxRaidAction, validateMaxRaidAction } from './max-raids.ts';
import type { Command, EventPayload, GameState } from './model.ts';
import { recordOpeningGift } from './opening-gift.ts';
import { initializeOpening, recordOpening, resolveOpeningRound } from './opening.ts';
import { applyPillageAction, isPillageAction, validatePillageAction } from './pillage.ts';
import { applyPolicyAction, initializePolicies, isPolicyAction, resolvePolicyRound, validatePolicyAction } from './policies.ts';
import { applyPromotionAction, initializePromotions, isPromotionAction, recordPromotions, resolvePromotionRound, validatePromotionAction } from './promotions.ts';
import { initializeRaids, recordRaids, resolveRaidRound } from './raids.ts';
import { applyRareBerryAction, initializeRareBerries, isRareBerryAction, resolveRareBerryRound, validateRareBerryAction } from './rare-berries.ts';
import { landRule } from './reach.ts';
import { initializeResearchTasks, recordResearchTasks } from './research-tasks.ts';
import { applyRivalDuelAction, isRivalDuelAction, validateRivalDuelAction } from './rival-duels.ts';
import { initializeRivals, recordRivals, resolveRivalRound } from './rivals.ts';
import { initializeVictoryWatch, resolveVictoryWatchRound } from './victory-watch.ts';
import { initializeWildEncounters } from './wild-encounters.ts';
import { applyWorldAction, initializeWorld, isWorldAction, resolveWorldRound, updateWorldRecords, validateWorldAction } from './world-systems.ts';

type ActionDispatcher = {
  matches(action: Command['action']): boolean;
  validate(state: GameState, actorId: number, action: Command['action'], content: Content): string | null;
  apply(state: GameState, actorId: number, action: Command['action'], content: Content): EventPayload[];
};

/**
 * Recording visibility mode:
 * - `base`: sees only the base command events (outputs are merged into the cumulative stream afterwards)
 * - `cumulative`: sees the base events plus all earlier recorded events
 * - `base-only`: sees only the original base command events (appended at the end)
 */
type RecordMode = 'base' | 'cumulative' | 'base-only';

export type ExpansionSubsystem = {
  id: string;
  initOrder?: number;
  roundOrder?: number;
  recordOrder?: number;
  recordMode?: RecordMode;
  init?(state: GameState, content: Content): void;
  action?: ActionDispatcher;
  resolveRound?(state: GameState, content: Content): EventPayload[];
  record?(before: GameState, after: GameState, command: Command, events: readonly EventPayload[], content: Content): EventPayload[];
};

function actionHandler<A extends Command['action']>(
  matches: (action: Command['action']) => action is A,
  validate: (state: GameState, actorId: number, action: A, content: Content) => string | null,
  apply: (state: GameState, actorId: number, action: A, content: Content) => EventPayload[],
): ActionDispatcher {
  return {
    matches,
    validate: (state, actorId, action, content) => validate(state, actorId, action as A, content),
    apply: (state, actorId, action, content) => apply(state, actorId, action as A, content),
  };
}

const civContent = (content: Content) => ({ ...CIVILIZATION_CONTENT, world: content });

export const EXPANSION_SUBSYSTEMS: readonly ExpansionSubsystem[] = [
  {
    id: 'leaders', initOrder: 1,
    init: state => initializeLeaders(state),
    action: actionHandler(isLeaderAction, (s, a, act, c) => validateLeaderAction(s, a, act, c), (s, a, act, c) => applyLeaderAction(s, a, act, c)),
  },
  {
    id: 'world', initOrder: 2, roundOrder: 1, recordOrder: 10, recordMode: 'base',
    init: (state, content) => { initializeWorld(state, content); },
    action: actionHandler(isWorldAction, (s, a, act, c) => validateWorldAction(s, a, act, c), (s, a, act, c) => applyWorldAction(s, a, act, c)),
    resolveRound: (state, content) => resolveWorldRound(state, content),
    record: (before, after, command, events, content) => updateWorldRecords(before, after, command, events, content),
  },
  {
    id: 'civilization', initOrder: 3, roundOrder: 4,
    init: (state, content) => { initializeCivilization(state, civContent(content)); },
    action: actionHandler(isCivilizationAction, (s, a, act, c) => validateCivilizationAction(s, a, act, civContent(c)), (s, a, act, c) => applyCivilizationAction(s, a, act, civContent(c))),
    resolveRound: (state, content) => resolveCivilizationRound(state, civContent(content)),
  },
  {
    id: 'improvements', initOrder: 4, roundOrder: 9,
    init: state => initializeImprovements(state),
    action: actionHandler(isImprovementAction, (s, a, act, c) => validateImprovementAction(s, a, act, c), (s, a, act, c) => applyImprovementAction(s, a, act, c)),
    resolveRound: state => resolveImprovementRound(state),
  },
  {
    id: 'discoveries', initOrder: 5, recordOrder: 20, recordMode: 'cumulative',
    init: state => initializeDiscoveries(state),
    record: (before, after, command, events, content) => recordDiscoveries(before, after, command, events, content),
  },
  {
    id: 'policies', initOrder: 6, roundOrder: 5,
    init: state => initializePolicies(state),
    action: actionHandler(isPolicyAction, (s, a, act) => validatePolicyAction(s, a, act), (s, a, act) => applyPolicyAction(s, a, act)),
    resolveRound: state => resolvePolicyRound(state),
  },
  {
    id: 'essences', initOrder: 7, roundOrder: 6,
    init: state => initializeEssences(state),
    action: actionHandler(isEssenceAction, (s, a, act) => validateEssenceAction(s, a, act), (s, a, act) => applyEssenceAction(s, a, act)),
    resolveRound: state => resolveEssenceRound(state),
  },
  {
    id: 'eraAbilities', initOrder: 8, roundOrder: 7,
    init: state => initializeEraAbilities(state),
    action: actionHandler(isEraAbilityAction, (s, a, act, c) => validateEraAbilityAction(s, a, act, c), (s, a, act, c) => applyEraAbilityAction(s, a, act, c)),
    resolveRound: state => resolveEraAbilityRound(state),
  },
  {
    id: 'bonds', initOrder: 9, roundOrder: 14, recordOrder: 1, recordMode: 'base',
    init: state => initializeBonds(state),
    action: actionHandler(isBondAction, (s, a, act) => validateBondAction(s, a, act), (s, a, act) => applyBondAction(s, a, act)),
    resolveRound: state => resolveBondRound(state),
    record: (_before, after) => { syncBonds(after); return []; },
  },
  {
    id: 'rareBerries', initOrder: 10, roundOrder: 8,
    init: state => initializeRareBerries(state),
    action: actionHandler(isRareBerryAction, (s, a, act) => validateRareBerryAction(s, a, act), (s, a, act) => applyRareBerryAction(s, a, act)),
    resolveRound: state => resolveRareBerryRound(state),
  },
  {
    id: 'contests', initOrder: 11, roundOrder: 15,
    init: state => initializeContests(state),
    action: actionHandler(isContestAction, (s, a, act) => validateContestAction(s, a, act), (s, a, act) => applyContestAction(s, a, act)),
    resolveRound: (state, content) => resolveContestRound(state, content),
  },
  {
    id: 'faith', initOrder: 12, roundOrder: 16,
    init: state => initializeFaith(state),
    action: actionHandler(isFaithAction, (s, a, act) => validateFaithAction(s, a, act), (s, a, act) => applyFaithAction(s, a, act)),
    resolveRound: (state, content) => resolveFaithRound(state, content),
  },
  {
    id: 'districts', initOrder: 13,
    init: state => initializeDistricts(state),
  },
  {
    id: 'eraHonors', initOrder: 14, roundOrder: 10, recordOrder: 30, recordMode: 'cumulative',
    init: state => initializeEraHonors(state),
    resolveRound: state => resolveEraHonorRound(state),
    record: (before, after, _command, events) => recordEraHonors(before, after, events),
  },
  {
    id: 'promotions', initOrder: 15, roundOrder: 11, recordOrder: 2, recordMode: 'base',
    init: state => initializePromotions(state),
    action: actionHandler(isPromotionAction, (s, a, act) => validatePromotionAction(s, a, act), (s, a, act) => applyPromotionAction(s, a, act)),
    resolveRound: state => resolvePromotionRound(state),
    record: (_before, after, _command, events) => { recordPromotions(after, events); return []; },
  },
  {
    id: 'legends', initOrder: 16, recordOrder: 40, recordMode: 'cumulative',
    init: state => initializeLegends(state),
    record: (_before, after, _command, events, content) => recordLegends(after, events, content),
  },
  {
    id: 'cityNetwork', initOrder: 17, roundOrder: 12,
    init: state => initializeCityNetwork(state),
    action: actionHandler(isCityNetworkAction, (s, a, act) => validateCityNetworkAction(s, a, act), (s, a, act) => applyCityNetworkAction(s, a, act)),
    resolveRound: state => resolveCityNetworkRound(state),
  },
  {
    id: 'opening', initOrder: 18, roundOrder: 13, recordOrder: 50, recordMode: 'cumulative',
    init: state => initializeOpening(state),
    resolveRound: state => resolveOpeningRound(state),
    record: (_before, after, _command, events) => recordOpening(after, events),
  },
  {
    id: 'landmarks', initOrder: 19, roundOrder: 3, recordOrder: 60, recordMode: 'cumulative',
    init: (state, content) => initializeLandmarks(state, content),
    resolveRound: (state, content) => resolveLandmarkRound(state, content),
    record: (_before, after, _command, events) => recordLandmarks(after, events),
  },
  {
    id: 'gymCircuit', initOrder: 20,
    init: (state, content) => initializeGymCircuit(state, content, landRule(state.map)),
    action: actionHandler(isGymCircuitAction, (s, a, act, c) => validateGymCircuitAction(s, a, act, c), (s, a, act, c) => applyGymCircuitAction(s, a, act, c)),
  },
  {
    id: 'rivals', initOrder: 21, roundOrder: 2, recordOrder: 11, recordMode: 'base',
    init: (state, content) => initializeRivals(state, content),
    resolveRound: (state, content) => resolveRivalRound(state, content, landRule(state.map)),
    record: (before, after, _command, events) => recordRivals(before, after, events),
  },
  {
    id: 'researchTasks', initOrder: 22, recordOrder: 70, recordMode: 'cumulative',
    init: (state, content) => initializeResearchTasks(state, content),
    record: (before, after, _command, events) => recordResearchTasks(before, after, events),
  },
  {
    id: 'raids', initOrder: 23, roundOrder: 19, recordOrder: 81, recordMode: 'base-only',
    init: (state, content) => initializeRaids(state, content),
    resolveRound: (state, content) => resolveRaidRound(state, content),
    record: (before, after, _command, events, content) => recordRaids(before, after, events, content),
  },
  {
    id: 'victoryWatch', initOrder: 24, roundOrder: 20,
    init: (state, content) => initializeVictoryWatch(state, content),
    resolveRound: (state, content) => resolveVictoryWatchRound(state, content),
  },
  {
    id: 'goldSinks', initOrder: 25, roundOrder: 17,
    init: (state, content) => initializeGoldSinks(state, content),
    action: actionHandler(isGoldSinkAction, (s, a, act, c) => validateGoldSinkAction(s, a, act, c), (s, a, act, c) => applyGoldSinkAction(s, a, act, c)),
    resolveRound: (state, content) => resolveGoldSinkRound(state, content),
  },
  {
    id: 'contestSeasons', initOrder: 26, roundOrder: 18,
    init: (state, content) => initializeContestSeasons(state, content),
    action: actionHandler(isContestSeasonAction, (s, a, act, c) => validateContestSeasonAction(s, a, act, c), (s, a, act, c) => applyContestSeasonAction(s, a, act, c)),
    resolveRound: (state, content) => resolveContestSeasonRound(state, content),
  },
  {
    id: 'wildEncounters', initOrder: 27,
    init: (state, content) => initializeWildEncounters(state, content),
  },
  {
    id: 'dedications',
    action: actionHandler(isDedicationAction, (s, a, act) => validateDedicationAction(s, a, act), (s, a, act) => applyDedicationAction(s, a, act)),
  },
  {
    id: 'pillage',
    action: actionHandler(isPillageAction, (s, a, act, c) => validatePillageAction(s, a, act, c), (s, a, act, c) => applyPillageAction(s, a, act, c)),
  },
  {
    id: 'rivalDuels',
    action: actionHandler(isRivalDuelAction, (s, a, act, c) => validateRivalDuelAction(s, a, act, c), (s, a, act, c) => applyRivalDuelAction(s, a, act, c)),
  },
  {
    id: 'maxRaids',
    action: actionHandler(isMaxRaidAction, (s, a, act, c) => validateMaxRaidAction(s, a, act, c), (s, a, act, c) => applyMaxRaidAction(s, a, act, c)),
  },
  {
    id: 'legendRace', recordOrder: 80, recordMode: 'base-only',
    record: (before, after, _command, events, content) => recordLegendRace(before, after, events, content),
  },
  {
    id: 'openingGift', recordOrder: 82, recordMode: 'base-only',
    record: (before, after, _command, events, content) => recordOpeningGift(before, after, events, content),
  },
];

const INIT_SUBSYSTEMS = EXPANSION_SUBSYSTEMS.filter(s => s.init && s.initOrder !== undefined).sort((a, b) => a.initOrder! - b.initOrder!);
const ACTION_SUBSYSTEMS = EXPANSION_SUBSYSTEMS.filter(s => s.action !== undefined);
const ROUND_SUBSYSTEMS = EXPANSION_SUBSYSTEMS.filter(s => s.resolveRound && s.roundOrder !== undefined).sort((a, b) => a.roundOrder! - b.roundOrder!);
const RECORD_SUBSYSTEMS = EXPANSION_SUBSYSTEMS.filter(s => s.record && s.recordOrder !== undefined).sort((a, b) => a.recordOrder! - b.recordOrder!);

export function initializeExpansion(state: GameState, content: Content): void {
  // The initializer is an unpublished transaction; each module fills its typed ledger in deterministic order.
  state.expansion = { version: 1 } as ExpansionState;
  for (const subsystem of INIT_SUBSYSTEMS) subsystem.init!(state, content);
}

export function validateExpansionAction(state: GameState, actorId: number, action: Command['action'], content: Content): boolean {
  if (!state.expansion || !expansionActionType(action.type)) return false;
  try {
    const clean = parseExpansionAction(action, content);
    for (const subsystem of ACTION_SUBSYSTEMS) {
      if (subsystem.action!.matches(clean)) return subsystem.action!.validate(state, actorId, clean, content) === null;
    }
  } catch { return false; }
  return false;
}

export function applyExpansionAction(state: GameState, actorId: number, action: Command['action'], content: Content): EventPayload[] {
  for (const subsystem of ACTION_SUBSYSTEMS) {
    if (subsystem.action!.matches(action)) return subsystem.action!.apply(state, actorId, action, content);
  }
  return [];
}

export function resolveExpansionRound(state: GameState, content: Content): EventPayload[] {
  if (!state.expansion || state.outcome) return [];
  const events: EventPayload[] = [];
  for (const subsystem of ROUND_SUBSYSTEMS) {
    if (state.outcome) break;
    events.push(...subsystem.resolveRound!(state, content));
  }
  return events;
}

export function recordExpansion(before: GameState, after: GameState, command: Command, events: readonly EventPayload[], content: Content): EventPayload[] {
  if (!after.expansion) return [];
  const produced: EventPayload[] = [];
  const cumulative: EventPayload[] = [...events];
  const baseBatch: EventPayload[] = [];
  let flushedBase = false;
  for (const subsystem of RECORD_SUBSYSTEMS) {
    const mode = subsystem.recordMode ?? 'cumulative';
    if (mode === 'cumulative' && !flushedBase) {
      cumulative.push(...baseBatch);
      flushedBase = true;
    }
    const input = mode === 'cumulative' ? cumulative : events;
    const emitted = subsystem.record!(before, after, command, input, content);
    if (!emitted.length) continue;
    produced.push(...emitted);
    if (mode === 'base') baseBatch.push(...emitted);
    else if (mode === 'cumulative') cumulative.push(...emitted);
  }
  return produced;
}
