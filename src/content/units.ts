import type { BiomeId } from './rules.ts';

export const STARTER_IDS = ['bulbasaur', 'charmander', 'squirtle'] as const;
export type StarterId = (typeof STARTER_IDS)[number];
export type UnitIdentity = { kind: 'pokemon'; speciesId: StarterId } | { kind: 'logistics'; role: 'settler' };
export type UnitDefinition = { name: string; move: number; vision: number; terrain: readonly BiomeId[] };
export type Content = {
  version: string;
  units: Record<StarterId | 'settler', UnitDefinition>;
  moveCosts: Record<BiomeId, number>;
};
const land: BiomeId[] = ['grassland', 'forest', 'mountain', 'desert', 'snow'];
export const CONTENT: Content = {
  version: 'm1-v1',
  // GDD §2.2/§5.2; only movement/vision fields actually consumed by M1.
  units: {
    bulbasaur: { name: '妙蛙种子', move: 3, vision: 2, terrain: land },
    charmander: { name: '小火龙', move: 3, vision: 2, terrain: [...land, 'volcano'] },
    squirtle: { name: '杰尼龟', move: 3, vision: 2, terrain: [...land, 'ocean'] },
    settler: { name: '开拓队', move: 2, vision: 2, terrain: land },
  },
  // D28 B1/B4: water starters are amphibious; no naval/flying content in M1.
  moveCosts: { grassland: 1, desert: 1, forest: 2, mountain: 2, snow: 2, ocean: 1, volcano: 2 },
};
export function unitDefinition(unit: UnitIdentity, content: Content = CONTENT): UnitDefinition {
  return content.units[unit.kind === 'pokemon' ? unit.speciesId : unit.role];
}
