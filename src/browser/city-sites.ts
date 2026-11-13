// Suggested city sites for a selected settler (docs/design/depth-v26.md §7.3). Presentation only: read from the player's own
// view and never used by the AI or the authority. Pure (no DOM), so it is unit-tested in Node.
//
// Legal on what the player knows: explored land (no peak, landmark or circuit gym), at least 4 tiles from every known city, and
// the site with its first ring (the territory a new city claims) explored, so a suggestion never contains an unexplored tile.
// Each unexplored tile within 3 costs 1 point (§7.3's radius-2 penalty, widened to the 4-tile spacing rule: an unseen city could be
// there, and founding is then refused by the authority as usual). The AI's `isCitySite` needs all of ring 3 explored, which with
// the opening's short sight hides nearly every site, so it is not used here.
import { ESSENCES } from '../content/essences.ts';
import type { EssenceId } from '../content/essences.ts';
import { contentForView } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import { knownCities } from '../ai/query.ts';
import { viewGymBlocksCity } from '../core/gym-circuit.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from '../core/hex.ts';
import type { Hex } from '../core/hex.ts';
import type { PlayerView } from '../core/model.ts';
import { freshWater, isLandmarkTile, isPeak } from '../core/terrain.ts';
import { tileYieldReader } from './tile-yields.ts';
import { fieldTurns, goToField, hostilesNear, isSettler } from './waypoints.ts';

/** Why a site scored what it did: yields within 2 tiles, resources, fresh water, coast, essence sources, turns away, danger. */
export type SiteReasons = { food: number; production: number; gold: number; research: number; resources: number; freshWater: boolean;
  coast: boolean; essences: number; turns: number; danger: boolean; unexplored: number };
export type CitySite = { index: number; position: Hex; score: number; rank: number; reasons: SiteReasons };

/** §7.3 weights. */
export const SITE_WEIGHTS = { food: 3, production: 3, gold: 2, research: 2, freshWater: 4, coast: 2, resource: 4, essence: 2, turn: 3, danger: 10, unexplored: 1 } as const;
/** Suggested sites keep this distance from each other, so the three pins are three different choices. */
const SPREAD = 3;

const within = (view: PlayerView, center: Hex, radius: number) => {
  const out: number[] = [];
  for (let q = center.q - radius; q <= center.q + radius; q++) for (let r = center.r - radius; r <= center.r + radius; r++) {
    if (hexDistance(center, { q, r }, view.map) > radius) continue;
    const index = hexToIndex({ q, r }, view.map);
    if (index !== null && !out.includes(index)) out.push(index);
  }
  return out;
};

/** Up to `count` best legal sites for the settler, ranked by score (ties: fewer turns, lower tile index). Empty for other units. */
export function suggestCitySites(view: PlayerView, settlerId: number, count = 3, content: Content = contentForView(view)): CitySite[] {
  const settler = view.units.find(unit => unit.id === settlerId && unit.ownerId === view.playerId);
  if (!settler || !isSettler(settler) || view.outcome) return [];
  const field = goToField(view, settlerId, { content });
  if (!field) return [];
  const here = hexToIndex(settler.position, view.map)!;
  const occupied = new Set(view.units.filter(unit => unit.id !== settlerId).map(unit => hexToIndex(unit.position, view.map)));
  const yieldOf = tileYieldReader(view);
  const resources = new Map((view.expansion?.world.resources ?? []).map(site => [site.tileIndex, site]));
  const nests = (view.expansion?.world.nests ?? []).map(nest => indexToHex(nest.tileIndex, view.map));
  const cities = knownCities(view).map(city => city.position);
  const essenceBiomes = new Map((Object.keys(ESSENCES) as EssenceId[]).map(id => [ESSENCES[id].biome, id]));
  const scored: Omit<CitySite, 'rank'>[] = [];
  for (const [index, biome] of view.map.tiles.entries()) {
    if (biome === null || biome === 'ocean' || occupied.has(index)) continue;
    const position = indexToHex(index, view.map);
    const turns = index === here ? 0 : fieldTurns(field, index);
    if (turns === null || isPeak(view.map, index) || isLandmarkTile(view.map, index) || viewGymBlocksCity(view, index)
      || cities.some(city => hexDistance(city, position, view.map) < 4)) continue;
    const area = within(view, position, 2);
    if (within(view, position, 1).some(tile => view.map.tiles[tile] === null)) continue;
    const unexplored = within(view, position, 3).filter(tile => view.map.tiles[tile] === null).length;
    const reasons: SiteReasons = { food: 0, production: 0, gold: 0, research: 0, resources: 0, freshWater: freshWater(view.map, position),
      coast: neighbors(position, view.map).some(hex => view.map.tiles[hexToIndex(hex, view.map) ?? -1] === 'ocean'), essences: 0, turns,
      danger: hostilesNear(view, position, 1).some(id => view.units.find(unit => unit.id === id)?.kind === 'pokemon')
        || nests.some(nest => hexDistance(nest, position, view.map) <= 3), unexplored };
    const essences = new Set<EssenceId>();
    for (const tile of area) {
      const info = yieldOf(tile);
      if (info?.workable) for (const key of ['food', 'production', 'gold', 'research'] as const) reasons[key] += info.yields[key];
      if (resources.has(tile) && view.map.tiles[tile] !== null) reasons.resources++;
      const essence = view.map.tiles[tile] && essenceBiomes.get(view.map.tiles[tile]!);
      if (essence) essences.add(essence);
    }
    reasons.essences = essences.size;
    const w = SITE_WEIGHTS;
    const score = reasons.food * w.food + reasons.production * w.production + reasons.gold * w.gold + reasons.research * w.research
      + (reasons.freshWater ? w.freshWater : 0) + (reasons.coast ? w.coast : 0) + reasons.resources * w.resource + reasons.essences * w.essence
      - turns * w.turn - (reasons.danger ? w.danger : 0) - unexplored * w.unexplored;
    scored.push({ index, position, score, reasons });
  }
  scored.sort((a, b) => b.score - a.score || a.reasons.turns - b.reasons.turns || a.index - b.index);
  const chosen: CitySite[] = [];
  for (const site of scored) {
    if (chosen.length >= count) break;
    if (chosen.some(other => hexDistance(other.position, site.position, view.map) < SPREAD)) continue;
    chosen.push({ ...site, rank: chosen.length + 1 });
  }
  return chosen;
}
