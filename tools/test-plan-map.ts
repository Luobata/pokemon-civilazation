/**
 * Reviewed mapping tables for tools/test-plan.ts: the parts of the plan that import graphs cannot decide.
 *
 * Everything that *can* be decided from imports (which vitest files, which specs import a changed module, whether a file is
 * in the rule closure of tools/district-smoke.ts) is computed by the planner; this file only lists what imports can't see:
 * browser specs drive the app by URL, CSS has no importer that a spec can see, and a few tests scan source text.
 *
 * Globs: `*` matches within one path segment, `**` across segments; source globs are repo-relative, spec globs are relative
 * to tests/browser. tests/tools/test-plan.test.ts checks that every glob here matches an existing file and that every
 * browser spec is reachable from some entry or from ALWAYS_SPECS.
 */

/** Fast browser specs that run whenever any browser spec runs: page load + every entry point, new game and the shell, end turn. */
export const ALWAYS_SPECS = ['entrypoints.spec.ts', 'shell.spec.ts', 'turn-and-rail.spec.ts'];

/** Every browser spec (the client's wiring: one change here can surface anywhere). */
const ALL = ['*.spec.ts'];
/** Map rendering, camera and anything drawn on the canvas. */
const MAP = ['map*.spec.ts', 'selection.spec.ts', 'combat-presentation.spec.ts', 'waypoints.spec.ts', 'performance.spec.ts', 'ui-painted.spec.ts',
  'terrain-v24.spec.ts', 'screen-scroll.spec.ts', 'tile-info.spec.ts', 'presentation-batch3.spec.ts'];
/** Specs that assert layout, overlay placement or screenshots: what a stylesheet change can break. */
const VISUAL = ['map-25d.spec.ts', 'ui-painted.spec.ts', 'ui-icons.spec.ts', 'screen-scroll.spec.ts', 'interaction-review.spec.ts', 'm6ui.spec.ts',
  'presentation-batch3.spec.ts', 'world-ui.spec.ts', 'playtest-fixes-*.spec.ts', 'unit-action-bar.spec.ts', 'combat-presentation.spec.ts', 'city-panel.spec.ts'];
const BATTLE = ['combat*.spec.ts', 'battle-evo.spec.ts', 'depth-v26-battles.spec.ts', 'presentation-batch3.spec.ts', 'strength.spec.ts',
  'playtest-fixes-a.spec.ts', 'playtest-fixes-b.spec.ts', 'gym-circuit.spec.ts', 'rivals.spec.ts', 'p3-ui.spec.ts'];
const UNITS = ['unit-action-bar.spec.ts', 'selection.spec.ts', 'promotions.spec.ts', 'roles.spec.ts', 'unit-classes.spec.ts', 'roster.spec.ts',
  'playtest-fixes-*.spec.ts', 'waypoints.spec.ts'];
const CITY = ['city-panel.spec.ts', 'districts.spec.ts', 'economy.spec.ts', 'expansion*.spec.ts', 'tile-info.spec.ts', 'improvements-v23.spec.ts',
  'city-network.spec.ts', 'dedications.spec.ts', 'playtest-fixes-2cd.spec.ts', 'opening.spec.ts'];
const RESEARCH = ['tech-tree.spec.ts', 'research-tasks.spec.ts', 'eras.spec.ts', 'gameplay-v2.spec.ts', 'era-honors.spec.ts', 'governments.spec.ts'];
const DIPLOMACY = ['diplomacy.spec.ts', 'leaders.spec.ts', 'playtest-fixes-2e.spec.ts', 'civ-glossary.spec.ts'];
const WORLD = ['world-ui.spec.ts', 'gym-circuit.spec.ts', 'rivals.spec.ts', 'late-game-v26.spec.ts', 'legends.spec.ts', 'regional-dex.spec.ts',
  'strength.spec.ts', 'era-honors.spec.ts', 'playtest-fixes-*.spec.ts', 'presentation-batch3.spec.ts', 'depth-v26-battles.spec.ts'];
const NOTICES = ['turn-feedback.spec.ts', 'interaction-review.spec.ts', 'presentation-batch3.spec.ts', 'playtest-fixes-2.spec.ts'];
const NETWORK = ['entrypoints.spec.ts', 'expansion.spec.ts', 'eras.spec.ts', 'map-25d.spec.ts', 'crossenv.spec.ts'];
const GUIDE = ['guide.spec.ts', 'civ-glossary.spec.ts', 'roles.spec.ts', 'unit-classes.spec.ts'];

export type SpecRule = { files: string[]; specs: string[]; why: string };

/**
 * Client source → browser specs. A changed file collects the specs of every rule it matches. A client file (src/browser,
 * src/app, src/*.css, *.html, public) that matches no rule runs ALL specs and the plan says so: add a rule.
 */
export const SPEC_RULES: SpecRule[] = [
  { files: ['src/browser/main.ts', 'src/browser/screens.ts', 'src/app/**', 'index.html'], specs: ALL,
    why: 'game page wiring: every spec loads it' },
  { files: ['src/browser/render/**', 'src/browser/canvas.ts', 'src/browser/camera.ts', 'src/browser/terrain.ts', 'src/browser/map-icons.ts',
    'src/browser/sprites.ts', 'src/browser/building-art.ts', 'src/browser/site-pins.ts', 'src/browser/city-sites.ts', 'src/browser/tile-coords.ts',
    'src/browser/ambient-transitions.ts'], specs: MAP, why: 'map rendering' },
  { files: ['src/browser/theme.ts'], specs: [...MAP, ...VISUAL], why: 'theme switch (pixel / painted)' },
  { files: ['src/browser/audio/**', 'src/browser/music-director.ts'], specs: ['audio.spec.ts', 'combat-presentation.spec.ts'], why: 'audio' },
  { files: ['src/browser/battle-*.ts', 'src/browser/lineup-picker.ts', 'src/browser/matchup-grid.ts', 'src/browser/evolution-panel.ts',
    'src/browser/combat-preview.ts', 'src/browser/target-preview.ts', 'src/browser/attack-reason.ts', 'src/browser/capture-reason.ts',
    'src/browser/action-targets.ts'], specs: BATTLE, why: 'battle presentation and previews' },
  { files: ['src/browser/unit-panel.ts', 'src/browser/unit-action-bar.ts', 'src/browser/selection-panel.ts', 'src/browser/promotion-panel.ts'],
    specs: UNITS, why: 'unit panels' },
  { files: ['src/browser/waypoints.ts', 'src/browser/world-goto.ts', 'src/browser/client-plans.ts'], specs: ['waypoints.spec.ts', 'playtest-fixes-2.spec.ts', 'world-ui.spec.ts'],
    why: 'waypoints and travel orders' },
  { files: ['src/browser/district-panel.ts', 'src/browser/economy-panel.ts', 'src/browser/expansion-panel.ts', 'src/browser/tile-panel.ts',
    'src/browser/tile-info.ts', 'src/browser/tile-yields.ts', 'src/browser/ball-stock.ts', 'src/browser/dex-owned.ts'], specs: CITY, why: 'city and tile panels' },
  { files: ['src/browser/research-panel.ts', 'src/browser/research-card.ts', 'src/browser/tech-tree-panel.ts', 'src/browser/tech-info.ts',
    'src/browser/tree-links.ts', 'src/browser/unlock-icons.ts', 'src/browser/era-panel.ts', 'src/browser/policy-panel.ts'], specs: RESEARCH,
    why: 'research, eras and charters' },
  { files: ['src/browser/diplomacy-panel.ts', 'src/browser/leader-panel.ts', 'src/browser/civ-names.ts', 'src/browser/civ-hint.ts'], specs: DIPLOMACY,
    why: 'diplomacy, leaders and civ hints' },
  { files: ['src/browser/world-cards.ts', 'src/browser/gym-panel.ts', 'src/browser/league-*.ts', 'src/browser/rival-tracker.ts', 'src/browser/late-game-ui.ts',
    'src/browser/legend-panel.ts', 'src/browser/challenge-card.ts', 'src/browser/event-tracks.ts', 'src/browser/neutral-panel.ts', 'src/browser/victory-*.ts',
    'src/browser/outcome-panel.ts', 'src/browser/regional-dex-panel.ts', 'src/browser/strength-panel.ts'], specs: WORLD, why: 'world, league and late-game panels' },
  { files: ['src/browser/notification-rail.ts', 'src/browser/notifications.ts', 'src/browser/turn-button.ts'], specs: NOTICES, why: 'turn flow and notifications' },
  { files: ['src/browser/ui-icons.ts', 'src/browser/effect-icons.ts', 'src/browser/ui-tip.ts'], specs: ['ui-icons.spec.ts', 'ui-painted.spec.ts', 'tile-info.spec.ts'],
    why: 'icons and tooltips' },
  { files: ['src/browser/audit.ts', 'src/audit/**', 'audit.html', 'src/audit.css'], specs: ['audit.spec.ts'], why: 'audit page' },
  { files: ['src/browser/editor.ts', 'src/editor/**', 'editor.html', 'src/editor.css'], specs: ['entrypoints.spec.ts', 'expansion.spec.ts'], why: 'editor page' },
  { files: ['src/browser/multiplayer.ts', 'src/network/**', 'server/**', 'multiplayer.html', 'src/multiplayer.css'], specs: NETWORK, why: 'multiplayer page and server' },
  { files: ['src/guide/**', 'guide.html', 'src/guide.css'], specs: GUIDE, why: 'guide page' },
  { files: ['src/*.css'], specs: VISUAL, why: 'stylesheets: layout, overlays and screenshots' },
  { files: ['src/battle-viewer.css', 'src/evolution-panel.css', 'src/lineup.css', 'src/league*.css'], specs: BATTLE, why: 'battle stylesheets' },
  { files: ['src/world-ui.css', 'src/late-game.css', 'src/research-tasks.css'], specs: WORLD, why: 'world stylesheets' },
  { files: ['src/waypoints.css'], specs: ['waypoints.spec.ts'], why: 'waypoint stylesheet' },
  { files: ['src/leaders.css', 'src/leader-doctrines.css', 'src/civ-hint.css'], specs: DIPLOMACY, why: 'leader stylesheets' },
  { files: ['src/ui-25d.css', 'src/painted.css'], specs: MAP, why: '2.5D / painted map stylesheets' },
  { files: ['public/sprites/**'], specs: ['selection.spec.ts', 'roster.spec.ts', 'battle-evo.spec.ts', 'regional-dex.spec.ts', 'combat-presentation.spec.ts'],
    why: 'sprites' },
  { files: ['public/buildings/**'], specs: ['ui-icons.spec.ts', 'map-25d.spec.ts', 'ui-painted.spec.ts'], why: 'building art' },
  { files: ['public/leaders/**'], specs: ['leaders.spec.ts', 'diplomacy.spec.ts'], why: 'leader portraits' },
  // Rule / AI modules whose numbers the page shows; a spec that imports the module is already selected by the import graph.
  { files: ['src/content/economy.ts', 'src/content/balance.ts', 'src/content/terrain.ts', 'src/core/economy*.ts', 'src/core/city.ts', 'src/core/terrain.ts'],
    specs: ['economy.spec.ts', 'city-panel.spec.ts', 'tile-info.spec.ts', 'districts.spec.ts', 'improvements-v23.spec.ts'], why: 'yields and city numbers shown in panels' },
  { files: ['src/core/combat*.ts', 'src/core/strength.ts', 'src/core/team-battle*.ts', 'src/core/preview.ts', 'src/content/combat.ts'],
    specs: ['combat*.spec.ts', 'strength.spec.ts', 'battle-evo.spec.ts', 'depth-v26-battles.spec.ts'], why: 'combat numbers and previews shown in the page' },
  { files: ['src/content/tech-tree.ts', 'src/core/tech-tree.ts', 'src/content/eras.ts', 'src/content/research-tasks.ts', 'src/core/research-tasks.ts'],
    specs: RESEARCH, why: 'research costs and unlocks shown in the page' },
  { files: ['src/content/leaders.ts', 'src/core/diplomacy.ts', 'src/core/leader-*.ts'], specs: DIPLOMACY, why: 'leader and diplomacy numbers' },
  { files: ['src/content/gym-circuit.ts', 'src/content/rivals.ts', 'src/content/world24-tuning.ts', 'src/content/depth-v26.ts', 'src/core/gym-circuit.ts',
    'src/core/rivals.ts', 'src/core/rival-duels.ts', 'src/core/legends.ts', 'src/content/legend-*.ts'], specs: WORLD, why: 'world-system numbers shown in panels' },
  { files: ['src/content/civ-glossary.ts'], specs: GUIDE, why: 'glossary terms shown in the guide' },
  { files: ['src/content/units.ts', 'src/content/species.ts', 'src/content/roster*.ts', 'src/content/regional-dex.ts', 'src/core/promotions.ts', 'src/core/unit*.ts'],
    specs: ['roster.spec.ts', 'regional-dex.spec.ts', 'selection.spec.ts', 'promotions.spec.ts', 'unit-classes.spec.ts'], why: 'unit stats shown in panels' },
];

/** Changed files that also need the production-build e2e (tests/browser-prod: CSS bundle order, overlay placement). */
export const PROD_TRIGGERS = ['src/*.css', '*.html', 'src/browser/screens.ts', 'src/browser/main.ts', 'src/browser/*-panel.ts', 'src/browser/notification-rail.ts',
  'src/browser/unit-action-bar.ts', 'src/browser/battle-viewer.ts', 'src/browser/lineup-picker.ts', 'src/browser/late-game-ui.ts', 'src/browser/world-cards.ts'];

/** Any of these changed → the whole old gate (build, lint, every vitest file, every spec, prod e2e, smoke for every version). */
export const FULL_TRIGGERS = ['package.json', 'package-lock.json', 'tsconfig*.json', 'eslint.config.js', 'vite.config.ts', 'vitest.config.*', 'playwright*.config.ts',
  'tools/test-plan.ts', 'tools/test-plan-map.ts', 'tools/smoke-parallel.ts', 'tools/content-trace.ts', '.npmrc', '.nvmrc'];

/** Documentation: no checks (no markdown linter is configured). Files a test or the page reads (public/**) are not docs. */
export const DOC_FILES = ['docs/**', '**/*.md', 'LICENSE*', '.gitignore', '.claude/**'];

/**
 * Tests that read source text with fs (not an import): the graph cannot see these edges.
 * civ-glossary.test scans every src/browser/*.ts for civHint('…') calls; test-plan.test reads the content-trace fixture.
 */
export const VITEST_TEXT_DEPENDENCIES: { files: string[]; tests: string[] }[] = [
  { files: ['src/browser/*.ts'], tests: ['tests/core/civ-glossary.test.ts'] },
  { files: ['tests/tools/fixtures/content-trace-*.json'], tests: ['tests/tools/test-plan.test.ts'] },
];

/**
 * Rule files that can only change smoke results of gameplay versions ≥ `from`. Reviewed by hand: rules reach these files only
 * through `importers` (checked by tests/tools/test-plan.test.ts: a new importer in the rule closure fails the test and needs a
 * new review). A module that throws at load would break every version, but the narrowed set always contains a version that
 * loads it, so the failure still shows.
 */
export const VERSION_SCOPED: { file: string; from: number; importers: string[]; why: string }[] = [
  { file: 'src/content/regional-dex.ts', from: 25, importers: ['src/content/units.ts'],
    why: 'units.ts uses it only to build REGIONAL_CONTENT / DEPTH_CONTENT and the dex draws, which contentFor / contentForView pick only for gameplay ≥ 25' },
  { file: 'src/content/stone-evolutions.ts', from: 25, importers: ['src/content/regional-dex.ts'], why: 'only regional-dex.ts reads it' },
  { file: 'src/content/roster-v26-data.ts', from: 25, importers: ['src/content/units.ts', 'src/content/regional-dex.ts'],
    why: 'units.ts: v26 species only (depthSpecies); regional-dex.ts: ALL_SPECIES_TAGS can override a v25 tag, so v25 too' },
];

/**
 * Tuning modules the content read tracer instruments (tools/content-trace.ts). A change that only edits literal values inside their
 * exported objects keeps the rule shape (tools/test-plan.ts `ruleShape`), so a stored trace of the same shape proves which gameplay
 * versions can observe it. `blocks`: the content key that carries a copy of an export (src/content/units.ts copies it into the stock
 * contents, `INIT_COPY_READERS`); `flags`: the export whose keys are spread onto the content as feature flags. `version` is only
 * documentation (the module's gameplay version); the proof never relies on it. A module that does not exist yet is skipped.
 */
export const TRACED_MODULES: { file: string; version: number; blocks: Record<string, string>; flags?: string }[] = [
  { file: 'src/content/world24-tuning.ts', version: 24, blocks: { world24: 'WORLD24_TUNING' } },
  { file: 'src/content/depth-v26.ts', version: 26, blocks: { depth26: 'DEPTH26_TUNING' }, flags: 'DEPTH_FLAGS' },
  { file: 'src/content/pace-v27.ts', version: 27, blocks: { pace27: 'PACE27_TUNING' }, flags: 'PACE_FLAGS' },
];

/**
 * Reviewed copy sites of traced values in src/content/units.ts (tools/test-plan.ts `copySites`; checked by tests/tools/test-plan.test.ts).
 * The tracer instruments the stock contents' blocks under the name of what they copy, which is right only while every copy is a
 * same-named block of a content that is, or is spread from, a stock content (STOCK_CONTENTS). Reviewed 2026-11-20: WORLD24_CONTENT
 * clones WORLD24_TUNING; REGIONAL_CONTENT clones that block with v25 rival offsets; depthOverlay clones the base block with v26 offsets and
 * early gym powers (same keys, over-approximated by name) and DEPTH26_TUNING, and spreads DEPTH_FLAGS onto the content. A changed or new
 * line (a v27 `pace27` overlay, a copy into a non-stock object) needs the same review before it is added here.
 */
export const INIT_COPY_SITES: Record<string, string[]> = {
  'src/content/units.ts': [
    'world24: JSON.parse(JSON.stringify(WORLD24_TUNING)) as typeof WORLD24_TUNING };',
    'world24: { ...JSON.parse(JSON.stringify(WORLD24_CONTENT.world24)) as World24Tuning, rivalStrengthOffsets: [...RIVAL_RULES_V25.strengthOffsets],',
    'const depthOverlay = (base: Content): Content => ({ ...base, version: \'depth-v26\', ...DEPTH_FLAGS,',
    'world24: { ...JSON.parse(JSON.stringify(base.world24)) as World24Tuning, rivalStrengthOffsets: [...RIVAL_RULES_V26.strengthOffsets],',
    'gymTeamPower: (base.world24?.gymTeamPower ?? []).map((power, badges) => GYM_RULES_V26.earlyTeamPower[badges] ?? power) },',
    'depth26: JSON.parse(JSON.stringify(DEPTH26_TUNING)) as Depth26Tuning });',
    // Reviewed ahead of the v27 merge (branch commit 6721019): paceOverlay clones the same-named blocks of its base and PACE27_TUNING and
    // spreads PACE_FLAGS; PACE_CONTENT is in STOCK_CONTENTS, per-game overlays are built during v27 games (recorded there).
    'const paceOverlay = (base: Content): Content => ({ ...base, version: \'pace-v27\', ...PACE_FLAGS,',
    'world24: JSON.parse(JSON.stringify(base.world24)) as World24Tuning, depth26: JSON.parse(JSON.stringify(base.depth26)) as Depth26Tuning,',
    'pace27: JSON.parse(JSON.stringify(PACE27_TUNING)) as Pace27Tuning });',
  ],
};

/** Balance knobs (tools/patch.ts leaves) worth sweeping when these files change. */
export const BALANCE_KNOBS: { files: string[]; params: string[] }[] = [
  { files: ['src/ai/**'], params: ['ai.aggressiveWarStrength=1250,1500,1750', 'ai.conservativeStrength=…', 'ai.expansionSiegeStrength=…'] },
  { files: ['src/content/balance.ts', 'src/core/city.ts', 'src/core/combat*.ts'], params: ['balance.city.defense=40,50,60', 'balance.city.baseHp=…'] },
  { files: ['src/content/economy.ts', 'src/content/terrain.ts', 'src/core/economy*.ts'], params: ['biomes.<biome>.<yield>=…', 'buildings.<id>.cost=…'] },
  { files: ['src/content/tech-tree.ts', 'src/core/tech-tree.ts', 'src/core/research-tasks.ts'], params: ['techs.<id>.cost=…'] },
  { files: ['src/content/species.ts', 'src/content/units.ts', 'src/content/roster*.ts'], params: ['species.<id>.attack=…', 'species.<id>.hp=…'] },
  { files: ['src/content/world24-tuning.ts', 'src/core/gym-circuit.ts', 'src/core/rivals.ts'], params: ['world24.gymTeamPower.0=…', 'world24.rivalArrivals.0=…'] },
  { files: ['src/content/depth-v26.ts', 'src/core/contest-seasons.ts', 'src/core/gold-sinks.ts', 'src/core/raids.ts'], params: ['depth26.gymPowerPercent=…', 'depth26.late.seasonInterval=…'] },
];

/** Rough wall-clock cost model (seconds) for the estimate line; measured on the shared 64-core box under load (docs/tech/testing.md). */
export const COST = {
  tsc: 75, eslintFile: 0.6, eslintAll: 70, viteBuild: 60,
  /** Full vitest run 2026-11-20: 122 files, 715 file-seconds, 122 s wall with 16 workers (≈ startup + sum / 8). */
  vitestStartup: 15, vitestDefaultFile: 3, vitestParallel: 8,
  vitestHeavy: { 'tests/core/regional-dex-game.test.ts': 86, 'tests/tools/balance-run.test.ts': 69, 'tests/core/team-battle.test.ts': 41,
    'tests/core/dedications.test.ts': 41, 'tests/tools/district-preview-check.test.ts': 39, 'tests/core/improvements-v23-ai.test.ts': 28,
    'tests/ai/memory.test.ts': 26, 'tests/core/legends.test.ts': 25, 'tests/core/roster.test.ts': 23, 'tests/tools/leader-balance.test.ts': 23 } as Record<string, number>,
  /** Per browser test under load, 4 Playwright workers (the old gate's default 32 workers caused load timeouts). */
  playwrightStartup: 25, playwrightTest: 16, playwrightWorkers: 4,
  prodE2e: 150,
  /** One smoke game (24×16, 100 rounds) took 30–110 s under load; 48 games per version, twice (base + head) unless the base is cached. */
  smokeGame: 60, smokeGamesPerVersion: 48, smokeRuns: 2, smokeWorkers: 16,
};
