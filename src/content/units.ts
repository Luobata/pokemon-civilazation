import { SPECIES } from './species.ts';
import type { SpeciesId } from './species.ts';
export { speciesDisplay } from './species.ts';
export type { SpeciesId } from './species.ts';
import { BALLS, BIOME_YIELDS, BUILDINGS, TECHS } from './economy.ts';
import type { BiomeId } from './rules.ts';

export const STARTER_IDS = ['bulbasaur', 'charmander', 'squirtle'] as const;
export type StarterId = (typeof STARTER_IDS)[number];
export type UnitIdentity = { kind: 'pokemon'; speciesId: SpeciesId } | { kind: 'logistics'; role: 'settler' };
export type UnitDefinition = { name: string; move: number; vision: number; terrain: readonly BiomeId[]; trainCost: number; upkeep: number };
export type Content = {
  version: string;
  biomes: typeof BIOME_YIELDS; buildings: typeof BUILDINGS; techs: typeof TECHS; balls: typeof BALLS;
  units: Record<SpeciesId | 'settler', UnitDefinition>;
  species: typeof SPECIES;
  moveCosts: Record<BiomeId, number>;
};
const land: BiomeId[] = ['grassland', 'forest', 'mountain', 'desert', 'snow'];
export const CONTENT: Content = {
  version: 'm3-v1', species: SPECIES, biomes: BIOME_YIELDS, buildings: BUILDINGS, techs: TECHS, balls: BALLS,
  units: {
    ...SPECIES,
    settler: { name: '开拓队', move: 2, vision: 2, terrain: land, trainCost: 30, upkeep: 0 },
  },
  // D28: flight grants passage, not a terrain cost discount.
  moveCosts: { grassland: 1, desert: 1, forest: 2, mountain: 2, snow: 2, ocean: 1, volcano: 2 },
};
export function unitDefinition(unit: UnitIdentity, content: Content = CONTENT): UnitDefinition {
  return content.units[unit.kind === 'pokemon' ? unit.speciesId : unit.role];
}
