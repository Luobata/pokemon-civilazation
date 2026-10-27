import '../styles.css';
import { GameSession } from '../app/session.ts';
import { CONTENT, unitDefinition } from '../content/units.ts';
import type { StarterId } from '../content/units.ts';
import { hexToIndex } from '../core/hex.ts';
import { reachablePaths } from '../core/movement.ts';
import type { VisibleEvent } from '../core/model.ts';
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
export let session: GameSession;
export let camera: Camera = { x: 0, y: 0, zoom: 1 };
let selected: number | null = null;
let active: { payload: Extract<VisibleEvent['payload'], { type: 'Moved' }>; started: number } | null = null;
let frameRequested = false;
let notice = '';
const busy = () => active !== null || session.presentationQueue.length > 0;
function controls() {
  const view = session.getView();
  info.textContent = `种子 ${view.seed} · 第 ${view.round} 轮 · 当前文明 ${view.activePlayerId + 1} · 命令 ${view.commandSeq}`;
  const unit = view.units.find(unit => unit.id === selected);
  selection.textContent = unit ? `${unitDefinition(unit, CONTENT).name} · 行动点 ${unit.actionLeft} · 点击高亮格移动` : '点选己方单位；拖动地图平移，滚轮缩放。';
  debug.textContent = `seed=${view.seed} round=${view.round} activePlayer=${view.activePlayerId} commandSeq=${view.commandSeq}\n最近拒绝：${session.lastRejected ? JSON.stringify(session.lastRejected) : '无'}${notice ? '\n' + notice : ''}`;
  sequence.max = String(session.exportLog().commands.length);
  for (const element of document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('#controls button, #controls input, #controls select')) {
    element.disabled = element.id === 'skip' ? !busy() : busy();
  }
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
    camera, selected, Object.keys(paths).map(Number), pose);
  if (busy()) requestFrame(); else controls();
}
function skip() { active = null; session.skipAnimations(); controls(); requestFrame(); }
function newGame() {
  try {
    session = new GameSession({ seed: Number(new URLSearchParams(location.search).get('seed') ?? '12345'), width: 24, height: 16,
      players: [{ id: 0, controller: 'human', starterId: starter.value as StarterId },
        { id: 1, controller: 'ai' }, { id: 2, controller: 'ai' }, { id: 3, controller: 'ai' }] });
    active = null; selected = null; notice = ''; sequence.value = '0';
    canvas.hidden = false;
    camera = fitCamera(session.getView().map, canvas.clientWidth, canvas.clientHeight);
    controls(); requestFrame();
  } catch (error) {
    canvas.hidden = true;
    info.textContent = `无法生成地图：${error instanceof Error ? error.message : String(error)}`;
    for (const element of document.querySelectorAll<HTMLButtonElement>('#controls button')) element.disabled = true;
  }
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
  const view = session.getView();
  const hex = worldToHex(toWorld(localPoint(event), camera));
  const index = hexToIndex(hex, view.map);
  const own = view.units.find(unit => unit.ownerId === view.playerId && hexToIndex(unit.position, view.map) === index);
  if (own) selected = own.id;
  else if (selected !== null && index !== null && reachablePaths(view, selected)[index]) {
    session.issue({ type: 'Move', unitId: selected, to: hex });
  } else selected = null;
  controls(); requestFrame();
});
canvas.addEventListener('wheel', event => {
  event.preventDefault(); zoomAt(camera, localPoint(event), Math.exp(-event.deltaY * .001)); requestFrame();
}, { passive: false });
document.querySelector('#end-turn')!.addEventListener('click', () => {
  if (busy()) return;
  session.issue({ type: 'EndTurn' }); controls(); requestFrame();
});
document.querySelector('#skip')!.addEventListener('click', skip);
document.querySelector('#new-game')!.addEventListener('click', newGame);
document.querySelector('#fit')!.addEventListener('click', () => {
  camera = fitCamera(session.getView().map, canvas.clientWidth, canvas.clientHeight); requestFrame();
});
document.querySelector('#export')!.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(session.exportLog(), null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `pokemon-${session.getView().seed}-commands.json`;
  link.click(); URL.revokeObjectURL(url);
});
document.querySelector('#replay')!.addEventListener('click', () => {
  try { session.replayTo(Number(sequence.value)); selected = null; notice = ''; skip(); }
  catch (error) { notice = error instanceof Error ? error.message : String(error); controls(); }
});
document.querySelector('#resume')!.addEventListener('click', () => {
  session.resumeFromReplay(); selected = null; controls(); requestFrame();
});
god.addEventListener('change', skip);
if (!import.meta.env.DEV) document.querySelector<HTMLElement>('#god-label')!.hidden = true;
new ResizeObserver(() => { if (session) requestFrame(); }).observe(canvas);
for (const { label, color } of Object.values(BIOME_DISPLAY)) {
  const item = document.createElement('li'), swatch = document.createElement('span');
  swatch.style.backgroundColor = color; item.append(swatch, label); document.querySelector('#legend')!.append(item);
}
newGame();
