# EXECUTION-CHECKLIST.md

State-carrier between sessions for the FirstPrinciples build. Every session
prompt in `sessions-all-prompts.md` starts by reading this file. Keep entries
terse and factual — this is not a narrative log.

---

## Session log

| # | Stories | Date | Outcome |
|---|---|---|---|
| S0 | PREP-1…PREP-5 | 2026-08-16 | Prerequisites passed. Node 24 (v24.19.0) via nvm, pnpm 11.22.0 via corepack, GitHub SSH auth as `aaasingh905`, npm org `@firstprinciples` claimed (member of org, not personal account), `NPM_TOKEN` repo secret added, repo switched public, Dependabot/secret-scanning/private-vuln-reporting/Pages all enabled. |
| S1 | SCAF-1, SCAF-2, SCAF-3 | 2026-08-16 | Root monorepo scaffold: `pnpm-workspace.yaml`, root `package.json` (`private: true`), `.nvmrc`, `.gitignore`, `turbo.json` (local cache only, no remoteCache block), `tools/tsconfig-base` and `tools/eslint-config` as real workspace packages. No package code. Verified clean `pnpm install`, a second `turbo run build` cache-hits, and both `tools/` packages are consumable via `workspace:*` (proved with a throwaway package, then deleted). |
| S2 | SCAF-4, GOV-1, GOV-2 | 2026-08-16 | Formatter hooks + governance re-landed on current `main` (history rewrite had dropped PR #3). `.prettierrc` + `eslint-config-prettier` last in `tools/eslint-config`; Husky pre-commit → lint-staged (`eslint --fix` + Prettier on staged files; hook verified on a real commit). MIT LICENSE, CONTRIBUTING.md (setup + changeset requirement + PR expectations), Contributor Covenant 2.1, SECURITY.md (0.x table; GitHub private vulnerability reporting only). `.github/CODEOWNERS`, bug/feature issue templates, PR template with changeset checkbox. Root `eslint.config.js` added so pre-commit ESLint has a config. |
| S3 | CI-1, CI-2 | 2026-08-17 | `.github/workflows/ci.yml`: pnpm+Node (`.nvmrc`, pnpm store cached via `actions/setup-node`) → `pnpm install --frozen-lockfile` → lint → typecheck → test w/ coverage → build → `changeset status --since=origin/main`. `.github/workflows/codeql.yml` (javascript-typescript, push/PR + Monday 3am UTC cron). `.github/dependabot.yml` (weekly npm, dev-dependencies grouped). New shared `tools/vitest-config` package exports coverage thresholds (lines/statements 90%, branches 85%, functions 90%) consumed by each package's `vitest.config.ts`; vitest's own threshold check is what fails the job, not a separate script. `scripts/write-coverage-summary.mjs` walks every `*/coverage/coverage-summary.json` and appends a markdown table to `$GITHUB_STEP_SUMMARY` (runs with `if: always()` so a red run still shows why); coverage HTML uploaded via `actions/upload-artifact`. Proved red→green locally with a throwaway `packages/_scratch-coverage-proof` package (partial test coverage → `vitest run --coverage` exited 1 with explicit threshold errors; completed the tests → exited 0 at 100%); package deleted afterward, `pnpm install` + full lint/typecheck/build/test/changeset-status pipeline reverified clean on the empty scaffold. Minimal `@changesets/cli` + `.changeset/config.json` (`access: public`, `baseBranch: main`) added by hand (`changeset init` doesn't run non-interactively) so the CI changeset-status step has something real to run against — S4 owns the full `release.yml`/publish wiring. |
| S4 | SCAF-5, CI-3 | 2026-08-17 | `pnpm exec changeset init` confirmed idempotent against the hand-written `.changeset/config.json` (`access: public`, `baseBranch: main` already correct, unchanged). Verified the real add→status flow with a throwaway **non-private** scratch package (`packages/_scratch-changeset-proof`) — `@changesets/cli` skips `private: true` packages by default (`config.privatePackages.version`, false unless set), which is why the earlier private-tooling packages (`tools/*`) never show up as versionable; the eventual public `packages/*` will. `changeset add --patch <pkg> -m "..."` produced a valid changeset file, `changeset status` listed the pending bump correctly, `changeset status --since=origin/main` only diffs *tracked* changes (git-uncommitted changeset files don't count, matching real CI where changesets are committed as part of the PR). Scratch package + changeset deleted afterward; `pnpm install` cleanly pruned the stale lockfile importer entry pnpm otherwise left behind (had to hand-edit `pnpm-lock.yaml` once — plain `pnpm install`/`--frozen-lockfile` did not prune it on their own) and `changeset status --since=origin/main` reverified clean (0 packages). `.github/workflows/release.yml` added per spec §6.3: `permissions` block (`contents: write`, `pull-requests: write`, `id-token: write` for OIDC provenance), `actions/checkout@v4` with `fetch-depth: 0`, `pnpm/action-setup@v4` → `actions/setup-node@v4` (`.nvmrc`, `cache: pnpm`, `registry-url` set for npm auth), install → `turbo run build` → `changesets/action@v1` with `publish: pnpm changeset publish`, both `GITHUB_TOKEN` (automatic) and `NPM_TOKEN` (repo secret from S0) wired as env. Added a `concurrency` group (`cancel-in-progress: false`) beyond the spec snippet so two rapid pushes to `main` queue instead of one release run getting cancelled mid-publish. Failure modes walked through, not yet exercised on GitHub (that's S6): no pending changesets → job runs clean, `changesets/action` finds nothing to do, no-op (expected outcome for this session, since all 13 packages are still unwritten/private); pending changesets on `main` → `changesets/action` opens/updates a "Version Packages" PR (needs `contents: write` + `pull-requests: write`) without publishing; merging that PR is itself a push to `main`, re-triggering the workflow, this time with no pending changesets but package.json versions ahead of what's on npm → `changesets/action` runs `pnpm changeset publish` instead, using `NPM_TOKEN` for publish auth and `id-token: write` for provenance attestation. |
| S5 | CI-4, GOV-3 | 2026-08-17 | **Size budgets:** added `size-limit` + `@size-limit/preset-small-lib` as root devDependencies; root `.size-limit.js` dynamically aggregates every `packages/<name>/size-limit.json` (each package owns its own budget file, spec §3.1) into one flat config, prefixing each `path` with `packages/<name>/` so a single root-level `size-limit` run covers every package with zero per-package CI wiring. `pnpm run size` → `scripts/check-bundle-size.mjs`, which skips gracefully (exit 0, logs why) when no `packages/*/size-limit.json` exists yet — needed so the still-empty scaffold's `size-limit` call (which errors on a genuinely empty config array) doesn't break Gate 1. `ci.yml` gained two steps after `Build`: a plain `pnpm run size` (always runs, fails the job on any budget overage — proved with a throwaway 10 B limit against a real ~43 B build, confirmed non-zero exit) and, gated on `github.event_name == 'pull_request'`, `andresz1/size-limit-action@v1` (`package_manager: pnpm`) for the PR-comment bundle-size-delta UI. **Per-package template:** `tools/package-template/` (excluded from the pnpm workspace via `!tools/package-template` in `pnpm-workspace.yaml` — it's a copy-and-rename scaffold, not a real member) holds `src/index.ts` + `src/internal/`, `tests/{unit,edge-cases,integration}/`, `README.md` (spec §8.1 section order), `package.json` (exports import/require/types, `sideEffects: false`, `files: ["dist"]`, `engines`, `publishConfig.access: "public"` + `provenance: true`), `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts` (wired to `@firstprinciples/vitest-config`'s thresholds), `size-limit.json`, and a `_TEMPLATE-USAGE.md` (copy/rename/find-replace instructions, deleted after copying — not part of the per-package structure itself). Proved the template end-to-end via a throwaway `packages/_scratch-template-proof` (copied, `PACKAGE_NAME` → real name via `sed`): `pnpm install` resolved it as a workspace member cleanly; `turbo run build` hit two real bugs fixed at the shared-tooling level so all 13 future packages don't hit them too — (1) tsup's dts worker unconditionally injects `baseUrl` into the TS program it hands to `tsc`, which TypeScript 6.0.3 now hard-errors on as deprecated (`TS5101`) even though no tsconfig here sets `baseUrl` itself; fixed by adding `"ignoreDeprecations": "6.0"` to `tools/tsconfig-base/tsconfig.json` (applies to all packages). (2) the template's `tsconfig.json` originally scoped `include`/`rootDir` to `src` only, so ESLint's `projectService` couldn't parse `tests/**` files (`was not found by the project service`); fixed by including both `src` and `tests` and dropping the `rootDir` restriction — tsup's own bundling (not `tsc`) still only ever touches `src/index.ts`, so this doesn't change build output. With those two fixes, `build`/`lint`/`typecheck`/`test` all passed clean (100% coverage on the one-function placeholder) and the size-limit gate was verified both passing and failing as above. Scratch package deleted afterward, `pnpm install` reverified the empty scaffold (`pnpm run size` skip message, full `turbo run build lint typecheck test` no-op on 0 packages, `changeset status --since=origin/main` clean) still green. **Definition of Done:** `DEFINITION_OF_DONE.md` added at repo root — spec §12's checklist verbatim, cross-referenced with this file's per-package matrix below (same columns; check boxes there during a package's session, then tick that session's row in the matrix here). Note for S6: none of S3's or S4's files (`tools/vitest-config/`, `scripts/write-coverage-summary.mjs`, `.changeset/`, `.github/workflows/{ci,codeql,release}.yml`, `.github/dependabot.yml`) are actually committed to git yet — `git status` shows them all untracked/modified on top of the S2 merge commit (`5f4fbe5`). This session's new/changed files (`.size-limit.js`, `scripts/check-bundle-size.mjs`, `tools/package-template/`, `DEFINITION_OF_DONE.md`, plus edits to `package.json`, `pnpm-workspace.yaml`, `tools/tsconfig-base/tsconfig.json`) are in the same uncommitted state — deliberately left that way since no session has been asked to commit/push. Gate 1 can't actually be confirmed (workflows running on GitHub) until an S6-or-earlier session commits and pushes all of S3–S5's work. |
| S6 | Gate 1 verification | 2026-08-17 | Added the missing `docs.yml` (spec §6.5) — its `paths` filter means it correctly never fires on the empty scaffold, until the docs site and first package land. Fixed a real template bug caught by the actual pre-commit hook (not just a scratch-copy test): `tools/package-template/tsconfig.json`'s `rootDir`/`include` fix from S5 had only been applied to a throwaway copy, never the template itself; also added missing types to `tools/vitest-config` (`TS7016` once `*.config.ts` got included). All of S3–S6's previously-uncommitted work pushed to branch `ci/s6-gate1-verification`; PR #6 opened by Cursor. **Six rounds of real CI failures, each traced to a genuine root cause (not guessed around) before fixing** — full diagnostic trail lives in PR #6's commit history if needed later, kept out of this log per the terse-log convention above: (1) `andresz1/size-limit-action@v1` doesn't accept `package_manager`/`script` inputs (silently warned, not failed) and always runs `npx size-limit --json` directly — fixed by making `.size-limit.js` itself always emit a valid config (a placeholder check) instead of a wrapper script only one caller could use. (2) That action diffs against `main`, which has none of this PR's size-limit setup yet (bootstrap gap, resolves itself post-merge) — made that step `continue-on-error: true` since the real budget-enforcement gate is the separate plain step. (3) `@changesets/cli@3.0.0` (pinned in S3) wasn't installing reliably in a clean CI environment; downgraded to the well-established `^2.31.1`. (4) `@changesets/config`'s default for `privatePackages.version` flipped between the two `cli` majors' bundled config — made it explicit (`false`) in `.changeset/config.json` instead of relying on either implicit default. (5) `pnpm install --frozen-lockfile` re-verifies each lockfile entry's supply-chain trust level unless `--trust-lockfile` is passed — added to all three workflows that install. (6) **The actual root cause of the "Changeset check" failure surviving fixes 3–5**: `andresz1/size-limit-action` runs `git checkout -f main` *in the same working directory* to build its comparison, then `pnpm install`s main's `package.json` (which lacks this PR's dependencies entirely) — it never restores the head branch's `node_modules` afterward, so any step placed after it in the job runs against corrupted state. Reordered `ci.yml` so that step runs last. Local pipeline (`lint`/`typecheck`/`build`/`test`/`size`/`changeset status`/`prettier --check`) verified clean before every push. Pushed as a sixth fixup commit. **Confirmed green**: `ci.yml` and `codeql.yml` both passed on commit `fe1b255` — [ci run](https://github.com/BetterFoundations/FirstPrinciples/actions/runs/32031815154), [codeql run](https://github.com/BetterFoundations/FirstPrinciples/runs/95393494538). `docs.yml` correctly never triggered (no `docs/**` or `packages/**/src/**` changes). PR: https://github.com/BetterFoundations/FirstPrinciples/pull/6. |
| S7 | CORE-1, CORE-2, CORE-3 | 2026-08-22 | `@firstprinciples/core` built: typed error hierarchy, `Result<T, E>`, branded primitives. 227 tests (unit / edge-case / integration / `expectTypeOf` type-level) green, coverage 100% lines / 99.35% statements / 96.89% branches / 100% functions, lint clean, 1.61 kB against a 2 kB budget. **Four design decisions came from writing call sites and reading them back, not from the spec** — all four are recorded under Decisions locked below: `toJSON()` omits stack traces; `details` is `unknown` rather than a class type parameter; `name` is a string literal per subclass; and the `Result`/error layering (item 3 of the brief) is resolved and written up. **Verified rather than assumed:** the `class extends Error` transpilation pitfall does not bite here — loaded the real `dist/index.js` and `dist/index.cjs` and confirmed `instanceof` holds across the hierarchy in both (esbuild keeps native classes at `target: es2022`); the dual-package hazard *is* real and reproducible (a CJS-built error fails `instanceof` against the ESM copy's class), which is what `isAppError`'s `Symbol.for` brand exists for, confirmed bridging both directions. That check lives on as `tests/integration/dist-interop.test.ts`, which rebuilds `dist` itself so a stale artifact can never fake a pass. **Three real bugs in shared tooling fixed while here** (all would have hit every future package): the template's `exports` map put `types` last, so TypeScript consumers would have resolved no types at all — now the nested `import`/`require` form pointing at `index.d.ts` and `index.d.cts`; the template's `repository.url` pointed at `aaasingh905/FirstPrinciples` instead of `BetterFoundations/FirstPrinciples`; and the template's `version` was `0.1.0`, which with a first `minor` changeset would have published `0.2.0` — proved by running `changeset version` that `0.0.0` lands on exactly `0.1.0`, so the template and `core` now start at `0.0.0`. **CI caught one thing local runs could not:** `ci.yml`'s test step passed `-- --coverage` on top of the package script's own `--coverage`, which vitest 4 rejects as a duplicate flag. Latent since S3 and invisible until a real package existed for turbo to pass the flag to. Fixed in `ci.yml`, coverage gate re-verified red-and-green, and the full CI sequence replayed locally from clean. Not committed or pushed — human handles git for this session. |
| S8 | CORE-4, 🚦 Gate 2 | 2026-08-22 | **`@firstprinciples/core@0.1.0` published to npm** — confirmed live on the real registry (`npm view @firstprinciples/core version` → `0.1.0`), not just assumed. PRs: #8 (`firstprinciples-core`, merged S7's uncommitted work), #9 (`chore/s8-gate2-prep` — pinned `esbuild >=0.28.1` via pnpm `overrides`, closing the low `npm audit` advisory noted open at end of S7; added `examples/core` lifted from `packages/core/tests/types/call-sites.test-d.ts`), #10 (`changeset-release/main`, the real "Version Packages" PR — merging it triggered `release.yml`'s live `pnpm changeset publish`, not a no-op, confirming Gate 1's `release.yml` leftover), #11 (fix: `changeset status --since=origin/main` unconditionally fails on the changesets bot's own release branch since that branch's entire diff is the version bump with the consumed changeset already deleted — skip the check when `github.head_ref` starts with `changeset-release/`; `push` events have empty `head_ref` so the real gate on `main` still runs). CI and CodeQL green on both #9 and #10 (verified via GitHub check runs, not assumed). `pnpm audit --prod` clean post-fix. `CHANGELOG.md` auto-generated by changesets. **This session's work was never logged here at the time** — this row was backfilled retroactively (2026-08-22, same day, ahead of S9) after discovering the gap; see the next row for the provenance finding made during that backfill. |
| **PRE-S9** | — | 2026-08-22 | **Checklist backfill + Gate 2 provenance fix**, done ahead of S9 at the user's direction after this session found two problems on read: (1) this file had no S8 entry at all despite S8's own instructions saying to add one — backfilled as the row above, from git history (`git log`) and live GitHub/npm state, not from memory. (2) **Gate 2's provenance requirement was not actually met.** S8's prompt said to verify "it shows a PROVENANCE BADGE" before declaring the gate passed; that verification did not happen. Checked directly against the live registry (`registry.npmjs.org/@firstprinciples/core`, `versions["0.1.0"].dist`): no `attestations` key, only a plain `signatures` entry — no provenance, despite `packages/core/package.json` already setting `publishConfig.provenance: true` and `release.yml` already granting `id-token: write`. **Root cause, found by reading source, not guessing:** pnpm 11.22's `publish` command reads `publishConfig.access`, `.directory`, `.registry`, `.executableFiles` — confirmed by grepping every `publishConfig` reference in pnpm's vendored CLI (`~/.cache/node/corepack/v1/pnpm/11.22.0/dist/pnpm.mjs`) — but **never `publishConfig.provenance`**. Provenance is only wired from pnpm's classic npm-config-compatible `provenance: Boolean` key (CLI flag or `.npmrc`), confirmed by tracing `libnpmpublish`'s vendored `generateProvenance` call (`if (provenance === true || provenanceFile)`) back to where `opts3.provenance` is populated. `@changesets/cli@2.31.1` never adds a `--provenance` flag itself (confirmed: no "provenance" string anywhere in its bundled source; its `publishFlags` only ever contains `--access`, `--tag`, `--no-git-checks`, `--json`, `--otp`). So `publishConfig.provenance: true` was silently a no-op the entire time. **Fix:** added root `.npmrc` with `provenance=true` — pnpm's config resolution walks up from `opts.cwd` (the package being published, e.g. `packages/core`) to the workspace root, so one root-level setting covers every future package with zero per-package wiring, matching how `.size-limit.js` and the shared vitest config already work. Generating actual Sigstore provenance requires a real GitHub Actions OIDC token exchange, which cannot be exercised locally — **this fix is unverified against a real publish.** The next real release (whenever a future "Version Packages" PR is merged — S9's `logger`, if it gets that far) is the actual test; check the registry the same way (`versions[<ver>].dist.attestations`) rather than assuming green. If still missing after that, re-check `ciInfo` detection inside `generateProvenance` next — GitHub Actions should be auto-detected, but that path hasn't been traced. |
| S9 | PKG-LOGGER | 2026-08-22 | `@firstprinciples/logger` built: isomorphic structured logging, pino on Node / console fallback in the browser, adversarial redaction, `AsyncLocalStorage` correlation IDs, pluggable transports. 88 tests (unit / edge-case / integration / type-level), 100% coverage on every metric, lint clean, both bundles well under budget (1.6 kB node / 1.2 kB browser against 5 kB). **Node/browser split is a build-time export condition, not a runtime check**: `src/index.ts` (pino, `node:async_hooks`, `node:crypto`) and `src/browser.ts` (console, a module-variable correlation fallback) are two separate tsup entries; `package.json`'s `exports.".".browser` resolves bundlers to the browser one, with a legacy top-level `browser` field (`{ "pino": false, "node:async_hooks": false }`) as a second line of defense for older bundlers. **Verified, not assumed**: `tests/integration/dist-browser.test.ts` rebuilds `dist/` and greps the actual built bundle text for `pino`/`node:*`/`async_hooks` references — confirmed zero on every rebuild, not inferred from source. **Redaction treated adversarially per the brief**: two independent mechanisms (key-fragment substring match, e.g. `dbPassword`/`x-api-key`; and unanchored value-shape patterns for JWTs/emails/Stripe/GitHub/AWS/Google/Slack keys/bearer tokens) apply recursively through nested objects and arrays; cycle detection tracks only the current ancestor chain (not every object seen tree-wide), so a cycle still resolves to `[Circular]` while the same object legitimately referenced twice is redacted independently in both places — covered by a dedicated DAG-vs-cycle test. Functions/symbols/BigInt/Date/RegExp/Error/Map/Set all get safe, JSON-stringifiable placeholders. A real (if narrow) prototype-pollution vector was caught and fixed, not just linted around: the redaction accumulator was a `{}` literal, so a log field literally named `__proto__` would have hit the special setter; switched to `Object.create(null)`, which is the actual fix, with the remaining `security/detect-object-injection` warning suppressed only because the rule can't see that fix. **Correlation-ID propagation verified, not assumed**: `tests/edge-cases/correlation-propagation.test.ts` proves the Node entry survives `Promise.all`, `setTimeout`/`setInterval`, `process.nextTick`/`queueMicrotask`, and correctly isolates two concurrent runs — via `AsyncLocalStorage`, not inspection of the implementation. The browser fallback (one module-level variable, since no browser ships `AsyncLocalStorage`) is documented as best-effort and its actual leak-under-overlap behavior is asserted by a test (`correlation-browser.test.ts`), not just described in a comment. **Found and fixed two pre-existing gaps unrelated to this package, while here:** (1) root `package.json` had `@changesets/cli` at `^3.0.0`, silently reverted from S6's explicit `^2.31.1` pin (that pin's whole reason was `3.0.0` failing to install reliably in clean CI — likely a Dependabot dev-dependency-group bump between S6 and S7 that nobody re-checked against that reasoning). Reverted to `^2.31.1`; full pipeline reverified clean after. `tools/package-template/package.json`'s `eslint`/`typescript` versions (`^10.8.1`/`^7.0.2`) also don't match the locked `^9.39.5`/`^6.0.3` — did **not** copy those into `logger` (used the locked versions instead, matching `core`), but the template itself is still wrong for the next package that copies it; flagged here rather than fixed, since `tools/package-template/` is explicitly not this session's file to edit under the safe-refactor-plan convention and the fix belongs with whoever next touches the template. (2) confirmed (separately) that root's own top-level `eslint` devDependency is at `^10.8.1` too — doesn't affect CI (each package pins its own correct `eslint@^9.39.5` and CI lints per-package), but does mean the local pre-commit hook's `eslint --fix` runs at a different major version than what actually gates CI; not fixed, since it's a pre-existing local-only inconsistency outside this session's brief. `examples/logger` added and actually run (not just written) — output inspected directly, confirming correlation ID survives real `await`/timer/`Promise.all`, a secret three levels deep gets redacted, and a custom transport receives only the sanitized entry. Changeset added (`minor`, landing `0.0.0` → `0.1.0`). Not committed or pushed — human handles git for this session. |
| S10 | PKG-HTTP | 2026-08-22 | `@firstprinciples/http-client` built: a typed `fetch` wrapper, `createApiClient` returning a client whose `get`/`post`/`put`/`patch`/`delete` and the endpoint-definition pattern (`client.endpoint({ method, path })`) all return `ApiResult` — never a thrown exception for an expected API outcome. 120 tests (unit / edge-case / integration against a real local `node:http` server / type-level), coverage 99.3% statements / 97.02% branches / 100% functions / 100% lines, lint clean, 2.46 kB against a 5 kB budget (comfortably under the spec's 3–5 kB target). **Promoted `NetworkError` into `core`** per the S7 decision's instruction (own changeset, `core` 0.1.1 → 0.2.0-pending): `code` `NETWORK_ERROR`, `httpStatus` 503, added to `ERROR_CONSTRUCTORS` and the `index.ts` export list; `tests/integration/dist-interop.test.ts`'s "exports exactly the intended public API" allow-list updated (that test's whole point is to fail on exactly this kind of surface drift, and it did, correctly, the first time it ran). **`ApiResult` built exactly per the S7 write-up**: `ApiOk<T> = Ok<T> & { status }`, `ApiErr<E extends AppError = AppError> = Err<E> & { status: number \| undefined; kind: 'http' \| 'network' \| 'validation' }` — the three-way `kind` split is this package's own addition on top of that decision, needed because the brief calls out validation failure as a third distinct outcome alongside network/HTTP. **The four "easy to get subtly wrong" items, each verified by a dedicated test file, not just implemented:** (1) network vs. HTTP distinction — `tests/edge-cases/network-vs-http.test.ts` proves `kind`/`status`/error-class differ correctly for both cases and that a caller can branch on `kind` alone. (2) timeout/signal composition — `tests/edge-cases/timeout-signal-combination.test.ts` proves the internal timeout still fires with a caller signal present but never aborted (the actual bug this item warns about — a naive implementation lets the caller's signal silently replace the timeout and this exact scenario is what would stay green under a shallower test), that an earlier caller abort still wins, and that per-call `timeoutMs` participates in the same composition. (3) retry policy — `tests/edge-cases/retry-policy.test.ts` proves 4xx is never retried, 5xx and network failures are, and backoff timing itself (not just the retry/no-retry decision) is correct under fake timers with `Math.random` pinned for determinism. (4) validation adapter as a pluggable slot — `tests/edge-cases/validation-adapter.test.ts` and the dist-bundle integration test both confirm no schema library is imported by the package and a throwing adapter produces `kind: 'validation'`, never a rejected promise. **Two real bugs found and fixed while writing tests, not by inspection:** the original `toNetworkError` classified an abort by checking `cause instanceof DOMException`, which is wrong the moment a caller calls `AbortController#abort(reason)` with anything else — a plain string, most commonly — silently mislabeling a real, common abort as a generic network failure; fixed by passing the request's own `signal.aborted` flag through explicitly rather than inferring it from the cause's shape (see design decision 3 below). `endpoint()`'s returned function was originally a plain (non-`async`) arrow whose body could throw synchronously (`interpolatePath` throws on a missing path param) — a caller using `.then()` instead of `await` would have gotten a synchronous throw instead of the promised `Promise<ApiResult>`, inconsistent with every other call path; marking it `async` normalizes the throw into a rejection regardless of call style. **Verified, not assumed:** `tests/integration/real-server.test.ts` runs every core scenario (GET/POST round-trip, a real 404, a real 204, retry recovering from three real transient 503s, `onRequest` injecting a header the server actually reads, the endpoint pattern) against an actual `node:http` server on loopback — everything else in the suite mocks `fetch`, so this is what catches a mock that only agreed with itself. `tests/integration/dist-bundle.test.ts` rebuilds `dist/` fresh (same "never trust a stale artifact" pattern as `core`'s `dist-interop` test) and measures the real gzip size, greps for `zod`/`valibot` in both the raw dist source and a scratch esbuild consumer bundle, and confirms the public surface is exactly `['createApiClient']`. `examples/http-client` was actually run (not just written): a local server, the endpoint pattern, both failure kinds, retry recovery, and header injection all produced the expected output. **A previously-latent cross-package race found and fixed, affecting CI itself, not just this package:** running the full suite (`pnpm turbo run test`) surfaced `http-client`'s type-level tests intermittently failing to resolve `@firstprinciples/core`'s types with "Could not find a declaration file" — root cause: `turbo.json`'s `test` task depended only on `^build`, so once `core#build` finished, turbo was free to run `core#test` (whose `dist-interop` integration test does its own `execFileSync('npx', ['tsup'])` rebuild of `core`'s dist, per the S7 design) at the same time as `http-client#test`'s `tsc` typecheck was reading that same `dist/index.d.ts` — a genuine race, not flaky test infrastructure. `core` never had a downstream consumer of its *types* running concurrently before `http-client` (`logger` has no dependency on `core`), so this was latent since S7 and would have hit real CI the first time this PR's `turbo run test` ran there. Fixed at the root: `turbo.json`'s `test` task now also `dependsOn: ["^build", "^test"]`, so a package's test task waits for its dependencies' test tasks too, not just their builds — verified clean across 3 consecutive from-scratch (`rm -rf packages/*/dist packages/*/coverage .turbo`) runs of `pnpm turbo run test` after the fix, where it had failed before. This is the same family of bug as S9's "don't run turbo tasks combined" finding but one level up: that one was intra-package (a package's own `build` and `test` racing), this one is inter-package. Not committed or pushed — human handles git for this session; the changeset for `core`'s `NetworkError` addition and this session's own `http-client-initial-release` changeset are both staged so `changeset status --since=origin/main` reports correctly (see the S4 finding this reconfirms, under Decisions locked, about untracked changeset files being invisible to that check). |

---

## Decisions locked

- **Scope name:** `@firstprinciples` (Final_plan.md §2.1) — confirmed unclaimed and claimed as an npm org in S0.
- **Node version:** 24 LTS, pinned to `v24.19.0` in `.nvmrc`. Local machine's system Node (v20.17.0, EOL) is superseded via `nvm`; CI must read `.nvmrc` so local/CI can't drift.
- **Package manager:** pnpm 11.22.0, pinned via `packageManager` field in root `package.json` and `corepack enable pnpm`.
- **Turbo remote cache:** explicitly NOT configured — local + CI cache only, per Final_plan.md and spec §4.2. Do not add a `remoteCache` block without re-confirming free-tier terms first.
- **Toolchain versions pinned in S1** (chosen for mutual peer-dependency compatibility, not just "latest"):
  - `typescript`: `6.0.3` — pinned below `7.0.x` because `@typescript-eslint` 8.67.0's peer range is `>=4.8.4 <6.1.0`; TypeScript 7.x (native/Go port) is out of range.
  - `eslint`: `^9.39.5` — pinned to the 9.x line because `eslint-plugin-import` 2.32.0's peer range tops out at `^9`; ESLint 10 is not yet supported by that plugin.
  - `@typescript-eslint/eslint-plugin` / `parser`: `^8.67.0`
  - `turbo`: `^2.10.10`
  - `eslint-plugin-import`: `^2.32.0`, `eslint-plugin-security`: `^4.0.1`, `eslint-plugin-tsdoc`: `^0.5.2`, `globals`: `^17.11.0`
  - `eslint-config-prettier`: `^10.1.8` (S2) — last item in the shared ESLint flat config so Prettier owns formatting.
  - `prettier`: `^3.6.2` (resolved 3.9.6), `husky`: `^9.1.7`, `lint-staged`: `^16.1.5` (resolved 16.4.0) (S2).
  - `vitest` / `@vitest/coverage-v8`: `^4.1.10` (S3) — v8 coverage provider, no external coverage service.
  - `@changesets/cli`: `^2.31.1` (S3, minimal config only — see S3 log entry; downgraded from `^3.0.0` in S6 after that version, published only 6 days before use, failed to install reliably in a clean CI environment — see S6 log entry). Don't re-bump to `3.x` without first confirming a clean-environment install actually works, not just a locally-cached one.
  - **`.changeset/config.json` sets `privatePackages: { version: false, tag: false }` explicitly** (S6) — the default value for this flipped between `@changesets/cli` major versions (confirmed by reading `@changesets/config`'s source), so relying on either version's implicit default is fragile. Private `tools/*` packages should never require a changeset.
  - **Every `pnpm install --frozen-lockfile` in a workflow also passes `--trust-lockfile`** (S6 — `ci.yml`, `release.yml`, `docs.yml`) — pnpm 11.x re-verifies each lockfile entry's supply-chain trust level (`minimumReleaseAge`/`trustPolicy`) against the registry on every install unless this flag is set, and an unauthenticated CI runner's verification can silently skip installing a package (no hard error) where an authenticated local machine's succeeds. If a workflow adds a new `pnpm install` step, it needs this flag too.
  - If any package session needs to bump these, re-check the peer-dependency chain above before doing so — it's the reason these specific versions were chosen over strictly-latest.
- **Formatter vs ESLint:** Prettier is the only formatter. Shared ESLint config does not set formatting rules; `eslint-config-prettier` is appended to disable any stylistic rules that leak in from recommended presets. Do not add `quotes`/`semi`/`indent` ESLint rules.
- **CODEOWNERS:** `@aaasingh905` is the default owner until GitHub teams exist.
- **`tools/*` added to `pnpm-workspace.yaml` packages list** (spec §4.1 only lists `packages/*`, `docs`, `examples/*`). This addition is necessary for `tools/tsconfig-base` and `tools/eslint-config` to be resolvable via `workspace:*` — without it they aren't pnpm workspace members at all.
- **`tools/package-template` explicitly excluded** from the workspace (`!tools/package-template` in `pnpm-workspace.yaml`, S5) — it's a copy-and-rename scaffold with a placeholder package name, not a real installable member.
- **`ignoreDeprecations: "6.0"` added to `tools/tsconfig-base/tsconfig.json`** (S5) — required for tsup's dts build step to succeed under TypeScript 6.0.3; tsup's dts worker (`rollup-plugin-dts`) always injects a `baseUrl` into the compiler options it hands to `tsc`, which 6.0.3 hard-errors on (`TS5101`) regardless of whether the project's own tsconfig sets `baseUrl`. Applies to every package via the shared base config, not something each package should suppress individually.
- **Per-package `tsconfig.json` includes both `src` and `tests`, no `rootDir` restriction** (S5, set in `tools/package-template/tsconfig.json`) — needed so ESLint's `projectService` can parse files under `tests/`; tsup's actual bundling only ever reads `src/index.ts` regardless, so this doesn't affect build output.
- **Bundle size budgets live per-package** (`packages/<name>/size-limit.json`, spec §3.1) but are **checked from one root `size-limit` run** (S5) — root `.size-limit.js` aggregates them dynamically so CI has a single command to wire into both the plain pass/fail gate and the `andresz1/size-limit-action` PR-comment step, with zero per-package CI special-casing.

### S7 — `@firstprinciples/core` design decisions

**1. The `Result` / error-class layering question (Final_plan.md §2.2) — RESOLVED. `http-client` (S10), `api-kit` (S12) and `access-control` (S16) all read this.**

The intended resolution — *both, layered* — composes cleanly, and is now proved
by a type-level test rather than asserted. It is expressed in `core` as a
**default type argument**:

```ts
export interface Ok<T>  { readonly ok: true;  readonly value: T }
export interface Err<E> { readonly ok: false; readonly error: E }
export type Result<T, E = AppError> = Ok<T> | Err<E>;
```

`Ok` and `Err` are exported as **standalone named interfaces**, not inlined into
the union. That is the load-bearing part: it is what lets a downstream package
widen a branch without redefining the union. `http-client` builds `ApiResult` as

```ts
type ApiOk<T>  = Ok<T> & { readonly status: number };
type ApiErr<E extends AppError = AppError> = Err<E> & {
  readonly status: number | undefined;          // undefined for a network failure
  readonly kind: 'http' | 'network' | 'validation';
};
type ApiResult<T, E extends AppError = AppError> = ApiOk<T> | ApiErr<E>;
```

Verified in `tests/types/result.test-d.ts` (the `composition with a downstream
ApiResult` block — **do not delete it, it is the regression guard on this
decision**):

- the intersection preserves the `ok` literal, so `ApiResult` stays a
  discriminated union and `if (res.ok)` narrows;
- `core`'s own `isOk` / `isErr` narrow an `ApiResult` to `ApiOk` / `ApiErr`
  **without losing `status` or `kind`** — no separate guards needed downstream;
- `ApiResult<T>` stays assignable to `Result<T, AppError>`, so a caller that
  does not care about transport detail can ignore it;
- the error branch keeps the full taxonomy, so `api-kit` maps
  `error.httpStatus` / `error.code` once for every error in the ecosystem.

Consequences the three dependent sessions must honour:

- **S10 `http-client`:** constrain the error branch to `E extends AppError`. Use
  the field name **`value`, not `data`** — this is a deliberate deviation from
  `typed-fetch-client-spec.md` §4's sketch, taken so one vocabulary covers all
  13 packages; note it in that package's README. A network failure needs an
  error class that does not exist yet: **propose promoting `NetworkError` into
  `core`** rather than defining it locally, so `api-kit` can map it without
  importing from `http-client`. Its `httpStatus` should be 503 — see decision 5.
- **S12 `api-kit`:** build the RFC 7807 problem-details payload from the typed
  fields (`code`, `httpStatus`, `message`, `details`). `toJSON()` is safe to
  send (it carries no stack — decision 2), but map explicitly anyway rather than
  spreading it, so adding a field to `core` can never silently widen a public
  response. Treat `details` as client-visible.
- **S16 `access-control`:** `assertCan` throws `ForbiddenError` from `core`, as
  specified. `core` ships no `Result`-returning wrapper and no `fromThrowable`;
  if `access-control` wants a non-throwing `canResult()`, add it there.

**2. `toJSON()` deliberately omits stack traces.** This was the opposite of the
first draft, and the call-site review is what changed it: `JSON.stringify` calls
`toJSON` implicitly, so it is the shape that reaches a response body the instant
anyone writes `res.json(error)`, and a stack in a response body is an
information leak. No consumer actually needs it there — a logger reads
`error.stack` directly (pino's error serializer does exactly that), and the
cause chain keeps the original errors reachable. "Lossless round-trip" is
therefore defined over every field `toJSON` emits: `AppError.fromJSON(e.toJSON())`
reproduces name, code, httpStatus, message, details and the whole cause chain.
If S19 (`queue`) needs stack transport across a process boundary, add a separate
`toDiagnosticJSON()` then — additive, non-breaking.

**3. `details` is `unknown`, not a class type parameter.** A generic
`AppError<TDetails = unknown>` reads beautifully at a construction site and then
fails at the only site that matters. **Verified with `tsc`:** narrowing an
`unknown` with `instanceof` against a *generic* class instantiates it at `any`,
so `catch (e) { if (e instanceof AppError) e.details }` hands back `any` —
unchecked data at precisely the boundary where untyped data arrives. A
non-generic class yields `unknown` there instead. A function that *does* know
the shape can still say so in its return type: `branded.ts` exports
`BrandValidationError<TReason> extends ValidationError` narrowing `details`, and
the parsers return it. Downstream packages should use that pattern rather than
asking for the type parameter back.

**4. `name` is a string literal on each subclass** (`declare name: 'NotFoundError'`),
and stays `string` on `AppError` itself so user subclasses can set their own.
**Verified with `tsc`:** the subclasses add no members beyond this, so without it
TypeScript — being structural — considered a `ConflictError` assignable to a
`NotFoundError`, and `Result<T, NotFoundError>` would have silently accepted any
`AppError`. That would have quietly voided the "exhaustive narrowing over a
typed error union" half of decision 1. It also makes `switch (error.name)`
exhaustive over the built-in taxonomy. `declare` (not a plain field) is required:
a real class field would be emitted under `useDefineForClassFields` and overwrite
the assigned name with `undefined`.

**5. `httpStatus` is required on every error, including non-HTTP ones.** It is
the ecosystem's single agreed severity/category axis and the field `api-kit`
reads. A package modelling a failure that never touches HTTP picks the status it
*would* map to (a network timeout: 503). `code` and `httpStatus` are both
overridable per instance; `name` is not.

**6. Deliberately not shipped.** `Result` combinators (`map`, `mapErr`,
`andThen`, `unwrapOr`, `fromThrowable`) and an error-code constants object were
all considered and left out. Adding them later is non-breaking; removing them is
not, and every export costs TSDoc, coverage and size budget across 13 packages.
S10 or S12 should propose them if a real consumer needs them.

**7. Other decisions worth not re-litigating.** Parsers never normalize
(`parseUUID` accepts uppercase and returns it unchanged) — a `parse` that
rewrites its input surprises callers who compare strings. Rejection `details`
carry a machine-readable `reason` but **never echo the rejected value**, since
`core` cannot know whether the caller's error payload gets logged and an email
address is personal data. `ISODateString` validates the calendar arithmetically,
not via `Date.parse`, because `new Date('2026-02-31T00:00:00Z')` does not fail —
it rolls over to 3 March. `AppError` is concrete, not abstract, so it can double
as the generic `INTERNAL_ERROR` / 500 and as `fromJSON`'s fallback. Nothing in
`core` throws: even `fromJSON`, which parses untrusted input, returns a `Result`.

**Module graph** (checked against the `circular-dependency-audit` skill's
concern): `internal/validation.ts` and `result.ts` are leaves, `errors.ts` →
`result.ts`, `branded.ts` → both. Acyclic at runtime. `result.ts` has a
**type-only** import of `AppError` for the default type argument, fully erased
under `isolatedModules`, so it adds no runtime edge and no fourth cycle.

### S7 — shared tooling changes (apply to all 13 packages)

- **`ci.yml`'s test step no longer passes `-- --coverage`.** This was a latent
  break that only *could* surface once a real package existed, and it did:
  `pnpm turbo run test -- --coverage` appends a second `--coverage` to a `test`
  script (`vitest run --coverage`, from the template) that already has one, and
  vitest 4's CAC parser rejects a duplicate outright — `Expected a single value
  for option "--coverage", received [true, true]` — rather than ignoring it.
  Every prior green CI run had zero packages, so turbo passed the flag to
  nothing. The step is now plain `pnpm turbo run test`; each package's own
  script owns `--coverage`, and thresholds live in its `vitest.config.ts` via
  `@firstprinciples/vitest-config`. **Do not re-add the flag at the CI level.**
  Verified afterwards that the gate still works in both directions: with
  impossible thresholds injected into `vitest.config.ts`, `vitest run
  --coverage` exits 1 with explicit per-metric threshold errors; restored, it
  exits 0. Also verified the whole `ci.yml` sequence end-to-end locally from a
  clean `dist`/`coverage`/turbo cache with `--frozen-lockfile` — install, lint,
  typecheck, test, coverage summary, build, size, changeset status all pass, and
  `coverage:summary` renders real numbers for `packages/core` (its first
  non-empty run).
- **Related pitfall worth knowing:** coverage runs *only* when `--coverage` is
  passed; it is not enabled in config. A package whose `test` script drops the
  flag would produce a green CI that checks no thresholds at all and silently
  contributes no row to the coverage summary. The template supplies the flag —
  don't remove it from a package's `test` script.
- **`exports` map order fixed** in `tools/package-template/package.json` and
  `packages/core`. It had `types` last, which esbuild warns about and which
  means a TypeScript consumer resolves **no types at all**. Now the nested form:
  `import` → `{ types: ./dist/index.d.ts, default: ./dist/index.js }`,
  `require` → `{ types: ./dist/index.d.cts, default: ./dist/index.cjs }`. tsup
  already emits both declaration files.
- **`repository.url` fixed** from `aaasingh905/FirstPrinciples` to
  `BetterFoundations/FirstPrinciples` in the template and in `core`. It would
  have shipped wrong metadata to npm.
- **Package `version` starts at `0.0.0`, not `0.1.0`.** Changesets applies a bump
  literally, so `0.0.0` plus a first `minor` changeset versions to exactly
  `0.1.0` — the version every package is specified to launch at. Starting at
  `0.1.0` would have made the first release `0.2.0`. Proved by running
  `changeset version` and reverting. Noted in `_TEMPLATE-USAGE.md` so it does not
  get "fixed" back.
- **Type-level tests live in `tests/types/*.test-d.ts`**, enabled per-package via
  `typecheck: { enabled: true }` in `vitest.config.ts` so a plain `vitest run` —
  and therefore `turbo run test` and CI — picks them up with no extra wiring. If
  S9/S10 also need them, consider promoting that block into
  `tools/vitest-config`.
- **`@types/node` is a devDependency of `core`**, needed only by the
  `dist-interop` integration test. It does not affect the shipped bundle (which
  has no `dependencies` or `peerDependencies` at all — asserted in that test).
- `security/detect-unsafe-regex` fires on `core`'s ISO 8601 pattern. It is a
  false positive: safe-regex counts *bounded* repetitions toward star height. The
  pattern is anchored with only finite quantifiers and matches in linear time —
  measured at 0.72 ms against a one-million-character adversarial input. Suppressed
  inline with that justification. Note the placement rule learned here: an
  `eslint-disable-next-line` must sit on the line *immediately* before the
  reported line, so put the prose in a separate comment block above it.

### S9 — `@firstprinciples/logger` design decisions

- **Redaction is two independent mechanisms, both additive over built-in
  defaults.** Key-fragment substring match (`isSensitiveKey`) redacts a value
  whenever its key *contains* a known-sensitive fragment (`password`,
  `token`, `apikey`, `authorization`, `secret`, `cookie`, `ssn`,
  `creditcard`, `cvv`/`cvc`, `privatekey`, …) after stripping non-alphanumerics
  from the key — this is what catches `dbPassword`/`x-api-key`/`refreshToken`
  without enumerating every real-world variant. Value-shape pattern match
  (`isSecretShaped`) redacts any string containing a JWT, email, or a known
  cloud-provider key shape (Stripe/GitHub/AWS/Google/Slack/Bearer),
  regardless of key name — this is what catches a secret under a field
  nobody thought to name defensively. Both accept caller-supplied
  `keyFragments`/`patterns` that extend, never replace, the built-ins.
- **Value-shape patterns are deliberately unanchored.** A pattern matching
  anywhere in a string redacts the whole value, not just the matched
  substring. Trades a wider false-positive surface (a string that merely
  looks like a secret) for never partially leaking one embedded in a longer
  message. Consistent with `core`'s error-handling bias toward the safe
  failure mode.
- **Cycle detection tracks the ancestor chain, not every object seen.** A
  `WeakSet`/`Set` populated once for the whole tree would flag a
  legitimately-repeated object reference (the same user object attached to
  two fields — a DAG, not a cycle) as `[Circular]`, silently over-redacting.
  Add-before-recurse, delete-after (`ancestors.add(obj)` / `.delete(obj)`
  bracketing each recursive call) makes it a true ancestor-path check, proven
  by a dedicated test (`does not falsely flag the same object referenced
  twice`) alongside the real-cycle cases.
- **The redaction accumulator uses `Object.create(null)`, not `{}`.** Found
  while responding to eslint's `security/detect-object-injection` warning on
  `result[key] = ...`: `key` comes from the *input* object's own enumerable
  keys, so a log field literally named `__proto__` (plausible — `fields` is
  often untrusted request data) would hit the special prototype setter on a
  plain-literal accumulator. `Object.create(null)` neutralizes it: the
  assignment becomes an ordinary own property instead. This is the actual
  fix; the eslint suppression on that line is justified by this, not a bare
  "false positive" claim.
- **The browser correlation-ID fallback is real, working code with an
  honestly-documented limitation, not a stub.** There is no
  `AsyncLocalStorage` equivalent in any shipping browser (the `AsyncContext`
  proposal is still experimental), so `runWithCorrelationId` there is one
  shared module-level variable: correct for a synchronous scope and for a
  single in-flight async call, but two overlapping calls will observe each
  other's ID. `tests/unit/correlation-browser.test.ts` has a test asserting
  exactly that leak (not just a comment claiming it), so the limitation stays
  provably true as the implementation changes.
- **`createLoggerCore` (in `src/internal/core.ts`) is the only place level
  filtering, redaction, base-field merging and `child()` are implemented.**
  Node and browser entry points differ only in which `getCorrelationId` and
  default `Transport` factory they inject — everything else is one code
  path, one set of tests-worth of logic to keep correct, instead of two
  parallel implementations that could drift.
- **`pino-transport.ts` and `console-transport.ts` receive an
  already-redacted `LogEntry`; neither transport, nor any custom one, ever
  sees a raw field value.** This is what "redaction survives the transport
  boundary" (from the brief) means concretely: redaction happens once, in
  `core.ts`, before `transport.write()` is ever called — not delegated to
  pino's own `redact` option (which only supports static known paths, not
  the dynamic/value-shape redaction this package promises) and not repeated
  per-transport.
- **`tsup.config.ts` cleans `dist/` once, synchronously, at config-eval time
  (`rmSync` before `defineConfig`) rather than via either build config's own
  `clean: true`.** tsup runs a config array's multiple builds concurrently,
  not sequentially (confirmed empirically: interleaved "ESM Build start"
  lines from both entries in one `tsup` invocation) — a per-entry `clean:
  true` would race the other entry's just-written output and could silently
  delete it depending on timing. Verified with three consecutive rebuilds
  producing an identical file set each time.
- **`turbo run lint typecheck build test` combined in one command is unsafe
  for this package** (and for `core`, which has the same pattern) **and was
  not how this session actually validated anything** — every real check ran
  as its own `pnpm turbo run <single task>` step, matching `ci.yml`'s actual
  sequence. The combined form races a `build` task's `tsup` run against a
  `test` task's own `execFileSync('npx', ['tsup'])` inside its dist-interop
  integration tests (both write to the same package's `dist/`), which is
  what a single combined run actually surfaced (spuriously) on both
  packages. Not a regression, not fixed — just avoid running turbo tasks
  combined like that when checking a package with a dist-rebuilding
  integration test; run them separately instead, as CI does.

### S10 — `@firstprinciples/http-client` design decisions

- **`ApiResult`'s `kind` is three-way, not the two-way split the S7 write-up
  sketched.** `'http' | 'network'` covers the layering decision's own
  example, but this package's brief separately calls out a schema-validation
  failure as a distinct outcome from both (item 4). Rather than overload
  `kind: 'http'` with a validation failure that never really came from the
  server's status code, or invent a fourth top-level result type, `kind:
  'validation'` sits alongside the other two on the same `ApiErr`. `status`
  is still populated for a validation failure (it's the *response's* status,
  since the response itself arrived successfully) — only `kind: 'network'`
  ever has `status: undefined`.
- **`retryOn` takes the whole `ApiErr`, not the sketchier
  `(error, status?)` pair from `typed-fetch-client-spec.md` §5.3.** The spec
  wins on substance (retry policy, defaults, backoff), but its type sketch
  predates this package's actual `ApiErr` shape; passing the real `ApiErr`
  gives a custom `retryOn` access to `kind` directly instead of
  reconstructing it from `(error, status)`, and it's one type instead of
  two parameters to keep in sync.
- **`attempts` counts total attempts, including the first — not retries.**
  `attempts: 2` (the default) means one retry after an initial failure. The
  spec's own two sections disagree on this (§5.1's sketch comment says
  "default: no retry, or 1 retry on network failure only"; §5.3's
  `RetryConfig` says "default 2"); resolved in favor of the field actually
  named `attempts` matching its literal meaning, with `2` landing exactly on
  §5.1's "1 retry" description as a happy coincidence, not a compromise.
- **Full jitter, not equal jitter or a fixed exponential delay** — the
  delay before retry attempt `n` (0-indexed) is drawn uniformly from `[0,
  backoffMs * 2^n]`, per `computeBackoffMs`. This is what actually prevents
  a thundering herd: a fixed or equal-jitter backoff still has every client
  that failed at the same instant retrying in a narrow, correlated window.
- **The timeout/abort combination has exactly two possible signal
  sources, never more**: the internal per-attempt timeout `AbortController`,
  and an optional caller-supplied `signal`. `createCombinedSignal`
  (`src/internal/signal.ts`) builds a third controller only when a caller
  signal is actually present and not already aborted, wiring both as
  one-shot listeners into it; `cleanup()` clears the timer and detaches both
  listeners once the attempt settles, so a caller signal reused across many
  requests (a single `AbortController` shared by a whole page navigation,
  for instance) never accumulates listeners across retries.
- **Abort detection trusts the signal's own `aborted` flag, never the shape
  of the rejection's `cause`.** The first implementation checked `cause
  instanceof DOMException` to decide "was this an abort" — which is exactly
  wrong the moment a caller calls `AbortController#abort(reason)` with
  anything other than the default (a plain string is the common case): the
  rejection reason is then whatever the caller passed, not a `DOMException`
  at all, so the naive check silently reclassified a real caller abort as a
  generic network failure. Fixed by threading the combined signal's
  `aborted` boolean into `toNetworkError` explicitly (`src/internal/errors.ts`)
  instead of inferring it from `cause`; the internal timeout still gets a
  distinct, better message (`'timed out'` vs `'was aborted'`) because *our
  own* timeout controller deliberately always aborts with a `DOMException`
  named `'TimeoutError'`, which is a promise this package controls, unlike a
  caller's abort reason. `tests/unit/errors.test.ts` has a dedicated case
  for a caller aborting with a plain string, which is the regression guard.
- **A response body is parsed exactly once per attempt, from
  `content-type`**, in `src/internal/body.ts`: `204`/`205` or a zero-length
  body is `undefined`; `application/json` is `JSON.parse`d, falling back to
  the raw text on a parse failure rather than throwing (a malformed body is
  a server bug the caller should see in `result.value`/`result.error`, not
  a crash inside this client); anything else is returned as text.
- **`endpoint()`'s returned function is `async`, not a plain arrow
  returning a `Promise`.** `interpolatePath` throws synchronously
  (`ValidationError`) when the path names a parameter `params` doesn't
  supply — a genuine caller bug, not an expected API outcome, so it's a
  throw rather than a `kind: 'validation'` result on purpose. But a plain
  (non-`async`) arrow whose body throws before returning anything throws
  *synchronously* to the caller, not as a promise rejection — meaning
  `getUser().catch(...)` would work but `getUser()` alone (no `.catch`,
  relying on an outer `try`/`await`) would too, while a *non-awaited*
  `.then()`-only caller would get an uncaught synchronous exception instead
  of a rejected promise. Marking the returned function `async` normalizes
  this: any synchronous throw inside becomes a rejection regardless of how
  the caller consumes it. Found by reasoning through call styles while
  writing `tests/unit/client.test.ts`'s missing-param test, not by a
  reported bug.
- **`mergeHeaders`'s accumulator is `Object.create(null)`, not `{}`** — the
  same prototype-pollution-shaped fix as `@firstprinciples/logger`'s S9
  redaction accumulator, for the same reason: header names are
  caller-supplied (`defaultHeaders`, per-call `headers`), and a header
  literally named `__proto__` is plausible if headers are ever built from
  untrusted input upstream of this client.
- **`toHttpError`'s status→class mapping only covers 400/401/403/404/409** —
  the statuses `core` ships a named subclass for. Anything else (422, 500,
  502, 503 from a real server as opposed to this package's own `NetworkError`
  for a transport-level 503, teapot 418, …) falls back to a plain `AppError`
  with `httpStatus` set to the real status, per `core`'s "httpStatus is
  always set, even on the fallback class" convention (S7 decision 5) —
  never silently defaulting to the base class's own `500`.
- **`isOk`/`isErr` are not re-exported from this package.**
  `@firstprinciples/core` is already a required runtime dependency of any
  consumer using `ApiResult` meaningfully, so re-exporting core's own
  narrowing guards here would just be a second name for the same function
  with no real benefit — and it very nearly hid a real question during
  development: an integration test asserting on tree-shaking treated the
  re-export as a thing that should disappear when unused, which esbuild
  does not reliably do for a bare pass-through re-export of an external
  package. Removing the re-export removed the ambiguity entirely rather
  than working around esbuild's specific behavior here.

### S10 — a cross-package `turbo.json` fix (affects every future package)

- **`test` now depends on `^test`, not just `^build`.** `core`'s
  `dist-interop` integration test rebuilds `core`'s own `dist/` mid-run
  (`execFileSync('npx', ['tsup'])`, by design since S7 — "never trust a
  stale artifact"). Once `http-client` existed as the first package with a
  real runtime dependency on `core` (`logger` has none), running the whole
  suite (`pnpm turbo run test`, exactly what `ci.yml` does) let `core#test`
  and `http-client#test` run concurrently — turbo's old `test: { dependsOn:
  ["^build"] }` only ordered `core`'s *build* before `http-client`'s test,
  not `core`'s *test*, so `http-client#test`'s `tsc` typecheck could read
  `core`'s `dist/index.d.ts` at the exact moment `core#test`'s rebuild had
  deleted it (tsup's `clean: true`) and not yet regenerated it —
  `TypeCheckError: Could not find a declaration file for module
  '@firstprinciples/core'`. This was latent since S7 and would have hit
  real CI the first time this PR ran there, not a flake specific to this
  machine. Fixed by adding `^test` to the `test` task's `dependsOn` in
  `turbo.json` — verified clean across 3 consecutive
  `rm -rf packages/*/dist packages/*/coverage .turbo && pnpm turbo run test`
  runs from a fully clean state, where it had failed reliably before the
  fix. Same family as S9's "don't combine turbo tasks" finding, one level
  up: that one was a package racing its own `build` against its own `test`;
  this one is one package's `test` racing a *different* package's `test`.

---

## Gate status

- **Gate 1 (CI green on empty scaffold):** PASSED. `ci.yml`/`codeql.yml` green since S6 (PR #6). The `release.yml` no-op leftover is resolved by evidence, not assumption: it later ran for real (not a no-op) when PR #10's merge published `core` (S8) — the same workflow, same OIDC/`NPM_TOKEN` wiring, exercised live and succeeded. Branch protection on `main` was never directly confirmed via API (no tool for it), but four PRs (#8–#11) have gone through the standard PR+merge flow with CI required to pass, which is consistent with protection being on; treat as inferred, not verified, if it ever matters again.
- **Gate 2 (core published to npm 0.1.0 with provenance):** PASSED WITH A KNOWN GAP. `@firstprinciples/core@0.1.0` is live on npm (S8) — confirmed directly against the registry. Provenance was checked the same way and found missing (no `dist.attestations` on the published version) despite `publishConfig.provenance: true` being set; root-caused to pnpm not reading that field at all (see PRE-S9 row above) and fixed via a root `.npmrc` (`provenance=true`). **The fix itself is unverified** — it can only be proven by the next real npm publish showing `dist.attestations.provenance` on the registry. Check that the first time any future package (e.g. `logger`) actually publishes, before assuming the fix worked.

---

## Per-package Definition of Done matrix

Columns per Final_plan.md §5 / spec §12. ☐ = not done, ☑ = done.

`core` is fully done except the docs site page, which has no home yet (`docs/` doesn't exist — deferred, low priority, tracked under Parked problems below).

| Package | index.ts clean | TSDoc | README | Coverage | Edge cases | Type-level tests | size-limit | npm audit | CodeQL | Provenance publish | /examples | Root README | Docs page |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| core | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑* | ☑ | ☑ | ☐ |

\* Published and live, but see the Gate 2 note above — the provenance *attestation* specifically is a fix awaiting verification on the next real publish, not yet reconfirmed for `core` itself (no re-publish planned just to test it).
| logger | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☐ | ☐ | ☑ | ☑ | ☐ |
| http-client | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☐ | ☐ | ☑ | ☑ | ☐ |
| cache-kit | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| api-kit | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| auth-utils | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| access-control | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| bootstrap | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| queue | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| realtime-kit | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| react-query-kit | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| react-forms | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| module-federation-kit | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

---

## Parked problems / open questions

- **Community standards (GOV-1):** GitHub evaluates Insights → Community standards on default branch `main` only. Description/topics were set via API. File-based items (LICENSE, CoC, CONTRIBUTING, SECURITY, templates) go green after this S2 re-land merges to `main`.
- ~~S7 (`core` design) must explicitly resolve the `Result`/error-class layering question~~ — **RESOLVED in S7**, written up as decision 1 under "S7 — `@firstprinciples/core` design decisions" above, with the per-session consequences spelled out for S10, S12 and S16.
- ~~**Open for S10 (`http-client`):** a network failure has no matching error class in `core`.~~ — **RESOLVED in S10.** `NetworkError` (code `NETWORK_ERROR`, `httpStatus` 503) added to `core`, own changeset (`core-network-error.md`, minor). `api-kit` (S12) can map it via `error instanceof NetworkError` / `error.code === 'NETWORK_ERROR'` without importing from `http-client`.
- ~~**Open for S8 (Definition of Done):** `pnpm audit --prod` reports one **low** advisory — `esbuild`~~ — **RESOLVED in S8** (PR #9): pinned via pnpm `overrides` to `>=0.28.1`. `pnpm audit --prod` reverified clean.
- **Open, low priority:** `AppError.fromJSON` restores a custom subclass's *data* and `name` but not its *class* — the registry only knows the six built-ins. There is deliberately no public registration API (a mutable global). Revisit only if a real consumer needs `instanceof` to survive a round-trip.
- ~~Gate 1 leftovers~~ — **RESOLVED**, see Gate status above.
- **Docs site page for `core`:** deferred — `docs/` doesn't exist yet anywhere in the repo. Whichever session first stands up the docs site should backfill `core`'s page as part of that, not treat it as `core`-specific debt. Same now applies to `logger`.
- **Open, found PRE-S9, unverified:** the `.npmrc` `provenance=true` fix (see PRE-S9 row above) needs confirming against a real publish — check `registry.npmjs.org/@firstprinciples/<pkg>`'s `versions[<ver>].dist.attestations` the first time any package publishes after this fix, don't assume it worked. `logger`'s eventual publish is the next opportunity to check this.
- **Found in S9, not fixed:** `tools/package-template/package.json` pins `eslint@^10.8.1` / `typescript@^7.0.2`, which don't match the locked `eslint@^9.39.5` / `typescript@^6.0.3` (see Decisions locked above — chosen for specific peer-dependency reasons). `core` and `logger` both used the locked versions directly rather than the template's, so no shipped package is affected yet, but the template itself will hand the wrong versions to the next package that copies it. Worth a one-line fix whenever a session is already touching the template for another reason.
- **Found in S9, not fixed:** root `package.json`'s own top-level `eslint` devDependency is `^10.8.1`, not the locked `^9.39.5`. Doesn't affect CI (each package pins and lints at its own correct version), but does mean the local pre-commit hook (`lint-staged` → `eslint --fix`, run from repo root) executes at a different major version than what actually gates CI. Low priority; revisit if pre-commit ever behaves differently from CI on a lint rule.
- **Fixed in S9, worth re-confirming after any future `pnpm install`:** root `package.json` had `@changesets/cli` at `^3.0.0` — silently drifted from S6's explicit `^2.31.1` pin (most likely a Dependabot dev-dependency-group bump between S6 and S7 that nobody cross-checked against S6's specific reasoning: `3.0.0` failed to install reliably in a clean CI environment). Reverted to `^2.31.1` in this session; full pipeline (lint/typecheck/test/build/audit/prettier, each run separately) reverified clean afterward. If Dependabot proposes bumping `@changesets/cli` again, the PR needs the same clean-environment-install check S6 did before merging, not a rubber-stamp.
- **Found in S10, not fixed — an intermittent, pre-existing race inside `logger`'s own test suite, unrelated to `http-client`.** Repeatedly running `pnpm turbo run test` across the whole workspace (6+ from-clean-state runs, verifying the S10 `turbo.json` fix above) hit this once: `logger`'s `tests/integration/dist-node-interop.test.ts` and `tests/integration/dist-browser.test.ts` each have their own `beforeAll` that independently runs `execFileSync('npx', ['tsup'], { cwd: packageRoot })` to rebuild `logger`'s dist (the same "always rebuild, never trust a stale artifact" pattern from S7/S9). Vitest runs test *files* concurrently by default, so both `beforeAll`s can fire close together — two separate `tsup` **processes** racing on the same `dist/` (worse than the S9-documented race, which was two builds *within one* `tsup` invocation's config array). Failure seen: `Error: Command failed: npx tsup` inside `dist-browser.test.ts`'s `beforeAll`. Did not reproduce in `logger` run alone (3/3 clean) or in the other 6 full-workspace `turbo run test` runs — genuinely rare, likely needs enough concurrent system load (from other packages' simultaneous build/test tasks) to widen the collision window. Not fixed here: it's `logger`'s file, outside this session's `PKG-HTTP` ticket, and a real fix (serializing the two rebuilds — e.g. a single shared `beforeAll` across both integration test files, or `execFileSync` under a lock) deserves its own focused session rather than a drive-by edit. Likely affects real CI too, since `ci.yml`'s "Test with coverage" step is exactly `pnpm turbo run test` — if a PR's CI run ever fails on `logger`'s `dist-browser.test.ts` with this exact error, it's this race, not a real regression; retry the job.

---

## Next session

**S11 · `cache-kit`** — fresh chat, Claude Sonnet 5 · `/effort high`. Story: `PKG-CACHE`. Per its own prompt: read `EXECUTION-CHECKLIST.md` and `sprocket-ecosystem-spec.md` §10.12 in `../Preparation_Docs/`. Nothing else. Build `@firstprinciples/cache-kit`: typed get/set/wrap/invalidate over in-memory LRU and Redis backends, tag-based invalidation, cache-stampede protection, both backends interchangeable behind one interface. First package needing testcontainers in CI — budget time for the Docker wiring; ephemeral containers inside the Actions runner stay free, which matters given the zero-cost constraint on this project. The single-flight dedup is the hardest problem and the one genuine concurrency race: reason about it carefully rather than pattern-matching, and the test that actually matters is N simultaneous misses for the same key producing EXACTLY ONE upstream call. Also cover TTL expiry boundaries, eviction under memory pressure, Redis connection loss mid-operation, and tag invalidation correctness on both backends. `cache-kit` was not one of the three sessions the S7 `core`/`http-client` layering decision explicitly named (`http-client`, `api-kit`, `access-control` were) — worth a quick read of that decision anyway (under "S7 — `@firstprinciples/core` design decisions" above, plus S10's own follow-on decisions below it) to judge whether `cache-kit`'s wrap/invalidate outcomes are `Result`-shaped at all, or whether a cache hit/miss is different enough that they shouldn't force-fit the pattern. Full DoD before finishing; update this file; open a PR.
