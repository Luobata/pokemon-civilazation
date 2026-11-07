import type { CitySummary, Command, PlayerView } from '../core/model.ts';
import { BOND_RECLAIM } from '../core/bonds.ts';
import { hexDistance } from '../core/hex.ts';

export function renderNeutralPanel(view: PlayerView, city: CitySummary | null, issue?: (action: Command['action']) => void, disabled = false): void {
  const root = document.querySelector<HTMLElement>('#neutral-city')!;
  if (!city || city.ownerId !== null) { root.innerHTML = ''; return; }
  const combat = view.combat.cities[city.id];
  const near = view.economy.cities.some(own => hexDistance(own.position, city.position, view.map) <= BOND_RECLAIM.range);
  const reclaim = view.expansion?.bonds ? `<p class="neutral-note">${near ? `可花 ${BOND_RECLAIM.gold} 金币和平收复（需在己方城市 ${BOND_RECLAIM.range} 格内），初始羁绊 50。` : `距离己方城市超过 ${BOND_RECLAIM.range} 格，无法和平收复。`}</p><div class="unit-actions"><button id="reclaim-city" ${disabled || !near || view.economy.player.gold < BOND_RECLAIM.gold ? 'disabled' : ''}>和平收复 · ${BOND_RECLAIM.gold} 金</button></div>` : '';
  root.innerHTML = `<div class="subpanel-head"><strong>中立营地 ${city.id}</strong><span>无主</span></div><p class="neutral-note">琥珀爪印表示中立实体。HP ${combat?.hp ?? '未知'}；不可工作、不产出，可通过战争占领。</p>${reclaim}`;
  root.querySelector('#reclaim-city')?.addEventListener('click', () => issue?.({ type: 'ReclaimCity', cityId: city.id }));
}
