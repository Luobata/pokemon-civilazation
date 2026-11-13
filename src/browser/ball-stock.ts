// Playtest 2026-11 U6: the Poké Ball stock is always in sight — a top-bar button (it opens the capital's 物资采购 tab)
// and a count on the unit bar's capture button. Display only: it reads `economy.player.ballInventory`.
import type { PlayerView } from '../core/model.ts';
import { statChip } from './ui-icons.ts';

/** Accessible summary, e.g. "精灵球 3 · 超级球 0". */
export function ballStockLabel(view: PlayerView): string {
  const stock = view.economy.player.ballInventory, great = view.economy.player.research.unlockedIds.includes('ballCraft');
  return `精灵球 ${stock.pokeBall}${great || stock.greatBall ? ` · 超级球 ${stock.greatBall}` : ''}`;
}
/** Top-bar markup: the ball icons with counts (the great ball once it can be bought or is owned). */
export function ballStockMarkup(view: PlayerView): string {
  const stock = view.economy.player.ballInventory, great = view.economy.player.research.unlockedIds.includes('ballCraft');
  return `<small aria-hidden="true">球</small>${statChip('pokeBall', stock.pokeBall, '精灵球')}${great || stock.greatBall ? statChip('greatBall', stock.greatBall, '超级球') : ''}`;
}
/** Renders the top-bar button; `open` goes to the purchase tab. */
export function renderBallStock(view: PlayerView, open: () => void): void {
  const button = document.querySelector<HTMLButtonElement>('#hud-balls');
  if (!button) return;
  const markup = ballStockMarkup(view), label = `${ballStockLabel(view)}（点击前往城市「物资采购」）`;
  if (button.dataset.markup !== markup) { button.innerHTML = markup; button.dataset.markup = markup; }
  button.setAttribute('aria-label', label); button.title = label;
  button.classList.toggle('is-empty', view.economy.player.ballInventory.pokeBall + view.economy.player.ballInventory.greatBall === 0);
  button.onclick = open;
}
