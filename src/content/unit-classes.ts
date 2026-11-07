// Gameplay v19 unit classes (docs/design/unit-classes-v19.md): types decide who counters whom; classes decide how a
// Pokémon fights. Civilization's tech/era/upgrade skeleton is expressed through Pokémon's own systems: HMs, gym
// badges and Rare Candy.
import type { TechId } from './economy.ts';
import type { SpeciesDefinition, TypeId } from './species.ts';
import { TREE_CLASS_HMS } from './tech-tree.ts';

export type UnitClass = SpeciesDefinition['role'];
export const CLASS_IDS: readonly UnitClass[] = ['melee', 'ranged', 'fast', 'scout', 'siege', 'air', 'naval'];
export const CLASS_NAMES: Record<UnitClass, string> = { melee: '近战', ranged: '远程', fast: '快速', scout: '侦察', siege: '攻城', air: '飞行', naval: '水面' };
export const CLASS_RULES = {
  /** Permille on a strike where the attacker's class counters the defender's. */
  counter: 1200,
  /** Siege Pokémon striking other Pokémon. */
  siegeVsUnits: 800,
  /** Damage bonus (permille) when a Pokémon's type fits its class. */
  affinity: 1150,
  /** Rare Candy: gold multiplier on the normal evolution gold, available from this generation. */
  candyGoldMultiplier: 3, candyGeneration: 2,
  /** Stage-3 training needs this generation plus the matching gym badge. */
  finalStageGeneration: 2,
} as const;
export const CLASS_COUNTERS: Record<UnitClass, { beats: readonly UnitClass[]; note: string }> = {
  melee: { beats: ['fast'], note: '挡住冲锋' },
  fast: { beats: ['ranged', 'siege'], note: '近身冲击' },
  ranged: { beats: ['air', 'naval'], note: '对空、岸防' },
  air: { beats: ['siege', 'naval'], note: '空袭' },
  naval: { beats: ['melee'], note: '陆军难以还手' },
  siege: { beats: [], note: '只擅长破城，攻击宝可梦 ×0.8' },
  scout: { beats: [], note: '侦察，不参与相克' },
};
export const CLASS_NATIVE_TYPES: Record<UnitClass, readonly TypeId[]> = {
  melee: ['fighting', 'normal', 'dark'], ranged: ['fire', 'electric', 'psychic', 'ice'], fast: ['electric', 'dark', 'fire'],
  scout: ['normal', 'flying', 'bug'], siege: ['rock', 'ground', 'steel'], air: ['flying', 'dragon'], naval: ['water', 'ice'],
};
/** HMs (秘传学习器): a technology teaches the HM, and the HM lets cities train that class. Other classes need none. */
export const CLASS_HMS: Partial<Record<UnitClass, { hm: string; techId: TechId }>> = {
  naval: { hm: '冲浪', techId: 'domestication' },
  siege: { hm: '怪力', techId: 'stoneCraft' },
  fast: { hm: '骑乘', techId: 'riding' },
  air: { hm: '飞翔', techId: 'meteorology' },
};
/** The HM table of a content: v22's tree teaches 冲浪 with 近海航行 and 飞翔 with 飞行训练. */
export const classHms = (content: { techTree?: true }): Partial<Record<UnitClass, { hm: string; techId: TechId }>> => content.techTree ? TREE_CLASS_HMS : CLASS_HMS;
