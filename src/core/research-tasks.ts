// Gameplay v24 D (docs/design/world-v24.md §5): per-species research cards (seen, knock out 2, capture, see an evolution, special condition).
// Kept in its own ledger, apart from the Pokédex victory records (world.players[].pokedex), so the Pokédex victory never counts them.
// Scaffolding: no ledger yet, so no task completes and no bonus applies.
/* eslint-disable @typescript-eslint/no-unused-vars -- scaffolding signatures; feature D fills them in and removes this line. */
import type { ResearchTaskId } from '../content/research-tasks.ts';
import type { SpeciesId } from '../content/species.ts';
import type { Content } from '../content/units.ts';
import type { EventPayload, GameState, PlayerView } from './model.ts';

/** Per player, per species: completed tasks (bit i = RESEARCH_TASK_IDS[i]) and knockouts counted so far. */
export type ResearchTaskState = Record<number, Partial<Record<SpeciesId, { tasks: number; knockouts: number }>>>;
export type ResearchTaskView = Partial<Record<SpeciesId, { tasks: number; knockouts: number }>>;
export type ResearchTaskEvent = { type: 'ResearchTaskCompleted'; playerId: number; speciesId: SpeciesId; task: ResearchTaskId; tasksDone: number };

export function initializeResearchTasks(state: GameState, content: Content): void {
  if (!content.researchTasks || !state.expansion) return;
}
/** Per command (recordExpansion), from that command's events and the vision at the time. */
export function recordResearchTasks(before: GameState, after: GameState, events: readonly EventPayload[]): EventPayload[] {
  if (!after.expansion?.researchTasks) return [];
  return [];
}
/** Capture chance bonus from a card with 4+ tasks (shared by authority and preview). */
export function researchCaptureBonus(state: Pick<GameState, 'expansion'>, playerId: number, speciesId: SpeciesId): number {
  return 0;
}
export function viewResearchCaptureBonus(view: Pick<PlayerView, 'expansion'>, speciesId: SpeciesId): number {
  return 0;
}
export function observeResearchTasks(state: GameState, playerId: number): ResearchTaskView | undefined {
  const ledger = state.expansion?.researchTasks;
  return ledger ? JSON.parse(JSON.stringify(ledger[playerId] ?? {})) as ResearchTaskView : undefined;
}
