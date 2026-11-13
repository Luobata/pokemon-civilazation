// Gameplay v25 B (docs/design/roster-v25.md §3): evolution lines and the roster tables derived from species tags (the regional
// Pokédex draw, A, comes next). Pure functions of public setup information (dex seed, era mode, seated leaders): integers and stableSeed only, every
// iteration sorted by id, never the game's random stream. A published v25 draw is frozen by tests/core/__golden__/regional-dex-v25.json.
import type { EraProgression } from './eras.ts';
import type { LeaderId } from './leaders.ts';
import type { BiomeId } from './rules.ts';
import type { SpeciesDefinition, SpeciesId } from './species.ts';
import type { LandmarkId } from './terrain.ts';
import { LANDMARK_IDS } from './terrain.ts';
import { STONE_EVOLUTIONS_V14_ADDITIONS } from './roster-v14-data.ts';
import { BASE_STONE_EVOLUTIONS } from './stone-evolutions.ts';
import { HABITAT_FEATURE_KEYS, SPECIES_TAGS } from './species-tags.ts';
import type { SpeciesTags } from './species-tags.ts';
import { RECRUIT_SLOTS, resolveRecruits } from './recruit-slots.ts';
import type { RecruitSlotId, ResolvedRecruit } from './recruit-slots.ts';
import type { TechId } from './economy.ts';

type Species = Readonly<Record<string, SpeciesDefinition>>;
export const DEX_BIOMES: readonly BiomeId[] = ['grassland', 'forest', 'mountain', 'ocean', 'desert', 'snow', 'volcano'];
const STARTERS: readonly SpeciesId[] = ['bulbasaur', 'charmander', 'squirtle'];

export const dexMaxGeneration = (mode: EraProgression): number => mode === 'full-v1' ? 9 : 3;
const generationOf = (species: Species, id: SpeciesId): number => species[id]?.generation ?? 1;
const tagsOf = (id: SpeciesId): SpeciesTags => SPECIES_TAGS[id] ?? { rarity: 'common' };
const byId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export type DexLine = { id: SpeciesId; speciesIds: readonly SpeciesId[] };
const lineCache = new WeakMap<Species, Map<number, DexLine[]>>();
/** The pool (species up to the mode's last generation) split into evolution lines: connected components over evolutions, branches and stone paths. */
export function evolutionLines(species: Species, maxGeneration: number): DexLine[] {
  let byGeneration = lineCache.get(species);
  if (!byGeneration) lineCache.set(species, byGeneration = new Map());
  const cached = byGeneration.get(maxGeneration);
  if (cached) return cached;
  const pool = (Object.keys(species) as SpeciesId[]).filter(id => generationOf(species, id) <= maxGeneration).sort(byId);
  const parent = new Map(pool.map(id => [id, id] as [SpeciesId, SpeciesId]));
  const find = (id: SpeciesId): SpeciesId => { let root = id; while (parent.get(root) !== root) root = parent.get(root)!; return root; };
  const join = (a: SpeciesId, b: SpeciesId) => { if (parent.has(a) && parent.has(b)) { const x = find(a), y = find(b); if (x !== y) parent.set(x < y ? y : x, x < y ? x : y); } };
  for (const id of pool) {
    const definition = species[id];
    for (const into of [definition.evolution?.speciesId, ...(definition.branches ?? []).map(option => option.speciesId)]) if (into) join(id, into);
  }
  for (const path of [...BASE_STONE_EVOLUTIONS, ...STONE_EVOLUTIONS_V14_ADDITIONS]) join(path.fromSpeciesId as SpeciesId, path.intoSpeciesId as SpeciesId);
  const groups = new Map<SpeciesId, SpeciesId[]>();
  for (const id of pool) { const root = find(id); groups.set(root, [...(groups.get(root) ?? []), id]); }
  const lines = [...groups.values()].map(members => {
    const base = [...members].sort((a, b) => species[a].stage - species[b].stage || byId(a, b))[0];
    return { id: base, speciesIds: [...members].sort(byId) };
  }).sort((a, b) => byId(a.id, b.id));
  byGeneration.set(maxGeneration, lines);
  return lines;
}

/** Starter lines: always regional, never a recruit (§2.4). */
function starterSpecies(species: Species, maxGeneration: number): Set<SpeciesId> {
  return new Set(evolutionLines(species, maxGeneration).filter(line => line.speciesIds.some(id => STARTERS.includes(id))).flatMap(line => line.speciesIds));
}

/** Roster tables derived from the tags for a species set (§3.2); the shape of `RosterTables` plus the v24 habitat extras. */
export type DerivedRosterTables = {
  spawnWeights: Record<BiomeId, Partial<Record<SpeciesId, number>>>;
  wanderers: SpeciesId[];
  techRecruits: Partial<Record<TechId, SpeciesId>>;
  generationRecruits: Partial<Record<number, SpeciesId>>;
  leaderUnits: Partial<Record<LeaderId, SpeciesId>>;
  stoneEvolutions: { fromSpeciesId: SpeciesId; intoSpeciesId: SpeciesId; stoneId: 'leafStone'; requiredXp: number }[];
  nestPriority: SpeciesId[]; nestWeights: Partial<Record<SpeciesId, number>>;
  pokedexTargetBonus: number;
  habitatOverlays: Record<'hill' | 'river' | 'peakside', Partial<Record<SpeciesId, number>>>;
  deepWater: { multiply: Partial<Record<SpeciesId, number>>; remove: SpeciesId[] };
  residents: Record<LandmarkId, SpeciesId[]>;
  recruitSlots: ResolvedRecruit[];
};
export function deriveRosterTables(species: Species, speciesIds: readonly SpeciesId[], mode: EraProgression): DerivedRosterTables {
  const maxGeneration = dexMaxGeneration(mode), ids = [...speciesIds].filter(id => species[id]).sort(byId), has = new Set(ids);
  const recruitSlots = resolveRecruits(species as Record<string, SpeciesDefinition>, ids, maxGeneration, starterSpecies(species, maxGeneration));
  const weights = (key: keyof NonNullable<SpeciesTags['habitat']>) =>
    Object.fromEntries(ids.flatMap(id => (tagsOf(id).habitat?.[key] ?? 0) > 0 ? [[id, tagsOf(id).habitat![key]!]] : [])) as Partial<Record<SpeciesId, number>>;
  const leaderUnits: Partial<Record<LeaderId, SpeciesId>> = {};
  for (const id of Object.keys(SPECIES_TAGS).sort(byId) as SpeciesId[]) for (const leader of tagsOf(id).leader ?? []) leaderUnits[leader] = id;
  return {
    spawnWeights: Object.fromEntries(DEX_BIOMES.map(biome => [biome, weights(biome)])) as Record<BiomeId, Partial<Record<SpeciesId, number>>>,
    wanderers: ids.filter(id => tagsOf(id).wanderer),
    techRecruits: Object.fromEntries(recruitSlots.flatMap(item => {
      const slot = RECRUIT_SLOTS.find(entry => entry.id === item.slot)!;
      return slot.techId && item.speciesId ? [[slot.techId, item.speciesId]] : [];
    })) as Partial<Record<TechId, SpeciesId>>,
    generationRecruits: Object.fromEntries(recruitSlots.flatMap(item => {
      const slot = RECRUIT_SLOTS.find(entry => entry.id === item.slot)!;
      return slot.generation !== undefined && item.speciesId ? [[slot.generation, item.speciesId]] : [];
    })) as Partial<Record<number, SpeciesId>>,
    leaderUnits,
    stoneEvolutions: STONE_EVOLUTIONS_V14_ADDITIONS.filter(path => has.has(path.fromSpeciesId as SpeciesId) && has.has(path.intoSpeciesId as SpeciesId))
      .map(path => ({ ...path, fromSpeciesId: path.fromSpeciesId as SpeciesId, intoSpeciesId: path.intoSpeciesId as SpeciesId })),
    nestPriority: ids.filter(id => (tagsOf(id).nest ?? 0) > 0),
    nestWeights: Object.fromEntries(ids.flatMap(id => tagsOf(id).nest ? [[id, tagsOf(id).nest!]] : [])) as Partial<Record<SpeciesId, number>>,
    pokedexTargetBonus: 5,
    habitatOverlays: Object.fromEntries(HABITAT_FEATURE_KEYS.map(key => [key, weights(key)])) as DerivedRosterTables['habitatOverlays'],
    deepWater: {
      multiply: Object.fromEntries(ids.flatMap(id => tagsOf(id).deep?.multiply ? [[id, tagsOf(id).deep!.multiply!]] : [])) as Partial<Record<SpeciesId, number>>,
      remove: ids.filter(id => tagsOf(id).deep?.remove),
    },
    residents: Object.fromEntries(LANDMARK_IDS.map(landmark => [landmark, ids.filter(id => (tagsOf(id).resident ?? []).includes(landmark))])) as Record<LandmarkId, SpeciesId[]>,
    recruitSlots,
  };
}
export type { RecruitSlotId };
