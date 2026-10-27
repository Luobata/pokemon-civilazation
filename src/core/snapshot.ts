export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function canonicalSerialize(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalSerialize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalSerialize(value[key])}`).join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Snapshot numbers must be finite.');
  return JSON.stringify(value);
}

// FNV-1a over UTF-16 code units. Diagnostic only; compare full canonical state
// for determinism, since a short hash alone cannot prove equality.
export function stateDigest(value: JsonValue): string {
  const serialized = canonicalSerialize(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < serialized.length; i++) {
    hash = Math.imul(hash ^ serialized.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
