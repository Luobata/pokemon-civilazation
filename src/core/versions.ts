/** Converged single schema and rules envelope (v27 / pace-v27; legacy v0–v26 archived at tag archive/v0-v27-legacy). */
export function gameVersions(_setup?: unknown) {
  void _setup;
  return { schemaVersion: 22 as const, rulesVersion: 'pace-v27' as const };
}
