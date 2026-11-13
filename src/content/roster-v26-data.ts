// Gameplay v26 species batch (docs/design/depth-v26.md §4.3, content `roster-v26`): the first-generation completion (metapod, butterfree,
// weedle line, persian, spearow line, doduo line). Stub: the lane fills these tables; `depthContentFor` (src/content/units.ts) is the
// single place that turns them into the v26 regional draw. Empty tables = the v25 species, so v26 draws the same Pokédex as v25.
import type { SpeciesDefinition } from './species.ts';
import type { SpeciesTags } from './species-tags.ts';

/** New species definitions (v20 strength scale: 100 HP, power 10), keyed by id. */
export const ROSTER_V26_SPECIES: Readonly<Record<string, SpeciesDefinition>> = {};
/** Tags of the new species (habitats, nest weights, recruit slots), same shape as `SPECIES_TAGS`. */
export const ROSTER_V26_TAGS: Readonly<Record<string, SpeciesTags>> = {};
/** Evolutions the batch adds to existing species (caterpie → metapod, meowth → persian), applied over the v25 species. */
export const ROSTER_V26_EVOLUTIONS: Readonly<Record<string, Pick<SpeciesDefinition, 'evolution'>>> = {};
