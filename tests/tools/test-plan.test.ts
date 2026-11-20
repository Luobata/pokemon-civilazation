import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import viteConfig from '../../vite.config.ts';
import { ALWAYS_SPECS, BALANCE_KNOBS, COST, FULL_TRIGGERS, INIT_COPY_SITES, PROD_TRIGGERS, SPEC_RULES, TRACED_MODULES, VERSION_SCOPED, VITEST_TEXT_DEPENDENCIES } from '../../tools/test-plan-map.ts';
import { BROWSER_SPECS, buildGraph, checkTracedModule, closure, copySites, globToRegExp, loadContext, normalizeTraced, parseCli, planFor, planSteps, ranges, REPO_ROOT, RULE_ENTRIES,
  ruleShape, smokeChunk, traceInputs, traceSafety, traceSelection, VITEST_INCLUDE } from '../../tools/test-plan.ts';
import type { Plan } from '../../tools/test-plan.ts';
import { checkSignature, compareSmoke, exportTree, parseSmokeArgs, QUICK_CASES, SMOKE_CASES, SMOKE_ROTATIONS, smokeConfig, supportedVersions } from '../../tools/smoke-parallel.ts';
import { covers, loadTraces, mergeChunkTraces, provenUnobservable, storeTrace } from '../../tools/content-trace.ts';
import type { StoredTrace, TraceRecord } from '../../tools/content-trace.ts';

const context = loadContext(REPO_ROOT);
const files = [...context.graph.files];
const plan = (changed: string[], options = {}): Plan => planFor(context, { label: 'test', base: null, files: changed }, options);
const specs = (p: Plan): string[] => p.playwright.specs === 'all' ? ['all'] : p.playwright.specs.map(spec => spec.replace('tests/browser/', ''));
const always = ALWAYS_SPECS;
const scratch = mkdtempSync(join(tmpdir(), 'test-plan-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('tiers', () => {
  test('UI-only change: no smoke, no balance, mapped specs plus the always-run set, related vitest only', () => {
    const p = plan(['src/browser/render/scene.ts']);
    expect(p.tier).toBe('scoped');
    expect(p.smoke.run).toBe(false);
    expect(p.smoke.why).toMatch(/cannot change/);
    expect(p.balance.recommend).toBe(false);
    expect(specs(p)).toEqual(expect.arrayContaining(['map.spec.ts', 'map-25d.spec.ts', 'selection.spec.ts', 'combat-presentation.spec.ts', 'waypoints.spec.ts', 'performance.spec.ts', ...always]));
    expect(specs(p)).not.toContain('audit.spec.ts');
    expect(p.vitest.files).toContain('tests/core/render-scene.test.ts');
    expect(p.vitest.files).not.toContain('tests/core/combat-math.test.ts');
    expect(p.prod.run).toBe(false);
    expect(p.lint).toMatchObject({ tsc: true, eslint: ['src/browser/render/scene.ts'], build: true });
  });

  test('stylesheet change: visual specs and the production e2e, no smoke', () => {
    const p = plan(['src/ui-icons.css']);
    expect(specs(p)).toEqual(expect.arrayContaining(['ui-icons.spec.ts', 'ui-painted.spec.ts', 'map-25d.spec.ts', ...always]));
    expect(p.prod.run).toBe(true);
    expect(p.smoke.run).toBe(false);
    expect(p.lint.eslint).toEqual([]);
  });

  test('guide change maps to the guide specs', () => {
    expect(specs(plan(['src/guide/sections.ts']))).toEqual(expect.arrayContaining(['guide.spec.ts', 'civ-glossary.spec.ts']));
  });

  test('core rule change: smoke for every supported version, related vitest, balance sweep recommended (never run)', () => {
    const p = plan(['src/core/combat-math.ts']);
    expect(p.smoke).toMatchObject({ run: true, versions: context.supported, proven: true, ruleFiles: ['src/core/combat-math.ts'] });
    // npm run check: the quick sample; --merge (npm run check:merge) and --full: all 48 cases.
    expect(p.smoke).toMatchObject({ tier: 'quick', cases: QUICK_CASES });
    expect(p.smoke.merge.versions).toEqual(context.supported);
    expect(p.smoke.mergeSeconds).toBeGreaterThan(p.estimate.selectedSeconds / 2);
    expect(plan(['src/core/combat-math.ts'], { merge: true }).smoke).toMatchObject({ tier: 'merge', cases: Array.from({ length: SMOKE_CASES }, (_, i) => i) });
    expect(plan(['src/core/combat-math.ts'], { full: true }).smoke.tier).toBe('merge');
    expect(plan(['tools/test-plan.ts']).smoke).toMatchObject({ tier: 'quick', versions: context.supported }); // escalated FULL GATE, still quick
    expect(p.vitest.files).toContain('tests/core/combat-math.test.ts');
    // Most tests reach combat-math through step/game; the ones that don't are skipped.
    expect(p.vitest.files.length).toBeLessThan(p.vitest.total);
    expect(p.vitest.files).not.toContain('tests/core/hex.test.ts');
    expect(p.balance.recommend).toBe(true);
    expect(p.balance.command).toMatch(/balance-sweep\.ts --param balance\.city/);
    expect(planSteps(p).filter(step => step.command === process.execPath).map(step => step.args.join(' ')).join('\n')).not.toMatch(/balance-run|preset gate/);
    // UI-visible combat numbers: the combat specs run too.
    expect(specs(p)).toEqual(expect.arrayContaining(['combat.spec.ts', 'strength.spec.ts', ...always]));
  });

  test('AI change: smoke for every version, AI knobs for the sweep', () => {
    const p = plan(['src/ai/war-plan.ts']);
    expect(p.smoke.versions).toEqual(context.supported);
    expect(p.balance.params.some(param => param.startsWith('ai.'))).toBe(true);
    expect(p.vitest.files).toEqual(expect.arrayContaining(['tests/ai/war-continuity.test.ts']));
  });

  test('content change for one gameplay version: smoke only for the versions it can reach', () => {
    for (const file of ['src/content/roster-v26-data.ts', 'src/content/stone-evolutions.ts']) {
      const p = plan([file]);
      expect(p.smoke.run).toBe(true);
      expect(p.smoke.versions).toEqual(context.supported.filter(version => version >= 25));
      expect(p.smoke.why).toMatch(/gameplay ≥ 25/);
    }
    // One unscoped rule file widens back to every version.
    expect(plan(['src/content/roster-v26-data.ts', 'src/core/hex.ts']).smoke.versions).toEqual(context.supported);
  });

  test('--smoke-versions narrows by hand and says it is no longer proven', () => {
    const p = plan(['src/core/hex.ts'], { smokeVersions: [26] });
    expect(p.smoke).toMatchObject({ run: true, versions: [26], proven: false });
    expect(p.smoke.why).toMatch(/NOT the proven set/);
  });

  test('docs only: nothing runs', () => {
    const p = plan(['docs/tech/rendering.md', 'README.md', 'tools/README.md']);
    expect(p.tier).toBe('docs');
    expect(planSteps(p)).toEqual([]);
    expect(p.notes.join()).toMatch(/docs only/);
  });

  test('a markdown file the page serves is not docs', () => {
    const p = plan(['public/buildings/README.md']);
    expect(p.tier).toBe('scoped');
    expect(specs(p)).toContain('ui-icons.spec.ts');
  });

  test('config, lockfile or the planner itself: the full gate', () => {
    for (const file of ['package.json', 'package-lock.json', 'tsconfig.core.json', 'eslint.config.js', 'vite.config.ts', 'playwright.prod.config.ts',
      'tools/test-plan.ts', 'tools/test-plan-map.ts', 'tools/smoke-parallel.ts']) {
      const p = plan([file]);
      expect(p.tier, file).toBe('full');
      expect(p.vitest.files).toBe('all');
      expect(p.playwright.specs).toBe('all');
      expect(p.prod.run).toBe(true);
      expect(p.smoke.versions).toEqual(context.supported);
      expect(p.lint).toMatchObject({ tsc: true, eslint: 'all', build: true });
    }
    expect(plan(['src/core/hex.ts'], { release: true }).notes.join()).toMatch(/balance-run\.ts --preset gate/);
  });

  test('unknown file: a wider tier, never nothing', () => {
    const p = plan(['scripts/deploy.sh']);
    expect(p.tier).toBe('scoped');
    expect(p.vitest.files).toBe('all');
    expect(p.lint).toMatchObject({ tsc: true, build: true });
    expect(specs(p)).toEqual(expect.arrayContaining(always.map(spec => spec)));
    expect(p.smoke.run).toBe(false); // rules are import-pure: a file outside the graph cannot reach them
    expect(p.notes.join()).toMatch(/unknown paths/);
  });

  test('unmapped client file runs every spec and asks for a mapping', () => {
    const p = plan(['src/browser/brand-new-panel.ts']);
    expect(p.playwright.specs).toBe('all');
    expect(p.notes.join()).toMatch(/no mapping/);
  });

  test('tool and test changes: only what imports them', () => {
    const p = plan(['tools/balance-report.ts']);
    expect(p.vitest.files).toEqual(expect.arrayContaining(['tests/tools/balance-report.test.ts']));
    expect(p.vitest.files).not.toContain('tests/core/combat.test.ts');
    expect(p.playwright.specs).toEqual([]);
    expect(p.smoke.run).toBe(false);
    expect(p.lint.build).toBe(false);
    // tools/statistics.ts is part of the smoke harness (leader-balance imports it), so it does run smoke.
    expect(plan(['tools/statistics.ts']).smoke.run).toBe(true);
    expect(plan(['tests/core/hex.test.ts']).vitest.files).toEqual(['tests/core/hex.test.ts']);
    const spec = plan(['tests/browser/ui.ts']);
    expect(specs(spec)).toEqual(expect.arrayContaining(['shell.spec.ts', 'map.spec.ts']));
  });

  test('smoke harness change runs smoke', () => {
    expect(plan(['tools/leader-balance.ts']).smoke).toMatchObject({ run: true, versions: context.supported });
  });
});

describe('import graph', () => {
  test('type-only imports carry no edge; mixed imports, dynamic imports, new URL data files, html and css do', () => {
    const root = join(scratch, 'graph');
    const write = (file: string, text: string) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text); };
    write('src/a.ts', "import type { T } from './types.ts';\nimport { type U, v } from './mixed.ts';\nexport type { W } from './w.ts';\nconst lazy = () => import('./lazy.ts');\nconst data = new URL('./data.json', import.meta.url);\nconst dir = new URL(`../public/sprites/${1}.png`, import.meta.url);\n");
    write('src/types.ts', ''); write('src/mixed.ts', ''); write('src/w.ts', ''); write('src/lazy.ts', ''); write('src/data.json', '{}'); write('public/sprites/1.png', '');
    write('index.html', '<link rel="stylesheet" href="./src/s.css"><script type="module" src="/src/a.ts"></script>');
    write('src/s.css', "@import './t.css';"); write('src/t.css', '');
    write('tests/x.spec.ts', "const path = '/src/lazy.ts';");
    const graph = buildGraph(root, ['src/a.ts', 'src/types.ts', 'src/mixed.ts', 'src/w.ts', 'src/lazy.ts', 'src/data.json', 'public/sprites/1.png', 'index.html', 'src/s.css', 'src/t.css', 'tests/x.spec.ts']);
    expect([...graph.edges.get('src/a.ts')!].sort()).toEqual(['src/data.json', 'src/lazy.ts', 'src/mixed.ts']);
    expect([...graph.prefixes.get('src/a.ts')!]).toEqual(['public/sprites/']);
    expect([...closure(graph, ['index.html']).files].sort()).toEqual(['index.html', 'src/a.ts', 'src/data.json', 'src/lazy.ts', 'src/mixed.ts', 'src/s.css', 'src/t.css']);
    expect(closure(graph, ['tests/x.spec.ts']).files.has('src/lazy.ts')).toBe(false);
    expect(closure(graph, ['tests/x.spec.ts'], true).files.has('src/lazy.ts')).toBe(true);
  });

  test('the rule closure holds core, content, AI and the smoke harness, and no client code', () => {
    const rules = closure(context.graph, RULE_ENTRIES).files;
    for (const file of ['tools/leader-balance.ts', 'src/core/step.ts', 'src/ai/plan.ts', 'src/content/units.ts', 'src/content/roster-v26-data.ts']) expect(rules.has(file), file).toBe(true);
    expect([...rules].filter(file => /^(src\/(browser|app|guide|audit|editor|network)|server)\//.test(file) || file.endsWith('.css'))).toEqual([]);
  });

  test('globs: * stays in a segment, ** crosses them', () => {
    expect(globToRegExp('src/*.css').test('src/a.css')).toBe(true);
    expect(globToRegExp('src/*.css').test('src/x/a.css')).toBe(false);
    expect(globToRegExp('src/browser/**').test('src/browser/render/painted/fog.ts')).toBe(true);
    expect(globToRegExp('**/*.md').test('README.md')).toBe(true);
    expect(globToRegExp('map*.spec.ts').test('map-25d.spec.ts')).toBe(true);
  });
});

describe('mapping table stays honest', () => {
  const browserSpecs = files.filter(file => globToRegExp(BROWSER_SPECS).test(file)).map(file => file.replace('tests/browser/', ''));
  const any = (glob: string, pool: string[]) => pool.some(file => globToRegExp(glob).test(file));

  test('every source glob in the tables matches an existing file', () => {
    const globs = [...SPEC_RULES.flatMap(rule => rule.files), ...PROD_TRIGGERS, ...VITEST_TEXT_DEPENDENCIES.flatMap(rule => [...rule.files, ...rule.tests]),
      ...BALANCE_KNOBS.flatMap(rule => rule.files), ...VERSION_SCOPED.map(entry => entry.file)];
    expect(globs.filter(glob => !any(glob, files))).toEqual([]);
    // Full triggers may name optional files (vitest.config.*, .npmrc); the ones that exist today must be found.
    expect(['package.json', 'package-lock.json', 'tsconfig*.json', 'eslint.config.js', 'vite.config.ts', 'playwright*.config.ts', 'tools/test-plan.ts']
      .filter(glob => !FULL_TRIGGERS.includes(glob) || !any(glob, files))).toEqual([]);
  });

  test('every spec glob matches an existing browser spec', () => {
    expect([...ALWAYS_SPECS, ...SPEC_RULES.flatMap(rule => rule.specs)].filter(glob => !any(glob, browserSpecs))).toEqual([]);
  });

  test('no browser spec is orphaned: each is in the always-run set or reachable from a non-catch-all mapping', () => {
    const mapped = new Set(SPEC_RULES.filter(rule => !rule.specs.includes('*.spec.ts')).flatMap(rule => rule.specs).concat(ALWAYS_SPECS)
      .flatMap(glob => browserSpecs.filter(spec => globToRegExp(glob).test(spec))));
    expect(browserSpecs.length).toBeGreaterThan(60);
    expect(browserSpecs.filter(spec => !mapped.has(spec))).toEqual([]);
  });

  test('version-scoped rule files are reached only through their reviewed importers', () => {
    const rules = closure(context.graph, RULE_ENTRIES).files;
    for (const entry of VERSION_SCOPED) {
      const importers = [...rules].filter(file => context.graph.edges.get(file)?.has(entry.file)).sort();
      expect(importers, `${entry.file}: a new importer needs a new review of VERSION_SCOPED`).toEqual([...entry.importers].sort());
      expect(context.supported.some(version => version >= entry.from)).toBe(true);
    }
  });

  test('vitest include globs match vite.config.ts', () => {
    expect((viteConfig as { test?: { include?: string[] } }).test?.include).toEqual(VITEST_INCLUDE);
  });
});

describe('CLI and smoke runner', () => {
  test('arguments', () => {
    expect(parseCli(['--files', 'a.ts', 'b.css', '--json'])).toMatchObject({ files: ['a.ts', 'b.css'], json: true });
    expect(parseCli(['--commit', 'abc', '--run', '--smoke-versions', '24-26,9'])).toMatchObject({ commit: 'abc', run: true, smokeVersions: [9, 24, 25, 26] });
    expect(parseCli(['--merge', '--no-trace-narrowing'])).toMatchObject({ merge: true, noTraceNarrowing: true });
    expect(() => parseCli(['--commit', 'a', '--files', 'x'])).toThrow();
    expect(() => parseCli(['--bogus'])).toThrow();
    expect(parseSmokeArgs(['--versions', '24-26', '--workers', '3', '--allow-diff', '27'], 64)).toMatchObject({ versions: [24, 25, 26], workers: 3, allowDiff: [27], base: 'main' });
    expect(parseSmokeArgs(['--no-base'], 64)).toMatchObject({ base: null, versions: 'all', workers: 16, cases: 'all', trace: true });
    expect(parseSmokeArgs(['--no-trace'], 64).trace).toBe(false);
    expect(() => parseSmokeArgs(['--workers', '0'])).toThrow();
  });

  test('the parallel smoke reproduces tools/district-smoke.ts (configuration, cases, file format)', () => {
    expect(() => checkSignature(REPO_ROOT)).not.toThrow();
    expect(supportedVersions(REPO_ROOT)).toEqual(context.supported);
    expect(context.supported).toContain(9);
    expect(Object.keys(smokeConfig(26))).toEqual(['seeds', 'seedStart', 'expansionVersion', 'eraProgression', 'gameplayVersion', 'roundLimit', 'width', 'height']);
  });

  test('smoke comparison is byte-for-byte, both directions', () => {
    const a = join(scratch, 'a'), b = join(scratch, 'b');
    mkdirSync(a); mkdirSync(b);
    writeFileSync(join(a, 'config.json'), '{}'); writeFileSync(join(b, 'config.json'), '{}');
    writeFileSync(join(a, 'g1.json'), '{"status":"completed"}'); writeFileSync(join(b, 'g1.json'), '{"status":"completed"} ');
    writeFileSync(join(b, 'g2.json'), '{}');
    expect(compareSmoke(a, b)).toEqual({ identical: 1, total: 3, differ: ['g1.json', 'g2.json'] });
    // A subset run (quick) against a fuller cached base compares only its own files; trace files are not compared.
    writeFileSync(join(b, 'trace-c0.txt'), '{}');
    expect(compareSmoke(b, a, true)).toEqual({ identical: 1, total: 2, differ: ['g1.json'] });
  });

  test('steps: changed-file eslint, explicit vitest files, Playwright with few workers, smoke against the base', () => {
    const p = planFor(context, { label: 't', base: 'abc123', files: ['src/content/stone-evolutions.ts'] });
    const steps = planSteps(p, { pwWorkers: 2 }).map(step => `${step.name}: ${step.args.join(' ')}`);
    expect(steps.find(step => step.startsWith('eslint'))).toMatch(/eslint --no-warn-ignored src\/content\/stone-evolutions\.ts$/);
    expect(steps.find(step => step.startsWith('playwright'))).toMatch(/--workers=2/);
    const versions = context.supported.filter(version => version >= 25).join(',');
    // The chunk follows the number of smoke versions (25–26 on a v26 tree, 25–27 once v27 is in district-smoke).
    const quickChunk = smokeChunk(versions.split(',').length * QUICK_CASES.length * COST.smokeRuns);
    // `npm run check`: the quick sample, labelled; `--merge`: all 48 cases; --commit / --range: the commit, not the working tree.
    expect(steps.find(step => step.startsWith('smoke'))).toMatch(new RegExp(`^smoke QUICK .*tools/smoke-parallel\\.ts --versions ${versions} --cases quick --base abc123 --chunk ${quickChunk}$`));
    const merge = planFor(context, { label: 't', base: 'abc123', head: 'def456', files: ['src/content/stone-evolutions.ts'] }, { merge: true });
    const mergeStep = planSteps(merge).find(step => step.name.startsWith('smoke'))!;
    expect(mergeStep.args.join(' ')).toBe(`tools/smoke-parallel.ts --versions ${versions} --base abc123 --head def456 --chunk 4`);
    expect(mergeStep.name).not.toMatch(/QUICK/);
  });

  test('the quick sample covers every rotation (so every smoke leader), seed and personality', async () => {
    const { leaderBalanceCases } = await import('../../tools/leader-balance.ts');
    const cases = leaderBalanceCases(smokeConfig(26) as Parameters<typeof leaderBalanceCases>[0]).filter(match => match.rotation < SMOKE_ROTATIONS);
    expect(cases).toHaveLength(SMOKE_CASES);
    const quick = QUICK_CASES.map(index => cases[index]);
    expect(QUICK_CASES).toHaveLength(8);
    expect(new Set(quick.map(match => match.rotation)).size).toBe(SMOKE_ROTATIONS);
    expect(new Set(quick.map(match => match.seed))).toEqual(new Set(cases.map(match => match.seed)));
    expect(new Set(quick.map(match => match.personality))).toEqual(new Set(cases.map(match => match.personality)));
    const leaders = (list: typeof cases) => new Set(list.flatMap(match => Object.values(match.leaderBySeat)));
    expect(leaders(quick)).toEqual(leaders(cases));
    expect(new Set(cases.map(match => `${match.setup.width}x${match.setup.height}`)).size).toBe(1); // one map size in the smoke
    expect(parseSmokeArgs(['--cases', 'quick'], 64).cases).toEqual(QUICK_CASES);
    expect(parseSmokeArgs(['--cases', '0-47'], 64).cases).toBe('all');
    expect(() => parseSmokeArgs(['--cases', '48'], 64)).toThrow();
  });
});

describe('version narrowing by content read traces', () => {
  const all = Array.from({ length: SMOKE_CASES }, (_, i) => i);
  const NPC = 'depth-v26#DEPTH26_TUNING.npcBasePower', LAND = 'world24-tuning#WORLD24_TUNING.landPercent';
  const record = (reads: string[], extra: Partial<TraceRecord> = {}): TraceRecord => ({ reads, global: [], initReaders: { 'src/content/units.ts': 81 }, untraceable: [], ...extra });
  const trace = (version: number, reads: string[], values: Record<string, unknown>, cases = all, extra: Partial<TraceRecord> = {}): StoredTrace =>
    ({ shape: 'shape', version, values, cases, record: record(reads, extra), sha: 'abc1234', node: process.version });
  const base = { [NPC]: 1120, [LAND]: 56 }, head = { [NPC]: 1150, [LAND]: 56 };

  test('proof: a stored trace that covers the cases and reads none of the changed keys', () => {
    expect(provenUnobservable([trace(24, [LAND], base)], all, base, head).proven).toBe(true);
    expect(provenUnobservable([trace(26, [LAND, NPC], base)], all, base, head)).toMatchObject({ proven: false, why: expect.stringMatching(/npcBasePower/) });
    expect(provenUnobservable([], all, base, head)).toMatchObject({ proven: false, why: 'no stored trace' });
    // A quick-tier trace proves the quick sample only.
    expect(provenUnobservable([trace(24, [], base, QUICK_CASES)], all, base, head).proven).toBe(false);
    expect(provenUnobservable([trace(24, [], base, QUICK_CASES)], QUICK_CASES, base, head).proven).toBe(true);
    // A key whose value differs in the trace's own tree counts too (the trace tree, base and head must all run alike).
    expect(provenUnobservable([trace(24, [LAND], { ...base, [LAND]: 60 })], all, base, head).proven).toBe(false);
    // Load-time reads outside units.ts and untraceable paths count as reads.
    expect(provenUnobservable([trace(24, [], base, all, { global: [NPC] })], all, base, head).proven).toBe(false);
    expect(provenUnobservable([trace(24, [], base, all, { untraceable: ['*'] })], all, base, head).proven).toBe(false);
    expect(covers('depth-v26#DEPTH26_TUNING.late', 'depth-v26#DEPTH26_TUNING.late.raidFirstRound')).toBe(true);
    expect(covers('depth-v26#DEPTH26_TUNING.late', 'depth-v26#DEPTH26_TUNING.lateX')).toBe(false);
    expect(ranges([9, 10, 11, 12, 24, 26, 27])).toBe('9–12, 24, 26, 27');
  });

  test('trace store: chunk traces merge per version and round-trip', () => {
    const dir = join(scratch, 'chunks'), store = join(scratch, 'store');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'trace-c0.txt'), JSON.stringify({ cases: [0, 5], record: record([LAND]) }));
    writeFileSync(join(dir, 'trace-c15.txt'), JSON.stringify({ cases: [15], record: record([NPC], { global: ['x'] }) }));
    const merged = mergeChunkTraces(dir)!;
    expect(merged).toMatchObject({ cases: [0, 5, 15], record: { reads: [LAND, NPC].sort(), global: ['x'] } });
    storeTrace({ shape: 'abc', version: 24, values: base, cases: merged.cases, record: merged.record, sha: 'deadbeef', node: process.version }, store);
    expect(loadTraces('abc', 24, store)).toHaveLength(1);
    expect(loadTraces('abc', 25, store)).toEqual([]);
  });

  test('rule shape: literal values of the traced exports are blanked, everything else is shape', () => {
    const file = 'src/content/depth-v26.ts', text = readFileSync(join(REPO_ROOT, file), 'utf8');
    const edit = (from: string, to: string) => { expect(text).toContain(from); return normalizeTraced(file, text.replace(from, to)); };
    const same = normalizeTraced(file, text);
    expect(edit('npcBasePower: 1150', 'npcBasePower: 1200')).toBe(same);
    expect(edit('// gate-v26 sweep', '// another comment')).toBe(same);
    expect(edit('npcBasePower: 1150', 'npcBaseStrength: 1150')).not.toBe(same); // a key
    expect(edit('seasonRewards: [60, 30, 15]', 'seasonRewards: [60, 30]')).not.toBe(same); // an array length
    expect(edit('content?.depth26 ?? DEPTH26_TUNING', 'content?.depth26 ?? LATE_GAME_TUNING')).not.toBe(same); // code
    const world = 'src/content/world24-tuning.ts', worldText = readFileSync(join(REPO_ROOT, world), 'utf8');
    expect(worldText).toContain('GYM_LATE_BADGES_FROM = 4');
    expect(normalizeTraced(world, worldText.replace('GYM_LATE_BADGES_FROM = 4', 'GYM_LATE_BADGES_FROM = 5'))).not.toBe(normalizeTraced(world, worldText)); // a primitive export is not traceable
    expect(normalizeTraced(world, worldText.replace('gymLatePowerPercent: 70', 'gymLatePowerPercent: 75'))).toBe(normalizeTraced(world, worldText));
  });

  test('the traced modules are traceable: load-time code only declares, no import of theirs imports a traced module, units.ts copies are reviewed', () => {
    for (const entry of TRACED_MODULES.filter(item => files.includes(item.file))) expect(checkTracedModule(entry.file, readFileSync(join(REPO_ROOT, entry.file), 'utf8'))).toEqual([]);
    expect(checkTracedModule('src/content/x.ts', "import { DEPTH26_TUNING } from './depth-v26.ts';\nexport const A = { a: 1, late: DEPTH26_TUNING };\nconst H = A.a / 2;\n"
      + 'export const B = { b: DEPTH26_TUNING.npcBasePower };\nexport const f = () => A.a + H;\nA.a = 3;\nlet z = 1;'))
      .toEqual([expect.stringMatching(/:3: reads A/), expect.stringMatching(/:4: reads DEPTH26_TUNING/), expect.stringMatching(/:6: top-level ExpressionStatement/), expect.stringMatching(/:7: top-level let/)]);
    const units = 'src/content/units.ts', sites = copySites(units, readFileSync(join(REPO_ROOT, units), 'utf8'));
    expect(sites.filter(line => !INIT_COPY_SITES[units].includes(line)), 'a new or changed copy of a traced value in units.ts: review it, then add it to INIT_COPY_SITES (tools/test-plan-map.ts)')
      .toEqual([]);
    expect(sites.length).toBeGreaterThanOrEqual(6);
    expect(traceSafety(REPO_ROOT, context.graph)).toEqual([]);
    // Modules of a supported version must exist (pace-v27.ts is listed ahead of gameplay 27).
    expect(TRACED_MODULES.filter(entry => entry.version <= Math.max(...context.supported) && !files.includes(entry.file))).toEqual([]);
    expect(ruleShape(REPO_ROOT, context.graph)).toMatch(/^[0-9a-f]{24}$/);
  });

  test('end to end on d9b778f (conference NPC power, values only): v26 alone once traces are stored', () => {
    const source = { label: 't', base: '95b282e', head: 'd9b778f', files: ['src/content/depth-v26.ts'] };
    const inputs = traceInputs(context, source);
    expect(inputs.fallback).toBe('');
    const store = join(scratch, 'trace-store');
    const none = traceSelection(context.supported, source.files, all, inputs, store)!;
    expect(none.versions).toEqual(context.supported);
    expect(none.why).toMatch(/values-only change .*npcBasePower/);
    const reads = (version: number) => version >= 26 ? [NPC, LAND] : version >= 24 ? [LAND] : [];
    for (const version of context.supported) {
      storeTrace({ shape: inputs.baseShape!, version, values: inputs.baseValues!, cases: all, record: record(reads(version)), sha: '95b282e', node: process.version }, store);
    }
    expect(traceSelection(context.supported, source.files, all, inputs, store)!.versions).toEqual(context.supported.filter(version => version >= 26));
    expect(traceSelection(context.supported, source.files, [...QUICK_CASES], inputs, store)!.versions).toEqual(context.supported.filter(version => version >= 26));
    // A trace of another shape proves nothing; a code change is not values-only; the same tree twice changes nothing.
    expect(traceSelection(context.supported, source.files, all, { ...inputs, baseShape: 'other' }, store)!.versions).toEqual(context.supported);
    expect(traceInputs(context, { ...source, base: '677b1af1' }).fallback).toMatch(/not a values-only change/);
    expect(traceSelection(context.supported, source.files, all, traceInputs(context, { ...source, base: 'd9b778f' }), store))
      .toMatchObject({ versions: [], why: expect.stringMatching(/comments or formatting only/) });
  }, 180_000);

  test('the tracer reproduces the stored traces of a known commit (fixture regenerated with this tracer)', async () => {
    type Traced = { reads: string[]; global: string[]; initReaders: Record<string, number>; untraceable: string[] };
    const fixture = JSON.parse(readFileSync(join(REPO_ROOT, 'tests/tools/fixtures/content-trace-677b1af.json'), 'utf8')) as
      { commit: string; cases: (Traced & { version: number; index: number; rounds: number })[] };
    const tree = exportTree(fixture.commit);
    const run = (version: number, index: number, rounds: number) => new Promise<Traced>((resolveRun, reject) =>
      execFile(process.execPath, [join(REPO_ROOT, 'tools/content-trace.ts'), '--case', String(version), String(index), '--tree', tree, '--rounds', String(rounds)], { maxBuffer: 64 << 20 },
        (error, stdout) => error ? reject(error) : resolveRun(JSON.parse(stdout) as Traced)));
    const results = await Promise.all(fixture.cases.map(item => run(item.version, item.index, item.rounds)));
    fixture.cases.forEach((item, i) => {
      const { reads, global, initReaders, untraceable } = results[i];
      expect({ reads, global, initReaders, untraceable }, `gameplay ${item.version}`).toEqual({ reads: item.reads, global: item.global, initReaders: item.initReaders, untraceable: item.untraceable });
    });
    // What the data says: before v24 nothing traced is read; v24 reads world24 only (through its content copy); v26 reads depth26.
    const [v23, v24, v26] = results;
    expect(v23.reads).toEqual([]);
    expect(v24.reads.length).toBeGreaterThan(0);
    expect(v24.reads.every(key => key.startsWith('world24-tuning#'))).toBe(true);
    expect(v26.reads).toContain(NPC);
    expect(Object.keys(v26.initReaders)).toEqual(['src/content/units.ts']);
  }, 600_000);
});
