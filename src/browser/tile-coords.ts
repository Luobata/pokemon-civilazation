// Playtest 2026-11b U-f: tiles as players read them on the map — (column, row) — instead of the internal tile index.
import { hexToOffset, indexToHex } from '../core/hex.ts';
import type { GridSize } from '../core/hex.ts';

/** "(12, 7)": column and row of the tile (on a wrapping map, the canonical column). */
export function tileCoords(index: number, map: GridSize): string {
  const { col, row } = hexToOffset(indexToHex(index, map));
  return `(${col}, ${row})`;
}
/** The accessible form: "第 12 列，第 7 行". */
export function tileCoordsLabel(index: number, map: GridSize): string {
  const { col, row } = hexToOffset(indexToHex(index, map));
  return `第 ${col} 列，第 ${row} 行`;
}
