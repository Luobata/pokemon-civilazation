// Civilization-style notification rail (P0-6): a column of round icons at the left edge of the right drawer.
// Hover or focus opens an item's card; clicking the icon or its button does the action; × or right-click dismisses.
// Persistent notifications stay until handled (clicked, their target visited, or resolved elsewhere) or dismissed;
// informational ones fade INFO_MS after the player has control again, so nothing vanishes during AI turns.
import { toastResolved } from './notifications.ts';
import type { Toast, ToastTarget } from './notifications.ts';
import type { PlayerView } from '../core/model.ts';

const MAX_ITEMS = 12;
export const INFO_MS = 10_000;
const PEEK_MS = 5_000;

type Entry = { toast: Toast; expiresAt: number | null; fresh: boolean };
export type RailFocus = { unitId: number | null; cityId: number | null };
export type NotificationRail = {
  push(item: Toast | null): void;
  dismiss(id: number): void;
  /** Call after every UI refresh: resolves handled items, starts fade timers once the player has control. */
  sync(view: PlayerView, busy: boolean, focus: RailFocus): void;
  /** A launcher screen was opened: notifications that only point there are handled. */
  screenOpened(screen: string | null): void;
  clear(): void;
};

const escape = (text: string) => text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);

export function railMarkup(entries: readonly Toast[], peekId: number | null): string {
  return entries.map(item => {
    const label = `${item.title}${item.detail ? `：${item.detail}` : ''}`;
    const actionable = Boolean(item.target);
    return `<div class="toast toast-${item.tone}${item.persistent ? ' is-persistent' : ''}${item.id === peekId ? ' is-peek' : ''}" data-toast="${item.id}" role="status">
    <button type="button" class="toast-icon" data-toast-open="${item.id}" title="${escape(label)}${actionable ? '（点击前往，右键忽略）' : '（右键忽略）'}" aria-label="${escape(label)}">${item.icon}</button>
    <div class="toast-card"><div class="toast-body"><strong>${item.title}</strong>${item.detail ? `<small>${item.detail}</small>` : ''}</div>
    ${item.target && item.action ? `<button type="button" class="toast-action" data-toast-action="${item.id}">${item.action}</button>` : ''}
    <button type="button" class="toast-close" data-toast-close="${item.id}" aria-label="忽略：${escape(item.title)}" title="忽略">×</button></div></div>`;
  }).join('');
}

export function createNotificationRail(host: HTMLElement, activate: (target: NonNullable<ToastTarget>) => void, now: () => number = () => Date.now()): NotificationRail {
  const entries: Entry[] = [];
  let peekId: number | null = null, peekTimer = 0, fadeTimer = 0, markup = '', lastFocus: RailFocus = { unitId: null, cityId: null }, lastView: PlayerView | null = null;

  function render() {
    const next = railMarkup(entries.map(entry => entry.toast), peekId);
    if (next === markup) return;
    markup = next; host.innerHTML = next;
    host.hidden = entries.length === 0;
  }
  function remove(predicate: (entry: Entry) => boolean) {
    let changed = false;
    for (let index = entries.length - 1; index >= 0; index--) if (predicate(entries[index]!)) { entries.splice(index, 1); changed = true; }
    if (changed) render();
    return changed;
  }
  function dismiss(id: number) { if (peekId === id) peekId = null; remove(entry => entry.toast.id === id); }
  function open(id: number) {
    const entry = entries.find(candidate => candidate.toast.id === id);
    if (!entry) return;
    // Clicking is handling it, unless the choice still has to be made (e.g. research not chosen yet).
    if (!entry.toast.resolve || (lastView && toastResolved(entry.toast, lastView))) dismiss(id);
    if (entry.toast.target) activate(entry.toast.target);
  }
  function scheduleFade() {
    window.clearTimeout(fadeTimer);
    const next = Math.min(...entries.map(entry => entry.expiresAt ?? Infinity));
    if (next === Infinity) return;
    fadeTimer = window.setTimeout(() => {
      const time = now();
      for (const entry of entries) {
        if (entry.expiresAt === null || entry.expiresAt > time) continue;
        // Never fade the card the player is reading.
        if (host.querySelector(`[data-toast="${entry.toast.id}"]`)?.matches(':hover, :focus-within')) entry.expiresAt = time + 3000;
      }
      remove(entry => entry.expiresAt !== null && entry.expiresAt <= time);
      scheduleFade();
    }, Math.max(0, next - now()));
  }
  function peek(id: number | null) {
    window.clearTimeout(peekTimer);
    peekId = id; render();
    if (id !== null) peekTimer = window.setTimeout(() => { peekId = null; render(); }, PEEK_MS);
  }

  host.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.toastClose) dismiss(Number(button.dataset.toastClose));
    else if (button.dataset.toastAction) open(Number(button.dataset.toastAction));
    else if (button.dataset.toastOpen) open(Number(button.dataset.toastOpen));
  });
  host.addEventListener('contextmenu', event => {
    const item = (event.target as HTMLElement).closest<HTMLElement>('[data-toast]');
    if (!item) return;
    event.preventDefault(); dismiss(Number(item.dataset.toast));
  });
  host.addEventListener('keydown', event => {
    const item = (event.target as HTMLElement).closest<HTMLElement>('[data-toast]');
    if (item && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); dismiss(Number(item.dataset.toast)); }
  });

  return {
    push(item) {
      if (!item) return;
      if (item.key) remove(entry => entry.toast.key === item.key);
      entries.unshift({ toast: item, expiresAt: null, fresh: true });
      // Overflow: drop the oldest informational item first, then the oldest of any kind.
      while (entries.length > MAX_ITEMS) {
        const informational = entries.map(entry => !entry.toast.persistent).lastIndexOf(true);
        entries.splice(informational >= 0 ? informational : entries.length - 1, 1);
      }
      render();
    },
    dismiss,
    sync(view, busy, focus) {
      lastView = view;
      remove(entry => entry.toast.persistent && toastResolved(entry.toast, view));
      // Visiting a notification's unit or city handles it (when nothing else has to be done there).
      const visitedUnit = focus.unitId !== null && focus.unitId !== lastFocus.unitId ? focus.unitId : null;
      const visitedCity = focus.cityId !== null && focus.cityId !== lastFocus.cityId ? focus.cityId : null;
      lastFocus = { ...focus };
      remove(entry => !entry.fresh && !entry.toast.resolve && entry.toast.target !== null
        && ((entry.toast.target.kind === 'unit' && entry.toast.target.unitId === visitedUnit) || (entry.toast.target.kind === 'city' && entry.toast.target.cityId === visitedCity)));
      if (busy) return;
      // The player has control again: informational items start to fade, the newest arrival opens briefly.
      const fresh = entries.filter(entry => entry.fresh);
      for (const entry of fresh) { entry.fresh = false; if (!entry.toast.persistent) entry.expiresAt = now() + INFO_MS; }
      if (fresh.length) { peek(fresh[0]!.toast.id); scheduleFade(); }
    },
    screenOpened(screen) {
      if (screen === null) return;
      remove(entry => !entry.fresh && !entry.toast.resolve && entry.toast.target?.kind === 'screen' && entry.toast.target.screen === screen);
    },
    clear() { entries.length = 0; peekId = null; window.clearTimeout(peekTimer); window.clearTimeout(fadeTimer); render(); },
  };
}
