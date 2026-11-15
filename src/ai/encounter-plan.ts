// Gameplay v27 ② AI (docs/design/pace-v27.md §3.3): "weaken it, then catch it". View-only: the exhaustion is a public unit field.
import { openingTuning } from '../content/pace-v27.ts';
import type { Content } from '../content/units.ts';
import { hexDistance } from '../core/hex.ts';
import type { MapUnit, PlayerView } from '../core/model.ts';
import { viewIsRaidUnit } from '../core/raids.ts';
import { viewIsRivalUnit } from '../core/rivals.ts';

/**
 * Extra attack score against a wild Pokémon that this hit (its minimum damage) leaves exhausted — not knocked out, at most the threshold —
 * while the civilization can throw a ball (domestication and a ball in stock) with an own Pokémon within 2 tiles. 0 before v27.
 */
export function exhaustAttackBonus(view: PlayerView, target: MapUnit, minDamage: number, content: Content): number {
  if (!content.wildEncounters || target.ownerId !== null || target.kind !== 'pokemon' || target.exhaustedUntilRound !== undefined
    || viewIsRivalUnit(view, target.id) || viewIsRaidUnit(view, target.id)) return 0;
  const player = view.economy.player, tuning = openingTuning(content), left = target.hp - minDamage;
  if (left <= 0 || left * 100 > tuning.exhaustHpPercent * content.species[target.speciesId].maxHp) return 0;
  if (!player.research.unlockedIds.includes('domestication') || player.ballInventory.pokeBall + player.ballInventory.greatBall === 0) return 0;
  return view.units.some(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon' && hexDistance(unit.position, target.position, view.map) <= 2)
    ? tuning.aiExhaustAttackBonus : 0;
}
