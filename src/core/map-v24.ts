// Gameplay v24 A1 (docs/design/world-v24.md §2.1, §2.4): continents, islands and island chains, lakes, ridges and peaks, climate bands,
// hills, rivers, fair starts and landmark sites. Integer-only and deterministic; called by createGame only when `content.terrain`.
// Scaffolding: delegates to the v22/v23 generator (same seed, same draws) and writes no features, so v24 games still match v23.
import { generateMap } from './map.ts';
import type { MapSetup, MapState } from './map.ts';

export function generateWorldMap(setup: Partial<MapSetup> & { seed: number }): MapState {
  return generateMap({ ...setup, wrap: true });
}
