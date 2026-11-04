import { RARE_BERRY_IDS, RARE_BERRY_RULES } from '../content/rare-berries.ts';
import type { Command, PlayerView } from '../core/model.ts';

/** Gift a surplus rare berry to a trade partner whose cooldown allows it. */
export function planRareBerryAction(view: PlayerView): Command['action'] | null {
  const berries = view.expansion?.rareBerries;
  if (!berries) return null;
  const surplus = RARE_BERRY_IDS.find(id => berries.owned[id] >= 2);
  if (!surplus) return null;
  const cooling = (targetId: number) => view.round - (berries.lastGiftRoundByTarget?.[targetId] ?? -99) < RARE_BERRY_RULES.giftCooldown;
  const partner = view.expansion!.civilization.relations.filter(relation => relation.tradeSinceRound !== null && !relation.targetEliminated && !cooling(relation.targetPlayerId))
    .sort((a, b) => a.trust - b.trust || a.targetPlayerId - b.targetPlayerId)[0];
  return partner ? { type: 'GiftBerry', targetPlayerId: partner.targetPlayerId, berry: surplus } : null;
}
/** Settling bonus: unseen-kind rare berry deposits within the future city radius. */
export function siteRareBerryBonus(view: PlayerView, ring: ReadonlySet<number>): number {
  const berries = view.expansion?.rareBerries;
  if (!berries) return 0;
  return berries.deposits.filter(item => ring.has(item.tileIndex) && berries.owned[item.berry] === 0).length * 6;
}
