/**
 * Change-scoped test plan (docs/tech/testing.md): which checks a change needs, computed from import graphs where possible and
 * from the reviewed tables in tools/test-plan-map.ts where imports can't tell (browser specs drive the app by URL).
 *
 *   node tools/test-plan.ts                       # plan for merge-base(main)..HEAD + working tree
 *   node tools/test-plan.ts --run                 # … and run it (npm run check)
 *   node tools/test-plan.ts --commit a71c3af      # plan for one commit
 *   node tools/test-plan.ts --base origin/main | --range A..B | --files a.ts b.css
 *   node tools/test-plan.ts --json                # machine-readable plan
 *   node tools/test-plan.ts --merge --run         # the merge tier: smoke runs all 48 cases for v27 (npm run check:merge)
 *   node tools/test-plan.ts --full --run          # full gate with merge-tier smoke (npm run check:full); --release adds balance gate notes
 *
 * Smoke tiers: by default (npm run check) smoke runs the 8-case QUICK sample of v27 — QUICK, not merge-proof;
 * --merge / --full / --release run all 48 cases.
 *
 * Other flags: --keep-going, --smoke-versions 27, --pw-workers N (default 4), --smoke-workers N.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { cacheRoot, exportTree, QUICK_CASES, SMOKE_CASES, supportedVersions } from './smoke-parallel.ts';
import { ALWAYS_SPECS, BALANCE_KNOBS, COST, DOC_FILES, FULL_TRIGGERS, PROD_TRIGGERS, SPEC_RULES,
  VITEST_TEXT_DEPENDENCIES } from './test-plan-map.ts';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Same globs as `test.include` in vite.config.ts (tests/tools/test-plan.test.ts keeps them equal). */
export const VITEST_INCLUDE = ['tests/core/**/*.test.ts', 'tests/ai/**/*.test.ts', 'tests/tools/**/*.test.ts', 'tests/network/**/*.test.ts', 'tests/editor/**/*.test.ts'];
export const BROWSER_SPECS = 'tests/browser/*.spec.ts';
export const PROD_SPECS = 'tests/browser-prod/*.spec.ts';
/** Entry points whose runtime import closure decides whether gameplay results can change. */
export const RULE_ENTRIES = ['tools/district-smoke.ts', 'src/core/step.ts', 'src/core/game.ts'];
export const BALANCE_ENTRY = 'tools/balance-run.ts';
export const HTML_ENTRIES = ['index.html', 'guide.html', 'audit.html', 'editor.html', 'multiplayer.html'];
const CLIENT = ['src/browser/**', 'src/app/**', 'src/guide/**', 'src/audit/**', 'src/editor/**', 'src/network/**', 'server/**', 'src/*.css', '*.html', 'public/**'];
const RULES = ['src/core/**', 'src/content/**', 'src/ai/**'];
const CODE_ROOTS = ['src/**', 'server/**', 'tools/**', 'tests/**', '*.html', '*.ts', '*.js', 'public/**'];
const LINTABLE = /\.(ts|tsx|js|mjs|cjs)$/;

// ---------------------------------------------------------------- globs

const globCache = new Map<string, RegExp>();
export function globToRegExp(glob: string): RegExp {
  let regex = globCache.get(glob);
  if (regex) return regex;
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { source += '(?:.*/)?'; i += 2; } else { source += '.*'; i += 1; }
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  regex = new RegExp(`^${source}$`);
  globCache.set(glob, regex);
  return regex;
}
export const matches = (file: string, globs: readonly string[]): boolean => globs.some(glob => globToRegExp(glob).test(file));

// ---------------------------------------------------------------- import graph

export type Graph = { files: Set<string>; edges: Map<string, Set<string>>; prefixes: Map<string, Set<string>>;
  pageEdges: Map<string, Set<string>> };

export function repoFiles(root = REPO_ROOT): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  return [...new Set(out.split('\0').filter(Boolean))].filter(file => existsSync(join(root, file))).sort();
}

function resolveSpecifier(root: string, from: string, specifier: string, files: Set<string>): string | null {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;
  const clean = specifier.split(/[?#]/)[0];
  const base = clean.startsWith('/') ? clean.slice(1) : posix.join(posix.dirname(from), clean);
  const target = posix.normalize(base);
  if (target.startsWith('..')) return null;
  for (const candidate of [target, `${target}.ts`, `${target}/index.ts`]) if (files.has(candidate)) return candidate;
  if (clean.startsWith('/') && files.has(`public/${target}`)) return `public/${target}`;
  return target;
}

function scriptEdges(file: string, text: string): { specifiers: string[]; prefixes: string[]; page: string[] } {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const specifiers: string[] = [], prefixes: string[] = [], page: string[] = [];
  const isTest = file.startsWith('tests/');
  const literal = (node: ts.Node | undefined): string | null =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (!node.importClause?.isTypeOnly) { const text = literal(node.moduleSpecifier); if (text) specifiers.push(text); }
    } else if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly && node.moduleSpecifier) { const text = literal(node.moduleSpecifier); if (text) specifiers.push(text); }
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isMock = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'vi'
        && ['mock', 'doMock', 'importActual'].includes(callee.name.text);
      if (isImport || isMock) { const text = literal(node.arguments[0]); if (text) specifiers.push(text); }
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL' && node.arguments?.length === 2
      && node.arguments[1].getText(source) === 'import.meta.url') {
      const first = node.arguments[0];
      const text = literal(first);
      if (text) specifiers.push(text);
      else if (ts.isTemplateExpression(first) && first.head.text) prefixes.push(first.head.text);
    } else if (isTest && ts.isStringLiteral(node) && /^\/?(src|server|tools|tests|public)\/[\w./-]+\.(ts|css|html|json)$/.test(node.text)) {
      page.push(node.text.startsWith('/') ? node.text : `/${node.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { specifiers, prefixes, page };
}

export function buildGraph(root = REPO_ROOT, fileList = repoFiles(root)): Graph {
  const files = new Set(fileList);
  const edges = new Map<string, Set<string>>(), prefixes = new Map<string, Set<string>>(), pageEdges = new Map<string, Set<string>>();
  for (const file of fileList) {
    let specifiers: string[], prefixList: string[] = [], page: string[] = [];
    if (/\.(ts|tsx|mts|js|mjs)$/.test(file) && !file.endsWith('.d.ts')) {
      ({ specifiers, prefixes: prefixList, page } = scriptEdges(file, readFileSync(join(root, file), 'utf8')));
    } else if (file.endsWith('.html')) {
      const text = readFileSync(join(root, file), 'utf8');
      specifiers = [...text.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]);
    } else if (file.endsWith('.css')) {
      const text = readFileSync(join(root, file), 'utf8');
      specifiers = [...text.matchAll(/@import\s+(?:url\()?["']([^"']+)["']/g)].map(match => match[1]);
    } else continue;
    const targets = new Set<string>();
    for (const specifier of specifiers) {
      const target = resolveSpecifier(root, file, specifier, files);
      if (target && target !== file) targets.add(target);
    }
    edges.set(file, targets);
    const pageTargets = new Set(page.map(specifier => resolveSpecifier(root, file, specifier, files)).filter((target): target is string => Boolean(target)));
    if (pageTargets.size) pageEdges.set(file, pageTargets);
    if (prefixList.length) prefixes.set(file, new Set(prefixList.map(prefix => posix.normalize(posix.join(posix.dirname(file), prefix)))));
  }
  return { files, edges, prefixes, pageEdges };
}

export function closure(graph: Graph, entries: readonly string[], page = false): { files: Set<string>; prefixes: string[] } {
  const seen = new Set<string>(), prefixes: string[] = [], named = new Set<string>();
  const stack = [...entries];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const prefix of graph.prefixes.get(file) ?? []) prefixes.push(prefix);
    for (const next of graph.edges.get(file) ?? []) if (!seen.has(next)) stack.push(next);
    if (page) for (const next of graph.pageEdges.get(file) ?? []) named.add(next);
  }
  for (const file of named) seen.add(file);
  return { files: seen, prefixes };
}
const hits = (reach: { files: Set<string>; prefixes: string[] }, changed: readonly string[]): string[] =>
  changed.filter(file => reach.files.has(file) || reach.prefixes.some(prefix => file.startsWith(prefix)));

/** Files of a tree: git's list in a checkout, a directory walk of src/ and tools/ in an exported tree. */
export function treeFiles(root: string): string[] {
  if (existsSync(join(root, '.git'))) return repoFiles(root);
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const name of readdirSync(join(root, dir)).sort()) {
      const file = dir ? `${dir}/${name}` : name;
      if (statSync(join(root, file)).isDirectory()) visit(file); else out.push(file);
    }
  };
  for (const dir of ['src', 'tools']) if (existsSync(join(root, dir))) visit(dir);
  return out;
}

// ---------------------------------------------------------------- changed files

export type ChangeSource = { label: string; base: string | null; head?: string | null; files: string[] };
const git = (root: string, args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
const lines = (text: string): string[] => text.split('\n').map(line => line.trim()).filter(Boolean);

export function collectChanges(root: string, options: { base?: string; range?: string; commit?: string; files?: string[] }): ChangeSource {
  if (options.files) {
    const files = options.files.map(file => relative(root, resolve(process.cwd(), file)).split('\\').join('/'));
    return { label: `--files (${files.length})`, base: null, files: [...new Set(files)].sort() };
  }
  if (options.commit) {
    const sha = git(root, ['rev-parse', '--short', options.commit]);
    const files = lines(git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', '--no-renames', '--root', options.commit]));
    const parent = (() => { try { return git(root, ['rev-parse', `${options.commit}^`]); } catch { return null; } })();
    return { label: `commit ${sha}`, base: parent, head: git(root, ['rev-parse', options.commit]), files: [...new Set(files)].sort() };
  }
  if (options.range) {
    const [from, to] = options.range.split(/\.\.\.?/);
    const files = lines(git(root, ['diff', '--name-only', '--no-renames', from, to || 'HEAD']));
    return { label: `range ${options.range}`, base: git(root, ['rev-parse', from]), head: git(root, ['rev-parse', to || 'HEAD']), files: [...new Set(files)].sort() };
  }
  const ref = options.base ?? 'main';
  const base = options.base ? git(root, ['rev-parse', options.base]) : git(root, ['merge-base', ref, 'HEAD']);
  const files = [...lines(git(root, ['diff', '--name-only', '--no-renames', base])), ...lines(git(root, ['ls-files', '--others', '--exclude-standard']))];
  return { label: `${options.base ? options.base : `merge-base(main) ${base.slice(0, 7)}`}..HEAD + working tree`, base, files: [...new Set(files)].sort() };
}

// ---------------------------------------------------------------- plan

export type SmokeSelection = { versions: number[]; why: string; proven: boolean;
  byVersion: Record<number, string>;
  baseCached: number[] };

export type Plan = {
  source: string; base: string | null; head: string | null; files: string[];
  tier: 'full' | 'release' | 'docs' | 'none' | 'scoped';
  full: { on: boolean; why: string[] };
  classes: Record<string, string>;
  lint: { tsc: boolean; eslint: 'all' | string[]; build: boolean; why: string[] };
  vitest: { files: 'all' | string[]; total: number; why: Record<string, string> };
  playwright: { specs: 'all' | string[]; total: number; why: Record<string, string> };
  prod: { run: boolean; why: string };
  smoke: { run: boolean; tier: 'quick' | 'merge'; cases: number[]; versions: number[]; supported: number[]; ruleFiles: string[]; why: string; proven: boolean;
    byVersion: Record<number, string>; baseCached: number[]; merge: SmokeSelection; mergeSeconds: number };
  balance: { recommend: boolean; params: string[]; command: string | null; why: string };
  notes: string[];
  estimate: { selectedSeconds: number; fullSeconds: number };
};

export type PlanOptions = { full?: boolean; release?: boolean; merge?: boolean; smokeVersions?: number[]; vitestSeconds?: Record<string, number> };

export type Context = { root: string; graph: Graph; supported: number[]; ruleGraph?: Graph };
export function loadContext(root = REPO_ROOT): Context {
  return { root, graph: buildGraph(root), supported: supportedVersions(root) };
}

const filesMatching = (graph: Graph, glob: string): string[] => [...graph.files].filter(file => globToRegExp(glob).test(file)).sort();

export function planFor(context: Context, source: ChangeSource, options: PlanOptions = {}): Plan {
  const { graph, supported } = context;
  const files = source.files;
  const vitestAll = VITEST_INCLUDE.flatMap(glob => filesMatching(graph, glob));
  const specsAll = filesMatching(graph, BROWSER_SPECS);
  const prodSpecs = filesMatching(graph, PROD_SPECS);
  const notes: string[] = [];
  const classes: Record<string, string> = {};
  const fullWhy: string[] = [];
  if (options.full || options.release) fullWhy.push(options.release ? '--release' : '--full');

  const referenced = new Set<string>();
  for (const targets of [...graph.edges.values(), ...graph.pageEdges.values()]) for (const target of targets) referenced.add(target);
  const referencedByPrefix = (file: string) => [...graph.prefixes.values()].some(set => [...set].some(prefix => file.startsWith(prefix)));
  const unknown: string[] = [], docs: string[] = [], code: string[] = [];
  for (const file of files) {
    if (matches(file, FULL_TRIGGERS)) { classes[file] = 'config → full gate'; fullWhy.push(`${file} changed`); code.push(file); }
    else if (file.startsWith('public/')) { classes[file] = 'client asset'; code.push(file); }
    else if (matches(file, DOC_FILES)) {
      if (referenced.has(file) || referencedByPrefix(file)) { classes[file] = 'data read by code'; code.push(file); } else { classes[file] = 'docs'; docs.push(file); }
    }
    else if (matches(file, CODE_ROOTS)) { classes[file] = matches(file, RULES) ? 'rules/AI' : matches(file, CLIENT) ? 'client' : file.startsWith('tests/') ? 'test' : file.startsWith('tools/') ? 'tool' : 'code'; code.push(file); }
    else { classes[file] = 'unknown → wider tier'; unknown.push(file); }
  }
  const full = fullWhy.length > 0;
  const release = Boolean(options.release);

  const ruleReach = closure(context.ruleGraph ?? graph, RULE_ENTRIES);
  const ruleFiles = hits(ruleReach, files);
  const balanceReach = closure(context.ruleGraph ?? graph, [BALANCE_ENTRY]);
  const balanceFiles = hits(balanceReach, files).filter(file => matches(file, RULES));

  // Vitest.
  const vitestWhy: Record<string, string> = {};
  if (!full && !unknown.length) {
    for (const test of vitestAll) {
      const hit = hits(closure(graph, [test]), files);
      if (hit.length) vitestWhy[test] = hit.length === 1 && hit[0] === test ? 'changed' : `imports ${list(hit.filter(file => file !== test))}`;
    }
    for (const rule of VITEST_TEXT_DEPENDENCIES) {
      const hit = files.filter(file => matches(file, rule.files));
      if (hit.length) for (const test of rule.tests) vitestWhy[test] ??= `reads the source text of ${list(hit)}`;
    }
  }
  const vitestFiles: 'all' | string[] = full || unknown.length ? 'all' : Object.keys(vitestWhy).sort();

  // Playwright.
  const specWhy: Record<string, string> = {};
  const add = (spec: string, why: string) => { specWhy[spec] ??= why; };
  let specsAllWhy: string | null = full ? 'full gate' : null;
  if (!full) {
    for (const spec of specsAll) {
      const hit = hits(closure(graph, [spec], true), files);
      if (hit.length) add(spec, hit.length === 1 && hit[0] === spec ? 'changed' : `imports ${list(hit.filter(file => file !== spec))}`);
    }
    for (const file of files) {
      const rules = SPEC_RULES.filter(rule => matches(file, rule.files));
      for (const rule of rules) {
        if (rule.specs.includes('*.spec.ts')) { specsAllWhy ??= `${file}: ${rule.why}`; continue; }
        for (const glob of rule.specs) for (const spec of filesMatching(graph, `tests/browser/${glob}`)) add(spec, `${rule.why} (${file})`);
      }
      if (!rules.length && matches(file, CLIENT) && !matches(file, ['server/**', 'src/network/**']) && classes[file] !== 'docs') {
        specsAllWhy ??= `${file} is client code with no mapping in tools/test-plan-map.ts SPEC_RULES (add one)`;
      }
    }
    const touchesPage = Object.keys(specWhy).length > 0 || unknown.length > 0 || files.some(file => matches(file, [...CLIENT, ...RULES]) && classes[file] !== 'docs');
    if (touchesPage) for (const spec of ALWAYS_SPECS) add(`tests/browser/${spec}`, 'always-run smoke set');
  }
  const specs: 'all' | string[] = specsAllWhy ? 'all' : Object.keys(specWhy).sort();
  if (specsAllWhy && !full) notes.push(`all browser specs: ${specsAllWhy}`);

  // Production e2e.
  const prodTests = new Set(prodSpecs.flatMap(spec => [...closure(graph, [spec], true).files].filter(file => file.startsWith('tests/'))));
  const prodHit = files.filter(file => matches(file, PROD_TRIGGERS) || prodTests.has(file));
  const prod = full ? { run: true, why: 'full gate' }
    : prodHit.length ? { run: true, why: `CSS / html / layout changed: ${list(prodHit)}` } : { run: false, why: 'no CSS, html, vite config or overlay/panel layout file changed' };

  // Lint and build.
  const nonDoc = code.length + unknown.length > 0;
  const typed = files.some(file => /\.(ts|tsx|mts|js|mjs|cjs|json)$/.test(file) && classes[file] !== 'docs') || unknown.length > 0;
  const eslintFiles = files.filter(file => LINTABLE.test(file) && existsSync(join(context.root, file)) && matches(file, ['src/**', 'server/**', 'tests/**', 'tools/**', '*.ts', '*.js']));
  const clientReach = closure(graph, HTML_ENTRIES);
  const buildHit = hits(clientReach, files).concat(files.filter(file => file.startsWith('public/')));
  const lint = {
    tsc: full || typed,
    eslint: full ? 'all' as const : eslintFiles,
    build: full || buildHit.length > 0 || unknown.length > 0,
    why: [full ? 'full gate' : typed ? 'tsc: scripts changed (both tsconfig.json and tsconfig.core.json)' : nonDoc ? 'tsc: no script changed' : 'tsc: docs only',
      full ? 'eslint: everything' : `eslint: ${eslintFiles.length} changed file(s)`,
      full ? 'vite build: full gate' : buildHit.length ? `vite build: client bundle changed (${list(buildHit)})` : unknown.length ? 'vite build: unknown file' : 'vite build: nothing in the html entries\' import closure changed'],
  };

  // Smoke: single v27 baseline (quick: 8 cases; merge/full/release: all 48 cases).
  const mergeTier = Boolean(options.merge || options.full || options.release);
  const allCases = Array.from({ length: SMOKE_CASES }, (_, index) => index);
  const select = (cases: number[]): SmokeSelection => {
    const cachedFor = (versions: number[]) => source.base ? versions.filter(version => baseIsCached(source.base!, version, cases)) : [];
    const done = (selection: Omit<SmokeSelection, 'baseCached'>): SmokeSelection => ({ ...selection, baseCached: cachedFor(selection.versions) });
    if (full) return done({ versions: supported, proven: true, byVersion: {}, why: 'full gate: supported gameplay baseline' });
    if (!ruleFiles.length) {
      return done({ versions: [], proven: true, byVersion: {},
        why: `no changed file is in the runtime import closure of ${RULE_ENTRIES.join(', ')} (${ruleReach.files.size} files). `
          + 'Rules are import-pure (eslint boundaries/pure-imports: src/core, src/content, src/ai import nothing else, no fs), so gameplay results cannot change.' });
    }
    return done({ versions: supported, proven: true, byVersion: {},
      why: `rule closure touched by ${list(ruleFiles)} → gameplay ${ranges(supported)}` });
  };
  const merge = select(allCases);
  const chosen = mergeTier ? merge : select([...QUICK_CASES]);
  let smoke: Plan['smoke'] = { run: chosen.versions.length > 0, tier: mergeTier ? 'merge' : 'quick', cases: mergeTier ? allCases : [...QUICK_CASES],
    versions: chosen.versions, supported, ruleFiles, why: chosen.why, proven: chosen.proven, byVersion: chosen.byVersion, baseCached: chosen.baseCached,
    merge, mergeSeconds: 0 };
  if (options.smokeVersions) {
    const override = options.smokeVersions.filter(version => supported.includes(version));
    const missing = smoke.versions.filter(version => !override.includes(version));
    smoke = { ...smoke, run: override.length > 0, versions: override, proven: missing.length === 0, byVersion: {}, baseCached: smoke.baseCached.filter(version => override.includes(version)),
      why: `${smoke.why}; overridden by --smoke-versions${missing.length ? ` (NOT the proven set: skips ${missing.join(', ')})` : ''}` };
  }

  // Balance (never automatic).
  const knobs = [...new Set(BALANCE_KNOBS.filter(rule => balanceFiles.some(file => matches(file, rule.files))).flatMap(rule => rule.params))];
  const balance: Plan['balance'] = balanceFiles.length
    ? { recommend: true, params: knobs, why: `rule/AI files in the balance-run closure changed: ${list(balanceFiles)}`,
      command: `node tools/balance-sweep.ts ${(knobs.length ? knobs.slice(0, 2) : ['<patch.path>=v1,v2']).map(param => `--param ${param}`).join(' ')} --out /tmp/balance/sweep-<name>   # preset sweep: 54 games` }
    : { recommend: false, params: [], command: null, why: 'no rule or AI file changed' };
  if (release) notes.push('release: run the 216-game balance gate by hand — node tools/balance-run.ts --preset gate --out /tmp/balance/gate-<sha>, then node tools/balance-report.ts /tmp/balance/gate-<sha> --anchor <previous gate> --out docs/design/balance/gate-<version>.md');
  if (unknown.length) notes.push(`unknown paths (${list(unknown)}): wider tier — every vitest file, tsc, eslint, vite build and the always-run browser specs`);
  if (!full && docs.length === files.length && files.length) notes.push('docs only: no checks (no markdown linter is configured)');

  const tier: Plan['tier'] = release ? 'release' : full ? 'full' : !files.length ? 'none' : docs.length === files.length ? 'docs' : 'scoped';
  const plan: Plan = {
    source: source.label, base: source.base, head: source.head ?? null, files, tier, full: { on: full, why: fullWhy }, classes,
    lint, vitest: { files: vitestFiles, total: vitestAll.length, why: vitestWhy },
    playwright: { specs, total: specsAll.length, why: specWhy }, prod, smoke, balance, notes,
    estimate: { selectedSeconds: 0, fullSeconds: 0 },
  };
  if (tier === 'docs' || tier === 'none') {
    plan.lint = { tsc: false, eslint: [], build: false, why: ['docs only'] };
    plan.playwright.specs = []; plan.vitest.files = [];
  }
  plan.estimate = estimate(context, plan, options.vitestSeconds);
  plan.smoke.mergeSeconds = Math.round(smokeSeconds(plan.smoke.merge.versions, SMOKE_CASES, plan.smoke.merge.baseCached));
  return plan;
}

const list = (items: readonly string[], max = 3): string => items.length <= max ? items.join(', ') : `${items.slice(0, max).join(', ')} +${items.length - max}`;

function baseIsCached(base: string, version: number, cases: number[]): boolean {
  const dir = (suffix: string) => join(cacheRoot(), base, `v${version}${suffix}`, '.complete');
  return existsSync(dir('')) || (cases.length < SMOKE_CASES && existsSync(dir(`-c${cases.join('.')}`)));
}

// ---------------------------------------------------------------- estimate

const testCount = (root: string, file: string): number => {
  try { return Math.max(1, (readFileSync(join(root, file), 'utf8').match(/^\s*test(\.\w+)?\(/gm) ?? []).length); } catch { return 1; }
};
export function estimate(context: Context, plan: Plan, vitestSeconds: Record<string, number> = {}): Plan['estimate'] {
  const { graph, root } = context;
  const vitestAll = VITEST_INCLUDE.flatMap(glob => filesMatching(graph, glob));
  const specsAll = filesMatching(graph, BROWSER_SPECS);
  const vitestCost = (tests: string[]) => tests.length
    ? COST.vitestStartup + Math.max(...tests.map(file => vitestSeconds[file] ?? COST.vitestHeavy[file] ?? COST.vitestDefaultFile),
      tests.reduce((sum, file) => sum + (vitestSeconds[file] ?? COST.vitestHeavy[file] ?? COST.vitestDefaultFile), 0) / COST.vitestParallel) : 0;
  const specCost = (specs: string[]) => specs.length
    ? COST.playwrightStartup + specs.reduce((sum, spec) => sum + testCount(root, spec) * COST.playwrightTest, 0) / Math.min(COST.playwrightWorkers, specs.length) : 0;
  const lintCost = (eslint: 'all' | string[]) => eslint === 'all' ? COST.eslintAll : eslint.length * COST.eslintFile + (eslint.length ? 8 : 0);
  const fullSeconds = COST.tsc + COST.eslintAll + COST.viteBuild + vitestCost(vitestAll) + specCost(specsAll) + COST.prodE2e + smokeSeconds(context.supported, SMOKE_CASES, []);
  const selectedSeconds = (plan.lint.tsc ? COST.tsc : 0) + lintCost(plan.lint.eslint) + (plan.lint.build ? COST.viteBuild : 0)
    + vitestCost(plan.vitest.files === 'all' ? vitestAll : plan.vitest.files) + specCost(plan.playwright.specs === 'all' ? specsAll : plan.playwright.specs)
    + (plan.prod.run ? COST.prodE2e : 0) + (plan.smoke.run ? smokeSeconds(plan.smoke.versions, plan.smoke.cases.length, plan.smoke.baseCached) : 0);
  return { selectedSeconds: Math.round(selectedSeconds), fullSeconds: Math.round(fullSeconds) };
}

export const smokeChunk = (games: number, workers: number = COST.smokeWorkers): number => Math.max(1, Math.min(4, Math.ceil(games / (workers * 2))));
export function smokeSeconds(versions: readonly number[], cases: number, baseCached: readonly number[], workers: number = COST.smokeWorkers): number {
  if (!versions.length) return 0;
  const games = versions.reduce((sum, version) => sum + cases * (baseCached.includes(version) ? 1 : COST.smokeRuns), 0);
  const chunk = smokeChunk(games, workers), jobs = versions.reduce((sum, version) => sum + Math.ceil(cases / chunk) * (baseCached.includes(version) ? 1 : COST.smokeRuns), 0);
  return Math.ceil(jobs / workers) * chunk * COST.smokeGame;
}

// ---------------------------------------------------------------- output

export const formatDuration = (seconds: number): string => seconds < 90 ? `${Math.round(seconds)} s` : seconds < 5400 ? `${Math.round(seconds / 60)} min` : `${(seconds / 3600).toFixed(1)} h`;

export function ranges(versions: readonly number[]): string {
  const out: string[] = [];
  for (let i = 0; i < versions.length; i++) {
    let j = i;
    while (j + 1 < versions.length && versions[j + 1] === versions[j] + 1) j++;
    out.push(j > i + 1 ? `${versions[i]}–${versions[j]}` : j === i + 1 ? `${versions[i]}, ${versions[j]}` : `${versions[i]}`);
    i = j;
  }
  return out.join(', ');
}

export function formatPlan(plan: Plan): string {
  const out: string[] = [];
  out.push(`test plan — ${plan.source}: ${plan.files.length} changed file(s), tier ${plan.tier}`);
  for (const file of plan.files.slice(0, 40)) out.push(`  ${file.padEnd(52)} ${plan.classes[file]}`);
  if (plan.files.length > 40) out.push(`  … ${plan.files.length - 40} more`);
  if (plan.full.on) out.push(`FULL GATE: ${plan.full.why.join('; ')}`);
  const count = (value: 'all' | string[], total: number) => value === 'all' ? `all ${total}` : `${value.length} of ${total}`;
  out.push('');
  out.push(`lint        ${plan.lint.tsc ? 'tsc ×2' : 'no tsc'} · ${plan.lint.eslint === 'all' ? 'eslint all' : `eslint ${plan.lint.eslint.length} file(s)`} · ${plan.lint.build ? 'vite build' : 'no vite build'}`);
  for (const why of plan.lint.why) out.push(`              ${why}`);
  out.push(`vitest      ${count(plan.vitest.files, plan.vitest.total)} files`);
  if (plan.vitest.files !== 'all') for (const file of plan.vitest.files) out.push(`              ${file.padEnd(48)} ${plan.vitest.why[file]}`);
  out.push(`playwright  ${count(plan.playwright.specs, plan.playwright.total)} specs`);
  if (plan.playwright.specs !== 'all') for (const spec of plan.playwright.specs) out.push(`              ${spec.replace('tests/browser/', '').padEnd(36)} ${plan.playwright.why[spec]}`);
  out.push(`prod e2e    ${plan.prod.run ? 'run' : 'skip'}: ${plan.prod.why}`);
  const smoke = plan.smoke, quick = smoke.tier === 'quick';
  const label = quick ? `QUICK — not merge-proof: ${smoke.cases.length} of ${SMOKE_CASES} cases` : `merge tier: all ${SMOKE_CASES} cases`;
  out.push(`smoke       ${smoke.run ? `gameplay ${ranges(smoke.versions)} (${smoke.versions.length}/${smoke.supported.length} versions; ${label})` : 'skip'}${smoke.proven ? '' : ' — NOT PROVEN'}`);
  out.push(`              ${smoke.why}`);
  if (smoke.baseCached.length) out.push(`              base results cached for v${ranges(smoke.baseCached)}`);
  if (quick && smoke.run) {
    out.push(`              before merging: npm run ${plan.full.on ? 'check:full' : 'check:merge'} — gameplay ${ranges(smoke.merge.versions)} × ${SMOKE_CASES} cases, ~${formatDuration(smoke.mergeSeconds)} of smoke`);
  }
  out.push(`balance     ${plan.balance.recommend ? 'recommended (not run): ' : 'not needed: '}${plan.balance.why}`);
  if (plan.balance.command) out.push(`              ${plan.balance.command}`);
  for (const note of plan.notes) out.push(`note        ${note}`);
  out.push(`estimate    ~${formatDuration(plan.estimate.selectedSeconds)} vs ~${formatDuration(plan.estimate.fullSeconds)} for the full gate`);
  return out.join('\n');
}

// ---------------------------------------------------------------- run

export type Step = { name: string; command: string; args: string[]; env?: Record<string, string> };

export function planSteps(plan: Plan, options: { pwWorkers?: number; smokeWorkers?: number } = {}): Step[] {
  const steps: Step[] = [];
  const npx = (name: string, ...args: string[]): Step => ({ name, command: 'npx', args });
  if (plan.lint.tsc) steps.push(npx('tsc', 'tsc', '--noEmit'), npx('tsc core', 'tsc', '--noEmit', '-p', 'tsconfig.core.json'));
  if (plan.lint.eslint === 'all') steps.push(npx('eslint', 'eslint', 'src', 'server', 'tests', '*.ts', '*.js', 'tools'));
  else if (plan.lint.eslint.length) steps.push(npx('eslint (changed)', 'eslint', '--no-warn-ignored', ...plan.lint.eslint));
  if (plan.vitest.files === 'all') steps.push(npx('vitest', 'vitest', 'run'));
  else if (plan.vitest.files.length) steps.push(npx(`vitest (${plan.vitest.files.length})`, 'vitest', 'run', ...plan.vitest.files));
  if (plan.lint.build) steps.push(npx('vite build', 'vite', 'build'));
  const workers = `--workers=${options.pwWorkers ?? 4}`;
  if (plan.playwright.specs === 'all') steps.push(npx('playwright', 'playwright', 'test', workers));
  else if (plan.playwright.specs.length) steps.push(npx(`playwright (${plan.playwright.specs.length})`, 'playwright', 'test', workers, ...plan.playwright.specs));
  if (plan.prod.run) steps.push(npx('prod e2e', 'playwright', 'test', '-c', 'playwright.prod.config.ts'));
  if (plan.smoke.run && plan.smoke.versions.length) {
    const quick = plan.smoke.tier === 'quick', workers = options.smokeWorkers ?? COST.smokeWorkers;
    const games = plan.smoke.versions.length * plan.smoke.cases.length * COST.smokeRuns;
    steps.push({ name: `smoke ${quick ? 'QUICK ' : ''}v${ranges(plan.smoke.versions).replace(/ /g, '')}`, command: process.execPath,
      args: ['tools/smoke-parallel.ts', '--versions', plan.smoke.versions.join(','), ...(quick ? ['--cases', 'quick'] : []),
        ...(plan.base ? ['--base', plan.base] : []), ...(plan.head ? ['--head', plan.head] : []),
        '--chunk', String(smokeChunk(games, workers)), ...(options.smokeWorkers ? ['--workers', String(options.smokeWorkers)] : [])] });
  }
  return steps;
}

function runSteps(root: string, steps: Step[], keepGoing: boolean): number {
  const results: { name: string; status: string; seconds: number }[] = [];
  let failed = 0;
  for (const step of steps) {
    console.log(`\n▶ ${step.name}: ${step.command === process.execPath ? 'node' : step.command} ${step.args.join(' ')}`);
    const started = Date.now();
    const result = spawnSync(step.command, step.args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...step.env } });
    const ok = result.status === 0;
    results.push({ name: step.name, status: ok ? 'ok' : `FAILED (${result.status ?? result.signal})`, seconds: (Date.now() - started) / 1000 });
    if (!ok) { failed++; if (!keepGoing) break; }
  }
  console.log('\nsummary');
  for (const result of results) console.log(`  ${result.name.padEnd(28)} ${result.status.padEnd(14)} ${formatDuration(result.seconds)}`);
  for (const step of steps.slice(results.length)) console.log(`  ${step.name.padEnd(28)} not run`);
  return failed ? 1 : 0;
}

// ---------------------------------------------------------------- CLI

export type CliOptions = { base?: string; range?: string; commit?: string; files?: string[]; json: boolean; run: boolean; full: boolean; release: boolean; merge: boolean;
  keepGoing: boolean; smokeVersions?: number[]; pwWorkers?: number; smokeWorkers?: number };

export function parseVersions(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(',')) {
    const range = /^(\d+)-(\d+)$/.exec(part.trim());
    if (range) for (let v = Number(range[1]); v <= Number(range[2]); v++) out.push(v);
    else if (/^\d+$/.test(part.trim())) out.push(Number(part.trim()));
    else throw new Error(`bad version list "${text}"`);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

export function parseCli(args: string[]): CliOptions {
  const options: CliOptions = { json: false, run: false, full: false, release: false, merge: false, keepGoing: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i], value = () => { const next = args[++i]; if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`); return next; };
    if (arg === '--json') options.json = true;
    else if (arg === '--run') options.run = true;
    else if (arg === '--full') options.full = true;
    else if (arg === '--release') options.release = true;
    else if (arg === '--merge') options.merge = true;
    else if (arg === '--keep-going') options.keepGoing = true;
    else if (arg === '--base') options.base = value();
    else if (arg === '--range') options.range = value();
    else if (arg === '--commit') options.commit = value();
    else if (arg === '--smoke-versions') options.smokeVersions = parseVersions(value());
    else if (arg === '--pw-workers') options.pwWorkers = Number(value());
    else if (arg === '--smoke-workers') options.smokeWorkers = Number(value());
    else if (arg === '--files') { options.files = []; while (args[i + 1] !== undefined && !args[i + 1].startsWith('--')) options.files.push(args[++i]); }
    else throw new Error(`unknown argument ${arg}`);
  }
  if ([options.base, options.range, options.commit, options.files].filter(Boolean).length > 1) throw new Error('use one of --base, --range, --commit, --files');
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseCli(process.argv.slice(2));
  const context = loadContext(REPO_ROOT);
  const source = collectChanges(REPO_ROOT, options);
  if (source.head) {
    const tree = exportTree(source.head);
    context.supported = supportedVersions(tree);
    context.ruleGraph = buildGraph(tree, treeFiles(tree));
  }
  const plan = planFor(context, source, { full: options.full, release: options.release, merge: options.merge, smokeVersions: options.smokeVersions });
  console.log(options.json ? JSON.stringify({ ...plan, steps: planSteps(plan, options) }, null, 2) : formatPlan(plan));
  if (options.run) {
    const steps = planSteps(plan, options);
    if (!steps.length) console.log('\nnothing to run');
    else process.exitCode = runSteps(REPO_ROOT, steps, options.keepGoing);
  }
}
