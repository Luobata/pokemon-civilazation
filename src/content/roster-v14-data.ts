/**
 * Roster v14 data (docs/design/roster-v14.md, proposal: docs/design/roster-expansion-proposal.md).
 *
 * Plain data only. Not imported by anything yet; the v14 content pack will build
 * `ROSTER_V14_CONTENT` = frozen 47 expansion-v1 species + these 58, and route spawn
 * tables, recruits, nests, leader units and stone evolutions through it.
 *
 * Design summary
 * - 58 new species, `generation` = original dex generation (1–9). The original 47 have
 *   no generation and stay unrestricted.
 * - Evolution into a generation-N species requires the player's generation >= N
 *   (`minGeneration`, set on every edge whose target is generation >= 2). Simple-era games
 *   stop at generation 3, so generation 4+ species only appear in full-era games.
 * - Stats follow `validateSpecies` (stage 1 150–170, stage 2 210–240, stage 3 280–320),
 *   trainCost = floor(sum / 8), upkeep = stage, power = 10, and the §1.4 implicit rules:
 *   - mobility tax: move 5 sits near the stage floor (210 / 280) unless rare; move 2 near the ceiling;
 *   - rare premium: only rare species exceed 300 at stage 3 (cap 315, the existing maximum);
 *   - range 3 only for stage-3 siege (magnezone is the only new one, mirroring golem);
 *   - ×4 weakness: attack is moved into defense, capped at 58 / 88 / 105 for stages 1 / 2 / 3
 *     (just under the existing non-×4 top attackers 62 / 92 / 108+).
 * - Roles fill the proposal's gaps: second/third/fourth siege family (magneton line, exeggutor,
 *   tinkaton), early & mid flyers (zubat, vibrava, fletchling, rookidee lines), steel/bug/dark/
 *   fairy/ice attackers, and ranged naval (horsea line).
 * - Eevee branches are stage 1 -> stage 3 (umbreon already exists as a standalone stage 3), so
 *   the single eevee evolution costs the stage-3 price (250 xp, 80 gold, training).
 * - `immunities` lists the zero cells of FULL_TYPE_CHART for the species' types. Expansion combat
 *   (`dualEffectiveness`) already reads the chart and ignores this field; it is kept for the
 *   legacy single-type path and the UI, matching how ground species list `electric` today.
 *
 * Rules bent (see each line):
 * - exeggutor 85/80/75 -> 85/64/91: bug ×4 weakness reallocation (its own pre-evolution is 42 attack).
 * - scyther 65/92/58 -> 66/88/61, sneasel 58/92/62 -> 60/88/64, scizor 82/108/98 -> 84/102/102:
 *   same ×4 reallocation rule (rock / fighting / fire ×4); still the fastest-hitting units of their stage.
 * - trapinch keeps the proposal's 70 attack (above every existing stage 1): no ×4 weakness, move 2.
 * - eevee skips stage 2 (see above).
 */
import type { BiomeId } from './rules.ts';
import type { TypeId } from './species.ts';

export type RosterTerrain = 'land' | 'all' | 'ocean' | BiomeId[];
export type EvolutionCondition =
  | 'day'
  | 'night'
  | { biome: BiomeId }
  | { stone: 'fireStone' | 'waterStone' | 'leafStone' | 'thunderStone' | 'moonStone' };
export type RosterEvolution = {
  speciesId: string; xp: number; gold: number; requiresTraining: boolean;
  minGeneration?: number; condition?: EvolutionCondition;
};
export type RosterSpecies = {
  name: string; dex: number; generation: number;
  typeId: TypeId; secondaryTypeId?: TypeId; stage: 1 | 2 | 3;
  role: 'ranged' | 'melee' | 'scout' | 'fast' | 'siege' | 'naval' | 'air';
  maxHp: number; attack: number; defense: number; move: number; range: number; power: 10; vision: number;
  rare: boolean; immunities: TypeId[]; trainCost: number; upkeep: number;
  terrain: RosterTerrain; spawnBiomes: BiomeId[]; evolutions: RosterEvolution[];
};

const landVolcano: BiomeId[] = ['grassland', 'forest', 'mountain', 'desert', 'snow', 'volcano'];
const landOcean: BiomeId[] = ['grassland', 'forest', 'mountain', 'desert', 'snow', 'ocean'];

/** Standard evolution prices (same as the existing lines). */
const toStage2 = (speciesId: string, minGeneration?: number): RosterEvolution =>
  ({ speciesId, xp: 100, gold: 30, requiresTraining: false, ...(minGeneration ? { minGeneration } : {}) });
const toStage3 = (speciesId: string, minGeneration?: number, condition?: EvolutionCondition): RosterEvolution =>
  ({ speciesId, xp: 250, gold: 80, requiresTraining: true, ...(minGeneration ? { minGeneration } : {}), ...(condition ? { condition } : {}) });

export const ROSTER_V14_SPECIES: Record<string, RosterSpecies> = {
  // ===== Generation 1 (#1–151) =====
  // Desert melee anchor, sand +20%; ground hits magneton ×4 — the standard answer to steel/electric siege. Weak to water/grass/ice.
  sandslash: { name: '穿山王', dex: 28, generation: 1, typeId: 'ground', stage: 2, role: 'melee', maxHp: 75, attack: 82, defense: 80, move: 3, range: 1, power: 10, vision: 2, rare: false, immunities: ['electric'], trainCost: 29, upkeep: 2, terrain: 'land', spawnBiomes: [], evolutions: [] },
  // Finishes the nest ekans line: forest poison bruiser that punishes fairy (clefable, later sylveon/mimikyu) and grass. Countered by ground (sandslash) and psychic.
  arbok: { name: '阿柏怪', dex: 24, generation: 1, typeId: 'poison', stage: 2, role: 'melee', maxHp: 70, attack: 85, defense: 68, move: 3, range: 1, power: 10, vision: 2, rare: false, immunities: [], trainCost: 27, upkeep: 2, terrain: 'land', spawnBiomes: [], evolutions: [] },
  // Earliest flyer: crosses sea/volcano, raids workers and settlers; fighting/grass/bug deal ×0.25. Countered by electric, psychic, rock, ice and city fire.
  zubat: { name: '超音蝠', dex: 41, generation: 1, typeId: 'poison', secondaryTypeId: 'flying', stage: 1, role: 'scout', maxHp: 50, attack: 52, defense: 48, move: 4, range: 1, power: 10, vision: 3, rare: false, immunities: ['ground'], trainCost: 18, upkeep: 1, terrain: 'all', spawnBiomes: ['mountain'], evolutions: [toStage2('golbat')] },
  // First stage-2 air unit (move 5): flanks ranged lines from the sea. Same counters as zubat.
  golbat: { name: '大嘴蝠', dex: 42, generation: 1, typeId: 'poison', secondaryTypeId: 'flying', stage: 2, role: 'air', maxHp: 70, attack: 74, defense: 66, move: 5, range: 1, power: 10, vision: 3, rare: false, immunities: ['ground'], trainCost: 26, upkeep: 2, terrain: 'all', spawnBiomes: [], evolutions: [toStage3('crobat', 2)] },
  // Second siege family: electric hits water/flying (gyarados ×4), grass deals only ×0.5, rock ×0.5. Countered by ground ×4 (sandslash, excadrill), fire, fighting.
  magneton: { name: '三合一磁怪', dex: 82, generation: 1, typeId: 'electric', secondaryTypeId: 'steel', stage: 2, role: 'siege', maxHp: 70, attack: 58, defense: 107, move: 2, range: 2, power: 10, vision: 2, rare: false, immunities: ['poison'], trainCost: 29, upkeep: 2, terrain: 'land', spawnBiomes: [], evolutions: [toStage3('magnezone', 4)] },
  // Forest siege seed; evolves only with a leaf stone (competes with ivysaur for the 2 deposits). Bug ×4.
  exeggcute: { name: '蛋蛋', dex: 102, generation: 1, typeId: 'grass', secondaryTypeId: 'psychic', stage: 1, role: 'siege', maxHp: 60, attack: 42, defense: 60, move: 2, range: 2, power: 10, vision: 2, rare: false, immunities: [], trainCost: 20, upkeep: 1, terrain: 'land', spawnBiomes: ['forest'], evolutions: [{ speciesId: 'exeggutor', xp: 100, gold: 0, requiresTraining: false, condition: { stone: 'leafStone' } }] },
  // Grass siege: breaks water/rock/ground garrisons (the starter-heavy AI cores). Countered by bug ×4 (scyther/scizor) and fire/ice/flying/poison/ghost/dark ×2.
  exeggutor: { name: '椰蛋树', dex: 103, generation: 1, typeId: 'grass', secondaryTypeId: 'psychic', stage: 2, role: 'siege', maxHp: 85, attack: 64, defense: 91, move: 2, range: 2, power: 10, vision: 2, rare: false, immunities: [], trainCost: 30, upkeep: 2, terrain: 'land', spawnBiomes: [], evolutions: [] },
  // First range-2 naval: shells coasts, water hits rock/ground (geodude line ×4) pushing along the shore. Countered by electric, grass.
  horsea: { name: '小海马', dex: 116, generation: 1, typeId: 'water', stage: 1, role: 'naval', maxHp: 50, attack: 58, defense: 52, move: 3, range: 2, power: 10, vision: 2, rare: false, immunities: [], trainCost: 20, upkeep: 1, terrain: 'ocean', spawnBiomes: ['ocean'], evolutions: [toStage2('seadra')] },
  // Mid-game coastal artillery; rain +30%, misty doctrine. Countered by electric, grass, and anything that can reach the sea (flyers).
  seadra: { name: '海刺龙', dex: 117, generation: 1, typeId: 'water', stage: 2, role: 'naval', maxHp: 62, attack: 82, defense: 68, move: 3, range: 2, power: 10, vision: 2, rare: false, immunities: [], trainCost: 26, upkeep: 2, terrain: 'ocean', spawnBiomes: [], evolutions: [toStage3('kingdra', 2)] },
  // First bug striker (move 5, ZOC): hunts psychic (kadabra), dark (umbreon) and grass; needs riding to train. Countered by rock ×4, fire/flying/electric/ice ×2.
  scyther: { name: '飞天螳螂', dex: 123, generation: 1, typeId: 'bug', secondaryTypeId: 'flying', stage: 2, role: 'fast', maxHp: 66, attack: 88, defense: 61, move: 5, range: 1, power: 10, vision: 2, rare: false, immunities: ['ground'], trainCost: 26, upkeep: 2, terrain: 'land', spawnBiomes: ['forest'], evolutions: [toStage3('scizor', 2)] },
  // Branching seed: day -> espeon, night -> umbreon, forest -> leafeon, snow -> glaceon, generation 6 -> sylveon. Countered by fighting.
  eevee: { name: '伊布', dex: 133, generation: 1, typeId: 'normal', stage: 1, role: 'melee', maxHp: 55, attack: 55, defense: 55, move: 3, range: 1, power: 10, vision: 2, rare: false, immunities: ['ghost'], trainCost: 20, upkeep: 1, terrain: 'land', spawnBiomes: ['grassland'], evolutions: [
    toStage3('espeon', 2, 'day'),
    toStage3('umbreon', 2, 'night'),
    toStage3('leafeon', 4, { biome: 'forest' }),
    toStage3('glaceon', 4, { biome: 'snow' }),
    toStage3('sylveon', 6),
  ] },

  // ===== Generation 2 (#152–251) =====
  // Gold/Silver flyer capstone; friendship xp +3/round grows golbats kept at home. Same counters as zubat.
  crobat: { name: '叉字蝠', dex: 169, generation: 2, typeId: 'poison', secondaryTypeId: 'flying', stage: 3, role: 'air', maxHp: 88, attack: 96, defense: 96, move: 5, range: 1, power: 10, vision: 3, rare: false, immunities: ['ground'], trainCost: 35, upkeep: 3, terrain: 'all', spawnBiomes: [], evolutions: [] },
  // Day eevee branch: ranged psychic glass cannon vs umbreon's dark tank; hits fighting/poison. Countered by dark (sneasel, weavile), bug, ghost.
  espeon: { name: '太阳伊布', dex: 196, generation: 2, typeId: 'psychic', stage: 3, role: 'ranged', maxHp: 80, attack: 112, defense: 90, move: 3, range: 2, power: 10, vision: 2, rare: false, immunities: [], trainCost: 35, upkeep: 3, terrain: 'land', spawnBiomes: [], evolutions: [] },
  // Onix's capstone: range-2 siege with no ×4 weakness, immune electric/poison — vs golem's range 3 but water/grass ×4. Countered by water, fire, fighting, ground.
  steelix: { name: '大钢蛇', dex: 208, generation: 2, typeId: 'steel', secondaryTypeId: 'ground', stage: 3, role: 'siege', maxHp: 100, attack: 72, defense: 138, move: 2, range: 2, power: 10, vision: 2, rare: true, immunities: ['electric', 'poison'], trainCost: 38, upkeep: 3, terrain: 'land', spawnBiomes: [], evolutions: [] },
  // Evolve-or-not: move 5 -> 3 but only fire ×4 remains, poison immune; forces opponents to keep fire. Countered by fire ×4 (talonflame, rapidash, sun).
  scizor: { name: '巨钳螳螂', dex: 212, generation: 2, typeId: 'bug', secondaryTypeId: 'steel', stage: 3, role: 'melee', maxHp: 84, attack: 102, defense: 102, move: 3, range: 1, power: 10, vision: 2, rare: false, immunities: ['poison'], trainCost: 36, upkeep: 3, terrain: 'land', spawnBiomes: [], evolutions: [] },
  // Gold/Silver recruit: arrives with night (+15% dark), move 5, raids abra/dratini snowfields; psychic immune. Countered by fighting ×4 (machop line, riolu).
  sneasel: { name: '狃拉', dex: 215, generation: 2, typeId: 'dark', secondaryTypeId: 'ice', stage: 2, role: 'fast', maxHp: 60, attack: 88, defense: 64, move: 5, range: 1, power: 10, vision: 2, rare: false, immunities: ['psychic'], trainCost: 26, upkeep: 2, terrain: 'land', spawnBiomes: [], evolutions: [toStage3('weavile', 4)] },
  // Slow snow heavy (move 2, top budget): ice hits dragon/flying/ground/grass; electric immune. Countered by fire, water, grass, fighting, steel.
  piloswine: { name: '长毛猪', dex: 221, generation: 2, typeId: 'ice', secondaryTypeId: 'ground', stage: 2, role: 'melee', maxHp: 90, attack: 80, defense: 70, move: 2, range: 1, power: 10, vision: 2, rare: false, immunities: ['electric'], trainCost: 30, upkeep: 2, terrain: 'land', spawnBiomes: [], evolutions: [toStage3('mamoswine', 4)] },
  // Non-rare dragon for lance/steven doctrines; range 2 stays inside city counter range. Only dragon/fairy ×2.
  kingdra: { name: '刺龙王', dex: 230, generation: 2, typeId: 'water', secondaryTypeId: 'dragon', stage: 3, role: 'naval', maxHp: 88, attack: 98, defense: 96, move: 4, range: 2, power: 10, vision: 2, rare: false, immunities: [], trainCost: 35, upkeep: 3, terrain: 'ocean', spawnBiomes: [], evolutions: [] },

  // ===== Generation 3 (#252–386) =====
  // Desert ambusher: highest stage-1 attack but move 2; ground hits fire/electric/rock/steel/poison. Countered by water, grass, ice, and being outrun.
  trapinch: { name: '大颚蚁', dex: 328, generation: 3, typeId: 'ground', stage: 1, role: 'melee', maxHp: 50, attack: 70, defense: 45, move: 2, range: 1, power: 10, vision: 2, rare: false, immunities: ['electric'], trainCost: 20, upkeep: 1, terrain: 'land', spawnBiomes: ['desert'], evolutions: [toStage2('vibrava', 3)] },
  // Ruby/Sapphire recruit: instant stage-2 flyer, electric immune, sand +20%. Countered by ice ×4 (piloswine, glaceon, lapras), dragon, fairy.
  vibrava: { name: '超音波幼虫', dex: 329, generation: 3, typeId: 'ground', secondaryTypeId: 'dragon', stage: 2, role: 'air', maxHp: 65, attack: 72, defense: 73, move: 5, range: 1, power: 10, vision: 3, rare: false, immunities: ['electric'], trainCost: 26, upkeep: 2, terrain: 'all', spawnBiomes: [], evolutions: [toStage3('flygon', 3)] },
  // Non-rare dragon flyer one tier below dragonite; the airborne answer to steel/electric siege. Countered by ice ×4.
  flygon: { name: '沙漠蜻蜓', dex: 330, generation: 3, typeId: 'ground', secondaryTypeId: 'dragon', stage: 3, role: 'air', maxHp: 90, attack: 95, defense: 95, move: 5, range: 1, power: 10, vision: 3, rare: false, immunities: ['electric'], trainCost: 35, upkeep: 3, terrain: 'all', spawnBiomes: [], evolutions: [] },
  // Rare mountain seed for steven's line: slow steel wall, poison immune. Countered by fire, ground, ghost, dark.
  beldum: { name: '铁哑铃', dex: 374, generation: 3, typeId: 'steel', secondaryTypeId: 'psychic', stage: 1, role: 'melee', maxHp: 55, attack: 50, defense: 65, move: 2, range: 1, power: 10, vision: 2, rare: true, immunities: ['poison'], trainCost: 21, upkeep: 1, terrain: 'land', spawnBiomes: ['mountain'], evolutions: [toStage2('metang', 3)] },
  // Mid-game steel/psychic wall; steel hits rock/ice/fairy (clefable). Countered by fire, ground, ghost, dark.
  metang: { name: '金属怪', dex: 375, generation: 3, typeId: 'steel', secondaryTypeId: 'psychic', stage: 2, role: 'melee', maxHp: 70, attack: 72, defense: 90, move: 3, range: 1, power: 10, vision: 2, rare: true, immunities: ['poison'], trainCost: 29, upkeep: 2, terrain: 'land', spawnBiomes: [], evolutions: [toStage3('metagross', 3)] },
  // Late steel core, rare premium (310). Countered by fire/ground ×2 and dark/ghost at night.
  metagross: { name: '巨金怪', dex: 376, generation: 3, typeId: 'steel', secondaryTypeId: 'psychic', stage: 3, role: 'melee', maxHp: 90, attack: 105, defense: 115, move: 3, range: 1, power: 10, vision: 2, rare: true, immunities: ['poison'], trainCost: 38, upkeep: 3, terrain: 'land', spawnBiomes: [], evolutions: [] },

  // ===== Generation 4 (#387–493) =====
  // Diamond/Pearl recruit: aura vision 3, fighting hits sneasel ×4 and steel/rock/dark/ice/normal. Countered by flying, psychic, fairy.
  riolu: { name: '利欧路', dex: 447, generation: 4, typeId: 'fighting', stage: 1, role: 'melee', maxHp: 55, attack: 58, defense: 52, move: 3, range: 1, power: 10, vision: 3, rare: false, immunities: [], trainCost: 20, upkeep: 1, terrain: 'land', spawnBiomes: ['mountain'], evolutions: [toStage2('lucario', 4)] },
  // Only ranged fighter: shells steel siege and dark frontlines (bisharp/kingambit/weavile ×4) from range 2. Countered by fire, fighting, ground; ghosts ignore it.
  lucario: { name: '路卡利欧', dex: 448, generation: 4, typeId: 'fighting', secondaryTypeId: 'steel', stage: 2, role: 'ranged', maxHp: 70, attack: 88, defense: 72, move: 3, range: 2, power: 10, vision: 3, rare: false, immunities: ['poison'], trainCost: 28, upkeep: 2, terrain: 'land', spawnBiomes: [], evolutions: [] },
  // Steel/electric siege capstone with golem's range 3: the choice is ground ×4 (magnezone) vs water/grass ×4 (golem).
  magnezone: { name: '自爆磁怪', dex: 462, generation: 4, typeId: 'electric', secondaryTypeId: 'steel', stage: 3, role: 'siege', maxHp: 88, attack: 80, defense: 132, move: 2, range: 3, power: 10, vision: 2, rare: false, immunities: ['poison'], trainCost: 37, upkeep: 3, terrain: 'land', spawnBiomes: [], evolutions: [] },
  // Forest eevee branch: grass melee hunter of rock/ground siege (golem/graveler ×4) and water. Countered by fire, ice, poison, flying, bug.
  leafeon: { name: '叶伊布', dex: 470, generation: 4, typeId: 'grass', stage: 3, role: 'melee', maxHp: 82, attack: 102, defense: 108, move: 3, range: 1, power: 10, vision: 2, rare: false, immunities: [], trainCost: 36, upkeep: 3, terrain: 'land', spawnBiomes: [], evolutions: [] },
  // Snow eevee branch: ranged anti-air/anti-dragon (flygon/vibrava ×4, dragonite, hydreigon). Countered by fire, fighting, rock, steel.
  glaceon: { name: '冰伊布', dex: 471, generation: 4, typeId: 'ice', stage: 3, role: 'ranged', maxHp: 75, attack: 110, defense: 100, move: 3, range: 2, power: 10, vision: 2, rare: false, immunities: [], trainCost: 35, upkeep: 3, terrain: 'land', spawnBiomes: [], evolutions: [] },
  // Swinub line capstone: slow ice/ground juggernaut, hail +30%; flattens flyers and dragons. Countered by fire, water, grass, fighting, steel.
  mamoswine: { name: '象牙猪', dex: 473, generation: 4, typeId: 'ice', secondaryTypeId: 'ground', stage: 3, role: 'melee', maxHp: 104, attack: 102, defense: 94, move: 2, range: 1, power: 10, vision: 2, rare: false, immunities: ['electric'], trainCost: 37, upkeep: 3, terrain: 'land', spawnBiomes: [], evolutions: [] },
  // Night raider capstone (move 5): deletes espeon/alakazam/gengar/aegislash/dragapult. Countered by fighting ×4 (lucario, machamp).
  weavile: { name: '玛狃拉', dex: 461, generation: 4, typeId: 'dark', secondaryTypeId: 'ice', stage: 3, role: 'fast', maxHp: 82, attack: 105, defense: 93, move: 5, range: 1, power: 10, vision: 2, rare: false, immunities: ['psychic'], trainCost: 35, upkeep: 3, terrain: 'land', spawnBiomes: [], evolutions: [] },

  // ===== Generation 5 (#494–649) =====
  // Desert digger: cheap ground melee that grows into the anti-siege rusher. Countered by water, grass, ice.
  drilbur: { name: '螺钉地鼠', dex: 529, generation: 5, typeId: 'ground', stage: 1, role: 'melee', maxHp: 60, attack: 56, defense: 50, move: 3, range: 1, power: 10, vision: 2, rare: false, immunities: ['electric'], trainCost: 20, upkeep: 1, terrain: 'land', spawnBiomes: ['desert'], evolutions: [toStage2('excadrill', 5)] },
  // Fast ground/steel (move 5, sand +20%): runs down magneton/magnezone (×4) and steel/rock siege; electric/poison immune. Countered by water, fire, fighting, ground.
  excadrill: { name: '龙头地鼠', dex: 530, generation: 5, typeId: 'ground', secondaryTypeId: 'steel', stage: 2, role: 'fast', maxHp: 68, attack: 88, defense: 60, move: 5, range: 1, power: 10, vision: 2, rare: false, immunities: ['electric', 'poison'], trainCost: 27, upkeep: 2, terrain: 'land', spawnBiomes: [], evolutions: [] },
  // Black/White recruit: volcano-capable dark/steel infantry, immune psychic & poison. Countered by fighting ×4, fire, ground.
  pawniard: { name: '驹刀小兵', dex: 624, generation: 5, typeId: 'dark', secondaryTypeId: 'steel', stage: 1, role: 'melee', maxHp: 50, attack: 56, defense: 60, move: 3, range: 1, power: 10, vision: 2, rare: false, immunities: ['psychic', 'poison'], trainCost: 20, upkeep: 1, terrain: landVolcano, spawnBiomes: ['volcano'], evolutions: [toStage2('bisharp', 5)] },
  // Dark/steel frontline that walls psychic/ghost/dragon armies and hits them back at night. Countered by fighting ×4 (lucario).
  bisharp: { name: '劈斩司令', dex: 625, generation: 5, typeId: 'dark', secondaryTypeId: 'steel', stage: 2, role: 'melee', maxHp: 70, attack: 86, defense: 76, move: 3, range: 1, power: 10, vision: 2, rare: false, immunities: ['psychic', 'poison'], trainCost: 29, upkeep: 2, terrain: landVolcano, spawnBiomes: [], evolutions: [toStage3('kingambit', 9)] },
  // Rare volcano dragon seed: night +15%. Countered by fairy ×4 (clefable, sylveon, tinkatink).
  deino: { name: '单首龙', dex: 633, generation: 5, typeId: 'dark', secondaryTypeId: 'dragon', stage: 1, role: 'melee', maxHp: 58, attack: 55, defense: 57, move: 3, range: 1, power: 10, vision: 2, rare: true, immunities: ['psychic'], trainCost: 21, upkeep: 1, terrain: landVolcano, spawnBiomes: ['volcano'], evolutions: [toStage2('zweilous', 5)] },
  // Rare stage-2 dark dragon brawler. Countered by fairy ×4, fighting/bug/ice/dragon ×2.
  zweilous: { name: '双首暴龙', dex: 634, generation: 5, typeId: 'dark', secondaryTypeId: 'dragon', stage: 2, role: 'melee', maxHp: 76, attack: 80, defense: 84, move: 3, range: 1, power: 10, vision: 2, rare: true, immunities: ['psychic'], trainCost: 30, upkeep: 2, terrain: landVolcano, spawnBiomes: [], evolutions: [toStage3('hydreigon', 5)] },
  // Rare dark dragon flyer, range 2 night bomber over sea/volcano. Countered by fairy ×4 (sylveon, tinkaton), so fairy finally has a target.
  hydreigon: { name: '三首恶龙', dex: 635, generation: 5, typeId: 'dark', secondaryTypeId: 'dragon', stage: 3, role: 'air', maxHp: 95, attack: 105, defense: 110, move: 4, range: 2, power: 10, vision: 3, rare: true, immunities: ['psychic'], trainCost: 38, upkeep: 3, terrain: 'all', spawnBiomes: [], evolutions: [] },

  // ===== Generation 6 (#650–721) =====
  // Grassland bird scout, ghost immune. Countered by electric, rock, ice.
  fletchling: { name: '小箭雀', dex: 661, generation: 6, typeId: 'normal', secondaryTypeId: 'flying', stage: 1, role: 'scout', maxHp: 48, attack: 52, defense: 50, move: 4, range: 1, power: 10, vision: 3, rare: false, immunities: ['ghost', 'ground'], trainCost: 18, upkeep: 1, terrain: 'all', spawnBiomes: ['grassland'], evolutions: [toStage2('fletchinder', 6)] },
  // Fire flyer (move 5): burns bug/steel/grass/ice from the air. Countered by rock ×4, water, electric.
  fletchinder: { name: '火箭雀', dex: 662, generation: 6, typeId: 'fire', secondaryTypeId: 'flying', stage: 2, role: 'air', maxHp: 66, attack: 78, defense: 66, move: 5, range: 1, power: 10, vision: 3, rare: false, immunities: ['ground'], trainCost: 26, upkeep: 2, terrain: 'all', spawnBiomes: [], evolutions: [toStage3('talonflame', 6)] },
  // Fire air striker: the mobile answer to scizor (×4), steel walls and corviknight. Countered by rock ×4 (golem's range 3), water, electric.
  talonflame: { name: '烈箭鹰', dex: 663, generation: 6, typeId: 'fire', secondaryTypeId: 'flying', stage: 3, role: 'air', maxHp: 82, attack: 104, defense: 94, move: 5, range: 1, power: 10, vision: 3, rare: false, immunities: ['ground'], trainCost: 35, upkeep: 3, terrain: 'all', spawnBiomes: [], evolutions: [] },
  // X/Y recruit: steel/ghost blade, immune normal/fighting/poison — the counter to fighting rushes. Countered by fire, ground, ghost, dark.
  honedge: { name: '独剑鞘', dex: 679, generation: 6, typeId: 'steel', secondaryTypeId: 'ghost', stage: 1, role: 'melee', maxHp: 48, attack: 52, defense: 66, move: 3, range: 1, power: 10, vision: 2, rare: false, immunities: ['normal', 'fighting', 'poison'], trainCost: 20, upkeep: 1, terrain: landVolcano, spawnBiomes: ['desert', 'volcano'], evolutions: [toStage2('doublade', 6)] },
  // Defensive stage-2 blade wall. Countered by fire, ground, ghost, dark.
  doublade: { name: '双剑鞘', dex: 680, generation: 6, typeId: 'steel', secondaryTypeId: 'ghost', stage: 2, role: 'melee', maxHp: 60, attack: 78, defense: 98, move: 3, range: 1, power: 10, vision: 2, rare: false, immunities: ['normal', 'fighting', 'poison'], trainCost: 29, upkeep: 2, terrain: landVolcano, spawnBiomes: [], evolutions: [toStage3('aegislash', 6)] },
  // Shield capstone: holds the line against fighting/normal/poison armies, steel hits fairy/rock/ice. Countered by dark (weavile, bisharp), fire, ground, ghost.
  aegislash: { name: '坚盾剑怪', dex: 681, generation: 6, typeId: 'steel', secondaryTypeId: 'ghost', stage: 3, role: 'melee', maxHp: 80, attack: 98, defense: 122, move: 3, range: 1, power: 10, vision: 2, rare: false, immunities: ['normal', 'fighting', 'poison'], trainCost: 37, upkeep: 3, terrain: landVolcano, spawnBiomes: [], evolutions: [] },
  // Generation-6 eevee branch: ranged fairy, dragon immune, hits hydreigon ×4 and dark/dragon/fighting. Countered by steel and poison.
  sylveon: { name: '仙子伊布', dex: 700, generation: 6, typeId: 'fairy', stage: 3, role: 'ranged', maxHp: 95, attack: 100, defense: 95, move: 3, range: 2, power: 10, vision: 2, rare: false, immunities: ['dragon'], trainCost: 36, upkeep: 3, terrain: 'land', spawnBiomes: [], evolutions: [] },

  // ===== Generation 7 (#722–809) =====
  // Amphibious tide-pool seed (land + ocean). Countered by electric, ground, psychic.
  mareanie: { name: '好坏星', dex: 747, generation: 7, typeId: 'poison', secondaryTypeId: 'water', stage: 1, role: 'naval', maxHp: 50, attack: 45, defense: 70, move: 3, range: 1, power: 10, vision: 2, rare: false, immunities: [], trainCost: 20, upkeep: 1, terrain: landOcean, spawnBiomes: ['ocean'], evolutions: [toStage2('toxapex', 7)] },
  // Coastal wall: low attack, 115 defense, sits on beaches to stop naval and shore landings; poison hits fairy/grass. Countered by electric, ground, psychic.
  toxapex: { name: '超坏星', dex: 748, generation: 7, typeId: 'poison', secondaryTypeId: 'water', stage: 2, role: 'naval', maxHp: 75, attack: 50, defense: 115, move: 3, range: 1, power: 10, vision: 2, rare: false, immunities: [], trainCost: 30, upkeep: 2, terrain: landOcean, spawnBiomes: [], evolutions: [] },
  // Sun/Moon recruit: immune normal/fighting/dragon — the counter-pick vs dragon and fighting pushes, ghost +15% at night. Countered by steel, ghost.
  mimikyu: { name: '谜拟Q', dex: 778, generation: 7, typeId: 'ghost', secondaryTypeId: 'fairy', stage: 2, role: 'melee', maxHp: 60, attack: 86, defense: 74, move: 4, range: 1, power: 10, vision: 2, rare: false, immunities: ['normal', 'fighting', 'dragon'], trainCost: 27, upkeep: 2, terrain: 'land', spawnBiomes: ['snow'], evolutions: [] },

  // ===== Generation 8 (#810–905) =====
  // Sword/Shield recruit: cheap bird scout that grows into the armoured flyer. Countered by electric, rock, ice.
  rookidee: { name: '稚山雀', dex: 821, generation: 8, typeId: 'flying', stage: 1, role: 'scout', maxHp: 50, attack: 48, defense: 52, move: 4, range: 1, power: 10, vision: 3, rare: false, immunities: ['ground'], trainCost: 18, upkeep: 1, terrain: 'all', spawnBiomes: ['grassland'], evolutions: [toStage2('corvisquire', 8)] },
  // Stage-2 sky scout (vision 3). Countered by electric, rock, ice.
  corvisquire: { name: '蓝鸦', dex: 822, generation: 8, typeId: 'flying', stage: 2, role: 'scout', maxHp: 68, attack: 70, defense: 74, move: 4, range: 1, power: 10, vision: 3, rare: false, immunities: ['ground'], trainCost: 26, upkeep: 2, terrain: 'all', spawnBiomes: [], evolutions: [toStage3('corviknight', 8)] },
  // Armoured air wall (move 4, 115 def): holds sea/volcano tiles, immune ground & poison, shrugs off siege. Countered by fire (talonflame) and electric.
  corviknight: { name: '钢铠鸦', dex: 823, generation: 8, typeId: 'flying', secondaryTypeId: 'steel', stage: 3, role: 'air', maxHp: 98, attack: 87, defense: 115, move: 4, range: 1, power: 10, vision: 3, rare: false, immunities: ['ground', 'poison'], trainCost: 37, upkeep: 3, terrain: 'all', spawnBiomes: [], evolutions: [] },
  // Rare snow ghost-dragon scout, immune normal/fighting. Countered by ghost, dark, dragon, ice, fairy.
  dreepy: { name: '多龙梅西亚', dex: 885, generation: 8, typeId: 'dragon', secondaryTypeId: 'ghost', stage: 1, role: 'scout', maxHp: 52, attack: 62, defense: 52, move: 4, range: 1, power: 10, vision: 3, rare: true, immunities: ['normal', 'fighting'], trainCost: 20, upkeep: 1, terrain: 'land', spawnBiomes: ['snow'], evolutions: [toStage2('drakloak', 8)] },
  // Rare fast ghost-dragon (move 5). Countered by ghost, dark, dragon, ice, fairy.
  drakloak: { name: '多龙奇', dex: 886, generation: 8, typeId: 'dragon', secondaryTypeId: 'ghost', stage: 2, role: 'fast', maxHp: 70, attack: 90, defense: 70, move: 5, range: 1, power: 10, vision: 2, rare: true, immunities: ['normal', 'fighting'], trainCost: 28, upkeep: 2, terrain: 'land', spawnBiomes: [], evolutions: [toStage3('dragapult', 8)] },
  // Rare fast skirmisher with range 2 (the only one): hit-and-run, but dragon is ×0 vs fairy and ×0.5 vs steel. Countered by sylveon/tinkaton/aegislash, weavile.
  dragapult: { name: '多龙巴鲁托', dex: 887, generation: 8, typeId: 'dragon', secondaryTypeId: 'ghost', stage: 3, role: 'fast', maxHp: 90, attack: 108, defense: 92, move: 5, range: 2, power: 10, vision: 3, rare: true, immunities: ['normal', 'fighting'], trainCost: 36, upkeep: 3, terrain: 'land', spawnBiomes: [], evolutions: [] },

  // ===== Generation 9 (#906–) =====
  // Bisharp's generation-9 capstone: dark/steel general, walls psychic/ghost/poison. Countered by fighting ×4 (lucario), fire, ground.
  kingambit: { name: '仆刀将军', dex: 983, generation: 9, typeId: 'dark', secondaryTypeId: 'steel', stage: 3, role: 'melee', maxHp: 98, attack: 102, defense: 100, move: 3, range: 1, power: 10, vision: 2, rare: false, immunities: ['psychic', 'poison'], trainCost: 37, upkeep: 3, terrain: landVolcano, spawnBiomes: [], evolutions: [] },
  // Scarlet/Violet recruit: fairy/steel smith, immune dragon & poison. Countered by fire, ground.
  tinkatink: { name: '小锻匠', dex: 957, generation: 9, typeId: 'fairy', secondaryTypeId: 'steel', stage: 1, role: 'melee', maxHp: 50, attack: 50, defense: 65, move: 3, range: 1, power: 10, vision: 2, rare: false, immunities: ['dragon', 'poison'], trainCost: 20, upkeep: 1, terrain: 'land', spawnBiomes: ['mountain'], evolutions: [toStage2('tinkatuff', 9)] },
  // Stage-2 fairy/steel bruiser; fairy hits dragon/dark/fighting. Countered by fire, ground.
  tinkatuff: { name: '巧锻匠', dex: 958, generation: 9, typeId: 'fairy', secondaryTypeId: 'steel', stage: 2, role: 'melee', maxHp: 66, attack: 72, defense: 90, move: 3, range: 1, power: 10, vision: 2, rare: false, immunities: ['dragon', 'poison'], trainCost: 28, upkeep: 2, terrain: 'land', spawnBiomes: [], evolutions: [toStage3('tinkaton', 9)] },
  // Hammer siege (range 1, move 3): trades golem's range for speed; not weak to water/grass. Countered by fire, ground (sandslash, excadrill).
  tinkaton: { name: '巨锻匠', dex: 959, generation: 9, typeId: 'fairy', secondaryTypeId: 'steel', stage: 3, role: 'siege', maxHp: 92, attack: 102, defense: 106, move: 3, range: 1, power: 10, vision: 2, rare: false, immunities: ['dragon', 'poison'], trainCost: 37, upkeep: 3, terrain: 'land', spawnBiomes: [], evolutions: [] },
};

/** Evolutions added to the frozen 47 (their v13 `evolution` stays null in expansion-v1). */
export const EXISTING_EVOLUTION_ADDITIONS: Record<string, RosterEvolution[]> = {
  sandshrew: [toStage2('sandslash')],
  ekans: [toStage2('arbok')],
  magnemite: [toStage2('magneton')],
  onix: [toStage3('steelix', 2)],
  swinub: [toStage2('piloswine', 2)],
  // umbreon is only a target (eevee, night).
};

/**
 * `spawnWild` also requires `spawnBiomes.includes(biome)`, so existing species placed in a new
 * biome table need their spawnBiomes extended in the v14 content copy.
 */
export const EXISTING_SPAWN_BIOME_ADDITIONS: Record<string, BiomeId[]> = {
  sandshrew: ['desert'],
  magnemite: ['desert'],
  swinub: ['snow'],
  ekans: ['forest'],
  caterpie: ['forest'],
};

/**
 * Full replacement of SPAWN_WEIGHTS (raw weights; rare species are ×0.25 in `spawnWild`).
 * The engine filters each draw to species with generation <= the nearest civilization's
 * generation; the comment after each biome gives the generation-1 subset on its own.
 */
export const SPAWN_WEIGHTS_V14: Record<BiomeId, Record<string, number>> = {
  // gen 1: rattata 30, pidgey 25, pikachu 15, meowth 15, ponyta 10, charmander 5, eevee 6
  grassland: { rattata: 30, pidgey: 25, pikachu: 15, meowth: 15, ponyta: 10, charmander: 5, eevee: 6, fletchling: 15, rookidee: 12 },
  // gen 1: bulbasaur 25, pidgey 20, pikachu 15, meowth 10, snorlax 15 (rare), scyther 15, exeggcute 15, ekans 10, caterpie 10
  forest: { bulbasaur: 25, pidgey: 20, pikachu: 15, meowth: 10, snorlax: 15, scyther: 15, exeggcute: 15, ekans: 10, caterpie: 10 },
  // gen 1: geodude 30, machop 20, gastly 15, abra 10, zubat 20, onix 10 (rare)
  mountain: { geodude: 30, machop: 20, gastly: 15, abra: 10, zubat: 20, onix: 10, beldum: 10, riolu: 12, tinkatink: 12 },
  // gen 1: magikarp 40, squirtle 20, horsea 30, lapras 10 (rare)
  ocean: { magikarp: 40, squirtle: 20, horsea: 30, lapras: 10, mareanie: 20 },
  // gen 1: rattata 20, ponyta 15, meowth 10, machop 10, geodude 15, sandshrew 15, magnemite 15
  desert: { rattata: 20, ponyta: 15, meowth: 10, machop: 10, geodude: 15, sandshrew: 15, magnemite: 15, trapinch: 20, drilbur: 18, honedge: 12 },
  // gen 1: abra 35, meowth 10, rattata 10, swinub 25, dratini 10 (rare)
  snow: { abra: 35, meowth: 10, rattata: 10, swinub: 25, dratini: 10, mimikyu: 10, dreepy: 10 },
  // gen 1: charmander 45, ponyta 25, gastly 20, onix 10 (rare) — unchanged. Existing quirk: gastly/onix have
  // land-only terrain, so a volcano draw for them finds no tile and places nothing. New volcano species can enter.
  volcano: { charmander: 45, ponyta: 25, gastly: 20, onix: 10, pawniard: 15, deino: 10, honedge: 8 },
};
export const WANDERERS_V14: readonly string[] = ['rattata', 'meowth', 'pidgey', 'pikachu', 'magikarp', 'dratini', 'zubat', 'fletchling', 'rookidee'];

/** Tech recruits: existing 4 + proposal §3.1 (typeResearch / fieldObservation / meteorology). */
export const TECH_RECRUITS_V14: Record<string, string> = {
  domestication: 'rattata',
  stoneCraft: 'geodude',
  riding: 'ponyta',
  training: 'machop',
  typeResearch: 'magnemite',
  fieldObservation: 'zubat',
  meteorology: 'horsea', // naval: coastal cities only (existing deployment check)
};

/**
 * Generation recruits: once a player reaches generation N, every city can train this species.
 * Each later recruit answers an earlier one: riolu (fighting) beats sneasel ×4, honedge
 * (immune fighting) walls riolu/lucario, pawniard (dark) cuts honedge, mimikyu (immune dragon/
 * fighting) stalls vibrava lines and riolu, tinkatink (fairy) hits deino/hydreigon ×4.
 */
export const GENERATION_RECRUITS_V14: Record<number, string> = {
  2: 'sneasel',
  3: 'vibrava',
  4: 'riolu',
  5: 'pawniard',
  6: 'honedge',
  7: 'mimikyu',
  8: 'rookidee',
  9: 'tinkatink',
};

/** Proposal §3.1: scyther spawns in forests but can only be trained after riding. */
export const TRAIN_REQUIRES_TECH_V14: Record<string, string> = { scyther: 'riding' };

/** Leader unique units in v14 (others unchanged from LEADER_KITS). */
export const LEADER_UNITS_V14: Record<string, string> = { jasmine: 'magneton', giovanni: 'sandslash' };

/**
 * Appended to WORLD_DEFINITIONS.stoneEvolutions in v14. The same edge appears in
 * exeggcute.evolutions with a stone condition; combat.ts rejects normal evolution for any
 * species with a stone path, so this list is the authoritative one.
 */
export const STONE_EVOLUTIONS_V14_ADDITIONS: { fromSpeciesId: string; intoSpeciesId: string; stoneId: 'leafStone'; requiredXp: number }[] = [
  { fromSpeciesId: 'exeggcute', intoSpeciesId: 'exeggutor', stoneId: 'leafStone', requiredXp: 100 },
];

/**
 * Nest species preference list (replaces `preferred` in representativeNestSpecies). Nests are
 * placed at world start, when every player is generation 1, so only generation-1 / original
 * species appear. Umbreon stays but moves last; the current picker is uniform among compatible
 * entries, so the order alone does not lower its odds — NEST_WEIGHTS_V14 does if the picker
 * becomes weighted.
 */
export const NEST_PRIORITY_V14: readonly string[] = ['sandshrew', 'ekans', 'caterpie', 'swinub', 'magnemite', 'clefairy', 'eevee', 'zubat', 'umbreon'];
export const NEST_WEIGHTS_V14: Record<string, number> = {
  sandshrew: 3, ekans: 3, caterpie: 3, swinub: 3, magnemite: 3, clefairy: 3, eevee: 3, zubat: 3, umbreon: 1,
};
