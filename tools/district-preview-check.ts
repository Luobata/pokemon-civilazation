/** Every visible target, every own city/kind, at five-round intervals in the fixed smoke schedule. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DISTRICT_IDS } from '../src/content/districts.ts';
import { districtBlocker, districtEffects, districtInput, districtViewInput } from '../src/core/districts.ts';
import type { GameState } from '../src/core/model.ts';
import { observe, visibleTiles } from '../src/core/vision.ts';
import { leaderBalanceCases, simulateLeaderCase } from './leader-balance.ts';
import type { LeaderBalanceCase } from './leader-balance.ts';

export function districtPreviewReport() {
  return { games: 0, completed: 0, defect: 0, aborted: 0, exceptions: 0, sampledRounds: 0,
    blockerChecks: 0, completeEffectChecks: 0, incomplete: 0, mismatches: 0,
    examples: [] as { game: string; round: number; player: number; city: number; kind: string; tile: number;
      check: string; observed: unknown; authority: unknown }[] };
}
export function checkDistrictState(state: GameState, game: string, report: ReturnType<typeof districtPreviewReport>): void {
  report.sampledRounds++;
  for (const player of state.turnOrder) {
    const view = observe(state, player), observed = districtViewInput(view);
    const authority = districtInput(state, player, visibleTiles(state, player));
    for (const city of view.economy.cities) for (const kind of DISTRICT_IDS) for (const tile of view.visibleTileIds) {
      const mismatch = (check: string, actual: unknown, expected: unknown) => {
        report.mismatches++;
        if (report.examples.length < 20) report.examples.push({ game, round: state.round, player, city: city.id, kind, tile,
          check, observed: actual, authority: expected });
      };
      const actual = districtBlocker(observed, city.id, kind, tile), expected = districtBlocker(authority, city.id, kind, tile);
      report.blockerChecks++;
      if (actual !== expected) mismatch('blocker', actual, expected);
      const effects = districtEffects(observed, kind, tile);
      if (effects.incomplete) report.incomplete++;
      else {
        report.completeEffectChecks++;
        const expectedEffects = districtEffects(authority, kind, tile);
        if (JSON.stringify(effects) !== JSON.stringify(expectedEffects)) mismatch('effects', effects, expectedEffects);
      }
    }
  }
}
export function checkDistrictGames(matches: readonly LeaderBalanceCase[]) {
  const report = districtPreviewReport();
  for (const match of matches) {
    let lastRound = -1;
    const result = simulateLeaderCase(match, state => {
      if (state.round % 5 === 0 && state.round !== lastRound) {
        lastRound = state.round;
        checkDistrictState(state, match.id, report);
      }
    });
    report.games++;
    report[result.status === 'completed' ? 'completed' : result.status === 'defect' ? 'defect' : 'aborted']++;
    if (result.exception !== null) report.exceptions++;
  }
  return { ...report, comparisons: report.blockerChecks + report.completeEffectChecks,
    incompleteRatio: report.blockerChecks === 0 ? 0 : report.incomplete / report.blockerChecks };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2] || process.argv.length !== 3) throw new Error('Usage: node tools/district-preview-check.ts <output.json>');
  const config = { seeds: 4, seedStart: 31, expansionVersion: 1 as const, eraProgression: 'simple-v1' as const,
    gameplayVersion: 10 as const, roundLimit: 100 as const, width: 24, height: 16 };
  const report = checkDistrictGames(leaderBalanceCases(config).filter(match => match.rotation < 4));
  const destination = resolve(process.argv[2]);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.mismatches || report.defect || report.aborted || report.exceptions) process.exitCode = 1;
}
