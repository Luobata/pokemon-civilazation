// Pointy-top, odd-r: odd offset rows shift right. Rules use axial q/r.
export type Hex = { q: number; r: number };
export type Offset = { col: number; row: number };
/** `wrap` (gameplay v22, docs/design/world-v22.md §A): columns wrap east-west; rows never wrap. */
export type GridSize = { width: number; height: number; wrap?: boolean };
/** What distance and adjacency need to know about a map: its width and whether columns wrap. */
export type MapShape = { width: number; wrap?: boolean };

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

/** On a wrapping map, the same tile with its column brought into 0..width−1; otherwise the hex unchanged. */
export function canonicalHex(hex: Hex, size: MapShape): Hex {
  if (!size.wrap || !(size.width > 0)) return hex;
  const { col, row } = hexToOffset(hex);
  const wrapped = ((col % size.width) + size.width) % size.width;
  return wrapped === col ? hex : offsetToHex({ col: wrapped, row });
}

/** The six neighbours in HEX_DIRECTIONS order; on a wrapping map each is canonical (it may lie across the seam). */
export function neighbors(hex: Hex, size: MapShape): Hex[] {
  const all = HEX_DIRECTIONS.map(({ q, r }) => ({ q: hex.q + q, r: hex.r + r }));
  return size.wrap ? all.map(next => canonicalHex(next, size)) : all;
}

function axialDistance(dq: number, dr: number): number {
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

/**
 * Steps between two hexes. On a wrapping map: the shortest of the three east-west copies (q ± width at the
 * same r), so a path may cross the seam. Without `wrap` this is exactly the flat axial distance.
 */
export function hexDistance(a: Hex, b: Hex, size: MapShape): number {
  if (!size.wrap) return axialDistance(a.q - b.q, a.r - b.r);
  const ca = canonicalHex(a, size), cb = canonicalHex(b, size);
  const dq = ca.q - cb.q, dr = ca.r - cb.r;
  return Math.min(axialDistance(dq, dr), axialDistance(dq - size.width, dr), axialDistance(dq + size.width, dr));
}

/**
 * The copy of `to` (shifted by whole map widths, same row) nearest to `from`; `to` itself on a flat map.
 * Only for drawing and for directions (flanking sides, animation): never store the result as a position.
 */
export function nearestCopy(from: Hex, to: Hex, size: MapShape): Hex {
  if (!size.wrap || !(size.width > 0)) return to;
  const shift = Math.round((hexToOffset(from).col - hexToOffset(to).col) / size.width);
  let best = to, bestDistance = Infinity;
  for (const k of [shift - 1, shift, shift + 1]) {
    const copy = { q: to.q + k * size.width, r: to.r };
    const distance = axialDistance(copy.q - from.q, copy.r - from.r);
    if (distance < bestDistance) { best = copy; bestDistance = distance; }
  }
  return best;
}

// Row-major offset storage is also r-then-q order within this rectangle.
// On a wrapping map an off-canonical column is folded back first (rows never wrap).
export function hexToIndex(hex: Hex, size: GridSize): number | null {
  const { col, row } = hexToOffset(size.wrap ? canonicalHex(hex, size) : hex);
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

/** Rings to the nearest map edge. On a wrapping map only the north and south edges (the poles) count. */
export function edgeDistance(hex: Hex, size: GridSize): number {
  const { col, row } = hexToOffset(hex);
  if (size.wrap) return Math.min(row, size.height - 1 - row);
  return Math.min(col, row, size.width - 1 - col, size.height - 1 - row);
}
