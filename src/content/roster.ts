import type { BiomeId } from './rules.ts';
import type { LeaderId } from './leaders.ts';
import type { Content, RosterStoneEvolution, SpeciesId } from './units.ts';
import { WORLD_DEFINITIONS } from './world-systems.ts';
import { DEEP_WATER_HABITAT_V24, HABITAT_OVERLAYS_V24, LANDMARKS } from './terrain.ts';
import type { LandmarkId } from './terrain.ts';
import type { ResolvedRecruit } from './recruit-slots.ts';

export const spawnWeightsFor = (content: Content, biome: BiomeId): Partial<Record<SpeciesId, number>> => content.roster.spawnWeights[biome];
export const wanderersFor = (content: Content): readonly SpeciesId[] => content.roster.wanderers;
export const nestPriorityFor = (content: Content): readonly SpeciesId[] => content.roster.nestPriority;
export const stoneEvolutionsFor = (content: Content): readonly RosterStoneEvolution[] =>
  [...WORLD_DEFINITIONS.stoneEvolutions, ...content.roster.stoneEvolutions];
export const leaderUnitFor = (content: Content, leaderId: LeaderId, fallback: SpeciesId): SpeciesId => content.roster.leaderUnits[leaderId] ?? fallback;

export const regionalSpeciesIds = (content: Content): readonly SpeciesId[] =>
  content.regionalDex?.speciesIds ?? Object.keys(content.species) as SpeciesId[];

const regionalSets = new WeakMap<Content, ReadonlySet<SpeciesId>>();
export function isRegionalSpecies(content: Content, speciesId: SpeciesId): boolean {
  if (!content.regionalDex) return true;
  let set = regionalSets.get(content);
  if (!set) regionalSets.set(content, set = new Set(content.regionalDex.speciesIds));
  return set.has(speciesId);
}

export const habitatOverlaysFor = (content: Content): Record<'hill' | 'river' | 'peakside', Partial<Record<SpeciesId, number>>> =>
  content.roster.habitatOverlays ?? HABITAT_OVERLAYS_V24;
export const deepWaterFor = (content: Content): { multiply: Partial<Record<SpeciesId, number>>; remove: readonly SpeciesId[] } =>
  content.roster.deepWater ?? DEEP_WATER_HABITAT_V24;
export const residentsFor = (content: Content, landmark: LandmarkId): readonly SpeciesId[] =>
  content.roster.residents?.[landmark] ?? LANDMARKS[landmark].residents;
export const recruitSlotsFor = (content: Content): readonly ResolvedRecruit[] => content.roster.recruitSlots ?? [];
export const speciesGeneration = (content: Content, speciesId: SpeciesId): number => content.species[speciesId]?.generation ?? 1;
