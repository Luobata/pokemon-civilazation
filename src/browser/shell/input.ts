// Map canvas pointer, hover tooltip, keyboard navigation, and global hotkey controllers.
import { hexToIndex } from '../../core/hex.ts';
import type { PlayerView } from '../../core/model.ts';
import { zoomAt } from '../camera.ts';
import type { Camera, Point } from '../camera.ts';
import { previewSummary, targetPreviews } from '../target-preview.ts';
import { describeTile, tileSummary } from '../tile-info.ts';
import { stepKeyboardHex } from './game-shell.ts';

export function localCanvasPoint(canvas: HTMLCanvasElement, event: { clientX: number; clientY: number }): Point {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

export type MapPointerOptions = {
  canvas: HTMLCanvasElement;
  camera: Camera;
  getView: () => PlayerView | null;
  pickIndex: (point: Point, view: PlayerView) => number | null;
  isBusy?: () => boolean;
  onDragStart?: () => void;
  onPan: () => void;
  onZoom: () => void;
  onClick: (index: number | null) => void;
  onHover?: (event: PointerEvent, point: Point, index: number | null, dragging: boolean) => void;
  onLeave?: () => void;
  onContextMenu?: (event: MouseEvent, point: Point, index: number | null) => void;
};

/** Installs pointer pan/click, wheel zoom, hover, and optional contextmenu handlers on a map canvas. */
export function installMapPointerControls(options: MapPointerOptions): void {
  const { canvas, camera, getView, pickIndex } = options;
  let drag: { start: Point; last: Point; moved: boolean } | null = null;

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const point = localCanvasPoint(canvas, event);
    drag = { start: point, last: point, moved: false };
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointerleave', () => {
    options.onLeave?.();
  });

  canvas.addEventListener('pointermove', event => {
    const point = localCanvasPoint(canvas, event);
    const view = getView();
    const dragging = Boolean(drag?.moved);
    if (options.onHover) {
      const index = !dragging && view ? pickIndex(point, view) : null;
      options.onHover(event, point, index, dragging);
    }
    if (!drag) return;
    if (Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > 4) {
      if (!drag.moved) options.onDragStart?.();
      drag.moved = true;
    }
    if (drag.moved) {
      camera.x += point.x - drag.last.x;
      camera.y += point.y - drag.last.y;
      options.onPan();
    }
    drag.last = point;
  });

  canvas.addEventListener('pointercancel', () => { drag = null; });

  canvas.addEventListener('pointerup', event => {
    const click = drag && !drag.moved;
    drag = null;
    options.onLeave?.();
    if (!click || options.isBusy?.()) return;
    const view = getView();
    if (!view) return;
    options.onClick(pickIndex(localCanvasPoint(canvas, event), view));
  });

  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    zoomAt(camera, localCanvasPoint(canvas, event), Math.exp(-event.deltaY * .001));
    options.onZoom();
  }, { passive: false });

  if (options.onContextMenu) {
    canvas.addEventListener('contextmenu', event => {
      event.preventDefault();
      if (options.isBusy?.()) return;
      const view = getView();
      if (!view) return;
      const point = localCanvasPoint(canvas, event);
      options.onContextMenu!(event, point, pickIndex(point, view));
    });
  }
}

export type MapTooltipController = {
  hide(): void;
  resetKey(): void;
  update(event: PointerEvent, point: Point, index: number | null, dragging: boolean): void;
};

export function createMapTooltip(options: {
  canvas: HTMLCanvasElement;
  tooltip: HTMLElement;
  getView: () => PlayerView | null;
  getSelected: () => number | null;
  isGoToMode: () => boolean;
  goToSuffix: (view: PlayerView, unitId: number, index: number) => string;
}): MapTooltipController {
  const { canvas, tooltip } = options;
  let tooltipKey: string | null = null;
  const hide = () => { tooltip.hidden = true; tooltipKey = null; };
  return {
    hide,
    resetKey() { tooltipKey = null; },
    update(event, point, index, dragging) {
      const view = options.getView();
      if (event.pointerType !== 'mouse' || dragging || !view || index === null) { hide(); return; }
      const selected = options.getSelected();
      const goToMode = options.isGoToMode();
      const key = `${index}:${selected}:${goToMode}`;
      if (key !== tooltipKey) {
        const preview = previewSummary(targetPreviews(view, selected, index));
        const suffix = goToMode && selected !== null ? options.goToSuffix(view, selected, index) : '';
        tooltip.textContent = tileSummary(describeTile(view, index)) + (preview ? ` · ${preview}` : '') + suffix;
        tooltipKey = key;
      }
      tooltip.hidden = false;
      const x = Math.min(point.x + 16, canvas.clientWidth - tooltip.offsetWidth - 8);
      const y = point.y + 18 + tooltip.offsetHeight > canvas.clientHeight ? point.y - tooltip.offsetHeight - 10 : point.y + 18;
      tooltip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
    },
  };
}

export function installMapKeyboardControls(options: {
  canvas: HTMLCanvasElement;
  camera: Camera;
  getView: () => PlayerView;
  isBusy: () => boolean;
  getSelected: () => number | null;
  getCursor: () => number | null;
  onCursorChange: (nextIndex: number) => void;
  onActivate: (index: number, confirmSelection: boolean) => void;
  onEscape: () => void;
  onFit: () => void;
  onFrame: () => void;
}): void {
  const { canvas, camera } = options;
  canvas.addEventListener('keydown', event => {
    if (options.isBusy()) return;
    const view = options.getView();
    const selectedUnit = view.units.find(unit => unit.id === options.getSelected());
    const current = options.getCursor() ?? (selectedUnit ? hexToIndex(selectedUnit.position, view.map) : null);
    const initialUnit = view.units.find(unit => unit.ownerId === view.playerId && unit.kind === 'pokemon')
      ?? view.units.find(unit => unit.ownerId === view.playerId);
    const initialPosition = initialUnit?.position ?? view.economy.cities[0]?.position;
    const fallback = current ?? (initialPosition ? hexToIndex(initialPosition, view.map) : null);
    if (fallback === null) return;
    const stepped = stepKeyboardHex(fallback, event.key, view.map);
    if (stepped !== null) {
      event.preventDefault();
      options.onCursorChange(stepped);
    } else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      options.onActivate(fallback, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      options.onEscape();
    } else if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault();
      zoomAt(camera, { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, event.key === '-' ? .9 : 1.1);
      options.onFrame();
    } else if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      options.onFit();
    }
  });
}

export function installGlobalHotkeys(options: {
  canvas: HTMLCanvasElement;
  showYields: HTMLInputElement;
  getView: () => PlayerView;
  isBusy: () => boolean;
  hasIdleUnits: (view: PlayerView) => boolean;
  onEscape: () => void;
  onEndTurn: (force: boolean) => void;
  onCycleUnit: (step: 1 | -1) => void;
  onSelectCity: (cityId: number | null) => void;
  onOpenResearch: () => void;
  onOpenHelp: () => void;
  onFrame: () => void;
}): void {
  document.addEventListener('keydown', event => {
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, select, textarea, [contenteditable="true"]')) return;
    // Hotkeys act on the map: not behind an open screen or dialog (Esc and Tab are handled by screens.ts).
    if (document.querySelector('dialog[open]') || !document.querySelector<HTMLElement>('#screen-host')!.hidden) return;
    if (event.key === 'Escape' && target !== options.canvas && !target?.closest('#combat-card') && !document.querySelector('#unit-action-bar .unit-action-menu')) {
      options.onEscape();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      options.onEndTurn(true);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === ',' || event.key === '.') {
      if (!options.hasIdleUnits(options.getView())) return;
      event.preventDefault();
      if (!options.isBusy()) options.onCycleUnit(event.key === ',' ? -1 : 1);
    } else if (event.key.toLowerCase() === 'c') {
      event.preventDefault();
      options.onSelectCity(options.getView().economy.cities[0]?.id ?? null);
      document.querySelector<HTMLElement>('#city-select')?.focus();
    } else if (event.key.toLowerCase() === 'y') {
      event.preventDefault();
      options.showYields.checked = !options.showYields.checked;
      options.onFrame();
    } else if (['r', 't'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      options.onOpenResearch();
    } else if (event.key === '?') {
      event.preventDefault();
      options.onOpenHelp();
    }
  });
}
