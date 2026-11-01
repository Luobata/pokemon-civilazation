# Expansion network/editor independent review — final narrow re-review

- Session: `expansion-20261101`
- Review runs: `network-1` (initial BLOCKED review) and `network-2` (this final re-review)
- Base commit: `adb8ac10c1e755202cfa42ee63a615562253a441`
- Scope: authoritative server, network contract/client, multiplayer and editor browser entrypoints, declarative editor/sandbox, content-aware command parsers, related browser panels, legacy/expansion content separation, network/editor tests, local HTML entrypoints, and network/editor documentation.
- Deployment scope: local `127.0.0.1` or an operator-configured same-origin reverse proxy. This review does not claim public-network deployment readiness.

## Final verdict

**PASS_WITH_RISK for the reviewed local multiplayer/editor scope.**

Both run-1 blockers are fixed and independently reproduced as fixed. The remaining risk is operational rather than an authorization, projection, canonical-command, or authoritative-sequence defect: saves still write directly to their final slot, so a process crash during a write can leave that slot truncated or corrupt. Load rejects such a file instead of accepting tampered state, and unrelated slots remain scoped, so this does not negate the reviewed correctness controls.

## Final source fingerprint

Aggregate SHA-256 over base HEAD plus each reviewed file's exact path and bytes (`path\0bytes\0`, listed order):

`e23939db83b3d5c1cd1e4d394ee0466372fc629e6bc756a61d1e9cf91dfa7baa`

Files covered:

- `server/main.ts`
- `server/server.ts`
- `src/network/client.ts`
- `src/network/contract.ts`
- `src/editor/content.ts`
- `src/editor/sandbox.ts`
- `src/browser/multiplayer.ts`
- `src/browser/editor.ts`
- `src/browser/economy-panel.ts`
- `src/browser/expansion-panel.ts`
- `src/audit/commands.ts`
- `src/audit/sandbox.ts`
- `src/core/expansion-commands.ts`
- `src/core/expansion.ts`
- `src/content/units.ts`
- `src/content/species.ts`
- `src/content/legacy-species.ts`
- `tests/network/server.test.ts`
- `tests/network/action-content.test.ts`
- `tests/editor/content.test.ts`
- `tests/browser/expansion.spec.ts`
- `editor.html`
- `multiplayer.html`
- `src/core/movement.ts`
- `src/ai/plan.ts`
- `src/core/leader-systems.ts`
- `tests/core/expansion-callers.test.ts`
- `tests/browser/expansion-content.spec.ts`

The fingerprint covers untracked source and test files directly. Continuously updated delivery/summary documents are intentionally excluded.

## Run-1 blocker resolution

### NET-BLOCK-01 — content-aware command parsing

**Resolved.** `parseAuditAction`, `parseExpansionAction`, `isCommandAction`, and `validateCommandRequest` now accept the actual `Content`. The authoritative command path passes `this.content` (`server/server.ts:239-244`). The runtime sandbox and expansion engine likewise pass their active content (`src/audit/sandbox.ts:54-57`, `src/core/expansion.ts:17-24`). Legacy content remains 39 species and expansion content remains 47 species.

Independent verification:

- All eight expansion-only species (`clefable`, `sandshrew`, `ekans`, `caterpie`, `swinub`, `magnemite`, `umbreon`, `clefairy`) accepted canonical production actions under `EXPANSION_CONTENT`.
- The same production actions were rejected under legacy `CONTENT`.
- In an actual expansion room, the `clefairy -> clefable` moon-stone action passed transport parsing and reached engine eligibility validation; the arbitrary test unit returned HTTP 409 `invalid-command` from gameplay validation rather than the prior transport HTTP 400 malformed-command rejection.
- An actual expansion-room queue action for `clefairy` passed transport parsing and returned gameplay `invalid-production` for the arbitrary unavailable city/unit context, again proving it was no longer rejected as malformed.
- `tests/network/action-content.test.ts` separately checks expanded acceptance, legacy rejection, the moon-stone route, and canonical extra-field rejection. It uses representative new IDs; the all-eight production matrix above was supplied by this independent probe.

### NET-BLOCK-02 — per-room authoritative mutation serialization

**Resolved.** `Room.pending` now provides a promise-chain queue. Join, command, and every owner endpoint enter this queue before reading their request body, so request order is captured before async body parsing or disk work (`server/server.ts:157-185`). Commands and owner load/close/reinvite/save/export operations therefore execute serially per room. A queued operation on a deleted room returns `room-not-found`.

The exact original race was replayed:

1. Two seats joined.
2. Seat 0 advanced sequence 0 to 1.
3. Owner saved sequence 1.
4. Owner load and seat 1 `expectedSeq=1 EndTurn` were issued concurrently, with load scheduled first.
5. Both returned HTTP 200; the command response reported sequence 2.
6. Final authoritative state remained sequence 2.

The accepted command was no longer erased. `tests/network/server.test.ts` contains a real concurrent load-plus-command regression and also verifies the exported command log/state sequence. That test uses a sequence-0 save rather than the original sequence-1 save; the independent sequence-1 reproduction above complements it.

## Final caller compatibility integration

**Resolved.** A final legacy/expansion caller audit found that omitted-content defaults could still leak legacy content into expansion-facing UI and audit paths: `reachablePaths(view, unitId)` used legacy species definitions, and economy rendering called `productionCost(item)` without the active pack. Expansion-only movement therefore crashed at the normal map path, while expansion-only production costs rendered as `undefined`/`NaN`. The AI audit path also needed expansion-aware default query/leader content.

The final implementation selects content from `view.expansion` or `state.setup.expansionVersion` when callers omit it, keeps explicit custom content authoritative, and passes the active pack from economy rendering. `tests/core/expansion-callers.test.ts` covers expansion-only movement, legacy behavior, custom overrides, leader/query defaults, and initial placement.

A real browser regression now proves the player-facing path end to end. `tests/browser/expansion-content.spec.ts` advances a legal seed-7 conservative expansion game with `planNext`/`step` until player 0 naturally captures and owns an action-ready `magnemite`; the save is replayable and imported through the normal browser loader. It then selects that unit from `#unit-select`, performs a real map move, checks the production label/preview/queue cost, opens the live game's audit copy at `s12-movement`, executes audit AI-step, and asserts no page error, `undefined`, or `NaN`. This issue is closed and is not pending.

## Controls verified in final re-review

- Seat and owner credentials remain separate; actor IDs are derived from authenticated seat tokens and cannot be supplied by the request body.
- One-use invites remain non-replayable; cross-room and wrong-kind tokens are rejected.
- Ordinary seat responses remain projected `PlayerView` and do not expose RNG, full schema state, or `nextEntityId`.
- Owner export/persistence/load/close/reinvite remain owner-token protected.
- Create/join/command schemas remain bounded and reject extra fields; expansion and legacy reference sets are now version/content aware.
- Direct request bodies remain capped at 1 MiB, and the real Node streaming adapter enforces the same bound.
- Malformed absolute request-target returns HTTP 400 without unhandled rejection; untrusted `Host` is not used to construct the route.
- Save paths remain room-prefixed and slot constrained; slot saves remain capped and mode 0600.
- Disk retention remains grouped by actual `{32-hex-room}-slot-N.json` files, bounded to 20 room groups, ordered by newest file mtime, and reconstructed correctly after restart. Unrelated JSON files are not touched.
- Load retains full format/schema/rules/content/setup, command-log length, replay, and canonical state equality checks.
- Browser invite links use one-use invite tokens, reconnect links use seat tokens, and owner credentials are restored per API origin plus room from `sessionStorage`.
- The editor remains a deep clone of expansion content, rejects non-declarative or out-of-shape edits, validates references/budgets/unit projections/full dual-defense D15, and executes only in its isolated real engine sandbox.
- The Node entrypoint remains bound explicitly to `127.0.0.1`.

## Nonblocking risk

`persist()` still writes directly to the final slot (`server/server.ts:358-369`). A process crash during the write can truncate or corrupt that slot; load safely rejects it. A future same-directory temporary-file-plus-atomic-rename implementation would remove this residual availability risk. This is not a review blocker.

## Evidence on the final fingerprint snapshot

- `npx vitest run tests/core/expansion-callers.test.ts tests/network/server.test.ts tests/network/action-content.test.ts tests/editor/content.test.ts` — 4 files, 20 tests passed.
- `npx playwright test tests/browser/expansion.spec.ts` — 3 tests passed after the final legacy-content browser fixes, including two-browser authenticated movement/turn transfer/reconnect/owner recovery and the isolated editor path.
- `npx playwright test tests/browser/expansion-content.spec.ts` — 1 test passed using the legal captured-`magnemite` save described above.
- `npm run build` — TypeScript, core TypeScript, and all Vite entrypoints passed.
- Independent direct-server probes: original sequence-1 load race, all eight expansion-only production actions, moon-stone transport behavior, malformed absolute request-target, untrusted Host, one-use invite replay, cross-room auth, projection leak strings, and save file permissions.
- No unhandled rejection was observed during malformed-adapter probes.

Root's final integration run passed 395 unit tests, all 60 browser tests, build, and both lint checks. Root-owned results supplement this reviewer's independently run evidence.

## Review attention

The server intentionally uses per-room in-memory authoritative state and local disk persistence. It does not provide multi-process consensus or public-network rate limiting; those are outside the documented local/self-host/reverse-proxy scope. QualityGate was not invoked by this reviewer; the root task owns the authorized central submission and result consumption.
