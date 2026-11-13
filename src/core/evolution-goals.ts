// Gameplay v26 P2 (docs/design/depth-v26.md §4.2): evolution goals — a Rare Candy evolution scores +1 instead of +2 (the `evolution`
// milestone still counts, `candyEvolution` takes one point back), and a "final evolution" milestone: +1 the first time a civilization
// evolves a Pokémon into the final form of a line (a line's last form: no further evolution, stone or otherwise), at most 3 per era.
// Stateless: "first" = the civilization had registered no final form of that line before this command. [] before v26.
import { stoneEvolutionsFor } from '../content/roster.ts';
import type { EraMilestone } from '../content/era-honors.ts';
import type { SpeciesId } from '../content/species.ts';
import type { Content } from '../content/units.ts';
import { contentFor } from '../content/units.ts';
import { evolutionOptions } from './roster.ts';
import type { EventPayload, GameState } from './model.ts';

export const FINAL_EVOLUTION_CAP_PER_ERA = 3;
type LineTables = { root: Map<SpeciesId, SpeciesId>; finals: Set<SpeciesId> };
const tables = new WeakMap<Content, LineTables>();
/** Root (first form) of every species' line and the set of final forms reached by evolution. */
export function evolutionLines(content: Content): LineTables {
  let cached = tables.get(content);
  if (cached) return cached;
  const parent = new Map<SpeciesId, SpeciesId>(), hasNext = new Set<SpeciesId>();
  for (const id of Object.keys(content.species) as SpeciesId[]) for (const option of evolutionOptions(content, id)) { parent.set(option.speciesId, id); hasNext.add(id); }
  for (const path of stoneEvolutionsFor(content)) if (content.species[path.fromSpeciesId] && content.species[path.intoSpeciesId]) { parent.set(path.intoSpeciesId, path.fromSpeciesId); hasNext.add(path.fromSpeciesId); }
  const root = new Map<SpeciesId, SpeciesId>(), finals = new Set<SpeciesId>();
  for (const id of Object.keys(content.species) as SpeciesId[]) {
    let first = id;
    for (let guard = 0; parent.has(first) && guard < 8; guard++) first = parent.get(first)!;
    root.set(id, first);
    if (parent.has(id) && !hasNext.has(id)) finals.add(id);
  }
  tables.set(content, cached = { root, finals });
  return cached;
}
/** Whether this evolution is a civilization's first final form of the line (from its registered species before the command). */
export function firstFinalOfLine(content: Content, registered: readonly SpeciesId[], into: SpeciesId): boolean {
  const { root, finals } = evolutionLines(content);
  return finals.has(into) && !registered.some(id => finals.has(id) && root.get(id) === root.get(into));
}
export function evolutionGoalMilestones(before: GameState, after: GameState, events: readonly EventPayload[]): [number, EraMilestone][] {
  if (!after.expansion?.eraHonors || !events.some(event => event.type === 'Evolved' || event.type === 'WorldStoneEvolution')) return [];
  const content = contentFor(after.setup);
  if (!content.evolutionGoals) return [];
  const found: [number, EraMilestone][] = [], finals: Record<number, number> = {};
  for (const event of events) {
    if (event.type !== 'Evolved' && event.type !== 'WorldStoneEvolution') continue;
    const into = event.type === 'Evolved' ? event.speciesId : event.intoSpeciesId, unit = before.units[event.unitId];
    // Rare Candy: the unit evolved short of the option's XP (stone evolutions never use candy).
    if (event.type === 'Evolved' && unit?.kind === 'pokemon') {
      const option = evolutionOptions(content, unit.speciesId).find(item => item.speciesId === into);
      if (option && unit.xp < option.xp) found.push([event.playerId, 'candyEvolution']);
    }
    const record = after.expansion.eraHonors.players[event.playerId], done = (record?.byMilestone.finalEvolution ?? 0) + (finals[event.playerId] ?? 0);
    if (done < FINAL_EVOLUTION_CAP_PER_ERA && firstFinalOfLine(content, before.players[event.playerId]?.registeredSpeciesIds ?? [], into)) {
      found.push([event.playerId, 'finalEvolution']);
      finals[event.playerId] = (finals[event.playerId] ?? 0) + 1;
    }
  }
  return found;
}
