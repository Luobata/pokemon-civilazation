import { initializeDistricts } from './districts.ts';
import { applyPromotionAction, initializePromotions, isPromotionAction, recordPromotions, resolvePromotionRound, validatePromotionAction } from './promotions.ts';
import { initializeEraHonors, recordEraHonors, resolveEraHonorRound } from './era-honors.ts';
import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import type { Content } from '../content/units.ts';
import type { Command, EventPayload, GameState } from './model.ts';
import type { ExpansionState } from './expansion-model.ts';
import { expansionActionType, parseExpansionAction } from './expansion-commands.ts';
import { applyLeaderAction, initializeLeaders, isLeaderAction, validateLeaderAction } from './leader-systems.ts';
import { applyWorldAction, initializeWorld, isWorldAction, resolveWorldRound, updateWorldRecords, validateWorldAction } from './world-systems.ts';
import { initializeDiscoveries, recordDiscoveries } from './discoveries.ts';
import { applyFaithAction, initializeFaith, isFaithAction, resolveFaithRound, validateFaithAction } from './faith-legends.ts';
import { applyContestAction, initializeContests, isContestAction, resolveContestRound, validateContestAction } from './contests.ts';
import { applyRareBerryAction, initializeRareBerries, isRareBerryAction, resolveRareBerryRound, validateRareBerryAction } from './rare-berries.ts';
import { applyBondAction, initializeBonds, isBondAction, resolveBondRound, syncBonds, validateBondAction } from './bonds.ts';
import { applyEraAbilityAction, initializeEraAbilities, isEraAbilityAction, resolveEraAbilityRound, validateEraAbilityAction } from './era-abilities.ts';
import { applyEssenceAction, initializeEssences, isEssenceAction, resolveEssenceRound, validateEssenceAction } from './essences.ts';
import { applyPolicyAction, initializePolicies, isPolicyAction, resolvePolicyRound, validatePolicyAction } from './policies.ts';
import { applyImprovementAction, initializeImprovements, isImprovementAction, validateImprovementAction } from './improvements.ts';
import { applyCivilizationAction, initializeCivilization, isCivilizationAction, resolveCivilizationRound, validateCivilizationAction } from './civilization-systems.ts';

export function initializeExpansion(state: GameState, content: Content): void {
  // The initializer is an unpublished transaction; each module fills its typed ledger.
  state.expansion = { version: 1 } as ExpansionState;
  initializeLeaders(state);
  initializeWorld(state, content);
  initializeCivilization(state, { ...CIVILIZATION_CONTENT, world: content });
  initializeImprovements(state);
  initializeDiscoveries(state);
  initializePolicies(state);
  initializeEssences(state);
  initializeEraAbilities(state);
  initializeBonds(state);
  initializeRareBerries(state);
  initializeContests(state);
  initializeFaith(state);
  initializeDistricts(state);
  initializeEraHonors(state);
  initializePromotions(state);
}
export function validateExpansionAction(state: GameState, actorId: number, action: Command['action'], content: Content): boolean {
  if (!state.expansion || !expansionActionType(action.type)) return false;
  try {
    const clean = parseExpansionAction(action, content);
    if (isPromotionAction(clean)) return validatePromotionAction(state, actorId, clean) === null;
    if (isImprovementAction(clean)) return validateImprovementAction(state, actorId, clean) === null;
    if (isPolicyAction(clean)) return validatePolicyAction(state, actorId, clean) === null;
    if (isEssenceAction(clean)) return validateEssenceAction(state, actorId, clean) === null;
    if (isFaithAction(clean)) return validateFaithAction(state, actorId, clean) === null;
    if (isContestAction(clean)) return validateContestAction(state, actorId, clean) === null;
    if (isRareBerryAction(clean)) return validateRareBerryAction(state, actorId, clean) === null;
    if (isBondAction(clean)) return validateBondAction(state, actorId, clean) === null;
    if (isEraAbilityAction(clean)) return validateEraAbilityAction(state, actorId, clean, content) === null;
    if (isLeaderAction(clean)) return validateLeaderAction(state, actorId, clean, content) === null;
    if (isWorldAction(clean)) return validateWorldAction(state, actorId, clean, content) === null;
    if (isCivilizationAction(clean)) return validateCivilizationAction(state, actorId, clean, { ...CIVILIZATION_CONTENT, world: content }) === null;
  } catch { return false; }
  return false;
}
export function applyExpansionAction(state: GameState, actorId: number, action: Command['action'], content: Content): EventPayload[] {
  if (isPromotionAction(action)) return applyPromotionAction(state, actorId, action);
  if (isImprovementAction(action)) return applyImprovementAction(state, actorId, action, content);
  if (isPolicyAction(action)) return applyPolicyAction(state, actorId, action);
  if (isEssenceAction(action)) return applyEssenceAction(state, actorId, action);
  if (isFaithAction(action)) return applyFaithAction(state, actorId, action);
  if (isContestAction(action)) return applyContestAction(state, actorId, action);
  if (isRareBerryAction(action)) return applyRareBerryAction(state, actorId, action);
  if (isBondAction(action)) return applyBondAction(state, actorId, action);
  if (isEraAbilityAction(action)) return applyEraAbilityAction(state, actorId, action, content);
  if (isLeaderAction(action)) return applyLeaderAction(state, actorId, action, content);
  if (isWorldAction(action)) return applyWorldAction(state, actorId, action, content);
  if (isCivilizationAction(action)) return applyCivilizationAction(state, actorId, action, { ...CIVILIZATION_CONTENT, world: content });
  return [];
}
export function resolveExpansionRound(state: GameState, content: Content): EventPayload[] {
  if (!state.expansion || state.outcome) return [];
  const events = resolveWorldRound(state, content);
  if (!state.outcome) events.push(...resolveCivilizationRound(state, { ...CIVILIZATION_CONTENT, world: content }));
  if (!state.outcome) events.push(...resolvePolicyRound(state));
  if (!state.outcome) events.push(...resolveEssenceRound(state));
  if (!state.outcome) events.push(...resolveEraAbilityRound(state));
  if (!state.outcome) events.push(...resolveRareBerryRound(state));
  if (!state.outcome) events.push(...resolveEraHonorRound(state));
  if (!state.outcome) events.push(...resolvePromotionRound(state));
  if (!state.outcome) events.push(...resolveBondRound(state));
  if (!state.outcome) events.push(...resolveContestRound(state, content));
  if (!state.outcome) events.push(...resolveFaithRound(state, content));
  return events;
}
export function recordExpansion(before: GameState, after: GameState, command: Command, events: readonly EventPayload[], content: Content): EventPayload[] {
  if (!after.expansion) return [];
  syncBonds(after);
  recordPromotions(after, events);
  const world = updateWorldRecords(before, after, command, events, content);
  const discoveries = recordDiscoveries(before, after, command, [...events, ...world], content);
  return [...world, ...discoveries, ...recordEraHonors(before, after, [...events, ...world, ...discoveries])];
}
