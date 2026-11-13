// One floating hover card for icon-first panels: an element bound here shows its full text beside it while hovered
// or focused. Same look as the 文明 6 hint card (src/civ-hint.css); it lives on <body> so clipped drawers cannot cut
// it off, and it ignores the pointer so it never blocks clicks.
import '../civ-hint.css';

let card: HTMLElement | null = null;
let anchor: HTMLElement | null = null;

export function hideTip(): void {
  if (card) card.hidden = true;
  anchor = null;
}

function place(): void {
  if (!card || !anchor) return;
  const box = anchor.getBoundingClientRect(), width = card.offsetWidth, height = card.offsetHeight;
  const right = box.right + 8 + width <= innerWidth - 8;
  const left = right ? box.right + 8 : Math.max(8, box.left - width - 8);
  const top = Math.max(8, Math.min(box.top, innerHeight - height - 8));
  card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

/** Scrolling keeps the card on its element while that is still hovered or focused (e.g. a node scrolled into view). */
function onScroll(): void {
  if (anchor?.isConnected && (anchor.matches(':hover') || anchor === document.activeElement)) place();
  else hideTip();
}

export function showTip(element: HTMLElement, html: string): void {
  if (!card) {
    card = document.createElement('div');
    card.id = 'ui-tip-card';
    card.className = 'civ-hint-card ui-tip-card';
    card.setAttribute('role', 'tooltip');
    document.body.append(card);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hideTip(); });
  }
  anchor = element;
  card.innerHTML = html;
  card.hidden = false;
  place();
}

/** Shows `html()` beside `element` on hover and keyboard focus. */
export function bindTip(element: HTMLElement, html: () => string): void {
  element.addEventListener('mouseenter', () => showTip(element, html()));
  element.addEventListener('focus', () => showTip(element, html()));
  element.addEventListener('mouseleave', hideTip);
  element.addEventListener('blur', hideTip);
}

let delegated = false;
const escapeText = (text: string) => text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);
/**
 * Delegated hover cards: any element with `data-tip` (plain text, newlines kept) shows it on hover and keyboard focus;
 * an optional `data-tip-title` is shown as the card's bold first line above it. Installed once, the first time a panel
 * renders such elements (no-op outside a browser).
 */
export function installDataTips(): void {
  if (delegated || typeof document === 'undefined') return;
  delegated = true;
  const tipOf = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('[data-tip]') : null;
  const html = (element: HTMLElement) => {
    const body = element.dataset.tip!.split('\n').map(escapeText).join('<br>'), title = element.dataset.tipTitle;
    return title ? `<b>${escapeText(title)}</b><small>${body}</small>` : body;
  };
  const show = (element: HTMLElement) => { if (element !== anchor || card?.hidden) showTip(element, html(element)); };
  document.addEventListener('mouseover', event => { const element = tipOf(event.target); if (element) show(element); });
  document.addEventListener('mouseout', event => { const element = tipOf(event.target); if (element && tipOf(event.relatedTarget) !== element) hideTip(); });
  document.addEventListener('focusin', event => { const element = tipOf(event.target); if (element) show(element); });
  document.addEventListener('focusout', event => { if (tipOf(event.target)) hideTip(); });
}
