// Gameplay v19 unit classes: class counters, type affinity, HM / badge training gates and Rare Candy.
// Every function returns the neutral value (1000 / null / false) before v19, so older games are unchanged.
import { CLASS_COUNTERS, CLASS_NATIVE_TYPES, CLASS_NAMES, CLASS_RULES, classHms } from '../content/unit-classes.ts';
import { TREE_GATES } from '../content/tech-tree.ts';
import { treeGateOpen } from './tech-tree.ts';
import { ESSENCES, TYPE_ESSENCE } from '../content/essences.ts';
import type { EssenceId } from '../content/essences.ts';
import type { EraProgression } from '../content/eras.ts';
import type { Content, SpeciesId, UnitIdentity } from '../content/units.ts';
import { techOf } from '../content/units.ts';
import { playerGeneration } from './roster.ts';

type Versioned = { setup?: { gameplayVersion?: number }; gameplayVersion?: number };
export const usesUnitClasses = (source: Versioned) => ((source.setup?.gameplayVersion ?? source.gameplayVersion) ?? 0) >= 19;

const speciesOf = (identity: UnitIdentity, content: Content) => identity.kind === 'pokemon' ? content.species[identity.speciesId] : null;
/** Whether a Pokémon's primary or secondary type is native to its class. */
export function hasAffinity(identity: UnitIdentity, content: Content): boolean {
  const species = speciesOf(identity, content);
  return species !== null && CLASS_NATIVE_TYPES[species.role].some(type => type === species.typeId || type === species.secondaryTypeId);
}
/** Permille class factor on one strike between Pokémon (counter, siege penalty and the attacker's affinity). */
export function classStrikeMultiplier(source: Versioned, attacker: UnitIdentity, defender: UnitIdentity, content: Content): number {
  if (!usesUnitClasses(source)) return 1000;
  const a = speciesOf(attacker, content), d = speciesOf(defender, content);
  if (!a || !d) return 1000;
  const counter = CLASS_COUNTERS[a.role].beats.includes(d.role) ? CLASS_RULES.counter : a.role === 'siege' ? CLASS_RULES.siegeVsUnits : 1000;
  return counter * (hasAffinity(attacker, content) ? CLASS_RULES.affinity : 1000) / 1000;
}
/** The two parts of `classStrikeMultiplier`, for labelled combat-strength bonuses (v20). */
export function classCounterPermille(source: Versioned, attacker: UnitIdentity, defender: UnitIdentity, content: Content): number {
  if (!usesUnitClasses(source)) return 1000;
  const a = speciesOf(attacker, content), d = speciesOf(defender, content);
  if (!a || !d) return 1000;
  return CLASS_COUNTERS[a.role].beats.includes(d.role) ? CLASS_RULES.counter : a.role === 'siege' ? CLASS_RULES.siegeVsUnits : 1000;
}
export const affinityPermille = (source: Versioned, attacker: UnitIdentity, content: Content) =>
  usesUnitClasses(source) && hasAffinity(attacker, content) ? CLASS_RULES.affinity : 1000;
/** Permille factor on a Pokémon's city attack (affinity only). */
export const classCityMultiplier = (source: Versioned, attacker: UnitIdentity, content: Content) =>
  usesUnitClasses(source) && hasAffinity(attacker, content) ? CLASS_RULES.affinity : 1000;
/** Player-facing labels for the class factors of an attack (empty before v19). */
export function classModifierLabels(source: Versioned, attacker: UnitIdentity, defender: UnitIdentity | null, content: Content): string[] {
  if (!usesUnitClasses(source)) return [];
  const a = speciesOf(attacker, content), d = defender ? speciesOf(defender, content) : null, labels: string[] = [];
  if (a && d && CLASS_COUNTERS[a.role].beats.includes(d.role)) labels.push(`兵种克制（${CLASS_NAMES[a.role]}克${CLASS_NAMES[d.role]}）×1.2`);
  else if (a && d && a.role === 'siege') labels.push('攻城打宝可梦 ×0.8');
  if (hasAffinity(attacker, content)) labels.push('属性契合 +15%');
  return labels;
}

/** Badges: essences of the type gyms standing in the player's own cities. */
export type BadgeSource = { gyms: readonly { cityId: number; essence: EssenceId }[]; ownCityIds: ReadonlySet<number> };
export const ownBadges = (source: BadgeSource): Set<EssenceId> => new Set(source.gyms.filter(gym => source.ownCityIds.has(gym.cityId)).map(gym => gym.essence));
export type TrainingBlocker = { kind: 'hm' | 'tech' | 'generation' | 'badge'; text: string };
/** Why a city may not train this species (null = it may). Older versions: never blocked here. */
export function classTrainingBlocker(version: Versioned, player: { research: { unlockedIds: readonly string[]; tree?: true } }, mode: EraProgression | undefined,
  badges: ReadonlySet<EssenceId>, speciesId: SpeciesId, content: Content): TrainingBlocker | null {
  if (!usesUnitClasses(version)) return null;
  const species = content.species[speciesId];
  if (!species) return null;
  const hm = classHms(content)[species.role];
  if (hm && !player.research.unlockedIds.includes(hm.techId)) return { kind: 'hm', text: `需要秘传「${hm.hm}」（研究${techOf(content, hm.techId).name}）` };
  if (species.stage === 3) {
    if (!treeGateOpen(player, 'finalStage')) return { kind: 'tech', text: `最终形态要先研究「${techOf(content, TREE_GATES.finalStage).name}」` };
    if (playerGeneration(player, mode) < CLASS_RULES.finalStageGeneration) return { kind: 'generation', text: '最终形态要进入金银时代才能训练' };
    const essence = TYPE_ESSENCE[species.typeId];
    if (!badges.has(essence)) return { kind: 'badge', text: `需要「${ESSENCES[essence].name}」徽章（建一座${ESSENCES[essence].name}属性道馆）` };
  }
  return null;
}
/** Rare Candy: a stage-1 Pokémon may evolve without the XP from generation 2, paying this much gold (null = not applicable). */
export function candyGold(version: Versioned, player: { research: { unlockedIds: readonly string[] } }, mode: EraProgression | undefined,
  stage: number, evolutionGold: number): number | null {
  if (!usesUnitClasses(version) || stage !== 1 || playerGeneration(player, mode) < CLASS_RULES.candyGeneration) return null;
  return evolutionGold * CLASS_RULES.candyGoldMultiplier;
}

type StateLike = { expansion?: { essences?: { gyms: Record<number, EssenceId> } }; cities: Record<number, { id: number; ownerId: number | null }> };
export const stateBadges = (state: StateLike, playerId: number): Set<EssenceId> => ownBadges({
  gyms: Object.entries(state.expansion?.essences?.gyms ?? {}).map(([cityId, essence]) => ({ cityId: Number(cityId), essence })),
  ownCityIds: new Set(Object.values(state.cities).filter(city => city.ownerId === playerId).map(city => city.id)) });
type ViewLike = { expansion?: { essences?: { gyms: readonly { cityId: number; essence: EssenceId }[] } }; economy: { cities: readonly { id: number }[] } };
export const viewBadges = (view: ViewLike): Set<EssenceId> => ownBadges({ gyms: view.expansion?.essences?.gyms ?? [], ownCityIds: new Set(view.economy.cities.map(city => city.id)) });
