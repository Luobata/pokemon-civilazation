// Gameplay v14 accessors: read a content's roster tables, or the legacy global tables for older contents.
import type { BiomeId } from './rules.ts';
import type { LeaderId } from './leaders.ts';
import type { Content, RosterStoneEvolution, SpeciesId } from './units.ts';
import { SPAWN_WEIGHTS, WANDERERS } from './wild.ts';
import { WORLD_DEFINITIONS } from './world-systems.ts';

export const LEGACY_NEST_PRIORITY: readonly SpeciesId[] = ['sandshrew', 'ekans', 'caterpie', 'swinub', 'magnemite', 'umbreon', 'clefairy'];
export const spawnWeightsFor = (content: Content, biome: BiomeId): Partial<Record<SpeciesId, number>> => (content.roster?.spawnWeights ?? SPAWN_WEIGHTS)[biome];
export const wanderersFor = (content: Content): readonly SpeciesId[] => content.roster?.wanderers ?? WANDERERS;
export const nestPriorityFor = (content: Content): readonly SpeciesId[] => content.roster?.nestPriority ?? LEGACY_NEST_PRIORITY;
export const stoneEvolutionsFor = (content: Content): readonly RosterStoneEvolution[] =>
  content.roster ? [...WORLD_DEFINITIONS.stoneEvolutions, ...content.roster.stoneEvolutions] : WORLD_DEFINITIONS.stoneEvolutions;
export const leaderUnitFor = (content: Content, leaderId: LeaderId, fallback: SpeciesId): SpeciesId => content.roster?.leaderUnits[leaderId] ?? fallback;
/** Original Pokédex generation of a species; the 47 pre-roster species count as generation 1 (always available). */
export const speciesGeneration = (content: Content, speciesId: SpeciesId): number => content.species[speciesId]?.generation ?? 1;
