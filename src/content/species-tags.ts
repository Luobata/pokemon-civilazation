// Gameplay v25 B (docs/design/roster-v25.md §3): species tags. One row per species replaces the hand-written per-system tables
// (spawn weights, wanderers, recruits, nests, leader units, landmark residents, habitat overlays, deep water); the regional
// tables are derived from these tags (src/content/regional-dex.ts). Transposed once from the v14 / v22 / v24 tables, which stay
// untouched for v<=24; tests/core/species-tags.test.ts proves the full-pool derivation equals them (known additions: sneasel
// snow 8, clefairy mountain 8, §3.1). Evolution, generation, role, stage and types are read from the species definition.
import type { BiomeId } from './rules.ts';
import type { LeaderId } from './leaders.ts';
import type { LandmarkId } from './terrain.ts';
import type { RecruitSlotId } from './recruit-slots.ts';

/** Wild habitat keys: the seven biomes plus the v24 feature overlays (hills, rivers, mountains beside a peak). */
export type HabitatKey = BiomeId | 'hill' | 'river' | 'peakside';
export const HABITAT_FEATURE_KEYS = ['hill', 'river', 'peakside'] as const;
export type SpeciesTags = {
  /** Wild spawn weight per biome / feature overlay. */
  habitat?: Partial<Record<HabitatKey, number>>;
  /** v24 deep water: multiply the weight, or remove the species from deep tiles. */
  deep?: { multiply?: number; remove?: true };
  rarity: 'common' | 'uncommon' | 'rare';
  /** `anchor`: in every regional Pokédex; `favored`: two draw tickets. */
  iconic?: 'anchor' | 'favored';
  /** Recruit slots this species is the first choice of (src/content/recruit-slots.ts). */
  recruit?: readonly RecruitSlotId[];
  /** Nest weight (nest representatives). */
  nest?: number;
  wanderer?: true;
  /** Leaders whose unique unit this species is. */
  leader?: readonly LeaderId[];
  /** v24 landmarks this species lives at. */
  resident?: readonly LandmarkId[];
  /** Draw tickets override (flavour-line compensation, measured by tools/regional-dex.ts). */
  draw?: number;
};

export const SPECIES_TAGS: Readonly<Record<string, SpeciesTags>> = {
  abra: { habitat: { mountain: 10, snow: 35 }, rarity: 'common', recruit: ['laboratory'], resident: ['mistlockGorge'] },
  aegislash: { rarity: 'common' },
  alakazam: { rarity: 'rare' },
  arbok: { rarity: 'common' },
  beldum: { habitat: { mountain: 10, peakside: 10 }, rarity: 'rare', recruit: ['steelworks'] },
  bisharp: { rarity: 'common' },
  blastoise: { rarity: 'common' },
  bulbasaur: { habitat: { forest: 25 }, rarity: 'common', resident: ['elderCanopy'] },
  caterpie: { habitat: { forest: 10, river: 10 }, rarity: 'uncommon', nest: 3, resident: ['elderCanopy'] },
  charizard: { rarity: 'common' },
  charmander: { habitat: { grassland: 5, volcano: 45 }, rarity: 'common', resident: ['emberCaldera'] },
  charmeleon: { rarity: 'common' },
  clefable: { rarity: 'common' },
  clefairy: { habitat: { mountain: 8 }, rarity: 'uncommon', nest: 3, resident: ['stardustMere'] },
  corviknight: { rarity: 'common' },
  corvisquire: { rarity: 'common' },
  crobat: { rarity: 'common' },
  deino: { habitat: { volcano: 10 }, rarity: 'rare' },
  doublade: { rarity: 'common' },
  dragapult: { rarity: 'rare' },
  dragonair: { rarity: 'rare', leader: ['lance'] },
  dragonite: { rarity: 'rare' },
  drakloak: { rarity: 'rare' },
  dratini: { habitat: { snow: 10 }, rarity: 'rare', iconic: 'favored', recruit: ['dragonLore'], wanderer: true, resident: ['everfrostHollow'] },
  dreepy: { habitat: { snow: 10 }, rarity: 'rare' },
  drilbur: { habitat: { desert: 18 }, rarity: 'common', resident: ['singingDunes'] },
  eevee: { habitat: { grassland: 6 }, rarity: 'uncommon', iconic: 'favored', recruit: ['breeding'], nest: 3 },
  ekans: { habitat: { forest: 10, river: 10 }, rarity: 'uncommon', nest: 3, draw: 2 },
  espeon: { rarity: 'common' },
  excadrill: { rarity: 'common' },
  exeggcute: { habitat: { forest: 15 }, rarity: 'common', draw: 2 },
  exeggutor: { rarity: 'common' },
  fletchinder: { rarity: 'common' },
  fletchling: { habitat: { grassland: 15 }, rarity: 'common', wanderer: true },
  flygon: { rarity: 'common' },
  gastly: { habitat: { mountain: 15, volcano: 20 }, rarity: 'common', iconic: 'favored', resident: ['mistlockGorge'] },
  gengar: { rarity: 'rare' },
  geodude: { habitat: { mountain: 30, desert: 15, hill: 15 }, rarity: 'common', recruit: ['stoneCraft'] },
  glaceon: { rarity: 'common' },
  golbat: { rarity: 'common' },
  golem: { rarity: 'common' },
  graveler: { rarity: 'common', leader: ['steven'] },
  gyarados: { rarity: 'common', leader: ['misty'] },
  haunter: { rarity: 'common' },
  honedge: { habitat: { desert: 12, volcano: 8 }, rarity: 'common', recruit: ['generation6'] },
  horsea: { habitat: { ocean: 30 }, rarity: 'common', recruit: ['oceanography'], resident: ['tidesongGrotto'] },
  hydreigon: { rarity: 'rare' },
  ivysaur: { rarity: 'common', leader: ['joy'] },
  kadabra: { rarity: 'common', leader: ['oak'] },
  kingambit: { rarity: 'common' },
  kingdra: { rarity: 'common' },
  lapras: { habitat: { ocean: 10 }, deep: { multiply: 3 }, rarity: 'rare', iconic: 'favored', resident: ['tidesongGrotto'] },
  leafeon: { rarity: 'common' },
  lucario: { rarity: 'common' },
  machamp: { rarity: 'common' },
  machoke: { rarity: 'common', leader: ['jenny'] },
  machop: { habitat: { mountain: 20, desert: 10, hill: 10 }, rarity: 'common', recruit: ['training'] },
  magikarp: { habitat: { ocean: 40 }, rarity: 'common', recruit: ['seafaring'], wanderer: true },
  magnemite: { habitat: { desert: 15 }, rarity: 'common', recruit: ['typeResearch'], nest: 3, resident: ['thunderMesa'] },
  magneton: { rarity: 'common', leader: ['jasmine'] },
  magnezone: { rarity: 'common' },
  mamoswine: { rarity: 'common' },
  mareanie: { habitat: { ocean: 20 }, rarity: 'common' },
  meowth: { habitat: { grassland: 15, forest: 10, desert: 10, snow: 10 }, rarity: 'common', wanderer: true },
  metagross: { rarity: 'rare' },
  metang: { rarity: 'rare' },
  mimikyu: { habitat: { snow: 10 }, rarity: 'uncommon', recruit: ['generation7'] },
  onix: { habitat: { mountain: 10, volcano: 10, peakside: 10 }, rarity: 'rare', leader: ['brock'] },
  pawniard: { habitat: { volcano: 15 }, rarity: 'common', recruit: ['generation5'] },
  pidgeot: { rarity: 'common' },
  pidgeotto: { rarity: 'common' },
  pidgey: { habitat: { grassland: 25, forest: 20 }, rarity: 'common', iconic: 'favored', recruit: ['aviation'], wanderer: true },
  pikachu: { habitat: { grassland: 15, forest: 15 }, rarity: 'common', iconic: 'anchor', recruit: ['electricity'], wanderer: true, resident: ['thunderMesa'] },
  piloswine: { rarity: 'common' },
  ponyta: { habitat: { grassland: 10, desert: 15, volcano: 25 }, rarity: 'common', recruit: ['riding'], resident: ['emberCaldera'] },
  raichu: { rarity: 'common' },
  rapidash: { rarity: 'common' },
  raticate: { rarity: 'common' },
  rattata: { habitat: { grassland: 30, desert: 20, snow: 10 }, rarity: 'common', recruit: ['domestication'], wanderer: true },
  riolu: { habitat: { mountain: 12 }, rarity: 'common', recruit: ['generation4'] },
  rookidee: { habitat: { grassland: 12 }, rarity: 'common', recruit: ['generation8'], wanderer: true },
  sandshrew: { habitat: { desert: 15, hill: 10 }, rarity: 'common', nest: 3, resident: ['singingDunes'] },
  sandslash: { rarity: 'common', leader: ['giovanni'] },
  scizor: { rarity: 'common' },
  scyther: { habitat: { forest: 15 }, rarity: 'common', resident: ['elderCanopy'] },
  seadra: { rarity: 'common' },
  sneasel: { habitat: { snow: 8 }, rarity: 'uncommon', recruit: ['generation2'], resident: ['everfrostHollow'] },
  snorlax: { habitat: { forest: 15 }, rarity: 'rare', iconic: 'favored' },
  squirtle: { habitat: { ocean: 20, river: 20 }, deep: { remove: true }, rarity: 'common' },
  steelix: { rarity: 'rare' },
  swinub: { habitat: { snow: 25 }, rarity: 'common', recruit: ['meteorology'], nest: 3, resident: ['everfrostHollow'] },
  sylveon: { rarity: 'common' },
  talonflame: { rarity: 'common' },
  tinkatink: { habitat: { mountain: 12 }, rarity: 'common', recruit: ['generation9'] },
  tinkaton: { rarity: 'common' },
  tinkatuff: { rarity: 'common' },
  toxapex: { rarity: 'common' },
  trapinch: { habitat: { desert: 20 }, rarity: 'common', resident: ['singingDunes'] },
  umbreon: { rarity: 'rare', nest: 1 },
  venusaur: { rarity: 'common' },
  vibrava: { rarity: 'common', recruit: ['generation3'] },
  wartortle: { rarity: 'common' },
  weavile: { rarity: 'common' },
  zubat: { habitat: { mountain: 20, peakside: 10 }, rarity: 'common', recruit: ['fieldObservation'], nest: 3, wanderer: true },
  zweilous: { rarity: 'rare' },
};
