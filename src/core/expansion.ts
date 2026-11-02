import { CIVILIZATION_CONTENT } from '../content/civilization-systems.ts';
import type { Content } from '../content/units.ts';
import type { Command, EventPayload, GameState } from './model.ts';
import type { ExpansionState } from './expansion-model.ts';
import { expansionActionType, parseExpansionAction } from './expansion-commands.ts';
import { applyLeaderAction, initializeLeaders, isLeaderAction, validateLeaderAction } from './leader-systems.ts';
import { applyWorldAction, initializeWorld, isWorldAction, resolveWorldRound, updateWorldRecords, validateWorldAction } from './world-systems.ts';
import { initializeDiscoveries, recordDiscoveries } from './discoveries.ts';
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
}
export function validateExpansionAction(state: GameState, actorId: number, action: Command['action'], content: Content): boolean {
  if (!state.expansion || !expansionActionType(action.type)) return false;
  try {
    const clean = parseExpansionAction(action, content);
    if (isImprovementAction(clean)) return validateImprovementAction(state, actorId, clean) === null;
    if (isPolicyAction(clean)) return validatePolicyAction(state, actorId, clean) === null;
    if (isEssenceAction(clean)) return validateEssenceAction(state, actorId, clean) === null;
    if (isEraAbilityAction(clean)) return validateEraAbilityAction(state, actorId, clean, content) === null;
    if (isLeaderAction(clean)) return validateLeaderAction(state, actorId, clean, content) === null;
    if (isWorldAction(clean)) return validateWorldAction(state, actorId, clean, content) === null;
    if (isCivilizationAction(clean)) return validateCivilizationAction(state, actorId, clean, { ...CIVILIZATION_CONTENT, world: content }) === null;
  } catch { return false; }
  return false;
}
export function applyExpansionAction(state: GameState, actorId: number, action: Command['action'], content: Content): EventPayload[] {
  if (isImprovementAction(action)) return applyImprovementAction(state, actorId, action, content);
  if (isPolicyAction(action)) return applyPolicyAction(state, actorId, action);
  if (isEssenceAction(action)) return applyEssenceAction(state, actorId, action);
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
  return events;
}
export function recordExpansion(before: GameState, after: GameState, command: Command, events: readonly EventPayload[], content: Content): EventPayload[] {
  if (!after.expansion) return [];
  const world = updateWorldRecords(before, after, command, events, content);
  return [...world, ...recordDiscoveries(before, after, command, [...events, ...world], content)];
}
