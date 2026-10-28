import type { CitySummary, PlayerView } from '../core/model.ts';

export function renderNeutralPanel(view: PlayerView, city: CitySummary | null): void {
  const root = document.querySelector<HTMLElement>('#neutral-city')!;
  if (!city || city.ownerId !== null) { root.innerHTML = ''; return; }
  const combat = view.combat.cities[city.id];
  root.innerHTML = `<div class="subpanel-head"><strong>中立营地 ${city.id}</strong><span>无主</span></div><p class="neutral-note">琥珀爪印表示中立实体。HP ${combat?.hp ?? '未知'}；不可工作、不产出，可通过战争占领。</p>`;
}
