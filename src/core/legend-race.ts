// Gameplay v26 D (docs/design/depth-v26.md §5.3): the legend-wonder race — which met civilizations build which legend, by stage
// (started / half / final; never rounds or cities), and the LegendWonderStarted events. Stub for the late-game lane.
import type { LegendWonderId } from '../content/legend-wonders.ts';
import type { EventPayload, GameState } from './model.ts';

export type LegendRaceEntry = { legendId: LegendWonderId; playerId: number; stage: 'started' | 'half' | 'final' };
export type LegendRaceEvent = never;
/** Met civilizations' legend wonders under way (the lane adds it to the legend view as `race`); undefined before v26. */
export function observeLegendRace(state: GameState, playerId: number): LegendRaceEntry[] | undefined {
  void state; void playerId;
  return undefined;
}
/** After every command: started / final-stage events for met civilizations. */
export function recordLegendRace(before: GameState, after: GameState, events: readonly EventPayload[]): EventPayload[] {
  void before; void after; void events;
  return [];
}
