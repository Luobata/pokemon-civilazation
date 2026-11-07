import { DISTRICT_IDS, DISTRICTS } from '../content/districts.ts';
import type { DistrictId, DistrictEffects } from '../content/districts.ts';
import type { Content } from '../content/units.ts';
import { tileYield, workRadius } from '../core/city.ts';
import { improvementYield } from '../core/improvements.ts';
import { districtBlocker, districtEffects, districtViewInput } from '../core/districts.ts';
import { hexDistance, indexToHex } from '../core/hex.ts';
import type { PlayerView } from '../core/model.ts';

export type DistrictCandidate = { cityId: number; kind: DistrictId; tileIndex: number; score: number;
  resourceValue: number; opportunityCost: number; sameKindCount: number; personalityBonus: number; effects: DistrictEffects };
const resourceValue = (effects: Pick<DistrictEffects, 'food' | 'production' | 'gold' | 'research'>) =>
  2 * effects.food + 3 * effects.production + 2 * effects.gold + 3 * effects.research;
export const compareDistrictCandidates = (a: DistrictCandidate, b: DistrictCandidate) => b.score - a.score
  || a.cityId - b.cityId || a.tileIndex - b.tileIndex || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0);
/** Pure observation-only candidates, ranked by the approved §5 formula. */
export function districtCandidates(view: PlayerView, cityId: number, content: Content): DistrictCandidate[] {
  if (!view.expansion?.districts) return [];
  const input = districtViewInput(view), city = view.economy.cities.find(city => city.id === cityId);
  if (!city) return [];
  const player = view.economy.player, personality = player.personality;
  const tiles = [...input.visible].filter(index => hexDistance(city.position, indexToHex(index, view.map), view.map) <= workRadius(city)).sort((a, b) => a - b);
  return DISTRICT_IDS.flatMap(kind => tiles.flatMap(tileIndex => {
    if (districtBlocker(input, cityId, kind, tileIndex)) return [];
    const effects = districtEffects(input, kind, tileIndex).total;
    const value = resourceValue(effects);
    const worked = tileYield(view.map.tiles[tileIndex]!, player, content);
    const improvement = input.improvements.find(item => item.tileIndex === tileIndex);
    if (improvement) {
      const bonus = improvementYield(improvement.kind, player);
      for (const key of ['food', 'production', 'gold', 'research'] as const) worked[key] += bonus[key];
    }
    const opportunityCost = city.workedTileIds.includes(tileIndex) ? 100 * resourceValue(worked) : 0;
    const sameKindCount = view.expansion!.districts!.tiles.filter(item => view.economy.cities.some(city => city.id === item.cityId) && item.kind === kind).length
      + input.projects.filter(item => item.kind === kind).length;
    const personalityBonus = personality === 'aggressive' && kind === 'gymDistrict' ? 150
      : personality === 'expansion' && (kind === 'harborDistrict' || kind === 'gardenDistrict') ? 100
        : personality === 'conservative' && (kind === 'researchDistrict' || kind === 'powerPlantDistrict') ? 100 : 0;
    const score = 100 * value + 20 * effects.bondPressure + 5 * effects.trainedXp - DISTRICTS[kind].cost - opportunityCost - 75 * sameKindCount + personalityBonus;
    return [{ cityId, kind, tileIndex, score, resourceValue: value, opportunityCost, sameKindCount, personalityBonus, effects }];
  })).sort(compareDistrictCandidates);
}
