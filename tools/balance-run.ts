/**
 * Balance gate runner (docs/design/review-2026-11/4-balance.md §3.2): AI-vs-AI games on the default setup with all nine
 * leaders rotating, run in child processes. Same flags → byte-identical `games/*.json`, `metrics.jsonl` and `curves.jsonl`
 * whatever `--workers` is; only `manifest.json` carries timing and the worker count.
 *
 *   node tools/balance-run.ts --preset gate --out /tmp/balance/gate-v23
 */
import { createHash } from 'node:crypto';
import { execFileSync, fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { contentFor } from '../src/content/units.ts';
import type { Content } from '../src/content/units.ts';
import { cityYield } from '../src/core/city.ts';
import { scorePlayer } from '../src/core/victory.ts';
import { canonicalSerialize } from '../src/core/snapshot.ts';
import type { JsonValue } from '../src/core/snapshot.ts';
import type { AiPersonality, GameState } from '../src/core/model.ts';
import { isMapUnit } from '../src/core/model.ts';
import { isEmbarked } from '../src/core/terrain.ts';
import { stableSeed } from '../src/core/civilization-systems.ts';
import { appealBreakdown } from '../src/core/contests.ts';
import { isGameplayVersion, LATEST_GAMEPLAY_VERSION } from '../src/content/eras.ts';
import type { GameplayVersion } from '../src/content/eras.ts';
import type { LeaderId } from '../src/content/leaders.ts';
import { leaderRoster, PERSONALITIES, simulateLeaderCase } from './leader-balance.ts';
import type { LeaderBalanceCase, LeaderCaseOverrides, LeaderGameResult, RoundLimit } from './leader-balance.ts';
import { parsePatch } from './patch.ts';
import { roundSnapshot } from './telemetry.ts';
import type { CombatRole } from './telemetry.ts';
import { gameCurveRows, gameMetrics } from './balance-metrics.ts';

export type BalanceConfig = {
  gameplay: GameplayVersion;
  width: number;
  height: number;
  rounds: RoundLimit;
  eras: 'simple' | 'full';
  seeds: number[];
  players: 2 | 3 | 4;
  mix: 'same' | 'mixed';
  /** v25: `rotation` = a regional Pokédex per seed × leader rotation (`dexSeed`), `map`/absent = the map seed's. */
  dexMode?: 'map' | 'rotation';
};
export type BalanceFlags = { preset: string; config: BalanceConfig; workers: number; patch: string | null; out: string };
/** `gate` is the §5 balance gate: 8 seeds × 9 leader rotations × 3 personalities = 216 games on the default new-game setup. */
export const PRESETS: Record<string, BalanceConfig> = {
  gate: { gameplay: LATEST_GAMEPLAY_VERSION, width: 40, height: 26, rounds: 200, eras: 'simple', seeds: range(31, 38), players: 4, mix: 'same' },
  'full-spot': { gameplay: LATEST_GAMEPLAY_VERSION, width: 40, height: 26, rounds: 200, eras: 'full', seeds: range(31, 34), players: 4, mix: 'same' },
  mixed: { gameplay: LATEST_GAMEPLAY_VERSION, width: 40, height: 26, rounds: 200, eras: 'simple', seeds: range(31, 38), players: 4, mix: 'mixed' },
  sweep: { gameplay: LATEST_GAMEPLAY_VERSION, width: 40, height: 26, rounds: 200, eras: 'simple', seeds: range(31, 32), players: 4, mix: 'same' },
};
/** Shared with others: half the machine, never more than 32. */
export const defaultWorkers = (cores = availableParallelism()) => Math.max(1, Math.min(32, Math.floor(cores / 2)));
const RUN_FLAGS = ['--preset', '--gameplay', '--size', '--rounds', '--eras', '--seeds', '--players', '--mix', '--dex-mode', '--workers', '--patch', '--out'] as const;
export const RUN_USAGE = 'Usage: node tools/balance-run.ts [--preset gate|full-spot|mixed|sweep] [--gameplay 1..] [--size 40x26] [--rounds 100|200|300] '
  + '[--eras simple|full] [--seeds 31-38|31,33] [--players 2|3|4] [--mix same|mixed] [--dex-mode map|rotation] [--workers N] [--patch p.json] --out <new-directory>';

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}
export function parseSeeds(text: string): number[] {
  const seeds: number[] = [];
  for (const part of text.split(',')) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!match) throw new Error(`--seeds: expected 31-38 or 31,33, got "${text}"`);
    const from = Number(match[1]), to = Number(match[2] ?? match[1]);
    if (from < 1 || to < from || !Number.isSafeInteger(to)) throw new Error(`--seeds: bad range "${part}"`);
    seeds.push(...range(from, to));
  }
  if (new Set(seeds).size !== seeds.length) throw new Error('--seeds: duplicate seed');
  if (seeds.length > 200) throw new Error('--seeds: at most 200 seeds');
  return seeds;
}
export function formatSeeds(seeds: readonly number[]): string {
  const parts: string[] = [];
  for (let index = 0; index < seeds.length;) {
    let end = index;
    while (end + 1 < seeds.length && seeds[end + 1] === seeds[end] + 1) end++;
    parts.push(end === index ? String(seeds[index]) : `${seeds[index]}-${seeds[end]}`);
    index = end + 1;
  }
  return parts.join(',');
}
/** Splits `--flag value` pairs; unknown or repeated flags are errors. */
export function splitFlags(args: readonly string[], allowed: readonly string[], usage: string, repeatable: readonly string[] = []): { flags: Record<string, string>; repeated: Record<string, string[]> } {
  const flags: Record<string, string> = {}, repeated: Record<string, string[]> = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!allowed.includes(key) || value === undefined || value.startsWith('--')) throw new Error(`${usage}\n(bad argument near "${key ?? ''}")`);
    if (repeatable.includes(key)) (repeated[key] ??= []).push(value);
    else if (Object.hasOwn(flags, key)) throw new Error(`${key} given twice`);
    else flags[key] = value;
  }
  return { flags, repeated };
}
/** Applies explicit flags on top of a preset (default `gate`). */
export function resolveConfig(flags: Record<string, string>): { preset: string; config: BalanceConfig } {
  const preset = flags['--preset'] ?? 'gate';
  if (!Object.hasOwn(PRESETS, preset)) throw new Error(`--preset: one of ${Object.keys(PRESETS).join(', ')}`);
  const config: BalanceConfig = { ...PRESETS[preset], seeds: [...PRESETS[preset].seeds] };
  if (flags['--gameplay'] !== undefined) {
    const gameplay = Number(flags['--gameplay']);
    if (!Number.isSafeInteger(gameplay) || gameplay < 4 || !isGameplayVersion(gameplay)) throw new Error(`--gameplay: 4..${LATEST_GAMEPLAY_VERSION} (nine leaders need v4+)`);
    config.gameplay = gameplay;
  }
  if (flags['--size'] !== undefined) {
    const match = /^(\d+)x(\d+)$/.exec(flags['--size']);
    if (!match || Number(match[1]) < 12 || Number(match[1]) > 80 || Number(match[2]) < 10 || Number(match[2]) > 60) throw new Error('--size: WIDTHxHEIGHT, 12..80 × 10..60');
    config.width = Number(match[1]); config.height = Number(match[2]);
  }
  if (flags['--rounds'] !== undefined) {
    if (!['100', '200', '300'].includes(flags['--rounds'])) throw new Error('--rounds: 100, 200 or 300');
    config.rounds = Number(flags['--rounds']) as RoundLimit;
  }
  if (flags['--eras'] !== undefined) {
    if (flags['--eras'] !== 'simple' && flags['--eras'] !== 'full') throw new Error('--eras: simple or full');
    config.eras = flags['--eras'];
  }
  if (flags['--seeds'] !== undefined) config.seeds = parseSeeds(flags['--seeds']);
  if (flags['--players'] !== undefined) {
    if (!['2', '3', '4'].includes(flags['--players'])) throw new Error('--players: 2, 3 or 4');
    config.players = Number(flags['--players']) as 2 | 3 | 4;
  }
  if (flags['--mix'] !== undefined) {
    if (flags['--mix'] !== 'same' && flags['--mix'] !== 'mixed') throw new Error('--mix: same or mixed');
    config.mix = flags['--mix'];
  }
  if (flags['--dex-mode'] !== undefined) {
    if (flags['--dex-mode'] !== 'map' && flags['--dex-mode'] !== 'rotation') throw new Error('--dex-mode: map or rotation');
    if (config.gameplay < 25) throw new Error('--dex-mode needs --gameplay 25 or later (the regional Pokédex)');
    config.dexMode = flags['--dex-mode'];
  }
  return { preset, config };
}
export function parseWorkers(text: string | undefined, cores = availableParallelism()): number {
  if (text === undefined) return defaultWorkers(cores);
  const workers = Number(text);
  if (!Number.isSafeInteger(workers) || workers < 1 || workers > cores) throw new Error(`--workers: 1..${cores}`);
  return workers;
}
export function parseBalanceArgs(args: readonly string[], cores = availableParallelism()): BalanceFlags {
  const { flags } = splitFlags(args, RUN_FLAGS, RUN_USAGE);
  if (!flags['--out']) throw new Error(`${RUN_USAGE}\n(--out is required)`);
  const { preset, config } = resolveConfig(flags);
  return { preset, config, workers: parseWorkers(flags['--workers'], cores), patch: flags['--patch'] ?? null, out: flags['--out'] };
}

export type BalanceCase = LeaderBalanceCase & {
  /** `same`: the personality name; `mixed`: `mix0`–`mix2` (seat s plays PERSONALITIES[(s + k) % 3]). */
  group: string;
  personalityBySeat: Record<number, AiPersonality>;
};
/**
 * Seats rotate cyclically through the roster: rotation r seats leaders r, r+1, … (mod 9), so with nine rotations every leader
 * plays `players` games per seed and group, once in every seat. `same` = one personality for the table (three groups);
 * `mixed` = personalities rotate across seats (three groups, each leader meets each personality once per rotation set).
 * For four players and `same` the setups equal `leaderBalanceCases` (the district smoke's rotations 0–3 are a subset).
 */
export function balanceCases(config: BalanceConfig): BalanceCase[] {
  const roster = leaderRoster({ gameplayVersion: config.gameplay }), seats = range(0, config.players - 1);
  const groups = config.mix === 'same'
    ? PERSONALITIES.map(personality => ({ group: personality, bySeat: seats.map(() => personality) }))
    : [0, 1, 2].map(k => ({ group: `mix${k}`, bySeat: seats.map(seat => PERSONALITIES[(seat + k) % PERSONALITIES.length]) }));
  const eraProgression = config.eras === 'simple' ? 'simple-v1' as const : 'full-v1' as const;
  const cases: BalanceCase[] = [];
  for (const seed of config.seeds) for (const { group, bySeat } of groups) for (let rotation = 0; rotation < roster.length; rotation++) {
    const leaderBySeat = Object.fromEntries(seats.map(seat => [seat, roster[(seat + rotation) % roster.length]])) as Record<number, LeaderId>;
    cases.push({
      id: `s${seed}-${group}-r${rotation}`, seed, personality: bySeat[0], rotation, leaderBySeat,
      setup: { seed, expansionVersion: 1, eraProgression, gameplayVersion: config.gameplay, width: config.width, height: config.height, roundLimit: config.rounds,
        players: seats.map(seat => ({ id: seat, controller: 'ai' as const, personality: bySeat[seat], leaderId: leaderBySeat[seat] })),
        // v25 `--dex-mode rotation` (roster-v25 §4.3): each leader rotation of a map gets its own regional Pokédex (8 seeds × 9 = 72).
        ...(config.dexMode === 'rotation' ? { dexSeed: stableSeed(seed, rotation, 'gate-dex') } : {}) },
      group, personalityBySeat: Object.fromEntries(seats.map(seat => [seat, bySeat[seat]])) as Record<number, AiPersonality>,
    });
  }
  return cases;
}

/** End-of-round sample per seat (seat order): cities, score total, techs, eliminated (0/1). `final` marks the game's last state. */
export type RoundSample = { r: number; c: number[]; s: number[]; t: number[]; e: number[]; final?: true };
export type CurveSeat = { seat: number; alive: boolean; cities: number; population: number; food: number; production: number; gold: number; research: number;
  techs: number; score: number; treasury: number; era: number | null; army: number; roles: Record<CombatRole, number> };
export type CurvePoint = { round: number; seats: CurveSeat[] };
/**
 * Gameplay v24 only (absent before, so older records are unchanged): per seat the circuit badges, the round of the first badge, Elite Four
 * runs and wins, rival visit outcomes; per game the own Pokémon knocked out while embarked (on water, not a water species).
 */
export type World24Record = { badges: number[]; firstBadgeRound: (number | null)[]; eliteFourRuns: number[]; eliteFourWon: boolean[];
  rivalOutcomes: string[][]; seaKnockouts: number };
/**
 * Gameplay v25 only (roster-v25 §4.3): the regional Pokédex and recruit slots; per seat (seat order) the starter, the peak number of own
 * Pokémon of each species, the species registered and the regional species documented at the end, and the contest appeal summed over the
 * rounds with the part that came from species.
 */
export type Roster25Record = { dex: string[]; pokedexTarget: number; recruits: string[]; starters: string[]; peakSpecies: Record<string, number>[];
  registered: string[][]; documented: number[]; appealTotal: number[]; appealSpecies: number[] };
/**
 * Gameplay v26 only (depth-v26 §9; absent before, so older records are unchanged), read from state changes: per seat the gym and guardian
 * challenges and wins, rival duels (friendly / serious, won), the rival beaten at the conference; per game the conference seasons won by a
 * civilization and the guardians beaten.
 */
export type World26Record = { gymChallenges: number[]; gymWins: number[]; guardianChallenges: number[]; guardianWins: number[];
  duels: { spar: number; serious: number; won: number }[]; conferenceRival: (string | null)[]; seasons: number; seasonsWonByCivs: number };
export type BalanceGameRecord = { schemaVersion: 1; case: BalanceCase; result: LeaderGameResult; samples: RoundSample[]; curves: CurvePoint[]; world24?: World24Record;
  roster25?: Roster25Record; world26?: World26Record };
export const CURVE_INTERVAL = 10;

/** Read-only observer for `simulateLeaderCase`: samples every end of round, snapshots every 10 rounds (on a copy of the state). */
export function createObserver(content: Content) {
  const samples: RoundSample[] = [], curves: CurvePoint[] = [];
  let lastRound = 0;
  // v24 bookkeeping (read-only): embarked own Pokémon of the previous call, Elite Four runs seen, first badge rounds.
  const v24 = Boolean(content.gymCircuit || content.rivals);
  let embarked = new Set<number>(), seaKnockouts = 0, latest: GameState | null = null;
  const eliteRuns = new Map<number, number>(), eliteSeen = new Map<number, number>(), firstBadge = new Map<number, number>();
  // v26 bookkeeping (read-only): challenge rounds seen per seat and site, badge counts, duel rounds and the duel outcome counts.
  const v26 = Boolean(content.teamBattles), gymSeen = new Map<string, number>(), guardSeen = new Map<string, number>();
  const counts = new Map<number, { gym: number; gymWins: number; guard: number; guardWins: number; spar: number; serious: number; won: number }>();
  const tally = (seat: number) => { let row = counts.get(seat); if (!row) counts.set(seat, row = { gym: 0, gymWins: 0, guard: 0, guardWins: 0, spar: 0, serious: 0, won: 0 }); return row; };
  const track26 = (state: GameState) => {
    const circuit = state.expansion?.gymCircuit, civ = state.expansion?.civilization, rivals = state.expansion?.rivals;
    for (const [seat, gyms] of Object.entries(circuit?.challengedAt ?? {})) for (const [gym, round] of Object.entries(gyms)) {
      if (gymSeen.get(`${seat}:${gym}`) !== round) { gymSeen.set(`${seat}:${gym}`, round); tally(Number(seat)).gym++; }
    }
    for (const [seat, list] of Object.entries(circuit?.badges ?? {})) tally(Number(seat)).gymWins = list.length;
    for (const site of civ?.sanctuaries ?? []) for (const [seat, round] of Object.entries(site.challengeRoundByPlayer)) {
      if (guardSeen.get(`${seat}:${site.id}`) !== round) {
        guardSeen.set(`${seat}:${site.id}`, round); tally(Number(seat)).guard++;
        if (site.guardianDefeated && civ?.tabletOwners[site.tabletId] === Number(seat)) tally(Number(seat)).guardWins++;
      }
    }
    for (const [seat, ledger] of Object.entries(rivals?.byPlayer ?? {})) {
      const row = tally(Number(seat)), log = ledger.duels ?? { spar: 0, serious: 0, won: 0 };
      row.spar = log.spar; row.serious = log.serious; row.won = log.won;
    }
  };
  // v25 bookkeeping (read-only): peak own Pokémon per species and contest appeal per seat, sampled at the end of every round.
  const dex = content.regionalDex, peakSpecies = new Map<number, Record<string, number>>(), appeal = new Map<number, { total: number; species: number }>();
  const trackRoster = (state: GameState) => {
    for (const player of Object.values(state.players)) {
      const counts: Record<string, number> = {}, peak = peakSpecies.get(player.id) ?? {};
      for (const unit of Object.values(state.units)) if (unit.ownerId === player.id && unit.kind === 'pokemon') counts[unit.speciesId] = (counts[unit.speciesId] ?? 0) + 1;
      for (const [id, count] of Object.entries(counts)) peak[id] = Math.max(peak[id] ?? 0, count);
      peakSpecies.set(player.id, peak);
      if (!player.eliminated && state.expansion?.contests) {
        const part = appealBreakdown(state, player.id, content), sum = appeal.get(player.id) ?? { total: 0, species: 0 };
        appeal.set(player.id, { total: sum.total + part.total, species: sum.species + part.species });
      }
    }
  };
  const track = (state: GameState) => {
    latest = state;
    for (const id of embarked) { const unit = state.units[id]; if (!unit || !isMapUnit(unit)) seaKnockouts++; }
    embarked = new Set(Object.values(state.units).filter(isMapUnit).filter(unit => unit.ownerId !== null && unit.kind === 'pokemon' && isEmbarked(unit, state.map, content))
      .map(unit => unit.id));
    const circuit = state.expansion?.gymCircuit;
    if (!circuit) return;
    for (const [id, run] of Object.entries(circuit.eliteFour)) if (eliteSeen.get(Number(id)) !== run.lastRound) {
      eliteSeen.set(Number(id), run.lastRound); eliteRuns.set(Number(id), (eliteRuns.get(Number(id)) ?? 0) + 1);
    }
    for (const [id, list] of Object.entries(circuit.badges)) if (list.length && !firstBadge.has(Number(id))) firstBadge.set(Number(id), state.round);
  };
  const sample = (round: number, state: GameState, final: boolean) => {
    if (dex && samples.at(-1)?.r !== round) trackRoster(state);
    if (samples.at(-1)?.r === round) samples.pop();
    const players = Object.values(state.players), scores = players.map(player => scorePlayer(state, player.id, content));
    samples.push({ r: round, c: scores.map(score => score.cities), s: scores.map(score => score.total), t: scores.map(score => score.techs),
      e: players.map(player => player.eliminated ? 1 : 0), ...(final ? { final: true as const } : {}) });
    if (round % CURVE_INTERVAL !== 0 || curves.at(-1)?.round === round) return;
    const copy = structuredClone(state), snapshot = roundSnapshot(copy, round, content);
    curves.push({ round, seats: snapshot.players.map(row => {
      const yields = { food: 0, production: 0, gold: 0, research: 0 };
      for (const city of Object.values(copy.cities)) if (city.ownerId === row.id) {
        const value = cityYield(copy, city, content);
        for (const key of ['food', 'production', 'gold', 'research'] as const) yields[key] += value[key];
      }
      return { seat: row.id, alive: !row.eliminated, cities: row.cities, population: row.population, ...yields, techs: row.techs, score: row.score.total,
        treasury: row.gold, era: row.eraIndex, army: row.combatUnits, roles: row.combatUnitsByRole };
    }) });
  };
  return {
    samples, curves,
    world24(): World24Record | undefined {
      if (!v24 || !latest) return undefined;
      const state: GameState = latest, seats = Object.keys(state.players).map(Number).sort((a, b) => a - b);
      const circuit = state.expansion?.gymCircuit, rivals = state.expansion?.rivals;
      return { badges: seats.map(seat => circuit?.badges[seat]?.length ?? 0), firstBadgeRound: seats.map(seat => firstBadge.get(seat) ?? null),
        eliteFourRuns: seats.map(seat => eliteRuns.get(seat) ?? 0), eliteFourWon: seats.map(seat => circuit?.eliteFour[seat]?.won ?? false),
        rivalOutcomes: seats.map(seat => [...(rivals?.byPlayer[seat]?.outcomes ?? [])]), seaKnockouts };
    },
    roster25(): Roster25Record | undefined {
      if (!dex || !latest) return undefined;
      const state: GameState = latest, seats = Object.keys(state.players).map(Number).sort((a, b) => a - b), regional = new Set(dex.speciesIds);
      const pokedex = (seat: number) => Object.values(state.expansion?.world.players[seat]?.pokedex ?? {});
      return { dex: [...dex.speciesIds], pokedexTarget: state.expansion?.world.victory.targetDocumentedSpecies ?? 0,
        recruits: (content.roster?.recruitSlots ?? []).map(item => `${item.slot}:${item.speciesId ?? '-'}:${item.level}`),
        starters: seats.map(seat => state.players[seat].starterId), peakSpecies: seats.map(seat => peakSpecies.get(seat) ?? {}),
        registered: seats.map(seat => [...state.players[seat].registeredSpeciesIds].sort()),
        documented: seats.map(seat => pokedex(seat).filter(record => record.observed && (record.battled || record.captured) && regional.has(record.speciesId)).length),
        appealTotal: seats.map(seat => Math.round(appeal.get(seat)?.total ?? 0)), appealSpecies: seats.map(seat => Math.round(appeal.get(seat)?.species ?? 0)) };
    },
    world26(): World26Record | undefined {
      if (!v26 || !latest) return undefined;
      const state: GameState = latest, seats = Object.keys(state.players).map(Number).sort((a, b) => a - b), history = state.expansion?.civilization.championship.history ?? [];
      const row = (seat: number) => counts.get(seat) ?? { gym: 0, gymWins: 0, guard: 0, guardWins: 0, spar: 0, serious: 0, won: 0 };
      return { gymChallenges: seats.map(seat => row(seat).gym), gymWins: seats.map(seat => row(seat).gymWins), guardianChallenges: seats.map(seat => row(seat).guard),
        guardianWins: seats.map(seat => row(seat).guardWins), duels: seats.map(seat => ({ spar: row(seat).spar, serious: row(seat).serious, won: row(seat).won })),
        conferenceRival: seats.map(seat => state.expansion?.rivals?.byPlayer[seat]?.conference ?? null),
        seasons: history.length, seasonsWonByCivs: history.filter(season => season.championPlayerId !== null).length };
    },
    onState(state: GameState) {
      if (dex) latest = state;
      if (v26) track26(state);
      if (v24) track(state);
      if (lastRound > 0 && state.round !== lastRound) sample(lastRound, state, false);
      lastRound = state.round;
      if (state.outcome) sample(state.round, state, true);
    },
  };
}

export type BalanceJob = { case: BalanceCase; patch: Record<string, JsonValue> | null; file: string };
const overridesCache = new Map<string, LeaderCaseOverrides>();
function overridesFor(job: BalanceJob): LeaderCaseOverrides {
  if (!job.patch) return {};
  const base = contentFor(job.case.setup), key = `${base.version}:${canonicalSerialize(job.patch)}`;
  if (!overridesCache.has(key)) {
    const { content, ai } = parsePatch(job.patch, base);
    overridesCache.set(key, { content, ai });
  }
  return overridesCache.get(key)!;
}
/** Plays one game and writes its record (no timing inside, so the file only depends on the case and the patch). */
export function playJob(job: BalanceJob): { status: LeaderGameResult['status'] } {
  const overrides = overridesFor(job), observer = createObserver(overrides.content ?? contentFor(job.case.setup));
  const result = simulateLeaderCase(job.case, observer.onState, overrides);
  const world24 = observer.world24(), roster25 = observer.roster25(), world26 = observer.world26();
  const record: BalanceGameRecord = { schemaVersion: 1, case: job.case, result, samples: observer.samples, curves: observer.curves, ...(world24 ? { world24 } : {}),
    ...(roster25 ? { roster25 } : {}), ...(world26 ? { world26 } : {}) };
  writeFileSync(job.file, JSON.stringify(record) + '\n');
  return { status: result.status };
}

type WorkerReply = { type: 'done'; index: number; status: LeaderGameResult['status']; ms: number } | { type: 'error'; index: number; error: string };
const SCRIPT = fileURLToPath(import.meta.url);
/** Runs jobs on `workers` child processes (each job writes its own file); resolves with per-job status and milliseconds. */
export function runJobs(jobs: readonly BalanceJob[], workers: number, onDone?: (done: number, total: number, job: BalanceJob, status: string) => void)
  : Promise<{ status: LeaderGameResult['status']; ms: number }[]> {
  const results: { status: LeaderGameResult['status']; ms: number }[] = new Array(jobs.length);
  if (jobs.length === 0) return Promise.resolve(results);
  return new Promise((resolvePromise, reject) => {
    let next = 0, done = 0, failed = false;
    const children: ChildProcess[] = [];
    const dispatch = (child: ChildProcess) => {
      if (next >= jobs.length) return; // idle until every job is done
      const index = next++;
      child.send({ type: 'job', index, job: jobs[index] });
    };
    const fail = (error: Error) => {
      if (failed) return;
      failed = true;
      for (const child of children) child.kill();
      reject(error);
    };
    for (let count = 0; count < Math.min(workers, jobs.length); count++) {
      const child = fork(SCRIPT, ['--worker'], { execArgv: ['--disable-warning=ExperimentalWarning'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      children.push(child);
      child.on('message', (message: WorkerReply) => {
        if (message.type === 'error') { fail(new Error(`${jobs[message.index].case.id}: ${message.error}`)); return; }
        results[message.index] = { status: message.status, ms: message.ms };
        done++;
        onDone?.(done, jobs.length, jobs[message.index], message.status);
        if (done === jobs.length) {
          for (const worker of children) if (worker.connected) worker.send({ type: 'exit' });
          resolvePromise(results);
        } else dispatch(child);
      });
      // Workers only leave after the final `exit` message, so any earlier exit (even code 0) loses a job.
      child.on('exit', (code, signal) => { if (!failed && done < jobs.length) fail(new Error(`worker exited early (code ${code}, signal ${signal})`)); });
      child.on('error', fail);
      dispatch(child);
    }
  });
}
function workerMain(): void {
  process.on('message', (message: { type: 'job'; index: number; job: BalanceJob } | { type: 'exit' }) => {
    if (message.type === 'exit') { process.disconnect?.(); return; }
    const started = process.hrtime.bigint();
    try {
      const { status } = playJob(message.job);
      process.send!({ type: 'done', index: message.index, status, ms: Number((process.hrtime.bigint() - started) / 1_000_000n) } satisfies WorkerReply);
    } catch (error) {
      process.send!({ type: 'error', index: message.index, error: String((error as Error)?.stack ?? error) } satisfies WorkerReply);
    }
  });
}

export type BalanceManifest = {
  schemaVersion: 1;
  tool: 'tools/balance-run.ts';
  command: string[];
  gitHead: string | null;
  gitDirty: boolean | null;
  node: string;
  preset: string;
  config: BalanceConfig;
  seedsText: string;
  patch: { file: string | null; sha256: string; value: Record<string, JsonValue> } | null;
  contentVersion: string;
  games: number;
  scheduleSha256: string;
  workers: number;
  started: string;
  finished: string | null;
  wallSeconds: number | null;
  cpuSeconds: number | null;
  statuses: Record<string, number> | null;
  gameMs: Record<string, number> | null;
};
function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: dirname(SCRIPT), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}
/** Creates `out` (refusing an existing path), writes the starting manifest and returns the jobs for it. */
export function prepareRun(out: string, input: { preset: string; config: BalanceConfig; workers: number; command: string[];
  patch?: { file: string | null; value: Record<string, JsonValue> } | null }): { manifest: BalanceManifest; jobs: BalanceJob[] } {
  const directory = resolve(out);
  if (existsSync(directory)) throw new Error(`${directory} already exists; use a new --out directory`);
  const cases = balanceCases(input.config);
  const stock = contentFor(cases[0].setup);
  // Validate before creating anything.
  const parsed = input.patch ? parsePatch(input.patch.value, stock) : null;
  mkdirSync(dirname(directory), { recursive: true });
  mkdirSync(directory);
  mkdirSync(resolve(directory, 'games'));
  const head = git(['rev-parse', 'HEAD']), status = git(['status', '--porcelain', '--untracked-files=no']);
  const manifest: BalanceManifest = {
    schemaVersion: 1, tool: 'tools/balance-run.ts', command: input.command, gitHead: head, gitDirty: status === null ? null : status.length > 0,
    node: process.version, preset: input.preset, config: input.config, seedsText: formatSeeds(input.config.seeds),
    patch: input.patch && parsed ? { file: input.patch.file, sha256: parsed.sha256, value: parsed.patch } : null,
    contentVersion: stock.version, games: cases.length,
    scheduleSha256: createHash('sha256').update(canonicalSerialize(JSON.parse(JSON.stringify(cases)) as JsonValue)).digest('hex'),
    workers: input.workers, started: new Date().toISOString(), finished: null, wallSeconds: null, cpuSeconds: null, statuses: null, gameMs: null,
  };
  writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const patch = parsed ? parsed.patch : null;
  return { manifest, jobs: cases.map(item => ({ case: item, patch, file: resolve(directory, 'games', `${item.id}.json`) })) };
}
export function readGameRecord(file: string): BalanceGameRecord {
  return JSON.parse(readFileSync(file, 'utf8')) as BalanceGameRecord;
}
/** Derives `metrics.jsonl` and `curves.jsonl` from the game files (case order) and completes the manifest. */
export function finalizeRun(out: string, manifest: BalanceManifest, jobs: readonly BalanceJob[], timings: readonly { status: string; ms: number }[], wallMs: number): BalanceManifest {
  const directory = resolve(out), metrics: string[] = [], curves: string[] = [];
  for (const job of jobs) {
    const record = readGameRecord(job.file);
    metrics.push(JSON.stringify(gameMetrics(record)));
    for (const row of gameCurveRows(record)) curves.push(JSON.stringify(row));
  }
  writeFileSync(resolve(directory, 'metrics.jsonl'), metrics.map(line => line + '\n').join(''));
  writeFileSync(resolve(directory, 'curves.jsonl'), curves.map(line => line + '\n').join(''));
  const statuses: Record<string, number> = {};
  for (const timing of timings) statuses[timing.status] = (statuses[timing.status] ?? 0) + 1;
  const finished: BalanceManifest = { ...manifest, finished: new Date().toISOString(), wallSeconds: Math.round(wallMs / 100) / 10,
    cpuSeconds: Math.round(timings.reduce((sum, timing) => sum + timing.ms, 0) / 100) / 10, statuses,
    gameMs: Object.fromEntries(jobs.map((job, index) => [job.case.id, timings[index].ms])) };
  writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify(finished, null, 2) + '\n');
  return finished;
}
export async function runBalance(input: { out: string; preset: string; config: BalanceConfig; workers: number; command?: string[];
  patch?: { file: string | null; value: Record<string, JsonValue> } | null; log?: (line: string) => void }): Promise<BalanceManifest> {
  const started = Date.now();
  const { manifest, jobs } = prepareRun(input.out, { ...input, command: input.command ?? [] });
  const timings = await runJobs(jobs, input.workers, (done, total, job, status) => input.log?.(`${done}/${total} ${job.case.id} ${status}`));
  return finalizeRun(input.out, manifest, jobs, timings, Date.now() - started);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--worker') workerMain();
  else {
    const flags = parseBalanceArgs(process.argv.slice(2));
    const patch = flags.patch ? { file: resolve(flags.patch), value: JSON.parse(readFileSync(flags.patch, 'utf8')) as Record<string, JsonValue> } : null;
    const manifest = await runBalance({ out: flags.out, preset: flags.preset, config: flags.config, workers: flags.workers, patch,
      command: ['node', 'tools/balance-run.ts', ...process.argv.slice(2)], log: line => console.log(line) });
    console.log(JSON.stringify({ out: resolve(flags.out), games: manifest.games, statuses: manifest.statuses, wallSeconds: manifest.wallSeconds, cpuSeconds: manifest.cpuSeconds }));
    if (Object.keys(manifest.statuses ?? {}).some(status => status !== 'completed')) process.exitCode = 1;
  }
}
