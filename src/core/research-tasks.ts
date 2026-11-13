// Gameplay v24 D (docs/design/world-v24.md §5): per-species research cards (seen, knock out 2, capture, see an evolution, special condition).
// Kept in its own ledger, apart from the Pokédex victory records (world.players[].pokedex), so the Pokédex victory never counts them.
// Progress is private: each player's card only records what that player did or saw; events go to that player alone.
import { RESEARCH_TASK_IDS, RESEARCH_TASK_RULES_V24, researchSpecialFor } from '../content/research-tasks.ts';
import type { ResearchTaskId } from '../content/research-tasks.ts';
import { isNight } from '../content/era-abilities.ts';
import { isRegionalSpecies, spawnWeightsFor } from '../content/roster.ts';
import type { BiomeId } from '../content/rules.ts';
import type { SpeciesId } from '../content/species.ts';
import { contentFor } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import { combatContext, weatherAt } from './era-abilities.ts';
import { hexToIndex } from './hex.ts';
import type { Hex } from './hex.ts';
import { isMapUnit } from './model.ts';
import type { EventPayload, GameState, PlayerView } from './model.ts';
import { visibleTiles } from './vision.ts';
import type { FeatureMap } from './terrain.ts';
import { tileHabitatWeights } from './wild.ts';

export type ResearchCard = { tasks: number; knockouts: number };
/** Per player, per species: completed tasks (bit i = RESEARCH_TASK_IDS[i]) and knockouts counted so far. */
export type ResearchTaskState = Record<number, Partial<Record<SpeciesId, ResearchCard>>>;
export type ResearchTaskView = Partial<Record<SpeciesId, ResearchCard>>;
/** One-off rewards granted by the completion that reached 2 / 4 / 5 tasks on the card. */
export type ResearchReward = { research?: number; captureBonus?: number; gold?: number; eraScore?: number };
export type ResearchTaskEvent = { type: 'ResearchTaskCompleted'; playerId: number; speciesId: SpeciesId; task: ResearchTaskId; tasksDone: number; reward?: ResearchReward };

const R = RESEARCH_TASK_RULES_V24;
const bit = (task: ResearchTaskId) => 1 << RESEARCH_TASK_IDS.indexOf(task);
/** Number of tasks done on a card mask. */
export function tasksDone(mask: number): number {
  let count = 0;
  for (let rest = mask; rest; rest >>= 1) count += rest & 1;
  return count;
}
export const hasTask = (card: ResearchCard | undefined, task: ResearchTaskId) => Boolean(card && card.tasks & bit(task));

const preEvolutionCache = new WeakMap<Content, Map<SpeciesId, SpeciesId[]>>();
/** Species that evolve into `speciesId` (direct parents), from the content's evolution and branch tables. */
function preEvolutions(content: Content, speciesId: SpeciesId): SpeciesId[] {
  let map = preEvolutionCache.get(content);
  if (!map) {
    map = new Map();
    for (const [from, definition] of Object.entries(content.species) as [SpeciesId, Content['species'][SpeciesId]][]) {
      for (const into of [definition.evolution?.speciesId, ...(definition.branches ?? []).map(option => option.speciesId)]) {
        if (!into) continue;
        const list = map.get(into) ?? [];
        if (!list.includes(from)) list.push(from);
        map.set(into, list);
      }
    }
    preEvolutionCache.set(content, map);
  }
  return map.get(speciesId) ?? [];
}
/** The species and its earlier forms. */
function speciesFamily(content: Content, speciesId: SpeciesId): SpeciesId[] {
  const family: SpeciesId[] = [], queue = [speciesId];
  while (queue.length) {
    const next = queue.shift()!;
    if (family.includes(next)) continue;
    family.push(next);
    queue.push(...preEvolutions(content, next));
  }
  return family;
}
/** Biomes where a species (or, for an evolved form, its family's earlier forms) appears in the wild. */
export function habitatBiomes(content: Content, speciesId: SpeciesId): BiomeId[] {
  const family = speciesFamily(content, speciesId);
  const biomes = new Set<BiomeId>();
  for (const member of family) for (const biome of content.species[member]?.spawnBiomes ?? []) if ((spawnWeightsFor(content, biome)?.[member] ?? 0) > 0) biomes.add(biome);
  return [...biomes].sort();
}
/**
 * Task 5 "in its habitat": the species (or an earlier form) can appear on this tile. On v24 maps that is the tile's habitat from the
 * terrain (`tileHabitatWeights`, docs/design/world-v24.md §2.6, night excluded); without features, the biomes it spawns in.
 */
export function inResearchHabitat(map: FeatureMap, content: Content, speciesId: SpeciesId, tileIndex: number): boolean {
  const biome = map.tiles[tileIndex];
  if (biome === null || biome === undefined) return false;
  if (!map.features) return habitatBiomes(content, speciesId).includes(biome);
  // v24 (§2.6): the tile's own habitat — biome table plus hills, rivers, peaksides, deep water and landmark residents.
  const weights = tileHabitatWeights(map, tileIndex, content);
  return speciesFamily(content, speciesId).some(member => (weights[member] ?? 0) > 0);
}

/** v24 games only: one empty card book per player; species already seen at the start (starting registrations) count as seen. */
export function initializeResearchTasks(state: GameState, content: Content): void {
  if (!content.researchTasks || !state.expansion) return;
  const ledger: ResearchTaskState = {};
  for (const playerId of [...state.turnOrder].sort((a, b) => a - b)) {
    const book: Partial<Record<SpeciesId, ResearchCard>> = {};
    for (const record of Object.values(state.expansion.world.players[playerId]?.pokedex ?? {})) if (record.observed) book[record.speciesId] = { tasks: bit('seen'), knockouts: 0 };
    ledger[playerId] = book;
  }
  state.expansion.researchTasks = ledger;
}

type Credit = { playerId: number; speciesId: SpeciesId; task: ResearchTaskId | 'knockout' };
const speciesOf = (before: GameState, after: GameState, unitId: number): SpeciesId | null => {
  const unit = before.units[unitId] ?? after.units[unitId];
  return unit?.kind === 'pokemon' ? unit.speciesId : null;
};
const positionOf = (before: GameState, after: GameState, unitId: number): Hex | null => {
  const unit = after.units[unitId] ?? before.units[unitId];
  return unit && isMapUnit(unit) ? unit.position : null;
};

/** What this command's events earn, in event order (knockouts, captures, evolutions), then newly seen species. */
function credits(before: GameState, after: GameState, events: readonly EventPayload[], content: Content): Credit[] {
  const found: Credit[] = [];
  const active = [...after.turnOrder].sort((a, b) => a - b).filter(id => !after.players[id].eliminated);
  const evolution = (actorId: number, unitId: number, from: SpeciesId | null, into: SpeciesId) => {
    const species = [...(from ? [from] : []), into];
    const position = positionOf(before, after, unitId), index = position ? hexToIndex(position, after.map) : null;
    for (const playerId of active) {
      // The actor always knows; anyone else only when the unit stood in their sight (the event-delivery rule).
      if (playerId !== actorId && (index === null || !(visibleTiles(before, playerId, content).has(index) || visibleTiles(after, playerId, content).has(index)))) continue;
      for (const speciesId of species) found.push({ playerId, speciesId, task: 'evolution' });
    }
  };
  for (const event of events) {
    if (event.type === 'BattleResolved') {
      for (const record of event.knockdowns ?? []) {
        // Own Pokémon knocking out any Pokémon (wild, rampaging, enemy, rival); cities and neutral attackers do not count.
        if (record.source.kind !== 'pokemon' || record.source.ownerId === null || record.target.kind !== 'pokemon') continue;
        const speciesId = speciesOf(before, after, record.target.id);
        if (!speciesId || !active.includes(record.source.ownerId)) continue;
        found.push({ playerId: record.source.ownerId, speciesId, task: 'knockout' });
        const special = researchSpecialFor(content.species[speciesId].typeId);
        const where = record.counter ? event.positions[0] : event.positions[1];
        if (special.kind === 'night' && isNight(after.round)) found.push({ playerId: record.source.ownerId, speciesId, task: 'special' });
        if (special.kind === 'weather' && where && weatherAt(combatContext(before), where)?.weather === special.weather) found.push({ playerId: record.source.ownerId, speciesId, task: 'special' });
      }
    } else if (event.type === 'Captured' && event.success) {
      const speciesId = speciesOf(before, after, event.targetUnitId);
      if (!speciesId || !active.includes(event.playerId)) continue;
      found.push({ playerId: event.playerId, speciesId, task: 'captured' });
      const target = before.units[event.targetUnitId], index = target && isMapUnit(target) ? hexToIndex(target.position, before.map) : null;
      if (researchSpecialFor(content.species[speciesId].typeId).kind === 'habitat' && index !== null && inResearchHabitat(before.map, content, speciesId, index)) {
        found.push({ playerId: event.playerId, speciesId, task: 'special' });
      }
    } else if (event.type === 'Evolved') {
      evolution(event.playerId, event.unitId, speciesOf(before, before, event.unitId), event.speciesId);
    } else if (event.type === 'WorldStoneEvolution') {
      evolution(event.playerId, event.unitId, event.fromSpeciesId, event.intoSpeciesId);
    }
  }
  // Seen: the player's own Pokédex record (already limited to what that player saw).
  for (const playerId of active) for (const record of Object.values(after.expansion?.world.players[playerId]?.pokedex ?? {})) {
    if (record.observed) found.push({ playerId, speciesId: record.speciesId, task: 'seen' });
  }
  // v25: research cards exist for regional species only.
  return content.regionalDex ? found.filter(credit => isRegionalSpecies(content, credit.speciesId)) : found;
}

/** Gives the rewards for reaching `done` tasks on one card (each threshold is reached exactly once). */
function reward(state: GameState, playerId: number, done: number): ResearchReward | undefined {
  const player = state.players[playerId];
  if (done === R.notesAt) { player.research.reserve += R.notesResearch; return { research: R.notesResearch }; }
  if (done === R.captureAt) return { captureBonus: R.captureBonus };
  if (done !== R.completeAt) return undefined;
  player.gold += R.completeGold;
  const honors = state.expansion?.eraHonors?.players[playerId];
  if (!honors || (honors.byMilestone.researchComplete ?? 0) >= R.eraScoreCapPerEra) return { gold: R.completeGold };
  honors.score += R.completeEraScore;
  honors.byMilestone.researchComplete = (honors.byMilestone.researchComplete ?? 0) + 1;
  return { gold: R.completeGold, eraScore: R.completeEraScore };
}

/** Per command (recordExpansion), from that command's events and the vision at the time. */
export function recordResearchTasks(before: GameState, after: GameState, events: readonly EventPayload[]): EventPayload[] {
  const ledger = after.expansion?.researchTasks;
  if (!ledger || after.outcome) return [];
  const output: EventPayload[] = [];
  for (const credit of credits(before, after, events, contentFor(after.setup))) {
    const book = ledger[credit.playerId] ??= {};
    const card = book[credit.speciesId] ?? { tasks: 0, knockouts: 0 };
    let task: ResearchTaskId;
    if (credit.task === 'knockout') {
      if (card.knockouts >= R.knockoutsNeeded) continue;
      card.knockouts++;
      book[credit.speciesId] = card;
      if (card.knockouts < R.knockoutsNeeded) continue;
      task = 'knockouts';
    } else task = credit.task;
    if (card.tasks & bit(task)) continue;
    card.tasks |= bit(task);
    book[credit.speciesId] = card;
    const done = tasksDone(card.tasks), granted = reward(after, credit.playerId, done);
    output.push({ type: 'ResearchTaskCompleted', playerId: credit.playerId, speciesId: credit.speciesId, task, tasksDone: done, ...(granted ? { reward: granted } : {}) });
  }
  return output;
}
const captureBonusOf = (card: ResearchCard | undefined) => card && tasksDone(card.tasks) >= R.captureAt ? R.captureBonus : 0;
/** Capture chance bonus from a card with 4+ tasks (shared by authority and preview). */
export function researchCaptureBonus(state: Pick<GameState, 'expansion'>, playerId: number, speciesId: SpeciesId): number {
  return captureBonusOf(state.expansion?.researchTasks?.[playerId]?.[speciesId]);
}
export function viewResearchCaptureBonus(view: Pick<PlayerView, 'expansion'>, speciesId: SpeciesId): number {
  return captureBonusOf(view.expansion?.researchTasks?.[speciesId]);
}
/** Only the viewer's own book. */
export function observeResearchTasks(state: GameState, playerId: number): ResearchTaskView | undefined {
  const ledger = state.expansion?.researchTasks;
  return ledger ? JSON.parse(JSON.stringify(ledger[playerId] ?? {})) as ResearchTaskView : undefined;
}
