// v26 §7.3 suggested city sites on the map: up to three pixel pins (①②③) over the canvas while a settler is selected, each with a
// hover / focus card listing the reasons as icon chips. A click sets a go-to order with the "found a city" intent (main.ts).
// The pins sit in the map frame below every HUD panel (action bar, notification rail, objective card, combat card), so they
// never cover one; they follow the camera each frame and hide off the canvas. Nothing animates (reduced motion needs nothing).
import '../waypoints.css';
import type { Point } from './camera.ts';
import type { CitySite } from './city-sites.ts';
import { escapeAttr, statChip, uiIcon } from './ui-icons.ts';

const CIRCLED = ['①', '②', '③', '④', '⑤'];
export const circled = (rank: number) => CIRCLED[rank - 1] ?? String(rank);

/** The hover card's reasons, one icon chip each (the number stays text; the icon names it). */
export function siteReasonChips(site: CitySite): string {
  const r = site.reasons;
  return [
    statChip('food', r.food, '食物（半径 2）'), statChip('production', r.production, '生产（半径 2）'),
    statChip('gold', r.gold, '金币（半径 2）'), statChip('research', r.research, '科研（半径 2）'),
    r.resources ? statChip('oranBerry', r.resources, '资源（树果、矿脉）') : '',
    r.freshWater ? statChip('freshWater', '✓', '淡水（河流或湖泊）') : '',
    r.coast ? statChip('coast', '✓', '近海') : '',
    r.essences ? statChip('essence', r.essences, '不同的精华来源') : '',
    statChip('turns', r.turns, '预计回合'),
    r.danger ? statChip('swords', '!', '危险：相邻有野生或敌方宝可梦，或 3 格内有巢穴') : '',
    r.unexplored ? statChip('map', r.unexplored, '3 格内未探索的格子（产出未计，可能藏着城市）') : '',
  ].filter(Boolean).join('');
}

export function sitePinsMarkup(sites: readonly CitySite[]): string {
  return sites.map(site => {
    const label = `推荐城址 ${circled(site.rank)}：得分 ${site.score}，约 ${site.reasons.turns} 轮。点击设路标`;
    return `<div class="site-pin" data-site-rank="${site.rank}" data-tile="${site.index}">
  <button type="button" class="site-pin-button" data-site="${site.index}" aria-label="${escapeAttr(label)}" aria-describedby="site-card-${site.index}">${uiIcon('sitePin', { size: 26 })}<b aria-hidden="true">${site.rank}</b></button>
  <div class="site-card" id="site-card-${site.index}" role="tooltip"><strong>${uiIcon('sitePin', { size: 16 })} 推荐城址 ${circled(site.rank)} <small>得分 ${site.score}</small></strong>
    <span class="site-chips">${siteReasonChips(site)}</span><small>点击图钉：设路标前往，到达后按「建城」（B）。</small></div>
</div>`;
  }).join('');
}

let rendered = '';
let pick: ((index: number) => void) | null = null;
/**
 * Draws the pins at `points` (canvas-local, the copy of each site nearest the view centre). An empty list hides them all.
 * `pickSite` runs when a pin is clicked (or activated from the keyboard).
 */
export function renderSitePins(host: HTMLElement, entries: readonly { site: CitySite; point: Point }[], size: { width: number; height: number }, pickSite: (index: number) => void): void {
  pick = pickSite;
  if (!host.dataset.bound) {
    host.dataset.bound = '1';
    // Keep keyboard focus on the map when a pin is clicked with the mouse, like the unit action bar.
    host.addEventListener('mousedown', event => { if ((event.target as HTMLElement).closest('button')) event.preventDefault(); });
    host.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-site]');
      if (button) pick?.(Number(button.dataset.site));
    });
  }
  const markup = sitePinsMarkup(entries.map(entry => entry.site));
  if (markup !== rendered) { host.innerHTML = markup; rendered = markup; }
  host.hidden = entries.length === 0;
  const pins = host.querySelectorAll<HTMLElement>('.site-pin');
  entries.forEach((entry, k) => {
    const pin = pins[k], { x, y } = entry.point;
    if (!pin) return;
    pin.hidden = x < 0 || x > size.width || y < 0 || y > size.height;
    pin.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    // The card opens above the pin, or below it near the top edge; it shifts inwards near the side edges.
    pin.classList.toggle('below', y < 170);
    pin.classList.toggle('edge-left', x < 150);
    pin.classList.toggle('edge-right', x > size.width - 150);
  });
}
