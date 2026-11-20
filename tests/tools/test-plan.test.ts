import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import viteConfig from '../../vite.config.ts';
import { ALWAYS_SPECS, BALANCE_KNOBS, FULL_TRIGGERS, PROD_TRIGGERS, SPEC_RULES, VERSION_SCOPED, VITEST_TEXT_DEPENDENCIES } from '../../tools/test-plan-map.ts';
import { BROWSER_SPECS, buildGraph, closure, globToRegExp, loadContext, parseCli, planFor, planSteps, REPO_ROOT, RULE_ENTRIES, VITEST_INCLUDE } from '../../tools/test-plan.ts';
import type { Plan } from '../../tools/test-plan.ts';
import { checkSignature, compareSmoke, parseSmokeArgs, smokeConfig, supportedVersions } from '../../tools/smoke-parallel.ts';

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
    expect(() => parseCli(['--commit', 'a', '--files', 'x'])).toThrow();
    expect(() => parseCli(['--bogus'])).toThrow();
    expect(parseSmokeArgs(['--versions', '24-26', '--workers', '3', '--allow-diff', '27'], 64)).toMatchObject({ versions: [24, 25, 26], workers: 3, allowDiff: [27], base: 'main' });
    expect(parseSmokeArgs(['--no-base'], 64)).toMatchObject({ base: null, versions: 'all', workers: 16 });
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
  });

  test('steps: changed-file eslint, explicit vitest files, Playwright with few workers, smoke against the base', () => {
    const p = planFor(context, { label: 't', base: 'abc123', files: ['src/content/stone-evolutions.ts'] });
    const steps = planSteps(p, { pwWorkers: 2 }).map(step => `${step.name}: ${step.args.join(' ')}`);
    expect(steps.find(step => step.startsWith('eslint'))).toMatch(/eslint --no-warn-ignored src\/content\/stone-evolutions\.ts$/);
    expect(steps.find(step => step.startsWith('playwright'))).toMatch(/--workers=2/);
    const versions = context.supported.filter(version => version >= 25).join(',');
    expect(steps.find(step => step.startsWith('smoke'))).toContain(`tools/smoke-parallel.ts --versions ${versions} --base abc123`);
  });
});
