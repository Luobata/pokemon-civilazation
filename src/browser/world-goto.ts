// Playtest 2026-11b (batch C, raids): can my Pokémon reach a known tile, in about how many rounds, and which one should go there.
// Presentation only: plans are the client waypoints' own (waypoints.ts: the viewer's known terrain, unexplored tiles costed as
// grassland), so the World page's 前往 button sets exactly the order the W key would.
import { contentForView, unitDefinition } from '../content/units.ts';
import type { Content } from '../content/units.ts';
import { hexDistance, hexToIndex, indexToHex, neighbors } from '../core/hex.ts';
import type { PlayerView } from '../core/model.ts';
import { fieldTurns, goToField } from './waypoints.ts';

/** The best own Pokémon to send next to `tileIndex`: the stop it would aim for and the rounds it needs (1 = it gets there this turn or next). */
export type Approach = { unitId: number; name: string; tileIndex: number; turns: number };
const cache = new Map<string, Approach | null>();
/** Up to `sample` nearest own Pokémon are planned (each a full known-terrain search); null when none can reach any tile beside it. */
export function approachTile(view: PlayerView, tileIndex: number, content: Content = contentForView(view), sample = 4): Approach | null {
  const key = `${view.seed}:${view.playerId}:${view.commandSeq}:${tileIndex}`;
  if (cache.has(key)) return cache.get(key)!;
  if (cache.size > 32) cache.clear();
  const at = indexToHex(tileIndex, view.map);
  const goals = new Set(neighbors(at, view.map).map(hex => hexToIndex(hex, view.map)).filter((index): index is number => index !== null && view.map.tiles[index] !== 'ocean'));
  let best: Approach | null = null;
  const own = view.units.filter(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon')
    .sort((a, b) => hexDistance(a.position, at, view.map) - hexDistance(b.position, at, view.map) || a.id - b.id).slice(0, sample);
  for (const unit of own) {
    const here = hexToIndex(unit.position, view.map)!;
    if (goals.has(here)) { best = { unitId: unit.id, name: unitDefinition(unit, content).name, tileIndex: here, turns: 0 }; break; }
    const field = goToField(view, unit.id, { content });
    if (!field) continue;
    for (const goal of [...goals].sort((a, b) => a - b)) {
      const turns = fieldTurns(field, goal);
      if (turns !== null && (!best || turns < best.turns)) best = { unitId: unit.id, name: unitDefinition(unit, content).name, tileIndex: goal, turns };
    }
  }
  cache.set(key, best);
  return best;
}
/** "约 N 轮到" as the cards say it (0: already beside it). */
export const approachText = (approach: Approach | null) => !approach ? '已知地形上到不了' : approach.turns === 0 ? `${approach.name}已在旁边` : `${approach.name}约 ${approach.turns} 轮到`;

/** The go-to order a clicked `[data-goto-unit]` button asks for (world-cards.ts `goToButton`), or null. */
export function goToButtonOrder(event: Event): { unitId: number; tileIndex: number } | null {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-goto-unit][data-goto-tile]') : null;
  return button && !button.disabled ? { unitId: Number(button.dataset.gotoUnit), tileIndex: Number(button.dataset.gotoTile) } : null;
}
