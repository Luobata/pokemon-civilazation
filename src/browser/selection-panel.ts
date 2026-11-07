import { unitDefinition, contentForView } from '../content/units.ts';
import type { PlayerView } from '../core/model.ts';

let rendered = '';
export function renderSelectionPanel(view: PlayerView, selectedUnit: number | null, selectedCity: number | null,
  callbacks: { unit: (id: number | null) => void; city: (id: number | null) => void; clear: () => void }, busy: boolean): void {
  const CONTENT = contentForView(view);
  const units = view.units.filter(unit => unit.ownerId === view.playerId);
  const cities = view.economy.cities;
  const signature = JSON.stringify([units, cities.map(city => [city.id, city.population]), selectedUnit, selectedCity, busy]);
  if (signature === rendered) return;
  rendered = signature;
  const root = document.querySelector<HTMLElement>('#selection-panel')!;
  // One compact row: the drawer's first screen belongs to the selected city or unit, not to the picker.
  root.title = '点选地图上的城市或单位，也可从列表选择。城市负责生产，开拓队负责建城。';
  root.innerHTML = `<div class="entity-selectors"><label><span class="visually-hidden">我的城市</span><select id="city-select" aria-label="我的城市" ${busy ? 'disabled' : ''}><option value="">选择城市</option>${cities.map(city => `<option value="${city.id}" ${city.id === selectedCity ? 'selected' : ''}>城市 ${city.id} · 人口 ${city.population}</option>`).join('')}</select></label>
    <label><span class="visually-hidden">我的单位</span><select id="unit-select" aria-label="我的单位" ${busy ? 'disabled' : ''}><option value="">选择单位</option>${units.map(unit => `<option value="${unit.id}" ${unit.id === selectedUnit ? 'selected' : ''}>${unitDefinition(unit, CONTENT).name} #${unit.id} · 行动 ${unit.actionLeft}</option>`).join('')}</select></label>
    <button id="clear-selection" class="quiet-button" title="取消选择" ${busy ? 'disabled' : ''}>取消</button></div>`;
  root.querySelector<HTMLSelectElement>('#city-select')!.addEventListener('change', event => {
    const value = (event.target as HTMLSelectElement).value;
    callbacks.city(value ? Number(value) : null);
  });
  root.querySelector<HTMLSelectElement>('#unit-select')!.addEventListener('change', event => {
    const value = (event.target as HTMLSelectElement).value;
    callbacks.unit(value ? Number(value) : null);
  });
  root.querySelector('#clear-selection')!.addEventListener('click', callbacks.clear);
}
