// Gameplay v14 roster rules: species unlock by each player's own generation (docs/design/roster-v14.md §3).
// Every rule is a no-op for contents without roster tables, so v<=13 games are unchanged.
import { isNight } from '../content/era-abilities.ts';
import type { EraProgression } from '../content/eras.ts';
import { speciesGeneration } from '../content/roster.ts';
import type { BiomeId } from '../content/rules.ts';
import type { EvolutionOption } from '../content/species.ts';
import type { Content, SpeciesId } from '../content/units.ts';
import { generationOf } from './era-abilities.ts';
import { hexDistance, hexToIndex, indexToHex } from './hex.ts';
import type { GameState } from './model.ts';

type ResearchHolder = { research: { unlockedIds: readonly string[] } };
export const playerGeneration = (player: ResearchHolder, mode: EraProgression | undefined) => generationOf(player, mode);
/** Highest generation a game mode can reach (simple eras stop at 3). */
export const maxGeneration = (mode: EraProgression | undefined) => mode === 'full-v1' ? 9 : mode === 'simple-v1' ? 3 : 1;
/** Roster species of a later generation than the player's are locked for evolution; the original 47 never are. */
export function generationAllows(content: Content, player: ResearchHolder, mode: EraProgression | undefined, speciesId: SpeciesId): boolean {
  return !content.roster || speciesGeneration(content, speciesId) <= playerGeneration(player, mode);
}

/** All evolution targets of a species: the primary `evolution`, then the v14 branches. */
export function evolutionOptions(content: Content, speciesId: SpeciesId): EvolutionOption[] {
  const species = content.species[speciesId];
  if (!species?.evolution) return [];
  return [{ ...species.evolution, ...species.evolutionCondition }, ...(species.branches ?? [])];
}
export type EvolutionContext = { generation: number; round: number; biome: BiomeId | null };
/** Why an option is unavailable right now (null = conditions met); XP, gold and tech are checked by the caller. */
export function evolutionBlocker(content: Content, option: EvolutionOption, context: EvolutionContext): 'generation' | 'day' | 'night' | 'biome' | null {
  if (!content.roster) return null;
  if (Math.max(option.minGeneration ?? 1, speciesGeneration(content, option.speciesId)) > context.generation) return 'generation';
  if (option.time === 'day' && isNight(context.round)) return 'day';
  if (option.time === 'night' && !isNight(context.round)) return 'night';
  if (option.biome && option.biome !== context.biome) return 'biome';
  return null;
}
export const EVOLUTION_BLOCKER_TEXT: Record<'generation' | 'day' | 'night' | 'biome', string> = {
  generation: '需要进入更晚的世代', day: '只能在白天进化', night: '只能在夜晚进化', biome: '需要站在指定地形上',
};

/** Generation that decides wild spawns in a map region: the civilization whose city is nearest the region centre. */
export function regionGeneration(state: GameState, tiles: readonly number[]): number {
  if (!tiles.length) return 1;
  const sorted = [...tiles].sort((a, b) => a - b), centre = indexToHex(sorted[Math.floor(sorted.length / 2)], state.map);
  let best: { distance: number; ownerId: number } | null = null;
  for (const city of Object.values(state.cities).sort((a, b) => a.id - b.id)) {
    if (city.ownerId === null || state.players[city.ownerId]?.eliminated) continue;
    const distance = hexDistance(centre, city.position);
    if (!best || distance < best.distance || (distance === best.distance && city.ownerId < best.ownerId)) best = { distance, ownerId: city.ownerId };
  }
  return best ? playerGeneration(state.players[best.ownerId], state.setup.eraProgression) : 1;
}
export const tileBiome = (state: { map: { width: number; height: number; tiles: readonly (BiomeId | null)[] } }, position: { q: number; r: number }): BiomeId | null => {
  const index = hexToIndex(position, state.map);
  return index === null ? null : state.map.tiles[index];
};
