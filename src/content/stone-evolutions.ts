// The five original stone evolutions (world v1). `WORLD_DEFINITIONS.stoneEvolutions` lists them; the v25 regional Pokédex reads them
// here too, because its evolution lines join species across stone paths and it must not import the world module (import cycle).
export type BaseStoneEvolution = { fromSpeciesId: string; intoSpeciesId: string; stoneId: 'fireStone' | 'waterStone' | 'leafStone' | 'thunderStone' | 'moonStone'; requiredXp: number };
export const BASE_STONE_EVOLUTIONS: readonly BaseStoneEvolution[] = [
  { fromSpeciesId: 'pikachu', intoSpeciesId: 'raichu', stoneId: 'thunderStone', requiredXp: 100 },
  { fromSpeciesId: 'ivysaur', intoSpeciesId: 'venusaur', stoneId: 'leafStone', requiredXp: 250 },
  { fromSpeciesId: 'charmeleon', intoSpeciesId: 'charizard', stoneId: 'fireStone', requiredXp: 250 },
  { fromSpeciesId: 'wartortle', intoSpeciesId: 'blastoise', stoneId: 'waterStone', requiredXp: 250 },
  { fromSpeciesId: 'clefairy', intoSpeciesId: 'clefable', stoneId: 'moonStone', requiredXp: 100 },
];
