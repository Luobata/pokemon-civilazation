/**
 * Parallel tools/district-smoke.ts with a byte-for-byte comparison against a base commit (docs/tech/testing.md).
 *
 *   node tools/smoke-parallel.ts --versions 27 [--base <ref>] [--head <ref>] [--out <dir>] [--workers N] [--allow-diff 27] [--no-base]
 *
 * Runs the same 48 cases as `node tools/district-smoke.ts 27 <dir>` and writes the same files with the same
 * bytes (config.json + one JSON per game); the cases are split over child processes. The base commit (default: merge-base with
 * main) is exported with `git archive` and run the same way; its results are cached per commit under
 * $XDG_CACHE_HOME/pokemon-civilization/smoke/<sha>/v<N> (default ~/.cache/…), so a base is computed once for every branch on
 * the machine. A clean working tree's results are cached under HEAD too. `--head <ref>` runs a commit instead of the working tree
 * (exported and cached the same way), e.g. to check one historical commit against its parent.
 *
 * Fails (exit 1) when a game does not complete, a child process fails, or a version's files differ from the base — except
 * versions listed in --allow-diff, whose differences are reported but expected. A version the base does not support is run
 * without comparison.
 *
 * `--cases quick` runs the 8-case sample QUICK_CASES (every rotation, so every smoke leader in two seats; every seed and personality)
 * instead of all 48 — the quick tier of `npm run check`, NOT merge-proof. `--cases 0,5,…` picks indices by hand. A full cached base
 * serves a subset run too (only the subset's files are compared).
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT), '..');

/** tools/district-smoke.ts's configuration for one version (key order matters: config.json must match byte for byte). */
export function smokeConfig(version: number) {
  return { seeds: 4, seedStart: 31, expansionVersion: 1 as const, eraProgression: 'simple-v1' as const, gameplayVersion: version, roundLimit: 100 as const, width: 24, height: 16 };
}
/** Same cases as district-smoke.ts: `leaderBalanceCases(config).filter(match => match.rotation < 4)`. */
export const SMOKE_ROTATIONS = 4;
/** Cases per version: seeds × personalities × rotations, index = (seed × 3 + personality) × 4 + rotation. */
export const SMOKE_CASES = 48;
/**
 * The quick tier's 8 of the 48 cases: each rotation twice (rotation r seats leaders r..r+3, so all seven smoke leaders play, in two
 * seats each), each seed twice, personalities 3 / 3 / 2. The smoke has one map size (24×16), so there is no size to cover.
 * tests/tools/test-plan.test.ts checks the coverage against leaderBalanceCases.
 */
export const QUICK_CASES = [0, 5, 15, 22, 28, 33, 38, 43];
/** Source fragments of district-smoke.ts that smokeConfig / SMOKE_ROTATIONS reproduce; a tree whose smoke differs is refused. */
export const SMOKE_SIGNATURE = ['seeds: 4, seedStart: 31, expansionVersion: 1 as const, eraProgression: \'simple-v1\' as const,', 'roundLimit: 100 as const, width: 24, height: 16 }',
  'filter(match => match.rotation < 4)', 'JSON.stringify(result, null, 2)', 'JSON.stringify(config, null, 2)'];

/** Versions tools/district-smoke.ts accepts in a tree (its `[27].includes(version)` list). */
export function supportedVersions(tree: string): number[] {
  const text = readFileSync(join(tree, 'tools/district-smoke.ts'), 'utf8');
  const match = /\[([\d,\s]+)\]\.includes\(version\)/.exec(text);
  if (!match) throw new Error(`${tree}/tools/district-smoke.ts: cannot find the supported-version list ([27].includes(version))`);
  return match[1].split(',').map(item => Number(item.trim())).filter(Number.isFinite);
}
export function checkSignature(tree: string): void {
  const text = readFileSync(join(tree, 'tools/district-smoke.ts'), 'utf8').replace(/\s+/g, ' ');
  const missing = SMOKE_SIGNATURE.filter(fragment => !text.includes(fragment.replace(/\s+/g, ' ')));
  if (missing.length) throw new Error(`${tree}/tools/district-smoke.ts no longer matches tools/smoke-parallel.ts (missing: ${missing.join(' | ')}); update smokeConfig / SMOKE_SIGNATURE`);
}

/** Byte comparison of two smoke directories (every *.json, both directions; `headOnly`: the files of a subset run against a fuller base). */
export function compareSmoke(base: string, head: string, headOnly = false): { identical: number; total: number; differ: string[] } {
  const names = (dir: string) => readdirSync(dir).filter(name => name.endsWith('.json')).sort();
  const all = headOnly ? names(head) : [...new Set([...names(base), ...names(head)])].sort();
  const differ = all.filter(name => {
    const a = join(base, name), b = join(head, name);
    return !existsSync(a) || !existsSync(b) || !readFileSync(a).equals(readFileSync(b));
  });
  return { identical: all.length - differ.length, total: all.length, differ };
}
export function statuses(dir: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of readdirSync(dir).filter(file => file.endsWith('.json') && file !== 'config.json')) {
    const status = String((JSON.parse(readFileSync(join(dir, name), 'utf8')) as { status?: unknown }).status);
    out[status] = (out[status] ?? 0) + 1;
  }
  return out;
}

// ---------------------------------------------------------------- worker

async function worker(tree: string, version: number, destination: string, indices: number[]): Promise<void> {
  const { leaderBalanceCases, simulateLeaderCase } = await import(pathToFileURL(join(tree, 'tools/leader-balance.ts')).href) as typeof import('./leader-balance.ts');
  const config = smokeConfig(version);
  const cases = leaderBalanceCases(config as Parameters<typeof leaderBalanceCases>[0]).filter(match => match.rotation < SMOKE_ROTATIONS);
  mkdirSync(destination, { recursive: true });
  for (const index of indices) {
    const match = cases[index];
    const result = simulateLeaderCase(match);
    writeFileSync(join(destination, `${match.id}.json`), JSON.stringify(result, null, 2));
    console.log(match.id, result.status, result.round, result.outcomeKind);
    if (result.status !== 'completed') process.exitCode = 1;
  }
}

// ---------------------------------------------------------------- driver

const git = (args: string[]): string => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 << 20 }).trim();
export const cacheRoot = (): string => join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'pokemon-civilization', 'smoke');

/** `git archive` of the files the smoke loads, extracted once per commit. */
export function exportTree(sha: string): string {
  const tree = join(cacheRoot(), sha, 'tree');
  if (existsSync(join(tree, '.complete'))) return tree;
  const staging = `${tree}.tmp-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const archive = execFileSync('git', ['archive', '--format=tar', sha, 'src', 'tools', 'package.json'], { cwd: REPO_ROOT, maxBuffer: 1 << 30 });
  execFileSync('tar', ['-x', '-C', staging], { input: archive });
  writeFileSync(join(staging, '.complete'), sha);
  try { renameSync(staging, tree); } catch { rmSync(staging, { recursive: true, force: true }); }
  return tree;
}

type Job = { label: string; tree: string; version: number; destination: string; indices: number[] };

function runPool(jobs: Job[], workers: number): Promise<{ failed: string[] }> {
  const failed: string[] = [];
  let next = 0, running = 0, done = 0;
  const started = Date.now();
  return new Promise(resolveAll => {
    const launch = (): void => {
      if (done === jobs.length) { resolveAll({ failed }); return; }
      while (running < workers && next < jobs.length) {
        const job = jobs[next++];
        running++;
        const child = spawn(process.execPath, [SCRIPT, '--worker', job.tree, String(job.version), job.destination, job.indices.join(',')],
          { cwd: job.tree, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.on('data', chunk => { output += chunk; });
        child.stderr.on('data', chunk => { output += chunk; });
        child.on('close', code => {
          running--; done++;
          if (code !== 0) { failed.push(`${job.label} cases ${job.indices.join(',')}`); process.stderr.write(`\n${job.label}: exit ${code}\n${output.slice(-4000)}\n`); }
          console.log(`  [${done}/${jobs.length}] ${job.label} cases ${job.indices[0]}–${job.indices.at(-1)} ${code === 0 ? 'ok' : 'FAILED'} (${Math.round((Date.now() - started) / 1000)} s)`);
          launch();
        });
      }
    };
    launch();
  });
}

export type SmokeArgs = { versions: number[] | 'all'; base: string | null; head: string | null; out: string | null; workers: number; allowDiff: number[]; chunk: number;
  /** Case indices (0–47) to run, or every case. */
  cases: number[] | 'all' };
export function parseSmokeArgs(args: string[], cpus = availableParallelism()): SmokeArgs {
  const parsed: SmokeArgs = { versions: 'all', base: 'main', head: null, out: null, workers: Math.min(16, Math.max(2, Math.floor(cpus / 4))), allowDiff: [], chunk: 4,
    cases: 'all' };
  const list = (text: string): number[] => text.split(',').flatMap(part => {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) return Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => Number(range[1]) + i);
    if (!/^\d+$/.test(part)) throw new Error(`bad number "${part}"`);
    return [Number(part)];
  });
  for (let i = 0; i < args.length; i++) {
    const arg = args[i], value = () => { const next = args[++i]; if (next === undefined) throw new Error(`${arg} needs a value`); return next; };
    if (arg === '--versions') { const text = value(); parsed.versions = text === 'all' ? 'all' : list(text); }
    else if (arg === '--base') parsed.base = value();
    else if (arg === '--no-base') parsed.base = null;
    else if (arg === '--head') parsed.head = value();
    else if (arg === '--out') parsed.out = value();
    else if (arg === '--workers') { parsed.workers = Number(value()); if (!Number.isInteger(parsed.workers) || parsed.workers < 1) throw new Error('--workers: positive integer'); }
    else if (arg === '--allow-diff') parsed.allowDiff = list(value());
    else if (arg === '--chunk') parsed.chunk = Number(value());
    else if (arg === '--cases') {
      const text = value();
      parsed.cases = text === 'all' ? 'all' : text === 'quick' ? [...QUICK_CASES] : [...new Set(list(text))].sort((a, b) => a - b);
      if (parsed.cases !== 'all' && parsed.cases.some(index => index >= SMOKE_CASES)) throw new Error(`--cases: indices 0–${SMOKE_CASES - 1}`);
      if (parsed.cases !== 'all' && parsed.cases.length === SMOKE_CASES) parsed.cases = 'all';
    }
    else throw new Error(`unknown argument ${arg}. Usage: node tools/smoke-parallel.ts --versions 27|all [--cases quick|all|0,5,…] [--base ref | --no-base] [--head ref] [--out dir] [--workers N] [--allow-diff 27]`);
  }
  return parsed;
}

async function main(args: SmokeArgs): Promise<number> {
  const headSha = git(['rev-parse', args.head ?? 'HEAD']);
  const headRoot = args.head ? exportTree(headSha) : REPO_ROOT;
  checkSignature(headRoot);
  const headSupported = supportedVersions(headRoot);
  const versions = args.versions === 'all' ? headSupported : args.versions;
  const unsupported = versions.filter(version => !headSupported.includes(version));
  if (unsupported.length) throw new Error(`tools/district-smoke.ts does not support gameplay ${unsupported.join(', ')} (supported: ${headSupported.join(', ')})`);
  const { LATEST_GAMEPLAY_VERSION } = await import(pathToFileURL(join(headRoot, 'src/content/eras.ts')).href) as { LATEST_GAMEPLAY_VERSION: number };
  const clean = Boolean(args.head) || git(['status', '--porcelain', '--untracked-files=all', '--', 'src', 'tools', 'package.json']) === '';
  const baseSha = args.base === null ? null : git(['rev-parse', args.base === 'main' ? git(['merge-base', 'main', headSha]) : args.base]);
  const out = resolve(args.out ?? join(tmpdir(), `smoke-${Date.now().toString(36)}`));
  mkdirSync(out, { recursive: true });

  let baseTree: string | null = null, baseVersions: number[] = [];
  if (baseSha && !(clean && baseSha === headSha)) {
    baseTree = exportTree(baseSha);
    checkSignature(baseTree);
    baseVersions = supportedVersions(baseTree);
  }
  const indices = args.cases === 'all' ? Array.from({ length: SMOKE_CASES }, (_, i) => i) : args.cases;
  const subset = indices.length < SMOKE_CASES;
  const cached = (sha: string, version: number, part = subset) => join(cacheRoot(), sha, `v${version}${part ? `-c${indices.join('.')}` : ''}`);
  const isCached = (sha: string, version: number, part = subset) => existsSync(join(cached(sha, version, part), '.complete'));
  const cachedBase = (sha: string, version: number): string | null => isCached(sha, version, false) ? cached(sha, version, false) : isCached(sha, version) ? cached(sha, version) : null;
  const chunks = (): number[][] => Array.from({ length: Math.ceil(indices.length / args.chunk) }, (_, i) => indices.slice(i * args.chunk, (i + 1) * args.chunk));
  const fresh = (dir: string, version: number): string => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify(smokeConfig(version), null, 2));
    return dir;
  };

  const jobs: Job[] = [];
  const headDirs = new Map<number, string>(), baseDirs = new Map<number, string>(), staging: { dir: string; sha: string; version: number }[] = [];
  for (const version of [...versions].sort((a, b) => b - a)) {
    if (clean && isCached(headSha, version)) headDirs.set(version, cached(headSha, version));
    else {
      const dir = fresh(join(out, `v${version}`), version);
      headDirs.set(version, dir);
      for (const part of chunks()) jobs.push({ label: `head v${version}`, tree: headRoot, version, destination: dir, indices: part });
      if (clean) staging.push({ dir, sha: headSha, version });
    }
    if (baseTree && baseSha && baseVersions.includes(version)) {
      const hit = cachedBase(baseSha, version);
      if (hit) baseDirs.set(version, hit);
      else {
        const dir = fresh(join(out, `base-v${version}`), version);
        baseDirs.set(version, dir);
        for (const part of chunks()) jobs.push({ label: `base v${version}`, tree: baseTree, version, destination: dir, indices: part });
        staging.push({ dir, sha: baseSha, version });
      }
    }
  }
  console.log(`smoke: gameplay ${versions.join(', ')} · ${subset ? `${indices.length} of ${SMOKE_CASES} cases (QUICK — not merge-proof)` : `all ${SMOKE_CASES} cases`}`
    + ` · head ${headSha.slice(0, 7)}${args.head ? ' (exported)' : clean ? '' : ' + working tree'} · base ${baseSha ? baseSha.slice(0, 7) : 'none'}`
    + `${baseSha && !baseTree ? ' (= head)' : ''} · ${jobs.length} jobs of ≤${args.chunk} games on ${args.workers} workers · ${out}`);
  const { failed } = await runPool(jobs, args.workers);

  // Cache complete, successful runs (copied, so --out stays a full record).
  for (const { dir, sha, version } of staging) {
    if (failed.some(label => label.includes(` v${version} `))) continue;
    const target = cached(sha, version);
    if (existsSync(join(target, '.complete'))) continue;
    const tmp = `${target}.tmp-${process.pid}`;
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    for (const name of readdirSync(dir)) writeFileSync(join(tmp, name), readFileSync(join(dir, name)));
    writeFileSync(join(tmp, '.complete'), `${sha} v${version}`);
    try { renameSync(tmp, target); } catch { rmSync(tmp, { recursive: true, force: true }); }
  }

  let exit = failed.length ? 1 : 0;
  console.log('\nversion  games  statuses                        vs base');
  for (const version of [...versions].sort((a, b) => a - b)) {
    const head = headDirs.get(version)!;
    const status = statuses(head);
    const incomplete = Object.entries(status).filter(([key]) => key !== 'completed').reduce((sum, [, count]) => sum + count, 0);
    const games = Object.values(status).reduce((sum, count) => sum + count, 0);
    if (incomplete || games !== indices.length) exit = 1;
    let verdict: string;
    const base = baseDirs.get(version);
    if (!baseSha) verdict = 'not compared (--no-base)';
    else if (!baseTree) verdict = 'base = head (clean tree at the base commit)';
    else if (!base) verdict = 'new version: no base to compare';
    else {
      const cmp = compareSmoke(base, head, subset);
      const allowed = version > LATEST_GAMEPLAY_VERSION || args.allowDiff.includes(version);
      verdict = cmp.differ.length === 0 ? `byte-identical (${cmp.identical}/${cmp.total} files)`
        : `${cmp.differ.length} file(s) differ${allowed ? ' (allowed)' : ' — FAIL'}: ${cmp.differ.slice(0, 4).join(', ')}${cmp.differ.length > 4 ? ' …' : ''}`;
      if (cmp.differ.length && !allowed) exit = 1;
    }
    console.log(`v${String(version).padEnd(7)} ${String(games).padEnd(6)} ${JSON.stringify(status).padEnd(31)} ${verdict}`);
  }
  if (failed.length) console.log(`failed jobs: ${failed.join('; ')}`);
  if (subset) console.log(`QUICK — not merge-proof: ${indices.length} of ${SMOKE_CASES} cases per version; run npm run check:merge before merging`);
  console.log(exit ? 'smoke: FAILED' : 'smoke: ok');
  return exit;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--worker') await worker(argv[1], Number(argv[2]), argv[3], argv[4].split(',').map(Number));
  else process.exitCode = await main(parseSmokeArgs(argv));
}
