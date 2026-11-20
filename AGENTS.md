# Notes for agents

## Test gate

- Run `npm run check` before every commit while you work. It computes the checks this branch needs (merge-base with `main` up to HEAD, plus the working tree) and runs only those: tsc, eslint on the changed files, the related vitest files, the mapped Playwright specs, the production-build e2e when CSS, html or layout changes, and `tools/smoke-parallel.ts` for the gameplay versions the rules can reach. Its smoke is a QUICK sample (8 of the 48 games per version) and is labelled `QUICK — not merge-proof`. Use `npm run check:plan` to see the plan and its reasons without running it.
- Before merging to `main`, `npm run check:merge` must pass. It makes the same selection but runs all 48 smoke games for every selected version and compares them byte for byte with the base. The byte-identical guarantee comes only from this tier (or from full / release). Quote its result, not the quick one, in a merge report.
- Run `npm run check:full` instead of `check:merge` when the plan says `FULL GATE`. That happens when package.json, the lockfile, a tsconfig, the eslint/vite/playwright config or the planner and its tracer (`tools/test-plan*.ts`, `tools/smoke-parallel.ts`, `tools/content-trace.ts`) changed. Also run it when you flip a global default such as the renderer or theme.
- Run `npm run check:release` for releases and gameplay-version flips (`LATEST_GAMEPLAY_VERSION`). It runs everything, then prints the 216-game balance-gate commands to run by hand.
- Never start the 216-game balance gate (`tools/balance-run.ts --preset gate`) on your own. When rule or AI files change, the plan recommends a 54-game `balance-sweep` with the relevant knobs. Run it if the change is meant to move balance.
- The planner can only narrow smoke versions when it can prove it. Two cases qualify:
  - `VERSION_SCOPED` files.
  - Changes that only edit literal values in a tuning module (`TRACED_MODULES`: `world24-tuning.ts`, `depth-v26.ts`, `pace-v27.ts`), backed by stored content-read traces of the same rule shape (see [docs/tech/testing.md](docs/tech/testing.md)).

  Without a stored trace it runs every version and says `no stored trace`. The next traced smoke of that shape (any `check:merge`) records one.
- `--smoke-versions` narrows smoke by hand. The plan then marks the result as `NOT PROVEN`, so say so in your report.
- If `tests/tools/test-plan.test.ts` fails on `INIT_COPY_SITES`, you changed a line in `src/content/units.ts` that copies tuning values, for example a new `pace27` overlay. Check that it copies a block of the same name into a stock content, then add the line to the table in `tools/test-plan-map.ts`.
- A new browser spec or client module needs a row in `tools/test-plan-map.ts` (`SPEC_RULES`). `tests/tools/test-plan.test.ts` fails on orphaned specs.
- This machine is shared, so keep worker counts modest (`--pw-workers`, `--smoke-workers`), and stop every process you start.
