import type { BallId } from '../content/economy.ts';
import type { Hex } from '../core/hex.ts';
import type { PlayerView } from '../core/model.ts';
import { previewAttack, previewCapture } from '../core/preview.ts';
import type { ActionMode } from './unit-panel.ts';

export type ActionTarget = { kind: 'unit' | 'city'; id: number; position: Hex };

export function actionTargets(view: PlayerView, unitId: number, mode: ActionMode, ballId: BallId): ActionTarget[] {
  if (mode === 'attack') return [
    ...view.units.filter(unit => unit.ownerId !== view.playerId && previewAttack(view, unitId, { kind: 'unit', id: unit.id }).ok)
      .map(unit => ({ kind: 'unit' as const, id: unit.id, position: unit.position })),
    ...view.cities.filter(city => city.ownerId !== view.playerId && previewAttack(view, unitId, { kind: 'city', id: city.id }).ok)
      .map(city => ({ kind: 'city' as const, id: city.id, position: city.position })),
  ];
  if (mode === 'capture') return view.units.filter(unit => previewCapture(view, unitId, unit.id, ballId).ok)
    .map(unit => ({ kind: 'unit' as const, id: unit.id, position: unit.position }));
  return [];
}
