// In-game "文明 6" hints for players who know Civilization VI. A small muted chip sits next to an
// existing heading; hovering or focusing it opens a hover card (styled like the unit action bar
// tips) with the Civ VI analogue and how it differs. The card is one fixed element on <body> so the
// drawer's clipped panels cannot cut it off, and it only exists while the pointer or focus is on a
// chip. Data comes from src/content/civ-glossary.ts, shared with the handbook.
import { CIV_GLOSSARY, civTermLabel, civTermSentence } from '../content/civ-glossary.ts';
import type { CivGlossaryEntry, CivGlossaryId } from '../content/civ-glossary.ts';
import '../civ-hint.css';

const esc = (text: string) => text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);

let installed = false;
let card: HTMLElement | null = null;

function hide(): void {
  if (card) card.hidden = true;
}

function show(chip: HTMLElement): void {
  const id = chip.dataset.civHint as CivGlossaryId | undefined;
  if (!id || !Object.hasOwn(CIV_GLOSSARY, id)) return;
  const entry: CivGlossaryEntry = CIV_GLOSSARY[id];
  if (!card) {
    card = document.createElement('div');
    card.id = 'civ-hint-card';
    card.className = 'civ-hint-card';
    card.setAttribute('role', 'tooltip');
    document.body.append(card);
  }
  card.dataset.civHint = id;
  card.innerHTML = `<b>${esc(entry.term)} ≈ 《文明 6》的${esc(entry.civ)}</b>${entry.note ? `<small>${esc(entry.note)}</small>` : ''}`;
  card.hidden = false;
  chip.setAttribute('aria-describedby', card.id);
  const box = chip.getBoundingClientRect(), width = card.offsetWidth, height = card.offsetHeight;
  const left = Math.max(8, Math.min(box.left, innerWidth - width - 8));
  const top = box.bottom + 6 + height > innerHeight - 8 ? Math.max(8, box.top - height - 6) : box.bottom + 6;
  card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

/** Delegated listeners, installed the first time a chip is rendered (no-op outside a browser). */
function install(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const chipOf = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('.civ-hint') : null;
  document.addEventListener('mouseover', event => { const chip = chipOf(event.target); if (chip) show(chip); });
  document.addEventListener('mouseout', event => { if (chipOf(event.target) && !chipOf(event.relatedTarget)) hide(); });
  document.addEventListener('focusin', event => { const chip = chipOf(event.target); if (chip) show(chip); else hide(); });
  document.addEventListener('focusout', event => { if (chipOf(event.target)) hide(); });
  document.addEventListener('scroll', hide, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
}

/** Chip markup for an existing heading, summary or panel header. */
export function civHint(id: CivGlossaryId): string {
  install();
  return `<span class="civ-hint" data-civ-hint="${id}" tabindex="0" role="note" aria-label="${esc(civTermSentence(id))}">${esc(civTermLabel(id))}</span>`;
}
