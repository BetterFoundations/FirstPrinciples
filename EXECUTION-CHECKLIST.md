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


---

## Gate status

- **Gate 1 (CI green on empty scaffold):** PARTIALLY PASSED — `ci.yml` and `codeql.yml` both confirmed green on GitHub (S6, PR #6, commit `fe1b255`); `docs.yml` correctly skipped (no matching path changes yet). **Still outstanding before Gate 1 can be marked fully PASSED:** (1) `release.yml` no-op verification and (2) branch protection on `main` requiring CI to pass — both require merging PR #6 into `main`, which needs explicit human sign-off first (merging triggers `release.yml`'s real `pnpm changeset publish` step against the live npm registry via `NPM_TOKEN`, even though it should no-op with zero pending changesets). Do not start `CORE-1`/any package code until both are done and this line is updated to fully PASSED. **Status at S7:** PR #6 has since been merged to `main` (`460773f`), which will have triggered `release.yml` — but neither that run's outcome nor branch protection was verifiable from this session (no `gh` CLI available), so this line stays PARTIALLY PASSED. S7 was run at the user's explicit direction with that noted; **S8 must confirm both before publishing**, since Gate 2 exercises the same `release.yml` for real.
- **Gate 2 (core published to npm 0.1.0 with provenance):** READY, NOT STARTED. `core`'s code, tests, README, size budget and changeset are all in place and green locally; `packages/core/package.json` sits at `0.0.0` so the pending `minor` changeset versions it to exactly `0.1.0` (verified). S8 owns the branch, PR, merge and publish.

---

## Per-package Definition of Done matrix

Columns per Final_plan.md §5 / spec §12. ☐ = not done, ☑ = done.

`core`'s remaining boxes are all S8 (Gate 2) work, not design work: `npm audit` and CodeQL need the branch pushed, provenance publish is the gate itself, and `/examples` plus the docs page follow the publish. Its call sites are already compiled and typechecked as `packages/core/tests/types/call-sites.test-d.ts`, so the `/examples` app can be lifted from there rather than written from scratch.

| Package | index.ts clean | TSDoc | README | Coverage | Edge cases | Type-level tests | size-limit | npm audit | CodeQL | Provenance publish | /examples | Root README | Docs page |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| core | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ | ☐ | ☐ | ☐ | ☐ | ☑ | ☐ |
| logger | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| http-client | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
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
- **Open for S10 (`http-client`):** a network failure has no matching error class in `core`. Propose promoting a `NetworkError` (code `NETWORK_ERROR`, `httpStatus` 503) *into* `core` rather than defining it locally, so `api-kit` can map it without importing from `http-client`. That is an additive `core` change, so it needs its own changeset.
- **Open for S8 (Definition of Done):** `pnpm audit --prod` reports one **low** advisory — `esbuild` "arbitrary file read when running the dev server", patched in `>=0.28.1`. Two copies are resolved: `0.28.2` (via `@size-limit/esbuild`, fine) and `0.27.7` (via `vitest`/`tsup`, vulnerable). It is dev-tooling only and ships in nothing — `core` has no `dependencies` and no `peerDependencies`, asserted in `tests/integration/dist-interop.test.ts`. Candidate fix is a pnpm `overrides` entry pinning `esbuild` to `>=0.28.1`, but that is a lockfile-wide resolution change that should be made with CI watching, not at the end of a design session. Left for the session that ticks the `npm audit` box.
- **Open, low priority:** `AppError.fromJSON` restores a custom subclass's *data* and `name` but not its *class* — the registry only knows the six built-ins. There is deliberately no public registration API (a mutable global). Revisit only if a real consumer needs `instanceof` to survive a round-trip.
- **Gate 1 leftovers are still outstanding** and are not S7's to close — see Gate status below.

---

## Next session

**S8 · 🚦 GATE 2 — publish `core` 0.1.0** — fresh chat, Claude Sonnet 5 · `/effort high`. Story: `CORE-4`. The design is in the code and in this file now, so a fresh chat is safe. Before publishing: confirm the two Gate 1 leftovers (`release.yml` no-op on the PR #6 merge, and branch protection on `main`). Then complete `core`'s Definition of Done — `npm audit`, CodeQL, an `/examples` app (liftable from `packages/core/tests/types/call-sites.test-d.ts`, which already compiles), the docs page — and run the real changeset → version PR → merge → `--provenance` publish path. Note that S7's work is **uncommitted**: `packages/core/`, the changeset, root `README.md`, `EXECUTION-CHECKLIST.md`, and shared-tooling fixes in `tools/package-template/` are all untracked or modified on top of `460773f`. See `sessions-all-prompts.md`.
