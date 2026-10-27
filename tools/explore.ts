import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { explorationMatches } from './matches.ts';
import { simulateMatch } from './simulate.ts';
import { compactResult, summarizeGames } from './summary.ts';
import type { GameMetrics } from './summary.ts';
import { canonicalSerialize } from '../src/core/snapshot.ts';

export function runExploration(count: number, output: string) {
  mkdirSync(output, { recursive: true }); mkdirSync(resolve(output, 'games'), { recursive: true });
  const started = new Date().toISOString(), start = performance.now();
  const matches = explorationMatches(count), results: GameMetrics[] = [];
  const jsonl = resolve(output, 'games.jsonl'); writeFileSync(jsonl, '');
  writeFileSync(resolve(output, 'schedule.json'), JSON.stringify(matches, null, 2));
  for (const [index, match] of matches.entries()) {
    const result = simulateMatch(match), compact = compactResult(result); results.push(compact);
    writeFileSync(resolve(output, 'games', `${match.id}.json`), JSON.stringify(result));
    appendFileSync(jsonl, JSON.stringify(compact) + '\n');
    if (index % 15 === 14 || result.aborted) console.log(JSON.stringify({ completed: index + 1, total: matches.length, match: match.id,
      elapsedSeconds: Math.round((performance.now() - start) / 1000), aborted: result.aborted,
      invalidCount: result.invalid.length, firstInvalid: result.invalid[0] ?? null }));
  }
  const summaries = { all: summarizeGames(results), oneVsOne: summarizeGames(results.filter(game => game.mode === '1v1')),
    oneVsThree: summarizeGames(results.filter(game => game.mode === '1v3')) };
  writeFileSync(resolve(output, 'summary.json'), JSON.stringify(summaries, null, 2));
  const manifest = { command: process.argv.join(' '), nodeVersion: process.version, started, finished: new Date().toISOString(),
    elapsedSeconds: (performance.now() - start) / 1000, gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    seeds: Array.from({ length: count }, (_, i) => i + 1), games: matches.length,
    notes: 'Exploration only; paired legs are correlated. Same seed fixes terrain/start locations and starter RNG by seat; personalities swap seats. 1v3 repeats a rotating personality and rotates the four-seat order.' };
  writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { summaries, manifest };
}
export function verifyDeterminism(output: string, count: number) {
  const matches = explorationMatches(count);
  const seeds = [...new Set([1, Math.ceil(count / 2), count])];
  const proofs = seeds.map(seed => {
    const match = matches.find(candidate => candidate.seed === seed && candidate.mode === '1v1' && candidate.leg === 0)!;
    const first = canonicalSerialize(simulateMatch(match)), second = canonicalSerialize(simulateMatch(match));
    const recorded = canonicalSerialize(JSON.parse(readFileSync(resolve(output, 'games', `${match.id}.json`), 'utf8')));
    return { seed, match: match.id, equal: first === second, equalsRecorded: first === recorded,
      firstSha256: createHash('sha256').update(first).digest('hex'), secondSha256: createHash('sha256').update(second).digest('hex') };
  });
  writeFileSync(resolve(output, 'determinism.json'), JSON.stringify(proofs, null, 2));
  if (proofs.some(proof => !proof.equal || !proof.equalsRecorded)) throw new Error('Repeated seed diverged');
  return proofs;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), seedAt = args.indexOf('--seeds'), outAt = args.indexOf('--out');
  const count = Number(seedAt < 0 ? 100 : args[seedAt + 1]), output = outAt < 0 ? undefined : args[outAt + 1];
  if (!Number.isSafeInteger(count) || count < 3 || !output) throw new Error('Usage: npm run sim:explore -- --seeds 100 --out <directory>');
  const result = runExploration(count, resolve(output));
  console.log(JSON.stringify({ manifest: result.manifest, summary: result.summaries.all }));
  console.log(JSON.stringify({ determinism: verifyDeterminism(resolve(output), count) }));
}
