# Notes for agents

## Test gate

- Run `npm run check` before every commit. It computes the checks this branch needs (merge-base with `main` up to HEAD, plus the working tree) and runs only those: tsc, eslint on the changed files, the related vitest files, the mapped Playwright specs, the production-build e2e when CSS, html or layout changes, and `tools/smoke-parallel.ts` for the gameplay versions the rules can reach. Use `npm run check:plan` to see the plan and its reasons without running it.
- Run `npm run check:full` only before merging to `main`, or when the plan says `FULL GATE`. That happens when package.json, the lockfile, a tsconfig, the eslint/vite/playwright config or the planner itself changed.
- Run `npm run check:release` for releases and default flips, such as `LATEST_GAMEPLAY_VERSION` or a default renderer or theme. It runs everything, then prints the 216-game balance-gate commands to run by hand.
- Never start the 216-game balance gate (`tools/balance-run.ts --preset gate`) on your own. When rule or AI files change, the plan recommends a 54-game `balance-sweep` with the relevant knobs. Run it if the change is meant to move balance.
- `--smoke-versions` narrows smoke by hand. The plan then marks the result as `NOT PROVEN`, so say so in your report.
- A new browser spec or client module needs a row in `tools/test-plan-map.ts` (`SPEC_RULES`). `tests/tools/test-plan.test.ts` fails on orphaned specs. Details are in [docs/tech/testing.md](docs/tech/testing.md).
- This machine is shared, so keep worker counts modest (`--pw-workers`, `--smoke-workers`), and stop every process you start.
