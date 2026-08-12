# FirstPrinciples — Jira Backlog

Story-level breakdown of [Final_plan.md](Final_plan.md). Created in Jira project **FIP** ([FirstPrinciples](https://algotrail.atlassian.net/browse/FIP)) on 2026-08-11.

**How to read this:** each story carries a stable **Ref** (e.g. `SCAF-1`) plus the live Jira **Ticket** key. Refs still express dependencies in this doc; use ticket keys when linking work in Jira.

**Points:** Fibonacci, where 1 ≈ under an hour, 3 ≈ one focused session, 8 ≈ multi-session with real design risk.

---

## Epics

| Ref | Epic | Ticket | Stories | Points |
|---|---|---|---|---|
| **E1** | Foundations & Accounts | `FIP-2` | 5 | 12 |
| **E2** | Monorepo Scaffold | `FIP-3` | 5 | 16 |
| **E3** | CI/CD & Security Automation | `FIP-4` | 5 | 21 |
| **E4** | Governance & Repo Hygiene | `FIP-5` | 3 | 8 |
| **E5** | `core` — Foundation Package | `FIP-6` | 4 | 21 |
| **E6** | Cross-Cutting Utilities | `FIP-7` | 3 | 26 |
| **E7** | Backend Conventions & Security | `FIP-8` | 4 | 34 |
| **E8** | Service Lifecycle | `FIP-9` | 2 | 16 |
| **E9** | Realtime & Frontend | `FIP-10` | 3 | 21 |
| **E10** | Module Federation | `FIP-11` | 1 | 13 |
| **E11** | Documentation & Examples | `FIP-12` | 4 | 21 |
| **E12** | Release & Hardening | `FIP-13` | 3 | 16 |
| **E13** | Open Source Contributions | `FIP-14` | 5 | 21 |
| | **Total** | | **47** | **246** |

---

# E1 · Foundations & Accounts

### `PREP-1` — Lock the package scope name
**Ticket:** `FIP-15` · **Points:** 1 · **Depends on:** — · **Labels:** `decision`, `blocker`

Choose the npm scope all 13 packages publish under. All three candidates (`@firstprinciples`, `@betterfoundations`, `@sprocket`) were verified unclaimed on 2026-08-11. Plan defaults to `@firstprinciples`.

Blocking because an npm org cannot be renamed, and the scope is baked into 13 `package.json` files plus every README, import example, and docs page.

**Acceptance criteria**
- [ ] Scope name decided and recorded in `Final_plan.md` §2.1
- [ ] Availability re-confirmed at time of decision
- [ ] If not `@firstprinciples`, find-and-replace applied across all planning docs

---

### `PREP-2` — Upgrade Node to 24 LTS and enable pnpm
**Ticket:** `FIP-16` · **Points:** 2 · **Depends on:** — · **Labels:** `tooling`, `security`

Local Node is v20.17.0 — the Iron line reached end-of-life in April 2026 and receives no further security patches. Move to Node 24 LTS ("Krypton") and enable pnpm via corepack.

**Acceptance criteria**
- [ ] `nvm install 24 && nvm alias default 24`
- [ ] `node -v` reports v24.x
- [ ] `corepack enable pnpm` and `pnpm -v` succeeds
- [ ] Version recorded for use in `.nvmrc` (`SCAF-1`)

---

### `PREP-3` — Configure git identity and GitHub SSH authentication
**Ticket:** `FIP-17` · **Points:** 2 · **Depends on:** — · **Labels:** `tooling`

`ssh -T git@github.com` currently fails with `Permission denied (publickey)` — no key is registered.

**Acceptance criteria**
- [ ] `git config --global user.name` / `user.email` set, email matching the GitHub account so commits link to the profile
- [ ] `git config --global init.defaultBranch main`
- [ ] ed25519 key generated and added to GitHub
- [ ] `ssh -T git@github.com` returns the "successfully authenticated" greeting

---

### `PREP-4` — Create npm organization and publish token
**Ticket:** `FIP-18` · **Points:** 3 · **Depends on:** `PREP-1` · **Labels:** `infra`, `security`, `blocker`

Create the npm org matching the chosen scope, enable 2FA, and wire a CI publish token.

Token must be a **Granular Access Token scoped to this org only** with an expiry — an unrestricted token in a public repo's secrets is a real blast-radius problem.

**Acceptance criteria**
- [ ] npm org created matching the scope from `PREP-1`
- [ ] 2FA enabled on the npm account
- [ ] `npm login` complete; `npm whoami` shows an account that is a **member of the org**, not just a personal account
- [ ] Granular token generated, scoped to the org, read+write on packages, with a noted expiry/rotation date
- [ ] Added as repo secret `NPM_TOKEN`

---

### `PREP-5` — Enable GitHub repository security features
**Ticket:** `FIP-19` · **Points:** 2 · **Depends on:** — · **Labels:** `infra`, `security`

All free on public repos; all should be on before any code lands.

**Acceptance criteria**
- [ ] Dependabot alerts + security updates enabled
- [ ] Secret scanning + push protection enabled
- [ ] Private vulnerability reporting enabled (backs `SECURITY.md`)
- [ ] GitHub Pages enabled with source set to GitHub Actions
- [ ] Repo topics and description set for discoverability

---

# E2 · Monorepo Scaffold

### `SCAF-1` — pnpm workspace and root package configuration
**Ticket:** `FIP-20` · **Points:** 3 · **Depends on:** `PREP-2` · **Labels:** `infra`

Root `package.json`, `pnpm-workspace.yaml` covering `packages/*`, `docs`, `examples/*`, `.nvmrc` pinned to Node 24, and `.gitignore`.

**Acceptance criteria**
- [ ] `pnpm install` succeeds from a clean clone
- [ ] Workspace globs resolve `packages/*`, `docs`, `examples/*`
- [ ] `.nvmrc` pins the Node 24 version from `PREP-2`
- [ ] Root `package.json` is `"private": true` — the root must never be publishable

---

### `SCAF-2` — Turborepo pipeline
**Ticket:** `FIP-21` · **Points:** 3 · **Depends on:** `SCAF-1` · **Labels:** `infra`

`turbo.json` with `build`, `test`, `lint`, `typecheck` tasks and correct `dependsOn`/`outputs` wiring.

**Do not** configure remote caching — local + CI cache is free and sufficient; Vercel Remote Cache is an explicit non-goal.

**Acceptance criteria**
- [ ] All four tasks defined with `^build` dependencies where required
- [ ] `outputs` set so caching actually works (`dist/**`, `coverage/**`)
- [ ] No `remoteCache` block present
- [ ] Second consecutive `turbo run build` reports cache hits

---

### `SCAF-3` — Shared tsconfig and ESLint config packages
**Ticket:** `FIP-22` · **Points:** 5 · **Depends on:** `SCAF-1` · **Labels:** `infra`

`tools/tsconfig-base/` and `tools/eslint-config/` as real workspace packages every package extends, so standards live in one place.

TypeScript must include `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `declaration`, `declarationMap`, `isolatedModules`. ESLint flat config with `@typescript-eslint`, `eslint-plugin-import`, `eslint-plugin-security`, `eslint-plugin-tsdoc`.

**Acceptance criteria**
- [ ] Both consumable via workspace protocol
- [ ] All strictness flags from spec §4.4 present
- [ ] `eslint-plugin-tsdoc` active — this is what enforces the TSDoc requirement in the Definition of Done
- [ ] Verified against a throwaway package, then removed

---

### `SCAF-4` — Prettier, Husky, and lint-staged
**Ticket:** `FIP-23` · **Points:** 2 · **Depends on:** `SCAF-3` · **Labels:** `infra`, `dx`

**Acceptance criteria**
- [ ] `.prettierrc` present, not conflicting with ESLint
- [ ] Husky pre-commit runs lint-staged
- [ ] lint-staged runs eslint --fix and prettier on staged files only
- [ ] Hook verified to fire on a real commit

---

### `SCAF-5` — Initialize Changesets
**Ticket:** `FIP-24` · **Points:** 3 · **Depends on:** `SCAF-1` · **Labels:** `infra`, `release`

`changeset init` plus `.changeset/config.json` configured for public access and the correct base branch.

**Acceptance criteria**
- [ ] `.changeset/config.json` present with `"access": "public"`
- [ ] `baseBranch` set to `main`
- [ ] Changeset creation and `changeset status` both verified locally
- [ ] Contributor instructions added to `CONTRIBUTING.md` (`GOV-1`)

---

# E3 · CI/CD & Security Automation

### `CI-1` — Main CI workflow
**Ticket:** `FIP-25` · **Points:** 5 · **Depends on:** `SCAF-2`, `SCAF-3` · **Labels:** `ci`

`ci.yml` on every PR and push to `main`: pnpm + Node setup with caching, frozen-lockfile install, lint, typecheck, test with coverage, build, and a changeset-presence check.

Coverage summary writes to `$GITHUB_STEP_SUMMARY` and the HTML report uploads as an artifact — this is what replaces a paid Codecov tier.

**Acceptance criteria**
- [ ] Runs on `pull_request` and push to `main`
- [ ] Node version read from `.nvmrc`, pnpm store cached
- [ ] `pnpm install --frozen-lockfile`
- [ ] lint, typecheck, test+coverage, build all run via turbo
- [ ] Job **fails** when coverage is under threshold (verify by deliberately breaking it once)
- [ ] Coverage summary visible in the run; HTML uploaded as artifact
- [ ] `changeset status` fails a PR that changes package code without a changeset

---

### `CI-2` — CodeQL and Dependabot
**Ticket:** `FIP-26` · **Points:** 3 · **Depends on:** `PREP-5` · **Labels:** `ci`, `security`

`codeql.yml` for `javascript-typescript` on push/PR plus a weekly schedule, and `.github/dependabot.yml` for weekly npm updates with dev-dependencies grouped.

**Acceptance criteria**
- [ ] CodeQL runs and reports into the Security tab
- [ ] Weekly cron configured
- [ ] Dependabot config valid; dev deps grouped into a single PR
- [ ] First Dependabot run observed

---

### `CI-3` — Release workflow with provenance
**Ticket:** `FIP-27` · **Points:** 8 · **Depends on:** `SCAF-5`, `PREP-4` · **Labels:** `ci`, `release`, `high-risk`

`release.yml` on push to `main`: build, then the Changesets action either opens a "Version Packages" PR or publishes.

**Highest-risk workflow in the repo.** OIDC permission scoping (`id-token: write` for provenance) and the Changesets action wiring have failure modes that only surface at actual publish time. Worth deliberate care now rather than debugging a broken publish later.

**Acceptance criteria**
- [ ] `permissions` block includes `contents: write`, `pull-requests: write`, `id-token: write`
- [ ] `setup-node` configured with `registry-url`
- [ ] `GITHUB_TOKEN` (automatic) and `NPM_TOKEN` (from `PREP-4`) both wired
- [ ] Pending changesets produce a Version Packages PR
- [ ] Merging that PR publishes to npm
- [ ] Published package shows a **provenance badge** on npm — this is the proof OIDC is correctly wired
- [ ] Fully validated end-to-end by `CORE-4`

---

### `CI-4` — Bundle size budgets
**Ticket:** `FIP-28` · **Points:** 3 · **Depends on:** `CI-1` · **Labels:** `ci`, `performance`

`size-limit` wired into CI with per-package budgets and PR comments on size deltas.

**Acceptance criteria**
- [ ] size-limit runs in CI
- [ ] Per-package `size-limit.json` pattern established for packages to follow
- [ ] Size deltas commented on PRs
- [ ] Exceeding a budget fails the job

---

### `CI-5` — 🚦 GATE 1: CI green on empty scaffold
**Ticket:** `FIP-29` · **Points:** 2 · **Depends on:** `CI-1`, `CI-2`, `CI-3`, `CI-4`, `GOV-1`, `GOV-2` · **Labels:** `gate`, `blocker`

Push the complete scaffold with **zero packages** and confirm every workflow passes.

**Hard gate — no package code may be written until this is green.** Tooling problems are cheap to fix now and expensive to fix under 13 packages.

**Acceptance criteria**
- [ ] `ci.yml` green on an empty scaffold
- [ ] `codeql.yml` green
- [ ] `docs.yml` green or correctly skipped
- [ ] `release.yml` runs without error (no-op with no changesets)
- [ ] Branch protection on `main` requires CI to pass
- [ ] Explicitly signed off before `CORE-1` starts

---

# E4 · Governance & Repo Hygiene

### `GOV-1` — Core governance files
**Ticket:** `FIP-30` · **Points:** 3 · **Depends on:** `SCAF-1` · **Labels:** `docs`, `governance`

MIT `LICENSE`, `CONTRIBUTING.md` (local setup, changeset workflow, PR expectations), `CODE_OF_CONDUCT.md` (Contributor Covenant), `SECURITY.md` (supported versions + private vulnerability reporting), `.github/CODEOWNERS`.

`CONTRIBUTING.md` matters more than usual here — you're about to publish advice to open-source maintainers on exactly this, so the repo should model it.

**Acceptance criteria**
- [ ] All five files present
- [ ] `SECURITY.md` points at GitHub private vulnerability reporting, not a personal email
- [ ] `CONTRIBUTING.md` documents the changeset requirement
- [ ] GitHub's community-standards checklist shows all green

---

### `GOV-2` — Issue and PR templates
**Ticket:** `FIP-31` · **Points:** 2 · **Depends on:** `SCAF-1` · **Labels:** `docs`, `governance`

**Acceptance criteria**
- [ ] `ISSUE_TEMPLATE/bug_report.md` and `feature_request.md`
- [ ] Bug template asks for package name, version, and a reproduction
- [ ] `PULL_REQUEST_TEMPLATE.md` includes a changeset checkbox
- [ ] Templates render correctly in the GitHub UI

---

### `GOV-3` — Package template and Definition of Done checklist
**Ticket:** `FIP-32` · **Points:** 3 · **Depends on:** `SCAF-3`, `CI-4` · **Labels:** `dx`, `infra`

A reusable per-package skeleton (spec §3.1) so all 13 packages are structurally identical — this uniformity is exactly what lets turbo, size-limit, and Changesets work with zero per-package special-casing.

**Acceptance criteria**
- [ ] Template covers `src/`, `src/internal/`, `tests/{unit,edge-cases,integration}/`, README, `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `size-limit.json`
- [ ] `package.json` template has correct `exports`, `sideEffects: false`, `files`, `engines`, and **`publishConfig.access: "public"` with `provenance: true`**
- [ ] README skeleton follows spec §8.1 section order
- [ ] Definition of Done checklist committed to the repo for per-package sign-off

---

# E5 · `core` — Foundation Package

> **Model guidance:** Opus 5 with "ultrathink". Every other package imports from here; a bad shape means painful refactors or everyone quietly working around it.

### `CORE-1` — Typed error class hierarchy
**Ticket:** `FIP-33` · **Points:** 5 · **Depends on:** `CI-5`, `GOV-3` · **Labels:** `package:core`, `design`, `high-risk`

`AppError` base plus `ValidationError`, `NotFoundError`, `ForbiddenError`, `UnauthorizedError`, `ConflictError`, each carrying `code`, `httpStatus`, and optional `details`.

This taxonomy propagates into `http-client`, `api-kit`, `access-control`, and every consumer — design for composition, not just coverage of today's cases.

**Acceptance criteria**
- [ ] All six classes with `code`, `httpStatus`, `details?`
- [ ] `toJSON()` serialization round-trips losslessly
- [ ] `instanceof` works correctly across the hierarchy (verify the TS class-extends-Error transpilation pitfall)
- [ ] Stack traces preserved through the chain
- [ ] Zero runtime dependencies
- [ ] Unit + edge-case tests at threshold

---

### `CORE-2` — `Result<T, E>` type and combinators
**Ticket:** `FIP-34` · **Points:** 5 · **Depends on:** `CORE-1` · **Labels:** `package:core`, `design`, `high-risk`

`Result<T, E>` with `ok()`/`err()` constructors and `isOk()`/`isErr()` guards.

**Must resolve the layering question from `Final_plan.md` §2.2:** how `Result`'s error variant carries a `core` error instance, so `http-client` gets exhaustive narrowing *and* the shared error taxonomy. Decide here — `http-client` depends on the answer.

**Acceptance criteria**
- [ ] Constructors and type guards implemented
- [ ] Guards narrow correctly in both branches under `strict`
- [ ] Composition with `AppError` decided and documented
- [ ] `expectTypeOf` type-level tests covering inference
- [ ] Ergonomics validated by writing 3–4 realistic call-site snippets **before** finalizing the API — an awkward signature is a design bug

---

### `CORE-3` — Branded primitive types
**Ticket:** `FIP-35` · **Points:** 3 · **Depends on:** `CORE-2` · **Labels:** `package:core`

`Email`, `UUID`, `ISODateString` as branded types with validating constructors.

**Acceptance criteria**
- [ ] Branded types reject raw strings at compile time
- [ ] Validators return `Result` rather than throwing
- [ ] Type-level tests confirm a plain `string` is not assignable
- [ ] Edge cases covered: empty, malformed, boundary-valid values

---

### `CORE-4` — 🚦 GATE 2: publish `core` 0.1.0
**Ticket:** `FIP-36` · **Points:** 8 · **Depends on:** `CORE-3`, `CI-3` · **Labels:** `package:core`, `release`, `gate`, `blocker`

Complete the full Definition of Done for `core` and publish it — the real end-to-end validation of the release pipeline.

**Hard gate.** Do not build twelve more packages on an unproven publish path.

**Acceptance criteria**
- [ ] Full Definition of Done checklist passed
- [ ] README complete per spec §8.1
- [ ] Coverage ≥90% lines/functions, ≥85% branches
- [ ] size-limit budget set and passing
- [ ] Changeset → Version PR → merge → publish completes
- [ ] **Package visible on npm with a provenance badge**
- [ ] `npm install @<scope>/core` works from a clean directory outside the repo
- [ ] `CHANGELOG.md` auto-generated

---

# E6 · Cross-Cutting Utilities

### `PKG-LOGGER` — `logger`
**Ticket:** `FIP-37` · **Points:** 8 · **Depends on:** `CORE-4` · **Labels:** `package:logger`

Structured isomorphic logging: pino on Node, lightweight console fallback in browser, `AsyncLocalStorage` correlation IDs, pluggable transports, and automatic secret/PII redaction.

**Redaction is the high-risk part** — a secret leaking through a nested object is an incident, not a bug. Give it disproportionate test attention.

**Acceptance criteria**
- [ ] Node and browser entry points both work; browser build pulls in no Node built-ins
- [ ] Redaction covers deeply nested objects, arrays, and secret-shaped strings (API keys, JWTs, emails)
- [ ] Redaction patterns configurable
- [ ] Correlation IDs propagate across async boundaries including `Promise.all` and timers
- [ ] Adversarial redaction tests: nested, circular refs, non-serializable values
- [ ] Full Definition of Done

---

### `PKG-HTTP` — `http-client`
**Ticket:** `FIP-38` · **Points:** 8 · **Depends on:** `CORE-4` · **Labels:** `package:http-client`, `high-risk`

Built to **`../Preparation_Docs/typed-fetch-client-spec.md`**, which is authoritative for this package and wins wherever it differs from the ecosystem spec's §10.3.

Client factory, all five verbs, endpoint-definition pattern, retry with exponential backoff + jitter, timeout via `AbortController`, `onRequest`/`onResponse` hooks, pluggable validation adapter. Target 3–5KB gzipped.

Two details that are easy to get subtly wrong:
- A network failure (timeout/DNS) must be a **distinct result variant** from a typed HTTP error — callers handle them differently.
- A caller-supplied `signal` must be **combined** with the internal timeout controller, not allowed to replace it.

**Acceptance criteria**
- [ ] `ApiResult` union covers success, HTTP error, network error, and validation error as distinct variants
- [ ] Default retry policy: network errors and 5xx only, **never** 4xx
- [ ] Backoff is exponential with jitter; timing verified with fake timers
- [ ] Caller `signal` composes with internal timeout — whichever fires first wins
- [ ] Interceptor ordering verified; `onResponse` runs before parsing
- [ ] Validation adapter is pluggable — **no** hard Zod/Valibot dependency in core
- [ ] Zod and Valibot adapter examples live in docs, not in the package
- [ ] Bundle size confirmed within the 3–5KB target
- [ ] Tree-shaking verified: a consumer importing only `createApiClient` doesn't pull unused code
- [ ] Full Definition of Done

---

### `PKG-CACHE` — `cache-kit`
**Ticket:** `FIP-39` · **Points:** 8 · **Depends on:** `CORE-4` · **Labels:** `package:cache-kit`, `high-risk`

Typed `get`/`set`/`wrap`/`invalidate` over in-memory LRU and Redis backends, tag-based invalidation, and cache-stampede (single-flight) protection.

**First package to need `testcontainers` in CI** — budget extra time for that Docker wiring. Ephemeral containers inside the Actions runner remain free.

Single-flight dedup is the one genuine concurrency-race risk here; treat it as the package's hardest problem.

**Acceptance criteria**
- [ ] One interface, both backends interchangeable
- [ ] Tag-based invalidation correct across both
- [ ] **Single-flight verified under concurrent misses** — N simultaneous misses produce exactly one upstream call
- [ ] testcontainers Redis runs in CI and tears down cleanly
- [ ] Edge cases: TTL expiry boundaries, eviction under memory pressure, Redis connection loss mid-operation
- [ ] Full Definition of Done

---

# E7 · Backend Conventions & Security

### `PKG-API` — `api-kit`
**Ticket:** `FIP-40` · **Points:** 8 · **Depends on:** `CORE-4` · **Labels:** `package:api-kit`

Standardized typed success/error envelope, RFC 7807 problem-details formatting, request validation middleware, and Express/Fastify/Hono adapters.

Not conceptually hard — the risk is **drift between the three adapters**. Test them against a shared conformance suite rather than separately.

**Acceptance criteria**
- [ ] Envelope shape identical across all three adapters, proven by a shared test suite
- [ ] `core` error classes map correctly to RFC 7807 problem details
- [ ] Validation middleware is schema-library agnostic
- [ ] Each adapter's peer dependency is optional — installing api-kit doesn't force Express
- [ ] Envelope types exported for `react-query-kit` to consume
- [ ] Full Definition of Done

---

### `PKG-AUTH-1` — `auth-utils`: password hashing and JWT
**Ticket:** `FIP-41` · **Points:** 8 · **Depends on:** `CORE-4` · **Labels:** `package:auth-utils`, `security`, `high-risk`

argon2id hashing with documented parameters, and JWT issue/verify with **algorithm allowlisting**.

> **Model guidance:** Opus 5, ultrathink. Highest-stakes package in the repo — a subtle mistake here is a vulnerability, not a bug.

**Acceptance criteria**
- [ ] argon2id with documented, justified memory/time/parallelism parameters
- [ ] Hashing round-trip correct; verify is constant-time
- [ ] JWT verification uses an explicit algorithm **allowlist**
- [ ] **`alg: none` rejected**
- [ ] **Algorithm-confusion attack rejected** (RS256 token replayed as HS256 with the public key as HMAC secret)
- [ ] Expiry, `nbf`, issuer, and audience all validated
- [ ] Negative-path tests for each attack above, asserting rejection

---

### `PKG-AUTH-2` — `auth-utils`: token rotation, reuse detection, rate limiting
**Ticket:** `FIP-42` · **Points:** 8 · **Depends on:** `PKG-AUTH-1` · **Labels:** `package:auth-utils`, `security`, `high-risk`

Refresh-token rotation with reuse detection, plus rate-limited login-attempt tracking over a pluggable store.

Includes a **mandatory adversarial self-review pass** after implementation — a dedicated prompt, not a glance: *"review this specifically for JWT algorithm-confusion vulnerabilities and timing-attack risks in comparison logic."*

**Acceptance criteria**
- [ ] Rotation issues a new refresh token and invalidates the old one atomically
- [ ] **Reuse of a rotated token detected and the whole token family revoked**
- [ ] State machine tested across all transitions including concurrent refresh attempts
- [ ] Rate limiting works with a pluggable store; in-memory default provided
- [ ] Adversarial review pass completed and findings addressed or documented
- [ ] Optional: Stryker mutation testing run and surviving mutants reviewed
- [ ] Full Definition of Done for `auth-utils`

---

### `PKG-ACL` — `access-control`
**Ticket:** `FIP-43` · **Points:** 8 · **Depends on:** `CORE-4` · **Labels:** `package:access-control`, `security`, `high-risk`

Isomorphic RBAC/ABAC engine: portable rule schema, `can()`/`assertCan()`, attribute-based ownership rules, Express/Fastify/Hono guards, and `<Can>` + `usePermission()` sharing the same rule source as the server.

> **Model guidance:** Opus 5, ultrathink specifically on rule precedence and conflict resolution. Permission systems fail in subtle ways — rule ordering, ownership edge cases, silent deny-by-default violations — that surface-level testing misses.

**Acceptance criteria**
- [ ] **Deny by default** — verified explicitly, including for unknown actions and unknown subjects
- [ ] Rule precedence and conflict resolution documented and tested exhaustively
- [ ] Ownership/attribute rules handle missing/null context safely (never fail *open*)
- [ ] `assertCan` throws `ForbiddenError` from `core`
- [ ] Identical decisions from the same rule set on client and server, proven by a shared test suite
- [ ] All three server guards tested
- [ ] Optional: Stryker mutation testing on the `can()` resolution core
- [ ] Full Definition of Done

---

# E8 · Service Lifecycle

### `PKG-BOOT` — `bootstrap`
**Ticket:** `FIP-44` · **Points:** 8 · **Depends on:** `PKG-LOGGER` · **Labels:** `package:bootstrap`

Startup/shutdown lifecycle: env validation that fails fast **before binding a port**, graceful shutdown on SIGTERM/SIGINT with ordered connection draining, health-check generator (`/healthz`, `/readyz`), structured startup diagnostics.

Shutdown ordering under in-flight requests is a partial-failure path that unit tests miss unless deliberately targeted.

**Acceptance criteria**
- [ ] Env validation runs and fails before the port binds
- [ ] Validation errors name every missing/invalid variable at once, not one at a time
- [ ] **Shutdown drains in-flight requests before closing connections**, verified under simulated load
- [ ] Shutdown ordering is deterministic and configurable
- [ ] Health checks aggregate pluggable sub-checks; `/readyz` fails while draining
- [ ] Double-signal (SIGTERM twice) handled without corrupting shutdown state
- [ ] Full Definition of Done

---

### `PKG-QUEUE` — `queue`
**Ticket:** `FIP-45` · **Points:** 8 · **Depends on:** `CORE-4`, `PKG-CACHE` · **Labels:** `package:queue`

Typed BullMQ conventions: payload/result generics, retry/backoff presets, dead-letter handling, metrics hooks. Reuses the testcontainers Redis setup from `cache-kit`.

**Acceptance criteria**
- [ ] Job payload and result types inferred end-to-end without call-site generics
- [ ] Retry presets configurable per job type
- [ ] **Retry exhaustion transitions to DLQ**, verified with testcontainers Redis
- [ ] Metrics hooks emit duration, failure, and depth to any backend
- [ ] Edge cases: worker crash mid-job, Redis disconnect during processing, malformed payload
- [ ] Full Definition of Done

---

# E9 · Realtime & Frontend

### `PKG-RT` — `realtime-kit`
**Ticket:** `FIP-46` · **Points:** 8 · **Depends on:** `CORE-4`, `PKG-HTTP` · **Labels:** `package:realtime-kit`

WebSocket/SSE abstraction with auto-reconnect and backoff, typed pub/sub channels, `useSubscription()` hook. Reuses the backoff shape already proven in `http-client`.

**Acceptance criteria**
- [ ] WS and SSE behind one interface
- [ ] Reconnect with exponential backoff verified via fake timers
- [ ] Reconnect gives up per policy rather than retrying forever
- [ ] Message types narrow correctly per channel
- [ ] `useSubscription()` cleans up on unmount with no leaked listeners
- [ ] Edge cases: disconnect mid-message, out-of-order delivery, server-side close during reconnect
- [ ] Full Definition of Done

---

### `PKG-RQ` — `react-query-kit`
**Ticket:** `FIP-47` · **Points:** 5 · **Depends on:** `PKG-API` · **Labels:** `package:react-query-kit`

Opinionated TanStack Query layer: paginated list hooks typed against `api-kit`'s envelope, optimistic mutation helpers with rollback, cache invalidation helpers by resource type.

Thin layer over a very well-documented library — low novelty, a reasonable place to conserve budget.

**Acceptance criteria**
- [ ] Pagination hooks infer types from the `api-kit` envelope with no manual generics
- [ ] **Optimistic mutation rolls back correctly on error**
- [ ] Invalidation targets only the intended resource type, verified by asserting untouched queries stay cached
- [ ] TanStack Query is a peer dependency, not bundled
- [ ] Tested with React Testing Library + Vitest
- [ ] Full Definition of Done

---

### `PKG-FORMS` — `react-forms`
**Ticket:** `FIP-48` · **Points:** 8 · **Depends on:** `PKG-API` · **Labels:** `package:react-forms`, `accessibility`

React Hook Form toolkit: prebuilt accessible fields (text, select, async-validated), error mapping from `api-kit`'s envelope into field-level errors, headless-first.

Accessibility work here is directly reusable in the accessibility blog post and connects to the Storybook a11y OSS contribution (`OSS-2`).

**Acceptance criteria**
- [ ] All fields pass axe with zero violations
- [ ] Keyboard navigation and screen-reader labelling verified per field
- [ ] Error messages correctly associated via `aria-describedby`
- [ ] **Async validation race conditions handled** — a stale slow response never overwrites a fresh result
- [ ] `api-kit` envelope errors map to the right fields, with unmapped errors surfaced rather than swallowed
- [ ] Logic separable from styling (headless-first proven by a styled and an unstyled consumer)
- [ ] Full Definition of Done

---

# E10 · Module Federation

### `PKG-MF` — `module-federation-kit`
**Ticket:** `FIP-49` · **Points:** 13 · **Depends on:** `CORE-4` · **Labels:** `package:module-federation-kit`, `high-risk`, `differentiator`

DX layer over Webpack/Rspack Module Federation: dynamic runtime remote registration, typed host/remote contracts, loading/error boundaries, retry and fallback on remote-load failure.

> **Model guidance:** Opus 5, ultrathink. The most niche, least-documented domain in the ecosystem — MF runtime internals are genuinely under-covered compared to something like React Query. Deliberately built last, so `core`'s patterns are stable.

Also the **highest-differentiation package**: few contributors have real production MF experience, and it pairs directly with the MF blog posts and `OSS-4`.

**Acceptance criteria**
- [ ] Remotes registerable at runtime, not just build time
- [ ] Host/remote contracts type-checked; a mismatch is a compile error
- [ ] **Remote-load failure triggers fallback**, verified by simulating a failed remote
- [ ] Retry strategy configurable with a bounded ceiling
- [ ] Error boundary surfaces which remote failed and why
- [ ] Shared-dependency/version-mismatch behaviour documented — including the real gotchas from production experience
- [ ] Works with both Webpack and Rspack
- [ ] Full Definition of Done

---

# E11 · Documentation & Examples

### `DOC-1` — Docs site infrastructure
**Ticket:** `FIP-50` · **Points:** 5 · **Depends on:** `CORE-4` · **Labels:** `docs`, `infra`

Astro Starlight + TypeDoc, deployed to GitHub Pages via `docs.yml`. Can start right after `core` and grow as packages land.

**Acceptance criteria**
- [ ] Starlight builds to static output
- [ ] TypeDoc generates API reference from TSDoc as part of the docs build
- [ ] `docs.yml` deploys to Pages on push to `main`
- [ ] Site reachable at the Pages URL
- [ ] Adding a package requires no manual docs wiring

---

### `DOC-2` — Docs content pages
**Ticket:** `FIP-51` · **Points:** 5 · **Depends on:** `DOC-1`, `PKG-MF` · **Labels:** `docs`

Architecture/dependency diagram page and a "build a mini-app in 10 minutes" getting-started page combining 3–4 packages.

Mostly prose — a good place to use a cheaper, faster model.

**Acceptance criteria**
- [ ] Architecture page shows the real dependency graph across all 13 packages
- [ ] Getting-started code is copy-pasteable and **verified to actually run**
- [ ] Every package has a docs page reachable from the homepage
- [ ] Homepage states what the ecosystem is within the first screen

---

### `EX-1` — `examples/minimal-api`
**Ticket:** `FIP-52` · **Points:** 5 · **Depends on:** `PKG-API`, `PKG-AUTH-2`, `PKG-LOGGER` · **Labels:** `examples`

Express or Fastify service using api-kit + auth-utils + logger.

**Not decoration** — the first real integration test of whether the packages compose. Expect to find genuine API-ergonomics problems here; that's the point.

**Acceptance criteria**
- [ ] Runs locally with documented setup
- [ ] Demonstrates auth, envelope responses, and correlated structured logging together
- [ ] Consumes packages by workspace protocol
- [ ] Any composition problems found are filed as issues, not worked around silently

---

### `EX-2` — `examples/minimal-dashboard`
**Ticket:** `FIP-53` · **Points:** 5 · **Depends on:** `PKG-RQ`, `PKG-FORMS`, `EX-1` · **Labels:** `examples`

React app using react-query-kit + react-forms, talking to `minimal-api`.

**Acceptance criteria**
- [ ] Runs locally against `minimal-api`
- [ ] Demonstrates paginated lists, optimistic mutation with rollback, and form error mapping from real API errors
- [ ] End-to-end type inference from backend envelope to frontend form errors, with no manual type duplication
- [ ] Composition problems filed as issues

---

# E12 · Release & Hardening

### `REL-1` — Security sweep across all packages
**Ticket:** `FIP-54` · **Points:** 5 · **Depends on:** all `PKG-*` · **Labels:** `security`, `release`

Triage every CodeQL alert, `npm audit` finding, and open Dependabot PR across all 13 packages.

> **Model guidance:** Sonnet 5 generally; Opus 5 for any alert touching `auth-utils` or `access-control`.

**Acceptance criteria**
- [ ] Every CodeQL alert resolved or explicitly dismissed with a written justification
- [ ] `npm audit` clean of high/critical
- [ ] All Dependabot PRs merged or closed with a reason
- [ ] OSSF Scorecard run and the score reviewed
- [ ] No secrets anywhere in git history (verify, don't assume)

---

### `REL-2` — Definition of Done audit
**Ticket:** `FIP-55` · **Points:** 5 · **Depends on:** `REL-1`, `DOC-2`, `EX-2` · **Labels:** `release`, `quality`

Walk the full Definition of Done for **all 13 packages**. Last checkpoint before the code is public and installable by strangers.

**Acceptance criteria**
- [ ] Checklist verified package by package, with results recorded
- [ ] Every package published with provenance
- [ ] Every package installs cleanly from npm in a fresh directory
- [ ] `"access": "public"` confirmed on all 13 — the one setting that could accidentally cost money
- [ ] Every package has an `/examples` usage and a docs page
- [ ] Any package failing the checklist is fixed or explicitly held back from release

---

### `REL-3` — Root README and profile polish
**Ticket:** `FIP-56` · **Points:** 3 · **Depends on:** `REL-2` · **Labels:** `docs`, `release`

The first thing a recruiter or engineer actually sees. Worth genuine care.

**Acceptance criteria**
- [ ] Root README explains the ecosystem in the first paragraph
- [ ] All 13 packages listed with one-line descriptions and links
- [ ] Badges: npm version, bundle size, license, CI status, OSSF Scorecard
- [ ] Links to docs site and examples
- [ ] Repo pinned on the GitHub profile
- [ ] 2–3 flagship packages identified for the resume's Open Source section

---

# E13 · Open Source Contributions

> Parallel track — runs alongside package work, not after. Target 1–2 merged PRs per repo.
>
> **Issue numbers in `oss-contribution-plan.pdf` are stale.** Use each repo's current `good first issue` label; the workflow transfers, the specific tickets don't.

### `OSS-0` — Contribution workflow checklist
**Ticket:** `FIP-57` · **Points:** 1 · **Depends on:** — · **Labels:** `oss`, `process`

Write the repeatable per-PR checklist once, reuse for every contribution below.

**Acceptance criteria**
- [ ] Checklist committed: read `CONTRIBUTING.md` → comment on the issue before coding → fork/clone → **reproduce locally first** → small single-purpose PR **with a test** → description with before/after evidence and `Fixes #N` → respond to review promptly → log the merge
- [ ] A running contribution log started (`OSS-5`)

---

### `OSS-1` — TanStack Query documentation PR
**Ticket:** `FIP-58` · **Points:** 3 · **Depends on:** `OSS-0` · **Labels:** `oss`, `tanstack`

Warm-up contribution to a library already used in production. Docs-only — merges faster, builds maintainer trust, lowest risk for a first PR. Learn the workflow end to end before attempting a code fix.

**Acceptance criteria**
- [ ] A current, open, unclaimed docs issue identified
- [ ] Commented on the issue before starting
- [ ] PR opened following their `CONTRIBUTING.md`
- [ ] Review feedback addressed
- [ ] Merged and logged

---

### `OSS-2` — TanStack Query or Storybook code fix
**Ticket:** `FIP-59` · **Points:** 5 · **Depends on:** `OSS-1` · **Labels:** `oss`, `accessibility`

First real code contribution. **The Storybook accessibility issue is the strategically best pick** — it yields a linkable, real code contribution to cite in the accessibility blog post, and overlaps directly with `PKG-FORMS`.

**Acceptance criteria**
- [ ] Bug reproduced locally **before** any fix is written
- [ ] Fix is minimal and single-purpose
- [ ] Test included
- [ ] PR description carries before/after evidence
- [ ] Merged and logged

---

### `OSS-3` — Zustand contribution
**Ticket:** `FIP-60` · **Points:** 5 · **Depends on:** `OSS-1` · **Labels:** `oss`, `typescript`

Note: Zustand keeps its Issues list deliberately short — maintainers route "help wanted" through **GitHub Discussions**, so look there, not the Issues tab.

Best fits: improving TypeScript inference on a middleware (`persist`/`devtools`), or clarifying SSR/hydration behaviour with `persist` — a recurring pain point in their history.

**Acceptance criteria**
- [ ] Current "help wanted" Discussions reviewed for open asks
- [ ] Contribution scoped and discussed with maintainers before coding
- [ ] PR opened with tests where code is involved
- [ ] Merged and logged

---

### `OSS-4` — Module Federation contribution
**Ticket:** `FIP-61` · **Points:** 5 · **Depends on:** `OSS-1` · **Labels:** `oss`, `differentiator`

Highest differentiation of the four — smaller community, and very few contributors have real production MF experience, so even a modest well-written PR stands out. Time it to support the MF blog posts and `PKG-MF`.

This is the one repo where **commenting with your production context before attempting a fix** is worth doing on its own — maintainers there value operational insight as much as code. A documentation contribution writing up a real shared-singleton or versioning gotcha is high-value even without a code PR.

**Acceptance criteria**
- [ ] Issue identified in the shared-dependency / version-mismatch / build-integration space
- [ ] Production context shared in an issue comment
- [ ] Docs or code PR opened
- [ ] Merged and logged

---

### `OSS-5` — Contribution log
**Ticket:** `FIP-62` · **Points:** 2 · **Depends on:** `OSS-0` · **Labels:** `oss`, `career`

A running list of merged PRs, updated **the day each one merges** — not batched later.

**Acceptance criteria**
- [ ] Log file in the repo, one entry per merged PR with repo, link, and one-line description
- [ ] Resume "Open Source & Technical Writing" section updated once there's a credible body of work
- [ ] LinkedIn Featured section updated to match
- [ ] Only live, linkable work listed — nothing aspirational

---

## Suggested sprint grouping

| Sprint | Refs | Theme |
|---|---|---|
| 1 | `PREP-1`…`PREP-5`, `SCAF-1`…`SCAF-5` | Accounts and scaffold |
| 2 | `CI-1`…`CI-5`, `GOV-1`…`GOV-3` | **Ends at Gate 1** · `OSS-0`, `OSS-1` start in parallel |
| 3 | `CORE-1`…`CORE-4` | **Ends at Gate 2** — first published package |
| 4 | `PKG-LOGGER`, `PKG-HTTP`, `PKG-CACHE` | Cross-cutting utilities · `OSS-2` |
| 5 | `PKG-API`, `PKG-AUTH-1`, `PKG-AUTH-2`, `PKG-ACL` | Security-critical · highest reasoning budget |
| 6 | `PKG-BOOT`, `PKG-QUEUE`, `DOC-1` | Service lifecycle · `OSS-3` |
| 7 | `PKG-RT`, `PKG-RQ`, `PKG-FORMS` | Realtime and frontend |
| 8 | `PKG-MF`, `DOC-2` | Module Federation · `OSS-4` |
| 9 | `EX-1`, `EX-2`, `REL-1`…`REL-3`, `OSS-5` | Integration, hardening, release |
