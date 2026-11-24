# Notes for agents

## Test gate

- Run `npm run check` before every commit while you work. It computes the checks this branch needs (merge-base with `main` up to HEAD, plus the working tree) and runs only those: tsc, eslint on the changed files, the related vitest files, the mapped Playwright specs, the production-build e2e when CSS, html or layout changes, and `tools/smoke-parallel.ts` when rule/AI code changes. Its smoke is a QUICK sample (8 of the 48 v27 games) and is labelled `QUICK — not merge-proof`. Use `npm run check:plan` to see the plan and its reasons without running it.
- Before merging to `main`, `npm run check:merge` must pass. It makes the same selection but runs all 48 v27 smoke games and compares them byte for byte with the base. The byte-identical guarantee comes only from this tier (or from full / release). Quote its result, not the quick one, in a merge report.
- Run `npm run check:full` instead of `check:merge` when the plan says `FULL GATE`. That happens when package.json, the lockfile, a tsconfig, the eslint/vite/playwright config or the planner (`tools/test-plan*.ts`, `tools/smoke-parallel.ts`) changed. Also run it when you flip a global default such as the renderer or theme.
- Run `npm run check:release` for releases. It runs everything, then prints the 216-game balance-gate commands to run by hand.
- Never start the 216-game balance gate (`tools/balance-run.ts --preset gate`) on your own. When rule or AI files change, the plan recommends a 54-game `balance-sweep` with the relevant knobs. Run it if the change is meant to move balance.
- A new browser spec or client module needs a row in `tools/test-plan-map.ts` (`SPEC_RULES`). `tests/tools/test-plan.test.ts` fails on orphaned specs.
- This machine is shared, so keep worker counts modest (`--pw-workers`, `--smoke-workers`), and stop every process you start.
