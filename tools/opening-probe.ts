/**
 * Opening probe (docs/design/pace-v27.md §0, §11): replays the gate openings (preset `gate`, regional Pokédex rotation; same loop as the
 * balance runner: AI commands, an illegal one becomes EndTurn and its city site is remembered) up to a stop round, and records per
 * civilization the third city, civilians knocked out by wild Pokémon, the first capture, the starter knocked out, startled civilians and
 * exhausted wild Pokémon. Two runs (e.g. --gameplay 26 and 27) pair game by game.
 *
 *   node tools/opening-probe.ts --gameplay 27 [--seeds 31-38] [--stop 36] [--workers 12] --out /tmp/opening-v27.jsonl
 *   node tools/opening-probe.ts --summary /tmp/opening-v26.jsonl [/tmp/opening-v27.jsonl]
 */
import { fork } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PRESETS, balanceCases, parseSeeds } from './balance-run.ts';
import type { BalanceCase } from './balance-run.ts';
import { contentFor } from '../src/content/units.ts';
import { isGameplayVersion } from '../src/content/eras.ts';
import { createGame } from '../src/core/game.ts';
import { observe } from '../src/core/vision.ts';
import { step } from '../src/core/step.ts';
import { isRivalUnit } from '../src/core/rivals.ts';
import { isRaidUnit } from '../src/core/raids.ts';
import { planNext } from '../src/ai/plan.ts';
import { RULE_QUERIES } from '../src/ai/query.ts';
import { rememberCityRejection } from '../src/ai/memory.ts';
import type { RejectedCitySite } from '../src/ai/memory.ts';
import type { GameState } from '../src/core/model.ts';

export type OpeningCiv = { playerId: number; group: string; thirdCity: number | null; civiliansLost: { round: number; role: string; byWild: boolean }[];
  firstCapture: { round: number; certain: boolean } | null; starterKnockedOut: number | null; fled: number; exhausted: number; foundRefused: number };
export type OpeningGame = { id: string; civs: OpeningCiv[] };
const USAGE = 'Usage: node tools/opening-probe.ts --gameplay <n> [--seeds 31-38] [--stop 36] [--workers 12] --out <file.jsonl> | --summary <a.jsonl> [b.jsonl]';

/** One opening, played to the end of round `stop`. */
export function probeOpening(match: BalanceCase, stop: number): OpeningGame {
  const content = contentFor(match.setup), memory: RejectedCitySite[] = [];
  let state: GameState = createGame(match.setup, content);
  const civs = new Map<number, OpeningCiv>(state.turnOrder.map(id => [id, { playerId: id, group: match.group, thirdCity: null, civiliansLost: [], firstCapture: null,
    starterKnockedOut: null, fled: 0, exhausted: 0, foundRefused: 0 }]));
  const starters = new Map(state.turnOrder.map(id => [id, Object.values(state.units).find(unit => unit.ownerId === id && unit.kind === 'pokemon')?.id]));
  while (!state.outcome && state.round <= stop) {
    const view = observe(state, state.activePlayerId, content);
    const command = planNext(view, { ...RULE_QUERIES, content }, memory);
    let result = step(state, command, content);
    if (!result.ok) {
      if (command.action.type === 'FoundCity') civs.get(command.actorId)!.foundRefused++;
      rememberCityRejection(memory, view, command, result.reason);
      result = step(state, { actorId: view.playerId, expectedSeq: view.commandSeq, action: { type: 'EndTurn' } }, content);
      if (!result.ok) break;
    }
    const before = state, after = result.state;
    const wildAttacker = (id: number) => before.units[id]?.ownerId === null && !isRivalUnit(before, id) && !isRaidUnit(before, id);
    for (const { payload } of result.events) {
      if (payload.type === 'Captured' && payload.success && !civs.get(payload.playerId)!.firstCapture) civs.get(payload.playerId)!.firstCapture = { round: after.round, certain: payload.probability === 100 };
      if (payload.type === 'CivilianFled') civs.get(payload.playerId)!.fled++;
      if (payload.type === 'WildExhausted') civs.get(payload.playerId)!.exhausted++;
      if (payload.type === 'BattleResolved' && payload.target.kind === 'unit' && wildAttacker(payload.attackerId) && payload.knockedDownUnitIds.includes(payload.target.id)) {
        const target = before.units[payload.target.id], civ = target?.ownerId === null || target === undefined ? undefined : civs.get(target.ownerId);
        if (civ && starters.get(civ.playerId) === target!.id && civ.starterKnockedOut === null) civ.starterKnockedOut = after.round;
      }
    }
    // Civilians gone without founding a city.
    for (const unit of Object.values(before.units)) {
      if (unit.kind !== 'logistics' || unit.ownerId === null || after.units[unit.id]) continue;
      if (result.events.some(({ payload }) => payload.type === 'CityFounded' && payload.unitId === unit.id)) continue;
      const killer = result.events.find(({ payload }) => payload.type === 'BattleResolved' && payload.target.kind === 'unit' && payload.target.id === unit.id);
      civs.get(unit.ownerId)!.civiliansLost.push({ round: after.round, role: unit.role, byWild: Boolean(killer && killer.payload.type === 'BattleResolved' && wildAttacker(killer.payload.attackerId)) });
    }
    for (const civ of civs.values()) if (civ.thirdCity === null && Object.values(after.cities).filter(city => city.ownerId === civ.playerId).length >= 3) civ.thirdCity = before.round;
    state = after;
  }
  return { id: match.id, civs: [...civs.values()] };
}

const median = (values: readonly (number | null)[]): number | null => {
  const sorted = values.map(value => value ?? Infinity).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = sorted.length / 2, value = sorted.length % 2 ? sorted[Math.floor(middle)] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Number.isFinite(value) ? value : null;
};
/** The summary lines of one run (and, with a baseline, the paired third-city comparison). */
export function summarizeOpenings(games: readonly OpeningGame[], baseline?: readonly OpeningGame[]): string[] {
  const civs = games.flatMap(game => game.civs), by = (round: number, value: number | null | undefined) => value !== null && value !== undefined && value <= round;
  const lost = (role: string, round: number) => civs.reduce((sum, civ) => sum + civ.civiliansLost.filter(item => item.role === role && item.byWild && item.round <= round).length, 0);
  const lines = [`${games.length} games, ${civs.length} civilizations`,
    `third city by round 22: ${civs.filter(civ => by(22, civ.thirdCity)).length}/${civs.length} (${(100 * civs.filter(civ => by(22, civ.thirdCity)).length / civs.length).toFixed(1)}%), median ${median(civs.map(civ => civ.thirdCity)) ?? '∞'}`,
    ...['expansion', 'aggressive', 'conservative'].map(group => {
      const own = civs.filter(civ => civ.group === group);
      return `  ${group}: median ${median(own.map(civ => civ.thirdCity)) ?? '∞'}, by 22 ${own.filter(civ => by(22, civ.thirdCity)).length}/${own.length}`;
    }),
    `knocked out by wild Pokémon in rounds 1–22: settlers ${lost('settler', 22)}, builders ${lost('builder', 22)}, traders ${lost('trader', 22)}`,
    `first capture: median ${median(civs.map(civ => civ.firstCapture?.round ?? null)) ?? '∞'}; by round 15 ${civs.filter(civ => by(15, civ.firstCapture?.round)).length}, by 26 ${civs.filter(civ => by(26, civ.firstCapture?.round)).length}, `
      + `ever ${civs.filter(civ => civ.firstCapture).length}; with the certain first ball ${civs.filter(civ => civ.firstCapture?.certain).length}`,
    `starter knocked out by a wild Pokémon by round 20: ${civs.filter(civ => by(20, civ.starterKnockedOut)).length}`,
    `startled civilians ${civs.reduce((sum, civ) => sum + civ.fled, 0)}, exhausted wild Pokémon ${civs.reduce((sum, civ) => sum + civ.exhausted, 0)}, refused FoundCity ${civs.reduce((sum, civ) => sum + civ.foundRefused, 0)}`];
  if (baseline) {
    const old = new Map(baseline.flatMap(game => game.civs.map(civ => [`${game.id}:${civ.playerId}`, civ.thirdCity ?? Infinity])));
    let earlier = 0, later = 0;
    for (const game of games) for (const civ of game.civs) {
      const before = old.get(`${game.id}:${civ.playerId}`), now = civ.thirdCity ?? Infinity;
      if (before === undefined) continue;
      if (now < before) earlier++; else if (now > before) later++;
    }
    lines.push(`paired with the baseline: third city earlier ${earlier}, later ${later}`);
  }
  return lines;
}

const read = (file: string): OpeningGame[] => readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as OpeningGame).sort((a, b) => a.id.localeCompare(b.id));
function flagsOf(args: readonly string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--gameplay', '--seeds', '--stop', '--workers', '--out', '--shard'].includes(args[index]) || !args[index + 1]) throw new Error(USAGE);
    flags[args[index]] = args[index + 1];
  }
  return flags;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args[0] === '--summary') {
    if (!args[1] || args.length > 3) throw new Error(USAGE);
    const games = read(args[args.length - 1]), baseline = args.length === 3 ? read(args[1]) : undefined;
    const ids = baseline ? new Set(baseline.map(game => game.id)) : null;
    console.log(summarizeOpenings(ids ? games.filter(game => ids.has(game.id)) : games, baseline).join('\n'));
  } else {
    const flags = flagsOf(args), gameplay = Number(flags['--gameplay']), stop = Number(flags['--stop'] ?? 36), out = flags['--out'];
    if (!isGameplayVersion(gameplay) || gameplay < 4 || !out || !Number.isSafeInteger(stop) || stop < 1) throw new Error(USAGE);
    const cases = balanceCases({ ...PRESETS.gate, gameplay, seeds: parseSeeds(flags['--seeds'] ?? '31-38'), dexMode: 'rotation' });
    if (flags['--shard']) {
      const [shard, shards] = flags['--shard'].split('/').map(Number);
      for (const [index, match] of cases.entries()) if (index % shards === shard) appendFileSync(out, JSON.stringify(probeOpening(match, stop)) + '\n');
    } else {
      if (existsSync(out)) throw new Error(`${out} exists`);
      writeFileSync(out, '');
      const workers = Math.max(1, Math.min(cases.length, Number(flags['--workers'] ?? 8)));
      const children = Array.from({ length: workers }, (_, shard) => fork(fileURLToPath(import.meta.url), [...args.filter((_, index) => !['--workers'].includes(args[index]) && !['--workers'].includes(args[index - 1])), '--shard', `${shard}/${workers}`]));
      await Promise.all(children.map(child => new Promise<void>((done, fail) => child.on('exit', code => code ? fail(new Error(`shard exited ${code}`)) : done()))));
      console.log(summarizeOpenings(read(out)).join('\n'));
    }
  }
}
