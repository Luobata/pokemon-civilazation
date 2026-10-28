import type { Command, PlayerView } from '../core/model.ts';
import type { Hex } from '../core/hex.ts';

// Session-owned journal. Rejections are observations, not accepted game commands.
export type RejectedCitySite = { playerId: number; position: Hex; seq: number };
export function rememberCityRejection(memory: RejectedCitySite[], view: PlayerView, command: Command, reason: string): void {
  if (reason !== 'invalid-city-site' || command.action.type !== 'FoundCity'
    || command.actorId !== view.playerId || command.expectedSeq !== view.commandSeq) return;
  const id = command.action.unitId;
  const unit = view.units.find(unit => unit.id === id && unit.ownerId === view.playerId && unit.kind === 'logistics');
  if (!unit || memory.some(site => site.playerId === view.playerId && site.position.q === unit.position.q && site.position.r === unit.position.r)) return;
  memory.push({ playerId: view.playerId, position: { ...unit.position }, seq: view.commandSeq });
}
export function rejectedCitySite(memory: readonly RejectedCitySite[], view: PlayerView, position: Hex): boolean {
  // The fallback EndTurn accepts seq before the next plan; future replay records must not leak back.
  return memory.some(site => site.playerId === view.playerId && site.seq < view.commandSeq
    && site.position.q === position.q && site.position.r === position.r);
}
