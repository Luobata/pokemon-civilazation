// Gameplay v25 B (docs/design/roster-v25.md §3.3): recruit slots. A slot = class + types + first choice; the first choice is the v22
// tech recruit (TREE_RECRUITS) or the v14 generation recruit. A regional Pokédex resolves every slot to its first choice when that
// species is in the region, otherwise to the best regional species of the same kind, otherwise to nothing (an empty slot).
import type { TechId } from './economy.ts';
import type { SpeciesDefinition, SpeciesId, TypeId } from './species.ts';

export type RecruitRole = SpeciesDefinition['role'];
export type RecruitSlotId = 'domestication' | 'stoneCraft' | 'seafaring' | 'riding' | 'typeResearch' | 'fieldObservation' | 'electricity' | 'meteorology'
  | 'training' | 'laboratory' | 'aviation' | 'oceanography' | 'breeding' | 'steelworks' | 'dragonLore'
  | 'generation2' | 'generation3' | 'generation4' | 'generation5' | 'generation6' | 'generation7' | 'generation8' | 'generation9';
export type RecruitSlot = {
  id: RecruitSlotId; preferred: SpeciesId;
  /** Tech slots: the technology; generation slots: the generation (2–9). */
  techId?: TechId; generation?: number;
  role?: RecruitRole; types?: readonly TypeId[];
  /** Coverage constraint C11: a core slot is never empty. */
  core?: true;
  /** Content batches (roster-v26 on, depth-v26 §4.3): a newer first choice. Species tables that define it resolve the slot to it first and
   * demote `preferred` to the first named fallback; older tables (v25) do not define it, so their resolution is unchanged. */
  upgrade?: SpeciesId;
  /** A named fallback tried right after the first choice (level 2); skipped by species tables that do not define it. */
  fallback?: SpeciesId;
  /** UI wording: "本地区的<kind>". */
  kind: string;
};
const tech = (id: RecruitSlotId & TechId, preferred: SpeciesId, role: RecruitRole, types: readonly TypeId[] | undefined, kind: string, core?: true): RecruitSlot =>
  ({ id, preferred, techId: id, role, ...(types ? { types } : {}), kind, ...(core ? { core } : {}) });
const upgraded = (slot: RecruitSlot, upgrade: SpeciesId, fallback?: SpeciesId): RecruitSlot => ({ ...slot, upgrade, ...(fallback ? { fallback } : {}) });
const generation = (value: number, preferred: SpeciesId): RecruitSlot =>
  ({ id: `generation${value}` as RecruitSlotId, preferred, generation: value, kind: `第 ${value} 世代宝可梦`, core: true });
/** Resolution order: tech columns left to right (TREE_TECHS declaration order inside a column), then the generations. */
export const RECRUIT_SLOTS: readonly RecruitSlot[] = [
  tech('domestication', 'rattata', 'scout', ['normal'], '一般系侦察宝可梦', true),
  tech('stoneCraft', 'geodude', 'siege', ['rock', 'ground', 'steel'], '攻城宝可梦', true),
  tech('seafaring', 'magikarp', 'naval', undefined, '水面宝可梦', true),
  { ...tech('riding', 'ponyta', 'fast', undefined, '快速宝可梦', true), fallback: 'doduo' },
  tech('typeResearch', 'magnemite', 'ranged', ['electric', 'steel'], '电 / 钢系远程宝可梦'),
  tech('fieldObservation', 'zubat', 'scout', ['flying', 'poison'], '飞行 / 毒系侦察宝可梦'),
  tech('electricity', 'pikachu', 'ranged', ['electric'], '电系远程宝可梦'),
  tech('meteorology', 'swinub', 'melee', ['ice'], '冰系近战宝可梦'),
  tech('training', 'machop', 'melee', ['fighting'], '格斗系近战宝可梦', true),
  tech('laboratory', 'abra', 'ranged', ['psychic'], '超能系远程宝可梦'),
  upgraded(tech('aviation', 'pidgey', 'scout', ['flying'], '飞行系宝可梦', true), 'spearow'),
  tech('oceanography', 'horsea', 'naval', undefined, '第二种水面宝可梦'),
  tech('breeding', 'eevee', 'melee', ['normal'], '一般系近战宝可梦'),
  tech('steelworks', 'beldum', 'melee', ['steel'], '钢系近战宝可梦'),
  tech('dragonLore', 'dratini', 'melee', ['dragon'], '龙系宝可梦'),
  generation(2, 'sneasel'), generation(3, 'vibrava'), generation(4, 'riolu'), generation(5, 'pawniard'),
  generation(6, 'honedge'), generation(7, 'mimikyu'), generation(8, 'rookidee'), generation(9, 'tinkatink'),
];
/** How a slot was filled: 1 first choice, 2 same class and type, 3 same type, 4 same class, 5 same generation, 6 empty. */
export type RecruitLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type ResolvedRecruit = { slot: RecruitSlotId; speciesId: SpeciesId | null; level: RecruitLevel };

type Species = Record<string, SpeciesDefinition>;
/** A slot's first choice in a species table: the batch `upgrade` when the table defines it, else `preferred`. */
export const firstChoiceOf = (slot: RecruitSlot, species: Readonly<Species>): SpeciesId => slot.upgrade && species[slot.upgrade] ? slot.upgrade : slot.preferred;
/** A slot's named fallbacks in a species table (level 2, in order): the demoted `preferred` under an upgrade, then `fallback`. */
const namedFallbacks = (slot: RecruitSlot, species: Species): SpeciesId[] =>
  [...(firstChoiceOf(slot, species) !== slot.preferred ? [slot.preferred] : []), ...(slot.fallback && species[slot.fallback] ? [slot.fallback] : [])];
const generationOf = (species: Species, id: SpeciesId) => species[id]?.generation ?? 1;
const typesOf = (definition: SpeciesDefinition) => definition.secondaryTypeId ? [definition.typeId, definition.secondaryTypeId] : [definition.typeId];

/**
 * §3.3 resolution, strictly in slot order; a species used by an earlier slot is not used again and the starter lines never fill a slot.
 * Fallbacks skip the other slots' regional first choices; a core slot may still take one when nothing else fits.
 * Only slots up to `maxGeneration` resolve (simple-era games stop at generation 3). Within a level: non-rare first, lower stage, id.
 */
export function resolveRecruits(species: Species, speciesIds: readonly SpeciesId[], maxGeneration: number, excluded: ReadonlySet<SpeciesId>): ResolvedRecruit[] {
  const used = new Set<SpeciesId>(), dex = new Set(speciesIds), tables = slotTables(species);
  const pool = tables.order.filter(id => dex.has(id) && !excluded.has(id));
  const active = RECRUIT_SLOTS.filter(slot => slot.generation === undefined || slot.generation <= maxGeneration);
  // Regional first choices are reserved for their own slots: only a core slot (C11, never empty) may borrow one when nothing else fits,
  // e.g. seafaring takes horsea when magikarp is not regional; other slots stay empty rather than take another slot's first choice.
  // A slot whose first choice is not regional reserves its first regional named fallback instead (v26: pidgey for flight training when
  // spearow is not regional); v25 tables define no named fallback, so there the reserved set is the regional first choices.
  const reservedBy = new Map<SpeciesId, RecruitSlotId>();
  for (const slot of active) {
    const pick = [firstChoiceOf(slot, species), ...namedFallbacks(slot, species)].find(id => dex.has(id) && !excluded.has(id));
    if (pick && !reservedBy.has(pick)) reservedBy.set(pick, slot.id);
  }
  const resolved: ResolvedRecruit[] = [];
  for (const [index, slot] of RECRUIT_SLOTS.entries()) {
    if (!active.includes(slot)) continue;
    let found: ResolvedRecruit = { slot: slot.id, speciesId: null, level: 6 };
    const first = firstChoiceOf(slot, species);
    if (dex.has(first) && !excluded.has(first) && !used.has(first)) found = { slot: slot.id, speciesId: first, level: 1 };
    else for (const free of slot.core ? [true, false] : [true]) {
      for (const [level, test] of tables.levels[index]) {
        const speciesId = pool.find(id => !used.has(id) && (!free || (reservedBy.get(id) ?? slot.id) === slot.id) && test(species[id], id));
        if (speciesId) { found = { slot: slot.id, speciesId, level }; break; }
      }
      if (found.speciesId) break;
    }
    if (found.speciesId) used.add(found.speciesId);
    resolved.push(found);
  }
  return resolved;
}
const tableCache = new WeakMap<Species, { order: SpeciesId[]; levels: LevelTest[][] }>();
/** Per species table: every species in tie order (non-rare, lower stage, id) and each slot's fallback levels. */
function slotTables(species: Species) {
  let tables = tableCache.get(species);
  if (!tables) {
    const order = (Object.keys(species) as SpeciesId[]).sort((a, b) => Number(species[a].rare) - Number(species[b].rare) || species[a].stage - species[b].stage || (a < b ? -1 : a > b ? 1 : 0));
    tableCache.set(species, tables = { order, levels: RECRUIT_SLOTS.map(slot => slotLevels(species, slot)) });
  }
  return tables;
}
type LevelTest = [RecruitLevel, (definition: SpeciesDefinition, id: SpeciesId) => boolean];
/** Fallback levels 2–5 of a slot (§3.3). */
function slotLevels(species: Species, slot: RecruitSlot): LevelTest[] {
  if (slot.generation !== undefined) return [[5, (definition, id) => generationOf(species, id) === slot.generation && definition.stage <= 2]];
  const typed = (definition: SpeciesDefinition) => !slot.types || typesOf(definition).some(type => slot.types!.includes(type));
  const preferredGeneration = generationOf(species, firstChoiceOf(slot, species));
  return [
    ...namedFallbacks(slot, species).map(named => [2, (_: SpeciesDefinition, id: SpeciesId) => id === named] as LevelTest),
    [2, (definition, id) => definition.role === slot.role && typed(definition) && definition.stage === 1 && generationOf(species, id) <= preferredGeneration],
    ...(slot.types ? [[3, (definition: SpeciesDefinition) => typed(definition) && definition.stage === 1] as LevelTest] : []),
    [4, definition => definition.role === slot.role && definition.stage === 1],
  ];
}
