/**
 * Content read tracer (docs/tech/testing.md, "version narrowing"): records which tuning values of the traced content modules
 * (TRACED_MODULES in tools/test-plan-map.ts: world24-tuning.ts, depth-v26.ts, pace-v27.ts …) the smoke games of a gameplay version read.
 *
 * How: after a traced module has loaded and before any other rule module evaluates, every primitive leaf of every exported plain
 * object / array is turned into an accessor in place (same key order, enumerability and values), so any read — direct, through an
 * accessor such as `lateTuning(content)` that falls back to the stock constant, `JSON.stringify`, spread, destructuring — goes through a
 * getter that records the leaf's canonical key (`depth-v26#DEPTH26_TUNING.late.raidFirstRound`). src/content/units.ts loads next: the
 * copies it makes (the `world24` / `depth26` / `pace27` blocks and the flags of the stock contents) are instrumented under the name of
 * what they copy before any other rule module loads (`INIT_COPY_READERS`; its copy sites are pinned by INIT_COPY_SITES in
 * tools/test-plan-map.ts). A read at load time by any other file makes its keys observable by every version.
 *
 * tools/smoke-parallel.ts traces every smoke worker: `trace-c<first case>.txt` next to the results (not *.json, so the byte comparison
 * ignores it), merged per version into the trace store ~/.cache/pokemon-civilization/trace/<rule shape>/v<N>/ (tools/test-plan.ts
 * `ruleShape`: the rule closure with the literal values of the traced modules blanked). The planner proves a version cannot observe a
 * values-only change when a stored trace of the same shape covers the cases it would run and reads none of the changed keys.
 *
 *   node tools/content-trace.ts --case 24 0 [--tree dir] [--rounds 40]   # trace one smoke case of gameplay 24 and print the reads
 *   node tools/content-trace.ts --values [tree]       # canonical key → value of every traced leaf (JSON)
 *   node tools/content-trace.ts --list                # the trace store: shapes, versions, cases covered
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TRACED_MODULES } from './test-plan-map.ts';

const SCRIPT = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT), '..');
/** Bumped when the tracer's semantics change: part of the rule shape, so older traces stop counting. */
export const TRACE_FORMAT = 1;

/** Files that may read traced values while the rules load: they copy whole blocks into the stock contents (instrumented by name after loading). */
export const INIT_COPY_READERS = ['src/content/units.ts'];

export type TraceRecord = {
  /** Every canonical key read while a game ran. */
  reads: string[];
  /** Keys read at load time by files outside INIT_COPY_READERS: observable by every version. */
  global: string[];
  /** Load-time reads by file (for the report and the test). */
  initReaders: Record<string, number>;
  /** Paths that could not be instrumented (frozen or exotic objects; '*' = the tree has no STOCK_CONTENTS): every key below counts as read. */
  untraceable: string[];
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isPlain = (value: Record<string, unknown>): boolean => Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
const moduleName = (file: string): string => file.replace(/^.*\//, '').replace(/\.ts$/, '');

/**
 * Canonical walk of a module namespace: exports in name order, depth first, each object named by the first path that reaches it
 * (aliases such as `DEPTH26_TUNING.late === LATE_GAME_TUNING` get one name). Calls `leaf` for every primitive leaf of a plain
 * object / array and `exotic` for non-plain objects (Map, class instances) whose contents cannot be instrumented.
 */
function walk(prefix: string, namespace: Record<string, unknown>, visit: { leaf: (holder: Record<string, unknown>, property: string, key: string) => void;
  exotic: (key: string) => void }): void {
  const seen = new Set<object>();
  const go = (value: Record<string, unknown>, path: string): void => {
    if (seen.has(value)) return;
    seen.add(value);
    if (!isPlain(value)) { visit.exotic(path); return; }
    for (const property of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, property)!;
      const key = `${path}.${property}`;
      if (!('value' in descriptor)) { visit.leaf(value, property, key); continue; } // already an accessor (instrumented)
      const child = descriptor.value as unknown;
      if (typeof child === 'function') continue;
      if (isObject(child)) go(child, key); else visit.leaf(value, property, key);
    }
  };
  for (const name of Object.keys(namespace).sort()) {
    const value = namespace[name];
    if (isObject(value)) go(value, `${prefix}#${name}`);
  }
}

/** Canonical key → value of every traced leaf of a module namespace (to diff two trees). Exotic objects count as one opaque leaf. */
export function leafValues(file: string, namespace: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  walk(moduleName(file), namespace, {
    leaf: (holder, property, key) => { out[key] = holder[property]; },
    exotic: key => { out[`${key}.*`] = 'exotic'; },
  });
  return out;
}

export type Tracer = {
  phase: 'init' | 'game' | 'off';
  reads: Set<string>;
  initReads: Map<string, Set<string>>;
  untraceable: Set<string>;
  /** Instrument the block copies in the stock contents (call after the rules loaded). */
  instrumentContents(stockContents: readonly Record<string, unknown>[]): void;
  record(): TraceRecord;
};

/** Repo-relative file of the first stack frame inside `tree` that is neither this file nor a traced module. */
function caller(tree: string, traced: Set<string>): string {
  const previous = Error.stackTraceLimit;
  Error.stackTraceLimit = 50;
  const stack = new Error().stack ?? '';
  Error.stackTraceLimit = previous;
  const root = pathToFileURL(realpathSync(tree)).href.replace(/\/?$/, '/'); // module URLs are real paths (~/.cache may be a symlink)
  for (const match of stack.matchAll(/(file:\/\/[^\s)]+?):\d+:\d+/g)) {
    if (!match[1].startsWith(root)) continue;
    const file = decodeURIComponent(match[1].slice(root.length));
    if (file === 'tools/content-trace.ts' || traced.has(file)) continue;
    return file;
  }
  return '(unknown)';
}

/**
 * Load the traced modules of `tree` (before anything else of the rules) and instrument them. Nothing can read them earlier: their own
 * imports never import a traced module (checked by tests/tools/test-plan.test.ts) and the traced modules read nothing of their own
 * objects while loading (`checkTracedModule` in tools/test-plan.ts).
 */
export async function installTracer(tree: string, modules = TRACED_MODULES): Promise<Tracer> {
  const present = modules.filter(entry => existsSync(join(tree, entry.file)));
  const traced = new Set(present.map(entry => entry.file));
  const tracer: Tracer = {
    phase: 'init', reads: new Set(), initReads: new Map(), untraceable: new Set(),
    instrumentContents: () => undefined, record: () => ({ reads: [], global: [], initReaders: {}, untraceable: [] }),
  };
  const touch = (key: string): void => {
    if (tracer.phase === 'game') tracer.reads.add(key);
    else if (tracer.phase === 'init') {
      const file = caller(tree, traced);
      let files = tracer.initReads.get(key);
      if (!files) tracer.initReads.set(key, files = new Set());
      files.add(file);
    }
  };
  const instrument = (holder: Record<string, unknown>, property: string, key: string): void => {
    const descriptor = Object.getOwnPropertyDescriptor(holder, property)!;
    if (!('value' in descriptor)) return;
    let current = descriptor.value as unknown;
    try {
      Object.defineProperty(holder, property, { enumerable: descriptor.enumerable, configurable: true,
        get() { touch(key); return current; }, set(value: unknown) { touch(key); current = value; } });
    } catch { tracer.untraceable.add(key); }
  };
  const namespaces: { entry: typeof present[number]; namespace: Record<string, unknown> }[] = [];
  for (const entry of present) {
    const namespace = await import(pathToFileURL(join(tree, entry.file)).href) as Record<string, unknown>;
    namespaces.push({ entry, namespace });
    walk(moduleName(entry.file), namespace, { leaf: instrument, exotic: key => tracer.untraceable.add(key) });
  }
  tracer.instrumentContents = stockContents => {
    const phase = tracer.phase;
    tracer.phase = 'off';
    for (const content of stockContents) {
      for (const { entry, namespace } of namespaces) {
        const prefix = moduleName(entry.file);
        for (const [block, exportName] of Object.entries(entry.blocks)) {
          const copy = content[block];
          if (!isObject(copy) || copy === namespace[exportName]) continue; // absent, or the original itself (already instrumented)
          walk(prefix, { [exportName]: copy }, { leaf: instrument, exotic: key => tracer.untraceable.add(key) });
        }
        const flags = entry.flags ? namespace[entry.flags] : undefined;
        if (isObject(flags)) {
          for (const flag of Object.keys(flags)) if (Object.prototype.hasOwnProperty.call(content, flag)) instrument(content, flag, `${prefix}#${entry.flags}.${flag}`);
        }
      }
    }
    tracer.phase = phase;
  };
  tracer.record = () => {
    const global = new Set<string>(), initReaders: Record<string, number> = {};
    for (const [key, files] of tracer.initReads) {
      for (const file of files) {
        initReaders[file] = (initReaders[file] ?? 0) + 1;
        if (!INIT_COPY_READERS.includes(file)) global.add(key);
      }
    }
    return { reads: [...tracer.reads].sort(), global: [...global].sort(), initReaders, untraceable: [...tracer.untraceable].sort() };
  };
  return tracer;
}

/**
 * Load src/content/units.ts of `tree` and instrument its stock contents (STOCK_CONTENTS) before any other rule module loads, so a later
 * module that reads a copy while loading is recorded (as a load-time read: observable by every version). A tree without that list cannot
 * be traced ('*').
 */
export async function instrumentTreeContents(tree: string, tracer: Tracer): Promise<void> {
  const units = await import(pathToFileURL(join(tree, 'src/content/units.ts')).href) as { STOCK_CONTENTS?: Record<string, unknown>[] };
  if (Array.isArray(units.STOCK_CONTENTS)) tracer.instrumentContents(units.STOCK_CONTENTS);
  else tracer.untraceable.add('*');
}

/** Does a recorded read (or untraceable path) observe the value at `key`? */
export const covers = (read: string, key: string): boolean => read === '*' || read === key || key.startsWith(`${read.replace(/\.\*$/, '')}.`);

// ---------------------------------------------------------------- trace store

export const traceRoot = (): string => join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'pokemon-civilization', 'trace');
const shortHash = (text: string, length: number): string => createHash('sha256').update(text).digest('hex').slice(0, length);
export const valuesHash = (values: Record<string, unknown>): string => shortHash(JSON.stringify(Object.keys(values).sort().map(key => [key, values[key]])), 16);

/** One stored trace: smoke cases (indices 0–47) of one gameplay version, run in a tree whose rules have `shape`, with these traced values. */
export type StoredTrace = { shape: string; version: number; values: Record<string, unknown>; cases: number[]; record: TraceRecord; sha: string; node: string };

/** Store a version's trace under trace/<shape>/v<N>/<values hash>-<cases hash>.json (atomic rename; identical runs overwrite each other). */
export function storeTrace(trace: StoredTrace, root = traceRoot()): string {
  const dir = join(root, trace.shape, `v${trace.version}`);
  mkdirSync(dir, { recursive: true });
  const name = `${valuesHash(trace.values)}-${shortHash(trace.cases.join(','), 8)}.json`;
  const tmp = join(dir, `.${name}.${process.pid}`);
  writeFileSync(tmp, JSON.stringify(trace));
  renameSync(tmp, join(dir, name));
  return join(dir, name);
}
export function loadTraces(shape: string, version: number, root = traceRoot()): StoredTrace[] {
  const dir = join(root, shape, `v${version}`);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(name => name.endsWith('.json')).sort().map(name => JSON.parse(readFileSync(join(dir, name), 'utf8')) as StoredTrace);
}

/** Merge the chunk traces a smoke run left in one version's result directory (null when it has none). */
export function mergeChunkTraces(dir: string): { cases: number[]; record: TraceRecord } | null {
  const files = existsSync(dir) ? readdirSync(dir).filter(name => /^trace-c\d+\.txt$/.test(name)) : [];
  if (!files.length) return null;
  const reads = new Set<string>(), global = new Set<string>(), untraceable = new Set<string>(), initReaders: Record<string, number> = {}, cases: number[] = [];
  for (const name of files) {
    const chunk = JSON.parse(readFileSync(join(dir, name), 'utf8')) as { cases: number[]; record: TraceRecord };
    cases.push(...chunk.cases);
    for (const key of chunk.record.reads) reads.add(key);
    for (const key of chunk.record.global) global.add(key);
    for (const key of chunk.record.untraceable) untraceable.add(key);
    for (const [file, count] of Object.entries(chunk.record.initReaders)) initReaders[file] = Math.max(initReaders[file] ?? 0, count);
  }
  return { cases: [...new Set(cases)].sort((a, b) => a - b), record: { reads: [...reads].sort(), global: [...global].sort(), initReaders, untraceable: [...untraceable].sort() } };
}

/** Traced leaf values of a tree. Import in a process of its own (`--values`): the module instances must be fresh. */
export async function treeValues(tree: string, modules = TRACED_MODULES): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const entry of modules.filter(item => existsSync(join(tree, item.file)))) {
    const namespace = await import(pathToFileURL(join(tree, entry.file)).href) as Record<string, unknown>;
    Object.assign(out, leafValues(entry.file, namespace));
  }
  return out;
}

export const changedKeys = (a: Record<string, unknown>, b: Record<string, unknown>): string[] =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => JSON.stringify(a[key]) !== JSON.stringify(b[key])).sort();

/**
 * Can a version observe the difference between the traced values `a` (base) and `b` (head)? Proven not when some stored trace of the
 * same rule shape covers every case in `cases` and none of its reads, load-time globals or untraceable paths touches a key whose value
 * differs among the trace's own values, `a` and `b` (then the trace's tree, the base and the head run the same steps on the same values).
 */
export function provenUnobservable(traces: StoredTrace[], cases: readonly number[], a: Record<string, unknown>, b: Record<string, unknown>):
  { proven: boolean; why: string } {
  const usable = traces.filter(trace => cases.every(index => trace.cases.includes(index)));
  if (!usable.length) return { proven: false, why: traces.length ? `no stored trace covers these ${cases.length} cases` : 'no stored trace' };
  let hit: string[] = [];
  for (const trace of usable) {
    const keys = [...new Set([...changedKeys(a, b), ...changedKeys(trace.values, a), ...changedKeys(trace.values, b)])];
    const observed = [...trace.record.reads, ...trace.record.global, ...trace.record.untraceable];
    const seen = keys.filter(key => observed.some(read => covers(read, key)));
    if (!seen.length) return { proven: true, why: `trace of ${trace.sha.slice(0, 7)} (${trace.cases.length} cases) reads none of the ${keys.length} changed key(s)` };
    if (!hit.length || seen.length < hit.length) hit = seen;
  }
  return { proven: false, why: `reads ${hit.slice(0, 2).map(key => key.replace(/^[^#]*#/, '')).join(', ')}${hit.length > 2 ? ` +${hit.length - 2}` : ''}` };
}

// ---------------------------------------------------------------- CLI

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === '--case') {
    const version = Number(args[1]), index = Number(args[2] ?? 0);
    const tree = args.includes('--tree') ? resolve(args[args.indexOf('--tree') + 1]) : REPO_ROOT;
    const rounds = args.includes('--rounds') ? Number(args[args.indexOf('--rounds') + 1]) : null;
    const tracer = await installTracer(tree);
    await instrumentTreeContents(tree, tracer);
    const { leaderBalanceCases, simulateLeaderCase } = await import(pathToFileURL(join(tree, 'tools/leader-balance.ts')).href) as typeof import('./leader-balance.ts');
    const { smokeConfig, SMOKE_ROTATIONS } = await import('./smoke-parallel.ts');
    const match = leaderBalanceCases(smokeConfig(version) as Parameters<typeof leaderBalanceCases>[0]).filter(item => item.rotation < SMOKE_ROTATIONS)[index];
    tracer.phase = 'game';
    // --rounds N stops the game after round N (the setup only allows 100-round games): a shorter trace for tests.
    const result = simulateLeaderCase(match, rounds ? state => { if (state.round > rounds) throw new Error(`content-trace: stopped after round ${rounds}`); } : undefined);
    tracer.phase = 'off';
    console.log(JSON.stringify({ case: match.id, version, rounds: rounds ?? 100, status: rounds ? `stopped at round ${result.round}` : result.status,
      ...tracer.record() }, null, 2));
  } else if (args[0] === '--values') {
    console.log(JSON.stringify(await treeValues(resolve(args[1] ?? REPO_ROOT))));
  } else if (args[0] === '--list') {
    const root = traceRoot();
    for (const shape of existsSync(root) ? readdirSync(root).sort() : []) {
      for (const versionDir of readdirSync(join(root, shape)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
        for (const trace of loadTraces(shape, Number(versionDir.slice(1)), root)) {
          console.log(`${shape.slice(0, 12)} ${versionDir.padEnd(4)} ${trace.sha.slice(0, 10).padEnd(10)} ${String(trace.cases.length).padStart(2)} cases  ${String(trace.record.reads.length).padStart(3)} reads  ${trace.record.global.length} global`);
        }
      }
    }
  } else {
    console.error('usage: node tools/content-trace.ts --case <version> [index] | --values [tree] | --list');
    process.exitCode = 2;
  }
}
