// Gameplay v14 accessors: read a content's roster tables, or the legacy global tables for older contents.
import type { BiomeId } from './rules.ts';
import type { LeaderId } from './leaders.ts';
import type { Content, RosterStoneEvolution, SpeciesId } from './units.ts';
import { SPAWN_WEIGHTS, WANDERERS } from './wild.ts';
import { WORLD_DEFINITIONS } from './world-systems.ts';
import { DEEP_WATER_HABITAT_V24, HABITAT_OVERLAYS_V24, LANDMARKS } from './terrain.ts';
import type { LandmarkId } from './terrain.ts';
import type { ResolvedRecruit } from './recruit-slots.ts';

export const LEGACY_NEST_PRIORITY: readonly SpeciesId[] = ['sandshrew', 'ekans', 'caterpie', 'swinub', 'magnemite', 'umbreon', 'clefairy'];
export const spawnWeightsFor = (content: Content, biome: BiomeId): Partial<Record<SpeciesId, number>> => (content.roster?.spawnWeights ?? SPAWN_WEIGHTS)[biome];
export const wanderersFor = (content: Content): readonly SpeciesId[] => content.roster?.wanderers ?? WANDERERS;
export const nestPriorityFor = (content: Content): readonly SpeciesId[] => content.roster?.nestPriority ?? LEGACY_NEST_PRIORITY;
export const stoneEvolutionsFor = (content: Content): readonly RosterStoneEvolution[] =>
  content.roster ? [...WORLD_DEFINITIONS.stoneEvolutions, ...content.roster.stoneEvolutions] : WORLD_DEFINITIONS.stoneEvolutions;
export const leaderUnitFor = (content: Content, leaderId: LeaderId, fallback: SpeciesId): SpeciesId => content.roster?.leaderUnits[leaderId] ?? fallback;
/** v25: the species of this game's regional Pokédex (every species when the content has none). */
export const regionalSpeciesIds = (content: Content): readonly SpeciesId[] => content.regionalDex?.speciesIds ?? Object.keys(content.species) as SpeciesId[];
const regionalSets = new WeakMap<Content, ReadonlySet<SpeciesId>>();
/** v25: whether a species belongs to this game's regional Pokédex (always true without one). */
export function isRegionalSpecies(content: Content, speciesId: SpeciesId): boolean {
  if (!content.regionalDex) return true;
  let set = regionalSets.get(content);
  if (!set) regionalSets.set(content, set = new Set(content.regionalDex.speciesIds));
  return set.has(speciesId);
}
/** v24 habitat overlays / deep water / landmark residents, narrowed to the regional Pokédex in v25. */
export const habitatOverlaysFor = (content: Content): Record<'hill' | 'river' | 'peakside', Partial<Record<SpeciesId, number>>> => content.roster?.habitatOverlays ?? HABITAT_OVERLAYS_V24;
export const deepWaterFor = (content: Content): { multiply: Partial<Record<SpeciesId, number>>; remove: readonly SpeciesId[] } => content.roster?.deepWater ?? DEEP_WATER_HABITAT_V24;
export const residentsFor = (content: Content, landmark: LandmarkId): readonly SpeciesId[] => content.roster?.residents?.[landmark] ?? LANDMARKS[landmark].residents;
/** v25: how this region's recruit slots resolved (empty before v25). */
export const recruitSlotsFor = (content: Content): readonly ResolvedRecruit[] => content.roster?.recruitSlots ?? [];
/** Original Pokédex generation of a species; the 47 pre-roster species count as generation 1 (always available). */
export const speciesGeneration = (content: Content, speciesId: SpeciesId): number => content.species[speciesId]?.generation ?? 1;
