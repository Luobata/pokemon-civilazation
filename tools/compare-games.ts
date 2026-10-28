import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Compare raw bytes, not parsed/canonical JSON: commands, outcome and telemetry are all covered.
export function compareGames(baseline: string, candidate: string) {
  const names = (directory: string) => readdirSync(resolve(directory, 'games')).filter(name => name.endsWith('.json')).sort();
  const a = names(baseline), b = names(candidate);
  if (a.length === 0 || JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Game file sets differ or are empty');
  const mismatches = a.filter(name => !readFileSync(resolve(baseline, 'games', name)).equals(readFileSync(resolve(candidate, 'games', name))));
  return { baseline: resolve(baseline), candidate: resolve(candidate), games: a.length, identical: a.length - mismatches.length, mismatches };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) throw new Error('Usage: node tools/compare-games.ts <baseline-directory> <candidate-directory>');
  const result = compareGames(process.argv[2], process.argv[3]);
  console.log(JSON.stringify(result, null, 2));
  if (result.mismatches.length) process.exitCode = 1;
}
