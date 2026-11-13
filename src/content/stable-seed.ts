/** FNV-1a over the parts' characters: a stable unsigned 32-bit integer that never touches a game's random stream. */
export function stableSeed(...parts: (string | number)[]): number {
  let value = 0x811c9dc5;
  for (const part of parts) for (const byte of String(part)) {
    value ^= byte.codePointAt(0)!;
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value >>> 0;
}
