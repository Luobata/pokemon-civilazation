import type { BiomeId } from './rules.ts';
import type { SpeciesId } from './species.ts';
export const SPAWN_WEIGHTS: Record<BiomeId, Partial<Record<SpeciesId, number>>> = {
  grassland: { rattata: 30, pidgey: 25, pikachu: 15, meowth: 15, ponyta: 10, charmander: 5 },
  forest: { bulbasaur: 25, pidgey: 25, pikachu: 20, meowth: 15, snorlax: 15 },
  mountain: { geodude: 30, machop: 25, gastly: 20, abra: 15, onix: 10 },
  ocean: { magikarp: 55, squirtle: 25, lapras: 10 },
  desert: { rattata: 30, ponyta: 20, meowth: 20, machop: 15, geodude: 15 },
  snow: { abra: 55, meowth: 20, rattata: 15, dratini: 10 },
  volcano: { charmander: 45, ponyta: 25, gastly: 20, onix: 10 },
};
export const WANDERERS: readonly SpeciesId[] = ['rattata', 'meowth', 'pidgey', 'pikachu', 'magikarp', 'dratini'];
