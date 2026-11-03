import { WORLD_DEFINITIONS } from '../content/world-systems.ts';
import type { BerryId } from '../content/world-systems.ts';
import type { Yield } from '../content/economy.ts';
import { CONTENT } from '../content/units.ts';
import { hexToIndex } from '../core/hex.ts';
import { improvementYield } from '../core/improvements.ts';
import type { PlayerView } from '../core/model.ts';

export type TileYieldInfo = { yields: Yield; workable: boolean };

/**
 * Builds a reader for what working a tile would give the viewing player, from player
 * knowledge only: remembered biome, known improvement, visible resource. Mirrors
 * workedTileYield in src/core/city.ts plus the resource bonus in worldCityYield.
 * City-centre and district tiles cannot be worked and read as null.
 */
export function tileYieldReader(view: PlayerView): (index: number) => TileYieldInfo | null {
  const player = view.economy.player, researched = player.research.unlockedIds;
  const weather = researched.includes('meteorology');
  const blocked = new Set<number>([...view.cities, ...view.economy.cities].map(city => hexToIndex(city.position, view.map) ?? -1));
  for (const tile of view.expansion?.districts?.tiles ?? []) blocked.add(tile.tileIndex);
  const improvements = new Map((view.expansion?.improvements?.tiles ?? []).map(tile => [tile.tileIndex, improvementYield(tile.kind, player)]));
  const resources = new Map((view.expansion?.world.resources ?? []).map(site => [site.tileIndex, site]));
  return index => {
    const biome = view.map.tiles[index];
    if (!biome || blocked.has(index)) return null;
    const yields = { ...CONTENT.biomes[biome] };
    if ((biome === 'snow' || biome === 'volcano') && weather) yields.research += CONTENT.balance.effects.meteorologyResearch;
    const bonus = improvements.get(index);
    if (bonus) for (const key of ['food', 'production', 'gold', 'research'] as const) yields[key] += bonus[key];
    const resource = resources.get(index);
    if (resource?.kind === 'berry') yields.food += Math.max(1, Math.floor(WORLD_DEFINITIONS.berries[resource.definitionId as BerryId].food / 4));
    else if (resource?.kind === 'stone') yields.production += 1;
    return { yields, workable: weather || (biome !== 'snow' && biome !== 'volcano') };
  };
}
