// Playtest 2026-11 B6: the starter is written into the Pokédex as "captured" when the game begins. The stored record
// stays as it is (it counts toward the Pokédex victory like any captured species); the dex only *shows* it as 拥有.
import type { PlayerView } from '../core/model.ts';
import type { SpeciesId } from '../content/species.ts';

type DexRecord = { speciesId: SpeciesId; captured: boolean };
/** A captured record that is the viewer's starter (owned from the start, never caught). */
export const isStarterRecord = (view: PlayerView, record: DexRecord) => record.captured && record.speciesId === view.economy.player.starterId;
/** Captured (caught) and owned-from-the-start counts for display. */
export function dexCaptureCounts(view: PlayerView, records: readonly DexRecord[]): { caught: number; owned: number } {
  const owned = records.filter(record => isStarterRecord(view, record)).length;
  return { caught: records.filter(record => record.captured).length - owned, owned };
}
