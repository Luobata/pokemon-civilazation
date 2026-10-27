import { renderEconomyPanel } from './economy-panel.ts';
import type { Command } from '../core/model.ts';
import '../styles.css';
import { GameSession } from '../app/session.ts';
import { CONTENT, unitDefinition } from '../content/units.ts';
import type { StarterId } from '../content/units.ts';
import { hexToIndex, indexToHex } from '../core/hex.ts';
import { reachablePaths } from '../core/movement.ts';
import type { PlayerView, VisibleEvent } from '../core/model.ts';
import { BIOME_DISPLAY, drawMap } from './canvas.ts';
import type { AnimationPose } from './canvas.ts';
import { fitCamera, hexToWorld, toWorld, worldToHex, zoomAt } from './camera.ts';
import type { Camera, Point } from './camera.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#map')!;
const info = document.querySelector<HTMLElement>('#map-info')!;
const debug = document.querySelector<HTMLElement>('#debug')!;
const selection = document.querySelector<HTMLElement>('#selection')!;
const animate = document.querySelector<HTMLInputElement>('#animate')!;
const god = document.querySelector<HTMLInputElement>('#god')!;
const starter = document.querySelector<HTMLSelectElement>('#starter')!;
const sequence = document.querySelector<HTMLInputElement>('#sequence')!;
const endTurn = document.querySelector<HTMLButtonElement>('#end-turn')!;
export let session: GameSession;
export let camera: Camera = { x: 0, y: 0, zoom: 1 };
let selected: number | null = null;
let selectedCity: number | null = null;
let keyboardIndex: number | null = null;
let active: { payload: Extract<VisibleEvent['payload'], { type: 'Moved' }>; started: number } | null = null;
let frameRequested = false;
let notice = '';
const busy = () => active !== null || session.presentationQueue.length > 0;

function renderUnitPanel(view: PlayerView) {
  const root = document.querySelector<HTMLElement>('#unit-panel')!;
  const unit = view.units.find(unit => unit.id === selected && unit.ownerId === view.playerId);
  if (!unit) { root.innerHTML = ''; return; }
  const definition = unitDefinition(unit, CONTENT);
  const kind = unit.kind === 'pokemon' ? '宝可梦' : '后勤单位';
  root.innerHTML = `<div class="unit-card"><div class="unit-head"><div class="unit-portrait">${definition.name.slice(0, 1)}</div><div><strong>${definition.name}</strong><small>${kind} · 文明 ${view.playerId + 1}</small></div><span class="unit-ap ${unit.actionLeft ? '' : 'spent'}">行动点 ${unit.actionLeft}</span></div>
    <div class="unit-details"><div class="unit-detail"><small>经验</small><strong>${unit.xp}</strong></div><div class="unit-detail"><small>移动</small><strong>${definition.move}</strong></div><div class="unit-detail"><small>视野</small><strong>${definition.vision}</strong></div></div>
    <p class="unit-note">${unit.kind === 'logistics' ? '在合法位置使用城市面板的“开拓队建城”。' : '选择高亮格移动；行动结果由现有命令结算。'}</p></div>`;
}

function controls() {
  const view = session.getView();
  const { player } = view.economy;
  const yields = view.economy.cities.reduce((sum, city) => ({
    gold: sum.gold + city.yields.gold,
    research: sum.research + city.yields.research,
  }), { gold: 0, research: 0 });
  const upkeep = view.units.filter(unit => unit.ownerId === view.playerId)
    .reduce((sum, unit) => sum + unitDefinition(unit, CONTENT).upkeep, 0);
  const netGold = yields.gold - upkeep;
  info.textContent = `种子 ${view.seed} · 第 ${view.round} 轮 · 当前文明 ${view.activePlayerId + 1} · 命令 ${view.commandSeq}`;
  document.querySelector('#round-display')!.innerHTML = `${view.round} <span>/ 100</span>`;
  document.querySelector('#hud-gold')!.innerHTML = `${player.gold} <span class="delta">${netGold >= 0 ? '+' : ''}${netGold}</span>`;
  document.querySelector('#hud-research')!.innerHTML = `${yields.research} <span class="delta">/ 轮</span>`;
  document.querySelector('#hud-upkeep')!.innerHTML = `−${upkeep} <span class="delta negative">金币</span>`;
  const unit = view.units.find(unit => unit.id === selected);
  selection.textContent = unit ? `${unitDefinition(unit, CONTENT).name} · 行动点 ${unit.actionLeft} · 点击高亮格移动` : '点选己方单位；拖动地图平移，滚轮缩放。';
  debug.textContent = `seed=${view.seed} round=${view.round} activePlayer=${view.activePlayerId} commandSeq=${view.commandSeq}\n最近拒绝：${session.lastRejected ? JSON.stringify(session.lastRejected) : '无'}${notice ? '\n' + notice : ''}`;
  sequence.max = String(session.exportLog().commands.length);
  renderUnitPanel(view);
  renderEconomyPanel(view, selectedCity, selected, issue, id => { selectedCity = id; controls(); }, busy());
  if (busy()) for (const element of document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('#economy button, #economy input, #economy select')) element.disabled = true;
  for (const element of document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('#controls button, #controls input, #controls select, #dev-drawer button, #dev-drawer input, #skip')) {
    element.disabled = element.id === 'skip' ? !busy() : busy();
  }
  endTurn.disabled = busy();
}

function issue(action: Command['action']) {
  if (busy()) return;
  const result = session.issue(action);
  if (result.ok && action.type === 'FoundCity') { selected = null; selectedCity = session.getView().economy.cities.at(-1)!.id; }
  controls(); requestFrame();
}
function requestFrame() {
  if (!frameRequested) { frameRequested = true; requestAnimationFrame(frame); }
}
function frame(now: number) {
  frameRequested = false;
  if (!animate.checked) { active = null; session.skipAnimations(); }
  if (active && now - active.started >= Math.max(1, active.payload.path.length - 1) * 180) active = null;
  while (!active && session.presentationQueue.length) {
    const event = session.presentationQueue.shift()!;
    if (event.payload.type === 'Moved') active = { payload: event.payload, started: now };
  }
  let pose: AnimationPose | undefined;
  if (active) {
    const path = active.payload.path;
    const progress = Math.min(path.length - 1, (now - active.started) / 180);
    const index = Math.floor(progress), fraction = progress - index;
    const a = hexToWorld(path[index]), b = hexToWorld(path[Math.min(index + 1, path.length - 1)]);
    pose = { unit: active.payload.unit, position: { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction } };
  }
  const view = session.getView();
  const paths = selected === null ? {} : reachablePaths(view, selected);
  drawMap(canvas, import.meta.env.DEV && god.checked ? session.getDebugView() : view,
    camera, selected, Object.keys(paths).map(Number), pose, keyboardIndex);
  if (busy()) requestFrame(); else controls();
}
function skip() { active = null; session.skipAnimations(); controls(); requestFrame(); }
function fit() { camera = fitCamera(session.getView().map, canvas.clientWidth, canvas.clientHeight); requestFrame(); }
function newGame() {
  try {
    session = new GameSession({ seed: Number(new URLSearchParams(location.search).get('seed') ?? '12345'), width: 24, height: 16,
      players: [{ id: 0, controller: 'human', starterId: starter.value as StarterId },
        { id: 1, controller: 'ai' }, { id: 2, controller: 'ai' }, { id: 3, controller: 'ai' }] });
    active = null; selected = null; selectedCity = null; keyboardIndex = null; notice = ''; sequence.value = '0';
    canvas.hidden = false;
    fit();
    controls();
  } catch (error) {
    canvas.hidden = true;
    info.textContent = `无法生成地图：${error instanceof Error ? error.message : String(error)}`;
    for (const element of document.querySelectorAll<HTMLButtonElement>('#controls button, #end-turn')) element.disabled = true;
  }
}
function activateIndex(index: number | null) {
  if (busy()) return;
  const view = session.getView();
  keyboardIndex = index;
  if (index === null) { selected = null; controls(); requestFrame(); return; }
  const hex = indexToHex(index, view.map);
  const own = view.units.find(unit => unit.ownerId === view.playerId && hexToIndex(unit.position, view.map) === index);
  const ownCity = view.cities.find(city => city.ownerId === view.playerId && hexToIndex(city.position, view.map) === index);
  if (ownCity) selectedCity = ownCity.id;
  if (own) selected = own.id;
  else if (selected !== null && reachablePaths(view, selected)[index]) issue({ type: 'Move', unitId: selected, to: hex });
  else selected = null;
  controls(); requestFrame();
}
function localPoint(event: { clientX: number; clientY: number }): Point {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
let drag: { start: Point; last: Point; moved: boolean } | null = null;
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  const point = localPoint(event); drag = { start: point, last: point, moved: false };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (!drag) return;
  const point = localPoint(event);
  if (Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > 4) drag.moved = true;
  if (drag.moved) {
    camera.x += point.x - drag.last.x; camera.y += point.y - drag.last.y;
    requestFrame();
  }
  drag.last = point;
});
canvas.addEventListener('pointercancel', () => { drag = null; });
canvas.addEventListener('pointerup', event => {
  const click = drag && !drag.moved; drag = null;
  if (!click || busy()) return;
  const hex = worldToHex(toWorld(localPoint(event), camera));
  activateIndex(hexToIndex(hex, session.getView().map));
});
canvas.addEventListener('wheel', event => {
  event.preventDefault(); zoomAt(camera, localPoint(event), Math.exp(-event.deltaY * .001)); requestFrame();
}, { passive: false });
canvas.addEventListener('keydown', event => {
  if (busy()) return;
  const view = session.getView();
  const current = keyboardIndex ?? (selected === null ? null : hexToIndex(view.units.find(unit => unit.id === selected)!.position, view.map));
  const initialUnit = view.units.find(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon')
    ?? view.units.find(unit => unit.ownerId === view.playerId)!;
  const fallback = current ?? hexToIndex(initialUnit.position, view.map);
  if (fallback === null) return;
  const hex = indexToHex(fallback, view.map);
  const directions: Record<string, { q: number; r: number }> = {
    ArrowLeft: { q: hex.q - 1, r: hex.r }, ArrowRight: { q: hex.q + 1, r: hex.r },
    ArrowUp: { q: hex.q, r: hex.r - 1 }, ArrowDown: { q: hex.q, r: hex.r + 1 },
  };
  if (directions[event.key]) {
    event.preventDefault();
    keyboardIndex = hexToIndex(directions[event.key], view.map) ?? fallback;
    requestFrame();
  } else if (event.key === 'Enter') { event.preventDefault(); activateIndex(fallback); }
  else if (event.key === 'Escape') { event.preventDefault(); selected = null; keyboardIndex = null; controls(); requestFrame(); }
  else if (event.key === '+' || event.key === '=' || event.key === '-') {
    event.preventDefault();
    zoomAt(camera, { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, event.key === '-' ? .9 : 1.1);
    requestFrame();
  } else if (event.key.toLowerCase() === 'f') { event.preventDefault(); fit(); }
});
endTurn.addEventListener('click', () => { if (!busy()) issue({ type: 'EndTurn' }); });
document.querySelector('#skip')!.addEventListener('click', skip);
document.querySelector('#new-game')!.addEventListener('click', newGame);
document.querySelector('#fit')!.addEventListener('click', fit);
document.querySelector('#export')!.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(session.exportLog(), null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `pokemon-${session.getView().seed}-commands.json`;
  link.click(); URL.revokeObjectURL(url);
});
document.querySelector('#replay')!.addEventListener('click', () => {
  try { session.replayTo(Number(sequence.value)); selected = null; keyboardIndex = null; notice = ''; skip(); }
  catch (error) { notice = error instanceof Error ? error.message : String(error); controls(); }
});
document.querySelector('#resume')!.addEventListener('click', () => {
  session.resumeFromReplay(); selected = null; keyboardIndex = null; controls(); requestFrame();
});
const saveKey = 'pokemon-civilization-save';
function load(text: string) {
  session.load(text); active = null; selected = null; selectedCity = null; keyboardIndex = null; notice = '读档完成';
  fit(); skip();
}
function storageAction(action: () => void) {
  try { action(); } catch (error) { notice = error instanceof Error ? error.message : String(error); }
  controls();
}
document.querySelector('#save-game')!.addEventListener('click', () => storageAction(() => {
  localStorage.setItem(saveKey, session.save()); notice = '已保存到此浏览器';
}));
document.querySelector('#load-game')!.addEventListener('click', () => storageAction(() => {
  const text = localStorage.getItem(saveKey); if (!text) throw new Error('此浏览器暂无存档'); load(text);
}));
document.querySelector('#export-save')!.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([session.save()], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'pokemon-save.json'; link.click(); URL.revokeObjectURL(url);
});
document.querySelector<HTMLInputElement>('#import-save')!.addEventListener('change', async event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0];
  if (!file) return;
  try { const text = await file.text(); if (!busy()) storageAction(() => load(text)); }
  catch (error) { notice = String(error); controls(); }
  input.value = '';
});
document.addEventListener('keydown', event => {
  const target = event.target as HTMLElement | null;
  if (target?.matches('input, select, textarea, [contenteditable="true"]')) return;
  if (event.ctrlKey && event.key === 'Enter') { event.preventDefault(); if (!busy()) issue({ type: 'EndTurn' }); }
  else if (event.key.toLowerCase() === 'c') {
    event.preventDefault();
    selectedCity = session.getView().economy.cities[0]?.id ?? null;
    controls(); document.querySelector<HTMLElement>('#city-select')?.focus();
  } else if (event.key.toLowerCase() === 'r') { event.preventDefault(); document.querySelector<HTMLElement>('#research-topic')?.focus(); }
});
god.addEventListener('change', skip);
if (!import.meta.env.DEV) document.querySelector<HTMLElement>('#god-label')!.hidden = true;
new ResizeObserver(() => { if (session) requestFrame(); }).observe(canvas);
for (const { label, color, symbol } of Object.values(BIOME_DISPLAY)) {
  const item = document.createElement('li'), swatch = document.createElement('span'), text = document.createElement('span');
  swatch.className = 'swatch'; swatch.style.backgroundColor = color;
  text.className = 'legend-symbol'; text.textContent = symbol;
  item.append(swatch, text, label); document.querySelector('#legend')!.append(item);
}
newGame();
