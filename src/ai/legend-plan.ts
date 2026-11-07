// Gameplay v15 AI: build one legendary wonder at a time and send a nearby mobile Pokémon to known trace sites (PlayerView only).
import { LEGEND_WONDER_IDS } from '../content/legend-wonders.ts';
import type { LegendWonderId } from '../content/legend-wonders.ts';
import type { Content } from '../content/units.ts';
import { hexDistance, indexToHex } from '../core/hex.ts';
import type { Hex } from '../core/hex.ts';
import { viewLegendBlocker } from '../core/legends.ts';
import type { PlayerView } from '../core/model.ts';

export function planLegendWonder(view: PlayerView, threatened: ReadonlySet<number>): { cityId: number | null; legendId: LegendWonderId | null } {
  const legends = view.expansion?.legends;
  if (!legends || legends.building.length) return { cityId: null, legendId: null };
  const cities = [...view.economy.cities].filter(city => !threatened.has(city.id)).sort((a, b) => b.yields.production - a.yields.production || a.id - b.id);
  for (const city of cities) {
    const legendId = LEGEND_WONDER_IDS.find(id => viewLegendBlocker(view, city, id) === null);
    if (legendId) return { cityId: city.id, legendId };
  }
  return { cityId: null, legendId: null };
}

const MOBILE = new Set(['scout', 'fast', 'air']);
/** Each known trace site without our clue gets the nearest idle mobile Pokémon within 12 tiles. */
export function legendTraceTargets(view: PlayerView, content: Content): Map<number, Hex> {
  const legends = view.expansion?.legends, targets = new Map<number, Hex>();
  if (!legends || !view.economy.player.research.unlockedIds.includes('fieldObservation')) return targets;
  const units = view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon' && unit.actionLeft && MOBILE.has(content.species[unit.speciesId].role));
  for (const site of legends.sites) {
    if (legends.clues.includes(site.legendId) || legends.wonders.some(wonder => wonder.legendId === site.legendId)) continue;
    const position = indexToHex(site.tileIndex, view.map);
    const unit = units.filter(candidate => !targets.has(candidate.id) && hexDistance(candidate.position, position) <= 12)
      .sort((a, b) => hexDistance(a.position, position) - hexDistance(b.position, position) || a.id - b.id)[0];
    if (unit) targets.set(unit.id, position);
  }
  return targets;
}

/** v21: each known item ball gets the nearest own Pokémon within 8 tiles (one per ball). */
export function itemBallTargets(view: PlayerView): Map<number, Hex> {
  const balls = view.expansion?.opening?.itemBalls ?? [], targets = new Map<number, Hex>();
  const units = view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon' && unit.actionLeft);
  for (const ball of balls) {
    const position = indexToHex(ball.tileIndex, view.map);
    const unit = units.filter(candidate => !targets.has(candidate.id) && hexDistance(candidate.position, position) <= 8)
      .sort((a, b) => hexDistance(a.position, position) - hexDistance(b.position, position) || a.id - b.id)[0];
    if (unit) targets.set(unit.id, position);
  }
  return targets;
}
