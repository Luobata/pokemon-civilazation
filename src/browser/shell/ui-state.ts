// Centralized browser UI state shared across single-player and multiplayer shells.
import type { DistrictId } from '../../content/districts.ts';
import type { BallId } from '../../content/economy.ts';
import type { Hex } from '../../core/hex.ts';
import type { CitySummary, PlayerView } from '../../core/model.ts';
import type { Camera } from '../camera.ts';
import type { ActionMode, PendingTarget } from '../unit-panel.ts';

export type DistrictPlacement = { cityId: number; kind: DistrictId; tileIndex: number | null };
export type ActivityEntry = { text: string; round: number; routine: boolean };
export type FrameMetrics = { samples: number; last: number; mean: number; p95: number; max: number };

export type UIState = {
  camera: Camera;
  selected: number | null;
  selectedCity: number | null;
  neutralCity: CitySummary | null;
  inspectedTile: number | null;
  keyboardIndex: number | null;
  actionMode: ActionMode;
  districtPlacement: DistrictPlacement | null;
  pendingTarget: PendingTarget | null;
  selectedBall: BallId;
  goToMode: boolean;
  goToHover: number | null;
  arrivedUnitId: number | null;
  notice: string;
  deferredFocus: Hex | null;
  activityLog: ActivityEntry[];
  activityImportantOnly: boolean;
  frameDurations: number[];
};

export function createUIState(): UIState {
  return {
    camera: { x: 0, y: 0, zoom: 1 },
    selected: null,
    selectedCity: null,
    neutralCity: null,
    inspectedTile: null,
    keyboardIndex: null,
    actionMode: null,
    districtPlacement: null,
    pendingTarget: null,
    selectedBall: 'pokeBall',
    goToMode: false,
    goToHover: null,
    arrivedUnitId: null,
    notice: '',
    deferredFocus: null,
    activityLog: [],
    activityImportantOnly: false,
    frameDurations: [],
  };
}

export function resetActionState(ui: UIState): void {
  ui.actionMode = null;
  ui.pendingTarget = null;
  ui.districtPlacement = null;
  ui.goToMode = false;
  ui.goToHover = null;
}

export function clearSelectionState(ui: UIState): void {
  ui.selected = null;
  ui.selectedCity = null;
  ui.neutralCity = null;
  ui.inspectedTile = null;
  ui.keyboardIndex = null;
  resetActionState(ui);
  ui.notice = '';
}

export function reconcileSelection(ui: UIState, view: PlayerView, fallbackFirstCity = false): void {
  if (ui.selected !== null && !view.units.some(unit => unit.id === ui.selected && unit.ownerId === view.playerId)) {
    ui.selected = null;
    resetActionState(ui);
  }
  if (ui.selectedCity !== null && !view.economy.cities.some(city => city.id === ui.selectedCity)) {
    ui.selectedCity = fallbackFirstCity ? view.economy.cities[0]?.id ?? null : null;
  } else if (fallbackFirstCity && ui.selectedCity === null) {
    ui.selectedCity = view.economy.cities[0]?.id ?? null;
  }
}

export function recordFrameDuration(ui: UIState, durationMs: number): void {
  ui.frameDurations.push(durationMs);
  if (ui.frameDurations.length > 240) ui.frameDurations.shift();
}

export function computeFrameMetrics(ui: UIState): FrameMetrics {
  const durations = ui.frameDurations;
  const sorted = [...durations].sort((a, b) => a - b);
  const sum = durations.reduce((total, duration) => total + duration, 0);
  return {
    samples: durations.length,
    last: durations.at(-1) ?? 0,
    mean: durations.length ? sum / durations.length : 0,
    p95: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? 0,
    max: sorted.at(-1) ?? 0,
  };
}
