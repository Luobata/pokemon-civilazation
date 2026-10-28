/**
 * One-off D38 migration of historical unpatched simulation output; reusable on matching rules.
 * Usage: node tools/reclassify.ts <source> <output>
 * Input: games/*.json MatchResult records (setup, commands, invalid, commandLimitReached)
 * plus manifest.json, schedule.json and determinism.json. Replays using current default
 * content, not manifest patches; incompatible rules/patch experiments are unsupported.
 * Writes reclassified games and summaries to a separate output directory. Copied determinism
 * evidence belongs to the source run; it does not validate the migrated format.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGame } from '../src/core/game.ts';
import { step } from '../src/core/step.ts';
import { classifyRejection } from './rejections.ts';
import { compactResult, summarizeGames } from './summary.ts';
import type { MatchResult } from './simulate.ts';

// D38 migration of preserved runs: replay accepted commands, never rerun the planner.
export function reclassifyRun(source: string, output: string) {
  if (resolve(source) === resolve(output)) throw new Error('Preserve the source run; use a different output directory.');
  mkdirSync(resolve(output, 'games'), { recursive: true });
  const results = readdirSync(resolve(source, 'games')).filter(name => name.endsWith('.json')).sort().map(name => {
    const result = JSON.parse(readFileSync(resolve(source, 'games', name), 'utf8')) as MatchResult;
    if (result.invalid.length) {
      let state = createGame(result.setup);
      for (const command of result.commands) {
        for (const rejected of result.invalid.filter(item => item.seq === state.commandSeq)) {
          const check = step(state, rejected.command);
          if (check.ok || check.reason !== rejected.reason) throw new Error(`Rejection replay mismatch: ${result.id}/${rejected.seq}`);
          rejected.category = classifyRejection(state, rejected.command, rejected.reason);
        }
        const next = step(state, command);
        if (!next.ok) throw new Error(`Accepted command replay mismatch: ${result.id}/${command.expectedSeq}`);
        state = next.state;
      }
      if (result.invalid.some(item => !item.category)) throw new Error(`Unclassified rejection: ${result.id}`);
    }
    result.legacyAborted = result.legacyAborted ?? result.aborted;
    result.aborted = result.commandLimitReached;
    result.defect = result.exception !== null || (!result.outcome && !result.aborted) || result.invalid.some(item => item.category === 'defect');
    writeFileSync(resolve(output, 'games', name), JSON.stringify(result));
    return compactResult(result);
  });
  writeFileSync(resolve(output, 'games.jsonl'), results.map(result => JSON.stringify(result)).join('\n') + '\n');
  writeFileSync(resolve(output, 'summary.json'), JSON.stringify({ all: summarizeGames(results),
    oneVsOne: summarizeGames(results.filter(game => game.mode === '1v1')), oneVsThree: summarizeGames(results.filter(game => game.mode === '1v3')) }, null, 2));
  for (const name of ['manifest.json', 'schedule.json', 'determinism.json']) writeFileSync(resolve(output, name), readFileSync(resolve(source, name)));
  writeFileSync(resolve(output, 'classification.json'), JSON.stringify({ decision: 'D38', source: resolve(source), classifiedAt: new Date().toISOString(),
    method: 'Replayed accepted commands; verified each core rejection and classified using the rejecting actor observation. Game outcomes/commands/telemetry unchanged.',
    determinismNote: 'Copied determinism proof initially covers the original run; rerun verifyDeterminism to verify the classified format.' }, null, 2));
  return summarizeGames(results);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [source, output] = process.argv.slice(2);
  if (!source || !output) throw new Error('Usage: node tools/reclassify.ts <source> <output>');
  console.log(JSON.stringify(reclassifyRun(source, output)));
}
