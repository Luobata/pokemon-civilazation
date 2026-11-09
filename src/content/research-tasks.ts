// Gameplay v24 D (docs/design/world-v24.md §5): Pokédex research tasks per species and their small rewards.
// Scaffolding: the spec's numbers; no rule reads them yet.
export type ResearchTaskId = 'seen' | 'knockouts' | 'captured' | 'evolution' | 'special';
export const RESEARCH_TASK_IDS: readonly ResearchTaskId[] = ['seen', 'knockouts', 'captured', 'evolution', 'special'];
export const RESEARCH_TASK_RULES_V24 = {
  knockoutsNeeded: 2,
  /** Rewards by tasks completed on one card. */
  notesAt: 2, notesResearch: 4, captureAt: 4, captureBonus: 10, completeAt: 5, completeGold: 15, completeEraScore: 1, eraScoreCapPerEra: 3,
} as const;
