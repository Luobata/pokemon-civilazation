# Expansion Core Independent Review

- Review session/run: `expansion-20261101` / `core-3`
- Reviewer role: independent correctness reviewer
- Reviewed at: 2026-11-01 20:11:22 +08:00
- Repository: `/Users/bytedance/luobata/pokemon-civilazation`
- Branch: `codex/system-audit`
- Base ref: `adb8ac10c1e755202cfa42ee63a615562253a441`
- Head ref: `adb8ac10c1e755202cfa42ee63a615562253a441`
- Review target: current working tree (staged and relevant untracked paths), narrowed to core plus the direct caller boundary repaired in this run
- Dirty state at review: 98 staged files, 0 unstaged files, 23 untracked files
- Verdict: **pass_with_risk**

This review closes the two original core blockers and the later expansion-only caller-content blocker. It also records final balance and browser evidence. It does not replace dedicated browser/UI, editor, network, asset, deployment, or long-term balance reviews.

## Source fingerprint

**SHA-256:** `3d883891203689f2952bf474c2181f38c769ae103d6f541654aa7f0991f4db8b`

Method: select the 43 source/test paths below from staged, unstaged, and untracked state, sort by exact repository-relative path, hash each file with SHA-256, emit one `<file-sha256>  <path>\n` line per file, then SHA-256 the UTF-8 manifest. Delivery documentation and this report are excluded.

Fingerprint path scope:

- `src/ai/plan.ts`
- changed files below `src/app/`
- `src/audit/commands.ts`
- `src/browser/economy-panel.ts`
- changed files below `src/content/`
- changed files below `src/core/`
- `src/network/contract.ts`
- `tests/browser/expansion-content.spec.ts`
- changed files below `tests/core/`
- `tests/network/action-content.test.ts`
- `tests/tools/leader-balance.test.ts`
- `tools/leader-balance.ts`

Other browser/UI source, server implementation, styles, assets, build configuration, and delivery documentation remain outside this fingerprint. They are exercised by full-repository checks recorded below, but were not independently line-reviewed as whole subsystems here.

## Resolved blockers

### CORE-BLOCK-01 — Engineer phantom production no longer transfers to a city captor

Verified fix:

- `src/core/civilization-systems.ts:105` stores `{ playerId, amount }` in `pendingProductionByCity`.
- Activation records the acting owner at `src/core/civilization-systems.ts:633-637`.
- Consumption validates that the pending owner still owns the city and clears stale state at `src/core/civilization-systems.ts:691-706`.
- Actual capture clears the entry at `src/core/combat.ts:117-118`.
- `tests/core/expansion-integration.test.ts:29-51` follows activation, `DeclareWar`, real `Attack`, capture, and full round resolution; the captor does not consume the original owner's +40 bonus.

### CORE-BLOCK-02 — `m3-v1` is pinned to immutable base content

Verified fix:

- `src/content/legacy-species.ts:4-5` pins the base `adb8ac1` table.
- `src/content/units.ts:26-34` builds `CONTENT` (`m3-v1`) from `LEGACY_SPECIES`; `src/content/units.ts:35-51` builds the 47-species dual-type pack separately as `EXPANSION_CONTENT` (`expansion-v1`).
- Independent canonical comparison against `/tmp/pokemon-review-base-adb8ac1/src/content/species.ts` found identical order and values. Both legacy tables hash to `51f734c6cdf29e822c2b958d6272d2bf4ea41a27569a11ce8ddbc1ce739bfee8`.
- Independent expansion-content hashing produced `68224504087ac1c0e9d5214161754e6744374c367b547a17b3b7e796fad781b9`.
- `tests/core/legacy-content.test.ts:15-37` pins both counts and hashes.
- Base/current 20-EndTurn canonical replay hashes match exactly: initial `c3cadda29b648e545f6111af96c8fb0650da3caddac090494aa5ecd618b28c75`, final `42f1e9e12cb5529b92812f42ccee1963ef1a7bcbf3cf9276fc4a44716b705aaf`.

### CORE-BLOCK-03 — Expansion-only species work through omitted-content callers

The late repro showed that `reachablePaths(view)` defaulted to legacy `CONTENT`, so an expansion-only species such as `magnemite` crashed while reading its move definition; UI, multiplayer, and audit callers that omitted the content argument were affected. A related UI path displayed expansion production costs through the legacy default and could render `undefined` or `NaN`.

Verified fix:

- `src/core/movement.ts:14-15` makes `initialUnitPosition` infer expansion content from `state.setup.expansionVersion`.
- `src/core/movement.ts:26-27` makes `reachablePaths` infer expansion content from `view.expansion`.
- `src/ai/plan.ts:29-33` makes personality capture use expansion content for an expansion view while preserving an explicit custom query content override.
- `src/core/leader-systems.ts:27-28`, `:40-41`, and `:90-91` apply the same default inference to leader validation, application, and planning.
- `src/browser/economy-panel.ts:35` selects stock content from the view, and `:80`, `:83`, and `:112` pass that content to every `productionCost` call.
- `tests/core/expansion-callers.test.ts:19-129` contains six regressions: real expansion-only `Move`, explicit custom content precedence, classic movement equivalence, expansion initial placement, expansion/canonical AI capture behavior, and leader default/explicit equivalence.
- `tests/browser/expansion-content.spec.ts:91` imports a real legal captured-`magnemite` fixture, selects and moves it through the browser, verifies the production cost and queue, opens the movement audit view, and rejects `undefined`/`NaN` or page errors.

The focused caller suite, real browser flow, full unit suite, lint, tools lint, and build all pass on the final fingerprint.

## Final balance evidence

The final 240-run balance rerun completed before the default-only caller repair: train seeds 1–10 and held-out seeds 11–20 each ran 120 games, with 0 defects, 0 aborts, and 0 exceptions. Both acceptance batches passed.

- Train win shares: oak 24.17%, lance 27.50%, jenny 27.50%, joy 20.83%; spread 6.67 points.
- Held-out win shares: oak 30.00%, lance 23.33%, jenny 21.67%, joy 25.00%; spread 8.33 points.
- Artifacts: `docs/design/data/leader-expansion-train-seeds1-10.json` (`641d3652cb2d9814828729b59b5c6183eb70841223c8c1c24efd5fb94e320044`) and `docs/design/data/leader-expansion-holdout-seeds11-20.json` (`35c12b8dd80e7fd631976bceb6c6a26ed9efc3852e923cc730aa788291f7473f`).

The caller repair does not invalidate those numeric paths: the balance harness passed `EXPANSION_CONTENT` explicitly through `planNext` and `step`, and the AI paths, leader calls, and capture judgment retained that explicit branch. The final report therefore records this time boundary and equivalence rather than claiming that the 240 games were rerun after the caller fix.

## Evidence

Independently rerun on fingerprint `3d883891203689f2952bf474c2181f38c769ae103d6f541654aa7f0991f4db8b`:

- `npx vitest run tests/core/expansion-callers.test.ts tests/core/species-movement.test.ts tests/core/recovery.test.ts tests/core/game.test.ts tests/core/expansion-integration.test.ts tests/core/legacy-content.test.ts tests/network/action-content.test.ts` — passed: 7 files / 67 tests.
- `npx playwright test tests/browser/expansion-content.spec.ts` — passed: 1/1 real browser selection, movement, production, and audit flow.
- `npx vitest run` — passed: 43 files / 395 tests.
- `npm run lint` — passed.
- `npm run lint:tools` — passed.
- `npm run build` — passed: root TypeScript check, core TypeScript check, and Vite production build.
- Content comparison/hashing and the deterministic legacy replay were verified during this review; the caller repair did not alter either content table.

Root final evidence:

- Full browser suite: 60/60 passed.
- Late-game Canvas performance p95: 1.4 ms, 1.4 ms, and 2.0 ms across the three measured scenes.
- QualityGate predecessor fingerprint `qgcf_3934279045c5f1d3c4824f2987d2e96ea38bebedf7c47bf1625395a17ef7ded1` completed with 3 JSON targets, 2 model shards, 0 findings, and 0 rejected findings. Its configured rules had no matched script rule and empty TS coverage; Mutation was disabled. Root records refreshed delivery/QG references separately. This report does not use QualityGate as TS game-logic coverage or as a pending core gate.

## Remaining risks

1. QualityGate has no matched script rule, TS rule coverage is empty, and Mutation is disabled; its clean JSON result cannot be counted as independent TS game-logic review.
2. The 240-game balance dataset is deterministic and small, with correlated four-seat rotations and mostly score-limited endings. It is pre-registered simulation evidence, not long-term balance proof.
3. Browser/editor/network subsystems have strong integration results, but their complete implementations remain under dedicated reports rather than this core line review.

## Review record

```json
{
  "schema_version": "independent-reviewer.v1",
  "review_status": "pass_with_risk",
  "repo": {
    "path": "/Users/bytedance/luobata/pokemon-civilazation",
    "execution_location": "local",
    "branch": "codex/system-audit",
    "base_ref": "adb8ac10c1e755202cfa42ee63a615562253a441",
    "head_ref": "adb8ac10c1e755202cfa42ee63a615562253a441",
    "dirty_state": { "staged": 98, "unstaged": 0, "untracked": 23 }
  },
  "review": {
    "session_id": "expansion-20261101",
    "run_id": "core-3",
    "source_fingerprint": "3d883891203689f2952bf474c2181f38c769ae103d6f541654aa7f0991f4db8b",
    "fingerprint_path_count": 43,
    "scope": "core/content/AI/app boundary plus direct movement, leader, economy-panel caller regressions"
  },
  "reviewer_agents": [
    {
      "agent_id": "/root/independent_core_review",
      "role": "general-reviewer",
      "lifecycle": "reused",
      "verdict": "pass_with_risk",
      "bound_scope": "three core blockers, immutable content, direct caller defaults, deterministic replay, final balance boundary"
    }
  ],
  "resolved_findings": [
    {
      "id": "CORE-BLOCK-01",
      "title": "Engineer phantom production transfers to a city captor",
      "resolution": "pending production records and validates its activating owner; actual capture clears it"
    },
    {
      "id": "CORE-BLOCK-02",
      "title": "m3-v1 content pack is mutated under the same version",
      "resolution": "m3-v1 uses the immutable base 39-species table; expansion-v1 uses a separate 47-species table"
    },
    {
      "id": "CORE-BLOCK-03",
      "title": "Expansion-only species crash or degrade through omitted-content callers",
      "resolution": "movement, AI capture, leader entries, and economy-panel costs infer stock expansion content while preserving explicit custom content"
    }
  ],
  "checks": [
    { "name": "focused-callers", "status": "passed", "command": "npx vitest run tests/core/expansion-callers.test.ts tests/core/species-movement.test.ts tests/core/recovery.test.ts tests/core/game.test.ts tests/core/expansion-integration.test.ts tests/core/legacy-content.test.ts tests/network/action-content.test.ts", "result": "7 files / 67 tests passed" },
    { "name": "browser-expansion-content", "status": "passed", "command": "npx playwright test tests/browser/expansion-content.spec.ts", "result": "1/1 passed" },
    { "name": "unit", "status": "passed", "command": "npx vitest run", "result": "43 files / 395 tests passed" },
    { "name": "lint", "status": "passed", "command": "npm run lint" },
    { "name": "lint-tools", "status": "passed", "command": "npm run lint:tools" },
    { "name": "build", "status": "passed", "command": "npm run build" },
    { "name": "browser-full", "status": "passed", "command": "root final Playwright run", "result": "60/60 passed; performance p95 1.4/1.4/2.0 ms" },
    { "name": "balance-final", "status": "passed", "command": "root leader-balance final rerun before caller fix", "result": "120 train + 120 held-out completed; 20 map seeds; 0 defects/aborts/exceptions; explicit expansion-content simulation path unchanged by caller fix" },
    { "name": "qualitygate-json", "status": "completed_predecessor", "command": "root dual-semantic bundle", "result": "3 JSON targets; 2 shards; 0 findings; 0 rejected; no matched script rule; TS coverage empty; Mutation disabled" }
  ],
  "next_actions": [],
  "residual_risks": [
    "QualityGate does not provide matched TS rules or Mutation coverage.",
    "The 240-run balance sample is deterministic, small, and correlated.",
    "Browser/editor/network implementation reviews remain dedicated subsystem reports."
  ]
}
```
