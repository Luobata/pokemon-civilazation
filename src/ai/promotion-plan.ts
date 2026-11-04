import type { Content } from '../content/units.ts';
import type { Command, PlayerView } from '../core/model.ts';
import { pendingPromotions, preferredTrait } from '../core/promotions.ts';

/** Gameplay v13: promote as soon as a promotion is available, lowest unit ID first, trait by role. */
export function planPromotionAction(view: PlayerView, content: Content): Command['action'] | null {
  const ledger = view.expansion?.promotions;
  if (!ledger) return null;
  const own = view.units.filter(unit => unit.ownerId === view.playerId).sort((a, b) => a.id - b.id);
  for (const unit of own) {
    if (pendingPromotions(ledger.units[unit.id]) < 1) continue;
    const trait = preferredTrait(view, unit.id, content);
    if (trait) return { type: 'PromoteUnit', unitId: unit.id, trait };
  }
  return null;
}
