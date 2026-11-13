// Gameplay v25 A + B (docs/design/roster-v25.md §2–§3): evolution lines, the regional Pokédex draw and the roster tables derived from
// species tags. Pure functions of public setup information (dex seed, era mode, seated leaders): integers and stableSeed only, every
// iteration sorted by id, never the game's random stream. A published v25 draw is frozen by tests/core/__golden__/regional-dex-v25.json.
import type { EraProgression } from './eras.ts';
import type { LeaderId } from './leaders.ts';
import type { BiomeId } from './rules.ts';
import type { SpeciesDefinition, SpeciesId, TypeId } from './species.ts';
import type { LandmarkId } from './terrain.ts';
import { LANDMARK_IDS } from './terrain.ts';
import { STONE_EVOLUTIONS_V14_ADDITIONS } from './roster-v14-data.ts';
import { BASE_STONE_EVOLUTIONS } from './stone-evolutions.ts';
import { CLASS_NATIVE_TYPES } from './unit-classes.ts';
import { HABITAT_FEATURE_KEYS, SPECIES_TAGS } from './species-tags.ts';
import type { SpeciesTags } from './species-tags.ts';
import { RECRUIT_SLOTS, resolveRecruits } from './recruit-slots.ts';
import type { RecruitSlotId, ResolvedRecruit } from './recruit-slots.ts';
import type { TechId } from './economy.ts';
import { stableSeed } from './stable-seed.ts';

type Species = Readonly<Record<string, SpeciesDefinition>>;
type Role = SpeciesDefinition['role'];
export const DEX_BIOMES: readonly BiomeId[] = ['grassland', 'forest', 'mountain', 'ocean', 'desert', 'snow', 'volcano'];
const ROLES: readonly Role[] = ['melee', 'ranged', 'fast', 'scout', 'siege', 'air', 'naval'];
const STARTERS: readonly SpeciesId[] = ['bulbasaur', 'charmander', 'squirtle'];

/** §2.2–§2.3 draw rules (choice 1A: simple 48 / full 60). */
export const REGIONAL_DEX_RULES = {
  size: { 'simple-v1': 48, 'full-v1': 60 } as Record<EraProgression, number>,
  /** The draw may pass the target by this many species (whole lines). */
  overshoot: 1,
  /** C4: while drawing, no type may hold more than this percentage of the target. */
  typeCapPercent: 25,
  /** C8: rare species (one overlord per civilization, at most four; the upper bound keeps contest appeal stable). */
  rareMin: 4, rareMax: 10,
  /** C9: lines with a naval species. */
  navalLines: 2,
  /** C6: generation-1 wild species per biome. */
  biomeSpawns: 2,
  /** C7: generation-1 nest species. */
  nests: 3,
  /** Draw tickets of a line with a `favored` species. */
  favoredTickets: 2,
} as const;
export const dexMaxGeneration = (mode: EraProgression): number => mode === 'full-v1' ? 9 : 3;
const generationOf = (species: Species, id: SpeciesId): number => species[id]?.generation ?? 1;
const typesOf = (definition: SpeciesDefinition): TypeId[] => definition.secondaryTypeId ? [definition.typeId, definition.secondaryTypeId] : [definition.typeId];
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

/** What the constraints look at, computed once per species set. */
type Profile = {
  cells: Set<string>; nativeCells: Set<string>; types: Set<TypeId>; generations: Set<number>;
  biomes: Map<BiomeId, number>; nests: number; rare: number; navalLines: number; recruits: () => ResolvedRecruit[];
};
type Context = { species: Species; maxGeneration: number; starters: ReadonlySet<SpeciesId>; lineOf: ReadonlyMap<SpeciesId, SpeciesId> };
/** One coverage constraint (§2.3): an id for reports and its deficit (0 = met; counts report how many are missing). */
type Constraint = { id: string; deficit: (profile: Profile) => number };
function profileOf(context: Context, ids: readonly SpeciesId[]): Profile {
  const { species } = context;
  const profile: Profile = { cells: new Set(), nativeCells: new Set(), types: new Set(), generations: new Set(), biomes: new Map(), nests: 0, rare: 0, navalLines: 0,
    recruits: () => recruits ??= resolveRecruits(species as Record<string, SpeciesDefinition>, ids, context.maxGeneration, context.starters) };
  let recruits: ResolvedRecruit[] | null = null;
  const naval = new Set<SpeciesId>();
  for (const id of ids) {
    const definition = species[id], generation = generationOf(species, id), tags = tagsOf(id);
    profile.cells.add(`${definition.role}:${definition.stage}`);
    if (nativeTo(definition, definition.role)) profile.nativeCells.add(`${definition.role}:${definition.stage}`);
    for (const type of typesOf(definition)) profile.types.add(type);
    if (definition.stage <= 2) profile.generations.add(generation);
    if (generation === 1) {
      for (const biome of DEX_BIOMES) if (spawnsIn(species, id, biome)) profile.biomes.set(biome, (profile.biomes.get(biome) ?? 0) + 1);
      if ((tags.nest ?? 0) > 0) profile.nests++;
    }
    if (definition.rare) profile.rare++;
    if (definition.role === 'naval') naval.add(context.lineOf.get(id) ?? id);
  }
  profile.navalLines = naval.size;
  return profile;
}
const nativeTo = (definition: SpeciesDefinition, role: Role) => typesOf(definition).some(type => (CLASS_NATIVE_TYPES[role] as readonly TypeId[]).includes(type));
const spawnsIn = (species: Species, id: SpeciesId, biome: BiomeId) => (tagsOf(id).habitat?.[biome] ?? 0) > 0 && species[id].terrain.includes(biome);

/** C1–C3, C5–C9, C11 for a mode. */
function constraintsFor(maxGeneration: number, types: readonly TypeId[]): Constraint[] {
  const rules = REGIONAL_DEX_RULES, all: Constraint[] = [];
  for (const role of ROLES) for (const stage of [1, 2, 3]) {
    all.push({ id: `C1:${role}:${stage}`, deficit: profile => profile.nativeCells.has(`${role}:${stage}`) ? 0 : 1 });
    all.push({ id: `C2:${role}:${stage}`, deficit: profile => profile.cells.has(`${role}:${stage}`) ? 0 : 1 });
  }
  for (const type of types) all.push({ id: `C3:${type}`, deficit: profile => profile.types.has(type) ? 0 : 1 });
  for (let generation = 2; generation <= maxGeneration; generation++) all.push({ id: `C5:${generation}`, deficit: profile => profile.generations.has(generation) ? 0 : 1 });
  for (const biome of DEX_BIOMES) all.push({ id: `C6:${biome}`, deficit: profile => Math.max(0, rules.biomeSpawns - (profile.biomes.get(biome) ?? 0)) });
  all.push({ id: 'C7:nests', deficit: profile => Math.max(0, rules.nests - profile.nests) });
  all.push({ id: 'C8:rare', deficit: profile => Math.max(0, rules.rareMin - profile.rare) });
  all.push({ id: 'C9:naval', deficit: profile => Math.max(0, rules.navalLines - profile.navalLines) });
  for (const slot of RECRUIT_SLOTS.filter(slot => slot.core && (slot.generation ?? 0) <= maxGeneration)) {
    all.push({ id: `C11:${slot.id}`, deficit: profile => profile.recruits().some(item => item.slot === slot.id && item.speciesId !== null) ? 0 : 1 });
  }
  return all;
}
type ModeRules = { context: Context; lines: DexLine[]; constraints: Constraint[] };
const modeCache = new WeakMap<Species, Map<number, ModeRules>>();
/** Lines, starters and the constraints the pool itself can meet (the others are content gaps, §2.3, and are not checked). */
function modeRules(species: Species, maxGeneration: number): ModeRules {
  let byGeneration = modeCache.get(species);
  if (!byGeneration) modeCache.set(species, byGeneration = new Map());
  const cached = byGeneration.get(maxGeneration);
  if (cached) return cached;
  const lines = evolutionLines(species, maxGeneration);
  const context: Context = { species, maxGeneration, starters: starterSpecies(species, maxGeneration),
    lineOf: new Map(lines.flatMap(line => line.speciesIds.map(id => [id, line.id] as [SpeciesId, SpeciesId]))) };
  const all = lines.flatMap(line => line.speciesIds), full = profileOf(context, all);
  const types = [...new Set(all.flatMap(id => typesOf(species[id])))].sort(byId);
  const rules = { context, lines, constraints: constraintsFor(maxGeneration, types).filter(constraint => constraint.deficit(full) === 0) };
  byGeneration.set(maxGeneration, rules);
  return rules;
}
/** Missing coverage of a set: the constraints' deficits (×100), then rare species above C8's upper bound as a tie-break (soft: anchors and
 * repairs may pass it, the draw never does). */
const totalDeficit = (rules: ModeRules, ids: readonly SpeciesId[]) => {
  const profile = profileOf(rules.context, ids);
  return rules.constraints.reduce((sum, constraint) => sum + 100 * constraint.deficit(profile), Math.max(0, profile.rare - REGIONAL_DEX_RULES.rareMax));
};
/** Unmet constraint ids of a species set (empty = the set satisfies every feasible constraint of its mode). */
export function unmetConstraints(species: Species, speciesIds: readonly SpeciesId[], mode: EraProgression): string[] {
  const rules = modeRules(species, dexMaxGeneration(mode)), profile = profileOf(rules.context, speciesIds);
  return rules.constraints.filter(constraint => constraint.deficit(profile) > 0).map(constraint => constraint.id);
}
/** Ids of every constraint checked in a mode (for reports). */
export const dexConstraintIds = (species: Species, mode: EraProgression): string[] => modeRules(species, dexMaxGeneration(mode)).constraints.map(constraint => constraint.id);

export type DexLineSource = 'anchor' | 'leader' | 'repair' | 'draw';
export type RegionalDexDraw = {
  speciesIds: SpeciesId[]; size: number; target: number; pool: number;
  lines: { id: SpeciesId; speciesIds: readonly SpeciesId[]; source: DexLineSource; key: number }[];
  repairs: number; unmet: string[];
};
export type RegionalDexInput = { species: Species; mode: EraProgression; dexSeed: number; leaders: readonly LeaderId[]; size?: number };
/** Draw tickets of a line: the `draw` override, else 2 with a favored species, else 1. */
function ticketsOf(line: DexLine): number {
  const override = Math.max(0, ...line.speciesIds.map(id => tagsOf(id).draw ?? 0));
  return override || (line.speciesIds.some(id => tagsOf(id).iconic === 'favored') ? REGIONAL_DEX_RULES.favoredTickets : 1);
}
export const lineKey = (dexSeed: number, line: DexLine): number =>
  Math.min(...Array.from({ length: ticketsOf(line) }, (_, ticket) => stableSeed(dexSeed, line.id, ticket, 'regional-dex')));

/** §2.2 the regional Pokédex of one game. */
export function drawRegionalDex(input: RegionalDexInput): RegionalDexDraw {
  const { species, mode, dexSeed } = input, maxGeneration = dexMaxGeneration(mode), target = input.size ?? REGIONAL_DEX_RULES.size[mode];
  const lines = evolutionLines(species, maxGeneration), starters = modeRules(species, maxGeneration).context.starters;
  const keyed = lines.map(line => ({ ...line, key: lineKey(dexSeed, line) })).sort((a, b) => a.key - b.key || byId(a.id, b.id));
  const chosen = new Map<SpeciesId, DexLineSource>();
  const members = () => keyed.filter(line => chosen.has(line.id)).flatMap(line => line.speciesIds);
  const leaders = [...new Set(input.leaders)].sort(byId);
  // Step 3: anchors (starters, iconic anchors) and the seated leaders' unique lines (choice 5A).
  for (const line of keyed) {
    if (line.speciesIds.some(id => starters.has(id) || tagsOf(id).iconic === 'anchor')) chosen.set(line.id, 'anchor');
    else if (line.speciesIds.some(id => (tagsOf(id).leader ?? []).some(leader => leaders.includes(leader)))) chosen.set(line.id, 'leader');
  }
  // Step 4: draw by key, whole lines, within the size, type cap (C4) and rare cap (C8).
  const typeCap = Math.floor(target * REGIONAL_DEX_RULES.typeCapPercent / 100);
  const typeCounts = (ids: readonly SpeciesId[]) => { const counts = new Map<TypeId, number>(); for (const id of ids) for (const type of typesOf(species[id])) counts.set(type, (counts.get(type) ?? 0) + 1); return counts; };
  for (const line of keyed) {
    const current = members();
    if (current.length >= target) break;
    if (chosen.has(line.id) || current.length + line.speciesIds.length > target + REGIONAL_DEX_RULES.overshoot) continue;
    const next = [...current, ...line.speciesIds];
    if ([...typeCounts(next).values()].some(count => count > typeCap) || next.filter(id => species[id].rare).length > REGIONAL_DEX_RULES.rareMax) continue;
    chosen.set(line.id, 'draw');
  }
  // Step 5: repair (greedy set cover on the total deficit): the line that removes the most missing coverage, ties by key; when no single
  // line helps (recruit slots interact), the best pair of lines.
  const rules = modeRules(species, maxGeneration);
  let repairs = 0, missing = totalDeficit(rules, members());
  while (missing >= 100) {
    const current = members(), open = keyed.filter(line => !chosen.has(line.id));
    let best: { lines: (typeof keyed)[number][]; left: number } | null = null;
    for (const line of open) {
      const left = totalDeficit(rules, [...current, ...line.speciesIds]);
      if (left < missing && (!best || left < best.left)) best = { lines: [line], left };
    }
    if (!best) for (const [index, first] of open.entries()) for (const second of open.slice(index + 1)) {
      const left = totalDeficit(rules, [...current, ...first.speciesIds, ...second.speciesIds]);
      if (left < missing && (!best || left < best.left)) best = { lines: [first, second], left };
    }
    if (!best) break;
    for (const line of best.lines) chosen.set(line.id, 'repair');
    repairs += best.lines.length; missing = best.left;
  }
  // Step 6: prune drawn lines from the largest key while every constraint still holds.
  for (const line of [...keyed].reverse()) {
    if (members().length <= target) break;
    if (chosen.get(line.id) !== 'draw') continue;
    chosen.delete(line.id);
    if (totalDeficit(rules, members()) > missing) chosen.set(line.id, 'draw');
  }
  const speciesIds = members().sort(byId);
  return { speciesIds, size: speciesIds.length, target, pool: lines.reduce((sum, line) => sum + line.speciesIds.length, 0),
    lines: keyed.filter(line => chosen.has(line.id)).map(line => ({ id: line.id, speciesIds: line.speciesIds, source: chosen.get(line.id)!, key: line.key })),
    repairs, unmet: unmetConstraints(species, speciesIds, mode) };
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
