// Gameplay v26 D (docs/design/depth-v26.md §5.3): the legend-wonder race — which met civilizations build which legend, by stage
// (started < 50%, half 50–84%, final ≥ 85%; never rounds or cities, which would leak the builder's production), and the
// LegendWonderStarted events (start and final stage) sent to every civilization that has met the builder. "Met" = the viewer has seen
// the builder's territory or one of its cities (remembered tiles and cities in its own knowledge), so nothing beyond the fog is used.
import { LEGEND_WONDERS, legendCost } from '../content/legend-wonders.ts';
import type { LegendWonderId } from '../content/legend-wonders.ts';
import type { Content } from '../content/units.ts';
import { contentFor } from '../content/units.ts';
import type { EventPayload, GameState } from './model.ts';
import type { LegendView } from './legends.ts';

export type LegendRaceStage = 'started' | 'half' | 'final';
export type LegendRaceEntry = { legendId: LegendWonderId; playerId: number; stage: LegendRaceStage };
/** `playerId` is the recipient; `builderId` the civilization building (or about to finish) `legendId`. */
export type LegendRaceEvent = { type: 'LegendWonderStarted'; playerId: number; builderId: number; legendId: LegendWonderId; stage: 'started' | 'final' };

export const raceStage = (progress: number, cost: number): LegendRaceStage => progress * 100 >= 85 * cost ? 'final' : progress * 100 >= 50 * cost ? 'half' : 'started';
const RANK: Record<LegendRaceStage, number> = { started: 0, half: 1, final: 2 };
/** Every civilization's queued legend wonders (best stage per builder and legend). */
function raceEntries(state: GameState): LegendRaceEntry[] {
  const best = new Map<string, LegendRaceEntry>();
  for (const city of Object.values(state.cities).sort((a, b) => a.id - b.id)) {
    if (city.ownerId === null || state.players[city.ownerId]?.eliminated) continue;
    for (const order of city.queue) {
      if (order.item.kind !== 'legend') continue;
      const entry = { legendId: order.item.defId, playerId: city.ownerId, stage: raceStage(order.progress, legendCost(order.item.defId)) };
      const key = `${entry.playerId}:${entry.legendId}`, known = best.get(key);
      if (!known || RANK[entry.stage] > RANK[known.stage]) best.set(key, entry);
    }
  }
  return [...best.values()].sort((a, b) => LEGEND_WONDERS[a.legendId].dex - LEGEND_WONDERS[b.legendId].dex || a.playerId - b.playerId);
}
/** Whether `viewer` has met `other`: it remembers a tile of `other`'s territory or one of its cities. */
export function hasMet(state: GameState, viewer: number, other: number): boolean {
  if (viewer === other) return true;
  const knowledge = state.knowledge[viewer];
  if (!knowledge) return false;
  return Object.values(knowledge.lastKnownCities).some(city => city.ownerId === other)
    || Object.values(knowledge.rememberedTiles).some(tile => tile.territoryOwnerIds?.includes(other));
}
const usesRace = (state: GameState, content: Content) => Boolean(content.legendRace && state.expansion?.legends);
/** Met civilizations' legend wonders under way (the viewer's own are in `LegendView.building`); undefined before v26. */
export function observeLegendRace(state: GameState, playerId: number, content: Content = contentFor(state.setup)): LegendRaceEntry[] | undefined {
  if (!usesRace(state, content)) return undefined;
  return raceEntries(state).filter(entry => entry.playerId !== playerId && hasMet(state, playerId, entry.playerId));
}
export const withLegendRace = (view: LegendView | undefined, race: LegendRaceEntry[] | undefined): LegendView | undefined =>
  view && race ? { ...view, race } : view;
/** After every command that can move a wonder (queue changes, the round end): started / final-stage events for met civilizations. */
export function recordLegendRace(before: GameState, after: GameState, events: readonly EventPayload[], content: Content = contentFor(after.setup)): EventPayload[] {
  if (!usesRace(after, content) || after.outcome || !events.some(event => event.type === 'ProductionQueueChanged' || event.type === 'RoundEnded')) return [];
  const old = new Map(raceEntries(before).map(entry => [`${entry.playerId}:${entry.legendId}`, entry.stage]));
  const output: EventPayload[] = [];
  for (const entry of raceEntries(after)) {
    const was = old.get(`${entry.playerId}:${entry.legendId}`);
    const stage = was === undefined ? 'started' : entry.stage === 'final' && was !== 'final' ? 'final' : null;
    if (!stage) continue;
    for (const recipient of [...after.turnOrder].sort((a, b) => a - b)) {
      if (recipient === entry.playerId || after.players[recipient].eliminated || !hasMet(after, recipient, entry.playerId)) continue;
      output.push({ type: 'LegendWonderStarted', playerId: recipient, builderId: entry.playerId, legendId: entry.legendId, stage });
    }
  }
  return output;
}
