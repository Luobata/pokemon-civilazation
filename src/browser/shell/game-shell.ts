// Shared game-shell operations reused by single-player (main.ts) and multiplayer (multiplayer.ts).
import type { SpeciesId } from '../../content/species.ts';
import { GAME_CONTENT, contentForView } from '../../content/units.ts';
import { previewDistrict } from '../../core/districts.ts';
import { hexToIndex, indexToHex } from '../../core/hex.ts';
import type { Hex } from '../../core/hex.ts';
import type { Command, PlayerView } from '../../core/model.ts';
import { hexToWorld, mapSpan, toWorld } from '../camera.ts';
import type { Camera } from '../camera.ts';
import type { DistrictPlacement, UIState } from './ui-state.ts';
import { resetActionState } from './ui-state.ts';

/** Centers `camera` on `position`, accounting for 2.5D tile lift and optional wrapped-map nearest copy. */
export function focusCameraOnHex(
  camera: Camera,
  canvas: HTMLCanvasElement,
  lift: (hex: Hex) => number,
  position: Hex,
  map?: Pick<PlayerView['map'], 'width' | 'wrap'>,
  options?: { wrapNearest?: boolean; minZoom?: number },
): void {
  const minZoom = options?.minZoom ?? 1.5;
  const point = hexToWorld(position);
  point.y -= lift(position);
  if (options?.wrapNearest && map?.wrap) {
    const centre = toWorld({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, camera);
    const span = mapSpan(map);
    point.x += Math.round((centre.x - point.x) / span) * span;
  }
  camera.zoom = Math.max(camera.zoom, minZoom);
  camera.x = canvas.clientWidth / 2 - point.x * camera.zoom;
  camera.y = canvas.clientHeight / 2 - point.y * camera.zoom;
}

/** Validates and builds the `SetProductionQueue` command for a chosen district site. */
export function buildDistrictOrderAction(
  view: PlayerView,
  placement: DistrictPlacement | null,
): { ok: true; action: Command['action']; cityId: number } | { ok: false; reason: string; dropPlacement?: boolean } | null {
  if (!placement || placement.tileIndex === null) return null;
  const city = view.economy.cities.find(item => item.id === placement.cityId);
  if (!city) return { ok: false, reason: '', dropPlacement: true };
  const site = previewDistrict(view, placement.cityId, placement.kind, placement.tileIndex);
  if (site.reason !== null || city.queue.length >= 5) {
    return {
      ok: false,
      reason: city.queue.length >= 5 ? '生产队列已满 5 项，请先完成或取消订单。' : '目标格已不可建造，请重新选择。',
    };
  }
  return {
    ok: true,
    cityId: city.id,
    action: {
      type: 'SetProductionQueue',
      cityId: city.id,
      orders: [
        ...city.queue.map(order => ({ orderId: order.id, item: order.item })),
        { item: { kind: 'district', defId: placement.kind, tileIndex: placement.tileIndex } },
      ],
    },
  };
}

/** Builds an Attack or Capture command from the current pending target. */
export function buildConfirmTargetAction(ui: UIState): Command['action'] | null {
  if (ui.selected === null || !ui.pendingTarget) return null;
  if (ui.actionMode === 'attack') {
    return { type: 'Attack', unitId: ui.selected, target: { kind: ui.pendingTarget.kind, id: ui.pendingTarget.id } };
  }
  if (ui.actionMode === 'capture') {
    return { type: 'Capture', unitId: ui.selected, targetUnitId: ui.pendingTarget.id, ballId: ui.selectedBall };
  }
  return null;
}

/** Builds an Evolve command for the selected own Pokémon if an evolution target exists. */
export function buildEvolveAction(view: PlayerView | null, unitId: number | null, intoSpeciesId?: SpeciesId): Command['action'] | null {
  const unit = view?.units.find(candidate => candidate.id === unitId && candidate.ownerId === view.playerId && candidate.kind === 'pokemon');
  const content = view ? contentForView(view) : GAME_CONTENT;
  const evolution = unit?.kind === 'pokemon' ? content.species[unit.speciesId].evolution : null;
  if (!view || !unit || !(intoSpeciesId ?? evolution)) return null;
  return { type: 'Evolve', unitId: unit.id, intoSpeciesId: intoSpeciesId ?? evolution!.speciesId };
}

/** Applies common UI selection / action-mode state updates after an accepted command. */
export function applyCommandStateEffects(ui: UIState, action: Command['action'], nextView: PlayerView): void {
  if (action.type === 'Attack' || action.type === 'Capture' || action.type === 'Move' || action.type === 'EndTurn') {
    resetActionState(ui);
  }
  if (action.type === 'SetProductionQueue' && action.orders.some(order => order.item.kind === 'district')) {
    ui.districtPlacement = null;
  }
  if (action.type === 'FoundCity') {
    ui.selected = null;
    ui.selectedCity = nextView.economy.cities.at(-1)?.id ?? ui.selectedCity;
    resetActionState(ui);
  }
}

/** Steps a map tile index one cell along an arrow key, returning `fallback` at the map edge. */
export function stepKeyboardHex(index: number, key: string, map: PlayerView['map']): number | null {
  const hex = indexToHex(index, map);
  const directions: Record<string, Hex> = {
    ArrowLeft: { q: hex.q - 1, r: hex.r },
    ArrowRight: { q: hex.q + 1, r: hex.r },
    ArrowUp: { q: hex.q, r: hex.r - 1 },
    ArrowDown: { q: hex.q, r: hex.r + 1 },
  };
  const next = directions[key];
  if (!next) return null;
  return hexToIndex(next, map) ?? index;
}
