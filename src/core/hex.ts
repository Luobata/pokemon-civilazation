// Pointy-top, odd-r: odd offset rows shift right. Rules use axial q/r.
export type Hex = { q: number; r: number };
export type Offset = { col: number; row: number };
export type GridSize = { width: number; height: number };

// E, NE, NW, W, SW, SE. Never infer order from object iteration.
export const HEX_DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

export function offsetToHex({ col, row }: Offset): Hex {
  return { q: col - Math.floor(row / 2), r: row };
}

export function hexToOffset({ q, r }: Hex): Offset {
  return { col: q + Math.floor(r / 2), row: r };
}

export function neighbors(hex: Hex): Hex[] {
  return HEX_DIRECTIONS.map(({ q, r }) => ({ q: hex.q + q, r: hex.r + r }));
}

export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

// Row-major offset storage is also r-then-q order within this rectangle.
export function hexToIndex(hex: Hex, size: GridSize): number | null {
  const { col, row } = hexToOffset(hex);
  if (!Number.isInteger(col) || !Number.isInteger(row)
    || col < 0 || col >= size.width || row < 0 || row >= size.height) return null;
  return row * size.width + col;
}

export function indexToHex(index: number, size: GridSize): Hex {
  if (!Number.isInteger(index) || index < 0 || index >= size.width * size.height) {
    throw new RangeError('Tile index is outside the map.');
  }
  return offsetToHex({ col: index % size.width, row: Math.floor(index / size.width) });
}

export function edgeDistance(hex: Hex, size: GridSize): number {
  const { col, row } = hexToOffset(hex);
  return Math.min(col, row, size.width - 1 - col, size.height - 1 - row);
}
