// Full-screen system pages opened from the top-bar launcher (Civilization-style), plus the
// right-hand context drawer for the current selection. Only one screen is open at a time.

export type ScreenId = 'victory' | 'research' | 'policy' | 'era' | 'legends' | 'leader' | 'diplomacy' | 'world' | 'log' | 'menu';

// Pages without a launcher (multiplayer.html) render panels inline; screen calls fall back to focusing them.
const host = () => document.querySelector<HTMLElement>('#screen-host');
let opener: HTMLElement | null = null;
const listeners = new Set<(screen: ScreenId | null) => void>();

export function currentScreen(): ScreenId | null {
  const open = host()?.querySelector<HTMLElement>('.screen:not([hidden])');
  return (open?.dataset.screen as ScreenId | undefined) ?? null;
}

export function openScreen(id: ScreenId, focus?: string): void {
  const root = host();
  if (!root) {
    const target = focus ? document.querySelector<HTMLElement>(focus) : null;
    target?.scrollIntoView({ block: 'center' }); target?.focus();
    return;
  }
  if (currentScreen() === null) opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  root.hidden = false;
  for (const screen of root.querySelectorAll<HTMLElement>('.screen')) screen.hidden = screen.dataset.screen !== id;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-open-screen]')) {
    button.setAttribute('aria-expanded', String(button.dataset.openScreen === id));
  }
  const screen = root.querySelector<HTMLElement>(`.screen[data-screen="${id}"]`)!;
  screen.querySelector<HTMLElement>('.screen-body')!.scrollTop = 0;
  const target = (focus ? screen.querySelector<HTMLElement>(focus) : null) ?? screen.querySelector<HTMLElement>('.screen-close')!;
  target.focus();
  for (const listener of listeners) listener(id);
}

export function closeScreen(): void {
  const root = host();
  if (!root || root.hidden) return;
  root.hidden = true;
  for (const screen of root.querySelectorAll<HTMLElement>('.screen')) screen.hidden = true;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-open-screen]')) button.setAttribute('aria-expanded', 'false');
  if (opener?.isConnected) opener.focus();
  opener = null;
  for (const listener of listeners) listener(null);
}

export function onScreenChange(listener: (screen: ScreenId | null) => void): void { listeners.add(listener); }

/** Brings any panel into view: opens the screen that hosts it, or scrolls it inside the drawer. */
export function revealPanel(target: HTMLElement): void {
  if (target instanceof HTMLDetailsElement) target.open = true;
  const screen = target.closest<HTMLElement>('.screen');
  if (screen) { openScreen(screen.dataset.screen as ScreenId); target.scrollIntoView({ block: 'nearest' }); }
  else { closeScreen(); target.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  target.classList.remove('panel-flash'); void target.offsetWidth; target.classList.add('panel-flash');
}

export function installScreens(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-open-screen]')) button.addEventListener('click', () => {
    const id = button.dataset.openScreen as ScreenId;
    if (currentScreen() === id) closeScreen(); else openScreen(id);
  });
  for (const element of document.querySelectorAll<HTMLElement>('[data-close-screen]')) element.addEventListener('click', closeScreen);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && currentScreen() !== null && !document.querySelector('dialog[open]')) { event.preventDefault(); closeScreen(); }
  });
}
