import { ESSENCE_IDS, ESSENCE_RULES } from '../content/essences.ts';
import type { EssenceId } from '../content/essences.ts';
import type { Content } from '../content/units.ts';
import { LEADER_ESSENCE, speciesEssence } from '../core/essences.ts';
import type { Command, PlayerView } from '../core/model.ts';

/** The essence this AI wants most: its leader's, then whatever its registered army uses most. */
export function preferredEssence(view: PlayerView, content: Content): EssenceId {
  const counts = Object.fromEntries(ESSENCE_IDS.map(id => [id, 0])) as Record<EssenceId, number>;
  for (const id of view.economy.player.registeredSpeciesIds) counts[speciesEssence(id, content)]++;
  const leader = view.economy.player.leaderId;
  if (leader) counts[LEADER_ESSENCE[leader]] += 2;
  return [...ESSENCE_IDS].sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))[0];
}
/** Build one gym per city once the stock allows, choosing a stocked essence the army can use. */
export function planEssenceAction(view: PlayerView, content: Content): Command['action'] | null {
  const essences = view.expansion?.essences;
  if (!essences || view.economy.player.gold < ESSENCE_RULES.gymGoldCost + 40) return null;
  const withGym = new Set(essences.gyms.map(gym => gym.cityId));
  const city = view.economy.cities.filter(item => !withGym.has(item.id) && item.capturedAtRound !== view.round).sort((a, b) => b.population - a.population || a.id - b.id)[0];
  if (!city) return null;
  const preferred = preferredEssence(view, content);
  const usable = new Set(view.economy.player.registeredSpeciesIds.map(id => speciesEssence(id, content)));
  const choice = [preferred, ...ESSENCE_IDS.filter(id => usable.has(id))].find(id => essences.stock[id] >= ESSENCE_RULES.gymEssenceCost);
  return choice ? { type: 'BuildGym', cityId: city.id, essence: choice } : null;
}
/** Settling score bonus: tiles around a site that yield the preferred essence. */
export function siteEssenceBonus(view: PlayerView, content: Content, nearbyBiomes: readonly (string | null)[]): number {
  if (!view.expansion?.essences) return 0;
  const preferred = preferredEssence(view, content);
  const biomes: Record<EssenceId, string> = { life: 'grassland', sylvan: 'forest', earth: 'mountain', tide: 'ocean', spark: 'desert', mind: 'snow', blaze: 'volcano' };
  return nearbyBiomes.filter(biome => biome === biomes[preferred]).length;
}
