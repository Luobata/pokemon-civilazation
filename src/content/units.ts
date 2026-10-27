import { BALLS, BIOME_YIELDS, BUILDINGS, TECHS } from './economy.ts';
import type { BiomeId } from './rules.ts';

export const STARTER_IDS = ['bulbasaur', 'charmander', 'squirtle'] as const;
export type StarterId = (typeof STARTER_IDS)[number];
export type UnitIdentity = { kind: 'pokemon'; speciesId: StarterId } | { kind: 'logistics'; role: 'settler' };
export type UnitDefinition = { name: string; move: number; vision: number; terrain: readonly BiomeId[]; trainCost: number; upkeep: number };
export type Content = {
  version: string;
  biomes: typeof BIOME_YIELDS; buildings: typeof BUILDINGS; techs: typeof TECHS; balls: typeof BALLS;
  units: Record<StarterId | 'settler', UnitDefinition>;
  moveCosts: Record<BiomeId, number>;
};
const land: BiomeId[] = ['grassland', 'forest', 'mountain', 'desert', 'snow'];
export const CONTENT: Content = {
  version: 'm2-v1', biomes: BIOME_YIELDS, buildings: BUILDINGS, techs: TECHS, balls: BALLS,
  // GDD §5.2 stats are used only to calculate training cost in M2.
  units: {
    bulbasaur: { name: '妙蛙种子', move: 3, vision: 2, terrain: land, trainCost: Math.floor((50 + 52 + 55) / 8), upkeep: 1 },
    charmander: { name: '小火龙', move: 3, vision: 2, terrain: [...land, 'volcano'], trainCost: Math.floor((50 + 60 + 52) / 8), upkeep: 1 },
    squirtle: { name: '杰尼龟', move: 3, vision: 2, terrain: [...land, 'ocean'], trainCost: Math.floor((55 + 48 + 60) / 8), upkeep: 1 },
    settler: { name: '开拓队', move: 2, vision: 2, terrain: land, trainCost: 30, upkeep: 0 },
  },
  // D28 B1/B4: water starters are amphibious; no naval/flying content in M1.
  moveCosts: { grassland: 1, desert: 1, forest: 2, mountain: 2, snow: 2, ocean: 1, volcano: 2 },
};
export function unitDefinition(unit: UnitIdentity, content: Content = CONTENT): UnitDefinition {
  return content.units[unit.kind === 'pokemon' ? unit.speciesId : unit.role];
}
