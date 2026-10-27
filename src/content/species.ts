import type { BiomeId } from './rules.ts';
export const SPECIES_NAMES = {
  bulbasaur: '妙蛙种子',
  ivysaur: '妙蛙草',
  venusaur: '妙蛙花',
  charmander: '小火龙',
  charmeleon: '火恐龙',
  charizard: '喷火龙',
  squirtle: '杰尼龟',
  wartortle: '卡咪龟',
  blastoise: '水箭龟',
  pikachu: '皮卡丘',
  raichu: '雷丘',
  rattata: '小拉达',
  raticate: '拉达',
  meowth: '喵喵',
  snorlax: '卡比兽',
  machop: '腕力',
  machoke: '豪力',
  machamp: '怪力',
  pidgey: '波波',
  pidgeotto: '比比鸟',
  pidgeot: '比雕',
  geodude: '小拳石',
  graveler: '隆隆石',
  golem: '隆隆岩',
  onix: '大岩蛇',
  ponyta: '小火马',
  rapidash: '烈焰马',
  magikarp: '鲤鱼王',
  gyarados: '暴鲤龙',
  lapras: '乘龙',
  abra: '凯西',
  kadabra: '勇基拉',
  alakazam: '胡地',
  gastly: '鬼斯',
  haunter: '鬼斯通',
  gengar: '耿鬼',
  dratini: '迷你龙',
  dragonair: '哈克龙',
  dragonite: '快龙',
} as const;
export type SpeciesId = keyof typeof SPECIES_NAMES;
export function speciesDisplay(speciesId: SpeciesId): { name: string; abbreviation: string } {
  const name = SPECIES_NAMES[speciesId];
  return { name, abbreviation: name.slice(0, 1) };
}

export type TypeId = 'grass' | 'fire' | 'water' | 'electric' | 'normal' | 'fighting' | 'flying' | 'rock' | 'psychic' | 'ghost' | 'dragon';
export type SpeciesDefinition = {
  name: string; typeId: TypeId; stage: 1 | 2 | 3; role: 'ranged' | 'melee' | 'scout' | 'fast' | 'siege' | 'naval' | 'air';
  maxHp: number; attack: number; defense: number; move: number; range: number; power: number; vision: number;
  rare: boolean; immunities: TypeId[]; trainCost: number; upkeep: number; terrain: BiomeId[]; spawnBiomes: BiomeId[];
  evolution: { speciesId: SpeciesId; xp: number; gold: number; requiresTraining: boolean } | null;
};
const land: BiomeId[] = ['grassland', 'forest', 'mountain', 'desert', 'snow'];
const allTerrain: BiomeId[] = [...land, 'ocean', 'volcano'];
export const SPECIES: Record<SpeciesId, SpeciesDefinition> = {
  bulbasaur: { name: '妙蛙种子', typeId: 'grass', stage: 1, role: 'ranged', maxHp: 50, attack: 52, defense: 55, move: 3, range: 2, power: 10, vision: 2, rare: false, immunities: [], trainCost: 19, upkeep: 1, terrain: land, spawnBiomes: ['forest'], evolution: { speciesId: 'ivysaur', xp: 100, gold: 30, requiresTraining: false } },
  ivysaur: { name: '妙蛙草', typeId: 'grass', stage: 2, role: 'ranged', maxHp: 70, attack: 70, defense: 72, move: 3, range: 2, power: 10, vision: 2, rare: false, immunities: [], trainCost: 26, upkeep: 2, terrain: land, spawnBiomes: [], evolution: { speciesId: 'venusaur', xp: 250, gold: 80, requiresTraining: true } },
  venusaur: { name: '妙蛙花', typeId: 'grass', stage: 3, role: 'ranged', maxHp: 95, attack: 92, defense: 95, move: 3, range: 2, power: 10, vision: 2, rare: false, immunities: [], trainCost: 35, upkeep: 3, terrain: land, spawnBiomes: [], evolution: null },
  charmander: { name: '小火龙', typeId: 'fire', stage: 1, role: 'ranged', maxHp: 50, attack: 60, defense: 52, move: 3, range: 2, power: 10, vision: 2, rare: false, immunities: [], trainCost: 20, upkeep: 1, terrain: [...land, 'volcano'], spawnBiomes: ['grassland', 'volcano'], evolution: { speciesId: 'charmeleon', xp: 100, gold: 30, requiresTraining: false } },
  charmeleon: { name: '火恐龙', typeId: 'fire', stage: 2, role: 'ranged', maxHp: 72, attack: 76, defense: 64, move: 3, range: 2, power: 10, vision: 2, rare: false, immunities: [], trainCost: 26, upkeep: 2, terrain: [...land, 'volcano'], spawnBiomes: [], evolution: { speciesId: 'charizard', xp: 250, gold: 80, requiresTraining: true } },
  charizard: { name: '喷火龙', typeId: 'fire', stage: 3, role: 'air', maxHp: 95, attack: 98, defense: 88, move: 5, range: 2, power: 10, vision: 3, rare: false, immunities: [], trainCost: 35, upkeep: 3, terrain: allTerrain, spawnBiomes: [], evolution: null },
  squirtle: { name: '杰尼龟', typeId: 'water', stage: 1, role: 'ranged', maxHp: 55, attack: 48, defense: 60, move: 3, range: 2, power: 10, vision: 2, rare: false, immunities: [], trainCost: 20, upkeep: 1, terrain: [...land, 'ocean'], spawnBiomes: ['ocean'], evolution: { speciesId: 'wartortle', xp: 100, gold: 30, requiresTraining: false } },
  wartortle: { name: '卡咪龟', typeId: 'water', stage: 2, role: 'ranged', maxHp: 70, attack: 64, defense: 78, move: 3, range: 2, power: 10, vision: 2, rare: false, immunities: [], trainCost: 26, upkeep: 2, terrain: [...land, 'ocean'], spawnBiomes: [], evolution: { speciesId: 'blastoise', xp: 250, gold: 80, requiresTraining: true } },
  blastoise: { name: '水箭龟', typeId: 'water', stage: 3, role: 'ranged', maxHp: 92, attack: 88, defense: 108, move: 3, range: 2, power: 10, vision: 2, rare: false, immunities: [], trainCost: 36, upkeep: 3, terrain: [...land, 'ocean'], spawnBiomes: [], evolution: null },
  pikachu: { name: '皮卡丘', typeId: 'electric', stage: 1, role: 'ranged', maxHp: 45, attack: 60, defense: 48, move: 4, range: 2, power: 10, vision: 2, rare: false, immunities: [], trainCost: 19, upkeep: 1, terrain: land, spawnBiomes: ['grassland', 'forest'], evolution: { speciesId: 'raichu', xp: 100, gold: 30, requiresTraining: false } },
  raichu: { name: '雷丘', typeId: 'electric', stage: 2, role: 'ranged', maxHp: 65, attack: 78, defense: 68, move: 4, range: 2, power: 10, vision: 2, rare: false, immunities: [], trainCost: 26, upkeep: 2, terrain: land, spawnBiomes: [], evolution: null },
  rattata: { name: '小拉达', typeId: 'normal', stage: 1, role: 'scout', maxHp: 55, attack: 58, defense: 48, move: 4, range: 1, power: 10, vision: 3, rare: false, immunities: [], trainCost: 20, upkeep: 1, terrain: land, spawnBiomes: ['grassland', 'desert', 'snow'], evolution: { speciesId: 'raticate', xp: 100, gold: 30, requiresTraining: false } },
  raticate: { name: '拉达', typeId: 'normal', stage: 2, role: 'fast', maxHp: 62, attack: 78, defense: 70, move: 5, range: 1, power: 10, vision: 2, rare: false, immunities: [], trainCost: 26, upkeep: 2, terrain: land, spawnBiomes: [], evolution: null },
  meowth: { name: '喵喵', typeId: 'normal', stage: 1, role: 'scout', maxHp: 50, attack: 55, defense: 48, move: 4, range: 1, power: 10, vision: 3, rare: false, immunities: [], trainCost: 19, upkeep: 1, terrain: land, spawnBiomes: ['grassland', 'forest', 'desert', 'snow'], evolution: null },
  snorlax: { name: '卡比兽', typeId: 'normal', stage: 3, role: 'melee', maxHp: 130, attack: 92, defense: 92, move: 2, range: 1, power: 10, vision: 2, rare: true, immunities: [], trainCost: 39, upkeep: 3, terrain: land, spawnBiomes: ['forest'], evolution: null },
  machop: { name: '腕力', typeId: 'fighting', stage: 1, role: 'melee', maxHp: 58, attack: 55, defense: 52, move: 3, range: 1, power: 10, vision: 2, rare: false, immunities: [], trainCost: 20, upkeep: 1, terrain: land, spawnBiomes: ['mountain', 'desert'], evolution: { speciesId: 'machoke', xp: 100, gold: 30, requiresTraining: false } },
  machoke: { name: '豪力', typeId: 'fighting', stage: 2, role: 'melee', maxHp: 74, attack: 88, defense: 66, move: 3, range: 1, power: 10, vision: 2, rare: false, immunities: [], trainCost: 28, upkeep: 2, terrain: land, spawnBiomes: [], evolution: { speciesId: 'machamp', xp: 250, gold: 80, requiresTraining: true } },
  machamp: { name: '怪力', typeId: 'fighting', stage: 3, role: 'melee', maxHp: 95, attack: 108, defense: 85, move: 3, range: 1, power: 10, vision: 2, rare: false, immunities: [], trainCost: 36, upkeep: 3, terrain: land, spawnBiomes: [], evolution: null },
  pidgey: { name: '波波', typeId: 'flying', stage: 1, role: 'scout', maxHp: 52, attack: 50, defense: 52, move: 4, range: 1, power: 10, vision: 3, rare: false, immunities: [], trainCost: 19, upkeep: 1, terrain: allTerrain, spawnBiomes: ['grassland', 'forest'], evolution: { speciesId: 'pidgeotto', xp: 100, gold: 30, requiresTraining: false } },
  pidgeotto: { name: '比比鸟', typeId: 'flying', stage: 2, role: 'scout', maxHp: 68, attack: 72, defense: 74, move: 4, range: 1, power: 10, vision: 3, rare: false, immunities: [], trainCost: 26, upkeep: 2, terrain: allTerrain, spawnBiomes: [], evolution: { speciesId: 'pidgeot', xp: 250, gold: 80, requiresTraining: true } },
  pidgeot: { name: '比雕', typeId: 'flying', stage: 3, role: 'air', maxHp: 92, attack: 90, defense: 98, move: 5, range: 1, power: 10, vision: 3, rare: false, immunities: [], trainCost: 35, upkeep: 3, terrain: allTerrain, spawnBiomes: [], evolution: null },
  geodude: { name: '小拳石', typeId: 'rock', stage: 1, role: 'siege', maxHp: 50, attack: 55, defense: 65, move: 2, range: 2, power: 10, vision: 2, rare: false, immunities: ['electric'], trainCost: 21, upkeep: 1, terrain: land, spawnBiomes: ['mountain', 'desert'], evolution: { speciesId: 'graveler', xp: 100, gold: 30, requiresTraining: false } },
  graveler: { name: '隆隆石', typeId: 'rock', stage: 2, role: 'siege', maxHp: 66, attack: 74, defense: 90, move: 2, range: 2, power: 10, vision: 2, rare: false, immunities: ['electric'], trainCost: 28, upkeep: 2, terrain: land, spawnBiomes: [], evolution: { speciesId: 'golem', xp: 250, gold: 80, requiresTraining: true } },
  golem: { name: '隆隆岩', typeId: 'rock', stage: 3, role: 'siege', maxHp: 85, attack: 95, defense: 120, move: 2, range: 3, power: 10, vision: 2, rare: false, immunities: ['electric'], trainCost: 37, upkeep: 3, terrain: land, spawnBiomes: [], evolution: null },
  onix: { name: '大岩蛇', typeId: 'rock', stage: 2, role: 'siege', maxHp: 70, attack: 60, defense: 110, move: 2, range: 2, power: 10, vision: 2, rare: true, immunities: ['electric'], trainCost: 30, upkeep: 2, terrain: land, spawnBiomes: ['mountain', 'volcano'], evolution: null },
  ponyta: { name: '小火马', typeId: 'fire', stage: 1, role: 'fast', maxHp: 55, attack: 62, defense: 50, move: 5, range: 1, power: 10, vision: 2, rare: false, immunities: [], trainCost: 20, upkeep: 1, terrain: [...land, 'volcano'], spawnBiomes: ['grassland', 'desert', 'volcano'], evolution: { speciesId: 'rapidash', xp: 100, gold: 30, requiresTraining: false } },
  rapidash: { name: '烈焰马', typeId: 'fire', stage: 2, role: 'fast', maxHp: 70, attack: 92, defense: 68, move: 5, range: 1, power: 10, vision: 2, rare: false, immunities: [], trainCost: 28, upkeep: 2, terrain: [...land, 'volcano'], spawnBiomes: [], evolution: null },
  magikarp: { name: '鲤鱼王', typeId: 'water', stage: 1, role: 'naval', maxHp: 60, attack: 40, defense: 50, move: 3, range: 1, power: 10, vision: 2, rare: false, immunities: [], trainCost: 18, upkeep: 1, terrain: ['ocean'], spawnBiomes: ['ocean'], evolution: { speciesId: 'gyarados', xp: 100, gold: 30, requiresTraining: false } },
  gyarados: { name: '暴鲤龙', typeId: 'water', stage: 2, role: 'naval', maxHp: 80, attack: 92, defense: 68, move: 4, range: 1, power: 10, vision: 2, rare: false, immunities: [], trainCost: 30, upkeep: 2, terrain: ['ocean'], spawnBiomes: [], evolution: null },
  lapras: { name: '乘龙', typeId: 'water', stage: 3, role: 'naval', maxHp: 105, attack: 85, defense: 100, move: 3, range: 1, power: 10, vision: 2, rare: true, immunities: [], trainCost: 36, upkeep: 3, terrain: ['ocean'], spawnBiomes: ['ocean'], evolution: null },
  abra: { name: '凯西', typeId: 'psychic', stage: 1, role: 'ranged', maxHp: 55, attack: 65, defense: 45, move: 3, range: 2, power: 10, vision: 2, rare: false, immunities: [], trainCost: 20, upkeep: 1, terrain: land, spawnBiomes: ['mountain', 'snow'], evolution: { speciesId: 'kadabra', xp: 100, gold: 30, requiresTraining: false } },
  kadabra: { name: '勇基拉', typeId: 'psychic', stage: 2, role: 'ranged', maxHp: 58, attack: 90, defense: 62, move: 3, range: 2, power: 10, vision: 2, rare: false, immunities: [], trainCost: 26, upkeep: 2, terrain: land, spawnBiomes: [], evolution: { speciesId: 'alakazam', xp: 250, gold: 80, requiresTraining: true } },
  alakazam: { name: '胡地', typeId: 'psychic', stage: 3, role: 'ranged', maxHp: 78, attack: 115, defense: 88, move: 3, range: 2, power: 10, vision: 2, rare: true, immunities: [], trainCost: 35, upkeep: 3, terrain: land, spawnBiomes: [], evolution: null },
  gastly: { name: '鬼斯', typeId: 'ghost', stage: 1, role: 'melee', maxHp: 48, attack: 55, defense: 53, move: 3, range: 1, power: 10, vision: 3, rare: false, immunities: [], trainCost: 19, upkeep: 1, terrain: land, spawnBiomes: ['mountain', 'volcano'], evolution: { speciesId: 'haunter', xp: 100, gold: 30, requiresTraining: false } },
  haunter: { name: '鬼斯通', typeId: 'ghost', stage: 2, role: 'melee', maxHp: 60, attack: 82, defense: 70, move: 3, range: 1, power: 10, vision: 3, rare: false, immunities: [], trainCost: 26, upkeep: 2, terrain: land, spawnBiomes: [], evolution: { speciesId: 'gengar', xp: 250, gold: 80, requiresTraining: true } },
  gengar: { name: '耿鬼', typeId: 'ghost', stage: 3, role: 'ranged', maxHp: 82, attack: 108, defense: 92, move: 3, range: 2, power: 10, vision: 3, rare: true, immunities: [], trainCost: 35, upkeep: 3, terrain: land, spawnBiomes: [], evolution: null },
  dratini: { name: '迷你龙', typeId: 'dragon', stage: 1, role: 'melee', maxHp: 55, attack: 62, defense: 52, move: 3, range: 1, power: 10, vision: 2, rare: true, immunities: [], trainCost: 21, upkeep: 1, terrain: land, spawnBiomes: ['snow'], evolution: { speciesId: 'dragonair', xp: 100, gold: 30, requiresTraining: false } },
  dragonair: { name: '哈克龙', typeId: 'dragon', stage: 2, role: 'ranged', maxHp: 75, attack: 85, defense: 72, move: 3, range: 2, power: 10, vision: 2, rare: true, immunities: [], trainCost: 29, upkeep: 2, terrain: land, spawnBiomes: [], evolution: { speciesId: 'dragonite', xp: 250, gold: 80, requiresTraining: true } },
  dragonite: { name: '快龙', typeId: 'dragon', stage: 3, role: 'air', maxHp: 105, attack: 112, defense: 98, move: 5, range: 2, power: 10, vision: 3, rare: true, immunities: [], trainCost: 39, upkeep: 3, terrain: allTerrain, spawnBiomes: [], evolution: null },
};
export function validateSpecies(species: Record<SpeciesId, SpeciesDefinition>): void {
  const budgets = [[150, 170], [210, 240], [280, 320]];
  for (const [id, definition] of Object.entries(species)) {
    const sum = definition.maxHp + definition.attack + definition.defense;
    const [min, max] = budgets[definition.stage - 1];
    if (sum < min || sum > max || definition.trainCost !== Math.floor(sum / 8)) throw new Error(`Invalid species budget/cost: ${id}`);
  }
}
validateSpecies(SPECIES);
