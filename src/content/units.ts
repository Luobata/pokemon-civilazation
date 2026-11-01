import type { LeaderId } from './leaders.ts';
import { BALANCE } from './balance.ts';
import type { Balance } from './balance.ts';
import { SPECIES, validateSpecies } from './species.ts';
import { LEGACY_SPECIES } from './legacy-species.ts';
import type { SpeciesDefinition, SpeciesId } from './species.ts';
export { speciesDisplay } from './species.ts';
export type { SpeciesId } from './species.ts';
import { BALLS, BIOME_YIELDS, BUILDINGS, TECHS } from './economy.ts';
import type { BiomeId } from './rules.ts';

export const STARTER_IDS = ['bulbasaur', 'charmander', 'squirtle'] as const;
export type StarterId = (typeof STARTER_IDS)[number];
export type UnitIdentity = { kind: 'pokemon'; speciesId: SpeciesId; uniqueLeader?: LeaderId } | { kind: 'logistics'; role: 'settler' };
export type UnitDefinition = { name: string; move: number; vision: number; terrain: readonly BiomeId[]; trainCost: number; upkeep: number };
export type Content = {
  version: string;
  biomes: typeof BIOME_YIELDS; buildings: typeof BUILDINGS; techs: { [K in keyof typeof TECHS]: Omit<typeof TECHS[K], 'cost'> & { cost: number } };
  balls: { [K in keyof typeof BALLS]: Omit<typeof BALLS[K], 'goldCost'> & { goldCost: number } };
  balance: Balance;
  units: Record<string, UnitDefinition>;
  species: Record<string, SpeciesDefinition>;
  moveCosts: Record<BiomeId, number>;
};
const land: BiomeId[] = ['grassland', 'forest', 'mountain', 'desert', 'snow'];
export const CONTENT: Content = {
  version: 'm3-v1', balance: BALANCE, species: LEGACY_SPECIES, biomes: BIOME_YIELDS, buildings: BUILDINGS, techs: TECHS, balls: BALLS,
  units: {
    ...LEGACY_SPECIES,
    settler: { name: '开拓队', move: 2, vision: 2, terrain: land, trainCost: 30, upkeep: 0 },
  },
  // D28: flight grants passage, not a terrain cost discount.
  moveCosts: { grassland: 1, desert: 1, forest: 2, mountain: 2, snow: 2, ocean: 1, volcano: 2 },
};
// Reallocate the same stage stat budgets for double weaknesses. The legacy table
// above remains the source of truth for existing m3-v1 saves and command logs.
const expandedSpecies = JSON.parse(JSON.stringify(SPECIES)) as typeof SPECIES;
for (const [id, stats] of Object.entries({
  geodude: { maxHp: 60, attack: 20, defense: 90 },
  graveler: { maxHp: 80, attack: 30, defense: 120 },
  onix: { maxHp: 80, attack: 40, defense: 120 },
  charizard: { maxHp: 100, attack: 83, defense: 98 },
  gyarados: { maxHp: 90, attack: 60, defense: 90 },
  bulbasaur: { maxHp: 55, attack: 45, defense: 57 },
  gastly: { maxHp: 53, attack: 43, defense: 60 },
})) Object.assign(expandedSpecies[id as SpeciesId], stats);
validateSpecies(expandedSpecies);
export const EXPANSION_CONTENT: Content = {
  ...CONTENT, version: 'expansion-v1', species: expandedSpecies,
  units: { ...expandedSpecies, settler: CONTENT.units.settler },
};
export function unitDefinition(unit: UnitIdentity, content: Content = CONTENT): UnitDefinition {
  const base = content.units[unit.kind === 'pokemon' ? unit.speciesId : unit.role];
  return unit.kind === 'pokemon' && unit.uniqueLeader ? { ...base, name: `${base.name}·${unit.uniqueLeader}`, vision: base.vision + 1 } : base;
}
