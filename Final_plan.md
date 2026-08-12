# FirstPrinciples — Final Execution Plan

**Status:** execution-ready · **Supersedes:** `plan.md` (which stays as the understanding-check record)
**Source specs:** `../Preparation_Docs/sprocket-ecosystem-spec.md`, `../Preparation_Docs/typed-fetch-client-spec.md`, `prerequisite-for-packages.pdf`, `oss-contribution-plan.pdf`, `resume-additions-guide.pdf`

> This document is the **execution layer** — sequencing, gates, decisions, and definitions of done.
> It deliberately does **not** re-paste config that already exists in `sprocket-ecosystem-spec.md`; that spec stays the reference for *what the config says*, this plan owns *when and in what order it happens, and how you know it worked*.

---

## 1. What we are building

A public monorepo at `github.com/BetterFoundations/FirstPrinciples` containing **13 independently-publishable TypeScript npm packages**, built entirely on free-tier infrastructure, each one production-grade: strictly typed, ≥90% line / ≥85% branch coverage, bundle-size budgeted, provenance-signed, and documented.

Running in parallel: a **structured open-source contribution track** into libraries already used in production (TanStack Query, Zustand, Storybook, Module Federation).

The combined output is the evidence base for the "Open Source & Technical Writing" resume/LinkedIn section described in `resume-additions-guide.pdf`.

### Hard constraints (non-negotiable, from the spec)

| Constraint | Why it matters |
|---|---|
| **Zero cost** — no tool, action, or service that requires a paid tier or card | The whole spec is built around this; a paid dependency invalidates the design |
| **Public repo** | Public repos get unlimited free Actions minutes; private ones don't |
| `"access": "public"` in every `publishConfig` | Scoped packages default to *private* on npm, which requires a paid plan — the single most common way this project could accidentally cost money |
| **No package ships partially done** | 5 complete packages beat 13 half-built ones — this is a portfolio artifact, incompleteness is the main reputational risk |

---

## 2. Decisions to lock before writing code

These are cheap to decide now and expensive to change later.

### 2.1 Package scope name — **decide before Phase 2**

The specs use `@sprocket` as a placeholder. Availability probed on 2026-08-11 — **all three candidates are unclaimed on npm**:

| Candidate scope | Reads as | Verdict |
|---|---|---|
| **`@firstprinciples`** | `@firstprinciples/core`, `@firstprinciples/logger` | **Recommended** — matches the repo name, self-describing, memorable |
| `@betterfoundations` | `@betterfoundations/core` | Matches the GitHub org, but longer and ties packages to an org identity rather than the product |
| `@sprocket` | `@sprocket/core` | The spec's placeholder — no real reason to adopt it |

**This plan assumes `@firstprinciples` throughout.** If you choose differently, global find-and-replace before Phase 2 starts — after `core` is published the scope is effectively permanent, because renaming means republishing every package and orphaning any installs.

An npm org cannot be renamed. Claim it in Phase 0.

### 2.2 `typed-fetch` is not a separate package

`typed-fetch-client-spec.md` and the spec's `@scope/http-client` describe **the same package**: a typed fetch wrapper with discriminated-union results, retry/backoff, timeout/abort, one interceptor hook, and a pluggable validation adapter.

**Resolution:** `typed-fetch-client-spec.md` becomes the authoritative design document for `@firstprinciples/http-client`. It is more detailed than the ecosystem spec's §10.3 and wins wherever the two differ. We do not build both.

One reconciliation is needed: the typed-fetch spec returns `ApiResult` unions, while the ecosystem spec says http-client "normalizes failures into `core` error classes." **Both, layered:** the union's error variant *carries* a `core` error instance. Callers get exhaustive type narrowing without losing the shared error taxonomy. Settle this concretely in the `core` design session (§4.2), because the shape has to exist in `core` first.

### 2.3 Versioning policy

- Every package starts at `0.1.0` and **stays on 0.x for the entire build**.
- `1.0.0` only after the API has been used in at least one real project (an `/examples` app counts as a smoke test, a real consumer like FuelKhata counts as validation).
- Internal cross-package deps: `workspace:*` in the repo, rewritten to real ranges on publish by Changesets.
- Even pre-1.0, treat breaking changes as breaking — a `major`-flavoured changeset and a CHANGELOG note. You are about to write publicly about semver discipline; the repo has to model it.

### 2.4 Node version

Local Node is **v20.17.0**, which is on the **Iron line that reached end-of-life in April 2026** — no more security patches. Upgrade to **Node 24 LTS ("Krypton", v24.19.x)** and pin it in `.nvmrc`. CI reads the same file, so local and CI can never drift.

---

## 3. Phase 0 — Prerequisites (1 session)

Verified state of this machine as of 2026-08-11:

| Item | Status | Action |
|---|---|---|
| git 2.39.5 | ✅ present | none |
| Node v20.17.0 | ⚠️ **EOL line** | `nvm install 24 && nvm alias default 24` |
| pnpm | ❌ **not installed** | `corepack enable pnpm` (ships with Node, no global install needed) |
| npm login | ❌ not authenticated | `npm login`, verify with `npm whoami` |
| GitHub SSH key | ❌ **`Permission denied (publickey)`** | `ssh-keygen -t ed25519`, add to GitHub, verify `ssh -T git@github.com` |
| GitHub repo | ✅ exists, `main`, 1 commit | none |
| npm org | ❌ not created | create `@firstprinciples`, enable 2FA |
| `NPM_TOKEN` secret | ❌ not set | Granular Access Token, **scoped to the org only**, added as repo secret |

**Exit criteria:** `ssh -T git@github.com` greets you by name, `npm whoami` shows an account that is a **member of the `@firstprinciples` org** (not just your personal account — this is the specific mistake that makes the first CI publish fail), `pnpm -v` works, `node -v` shows 24.x.

Also enable in repo settings (all free, all public-repo features): Dependabot alerts + security updates, secret scanning + push protection, private vulnerability reporting, GitHub Pages (source: GitHub Actions).

---

## 4. Build phases

Each "session" is a focused few-hour block, run as its own agent conversation so context stays tight and each PR stays reviewable.

### Phase 1 — Root scaffold (2–3 sessions) · Sonnet 5 · medium

Everything in spec §3–§4, and **no package code at all**:

1. `pnpm-workspace.yaml`, root `package.json`, `.nvmrc`, `.gitignore`
2. `turbo.json` pipeline (local cache only — **do not** enable Vercel Remote Cache)
3. `tools/tsconfig-base/` and `tools/eslint-config/` as real workspace packages
4. Prettier, Husky + lint-staged
5. `changeset init`
6. Governance files: MIT `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.github/CODEOWNERS`, issue + PR templates
7. All five workflows: `ci.yml`, `codeql.yml`, `release.yml`, `docs.yml`, `dependabot.yml`

> **Spend extra effort on `release.yml`.** The OIDC permission scoping (`id-token: write`) plus the Changesets action wiring has real failure modes that only surface at publish time, which is the worst moment to debug them. Get it right once here.

**🚦 GATE 1 — CI green on an empty scaffold.** Push and confirm every workflow passes with zero packages. Do not write a line of package code until this is green. Fixing tooling wiring now is trivial; fixing it after 13 packages sit on top of it is not.

### Phase 2 — `@firstprinciples/core` (2 sessions) · **Opus 5 · ultrathink**

The highest-leverage design decision in the project — all twelve other packages import from here, so a bad shape means either painful refactors or everyone quietly working around it.

Scope: typed error hierarchy (`AppError` base + `Validation`/`NotFound`/`Forbidden`/`Unauthorized`/`Conflict`, each carrying `code`, `httpStatus`, `details?`), `Result<T, E>` with `ok`/`err` constructors and `isOk`/`isErr` guards, branded primitives (`Email`, `UUID`, `ISODateString`). Zero runtime dependencies.

Explicitly resolve here: **how `Result` and the error classes compose**, since that contract propagates into `http-client`, `api-kit`, and every consumer (§2.2).

Tests: error serialization round-trip (`toJSON()`), type-guard correctness, branded-type validation, plus `expectTypeOf` type-level tests — generics that don't infer well are a design bug, not a test gap.

**🚦 GATE 2 — publish `core` at `0.1.0` immediately.** This is the real end-to-end proof of the release pipeline: changeset → version PR → merge → CI publish with `--provenance` → visible on npm with a provenance badge. Do not build twelve more packages on an unproven publish path.

### Phase 3 — Cross-cutting utilities (4–5 sessions) · Sonnet 5 · medium→high

| Package | Notes | Effort |
|---|---|---|
| `logger` | pino on Node, console fallback in browser, `AsyncLocalStorage` correlation IDs | high on **redaction** — a secret leaking through a nested object is a real incident, not a bug |
| `http-client` | Built to `typed-fetch-client-spec.md` (§2.2) | high on **retry/backoff and abort-signal composition** |
| `cache-kit` | LRU + Redis behind one interface, tag invalidation | high on **single-flight stampede protection** — the one genuine concurrency-race risk in the package |

`cache-kit` is where `testcontainers` enters CI. Budget a little extra time for that Docker wiring the first time; ephemeral containers inside the Actions runner stay free.

Two `http-client` details worth calling out because they are easy to get subtly wrong and both are explicitly in the spec:
- A network failure (timeout/DNS) must be a **distinct result variant** from a typed HTTP error response — callers handle them differently (retry UI vs. error message).
- If the caller passes their own `signal`, **combine** it with the internal timeout controller. Letting the caller's signal silently replace the timeout is a real bug that looks like it works.

### Phase 4 — Backend conventions & security (5–6 sessions)

| Package | Model | Effort | Why |
|---|---|---|---|
| `api-kit` | Sonnet 5 | high | Not conceptually hard, but three framework adapters (Express/Fastify/Hono) must stay consistent — effort here buys consistency-checking, not raw difficulty |
| `auth-utils` | **Opus 5** | **ultrathink + adversarial self-review** | Highest-stakes package in the repo |
| `access-control` | **Opus 5** | high, ultrathink on rule resolution | Permission systems fail in subtle, hard-to-test ways |

**`auth-utils` requires an explicit second pass**, not just a careful first one. After implementation, run a dedicated review prompt: *"review this specifically for JWT algorithm-confusion vulnerabilities and timing-attack risks in comparison logic."* Non-negotiable behaviours: `alg: none` and algorithm substitution rejected via an explicit allowlist; argon2id with documented parameters; refresh-token rotation with reuse detection.

**`access-control`**: deny-by-default, and rule precedence/conflict resolution reasoned through explicitly. The adapter surface (Express/Fastify/Hono guards, `<Can>`, `usePermission()`) is ordinary work; the `can()` resolution core is not.

Consider Stryker mutation testing on these two packages specifically (free, local HTML report — not the paid dashboard). High-coverage tests that don't actually catch mutations are exactly the failure mode that matters here.

### Phase 5 — Service lifecycle (3 sessions) · Sonnet 5 · medium→high

`bootstrap` (env validation pre-bind, graceful shutdown with ordered draining, health-check generator) and `queue` (typed BullMQ layer, retry presets, DLQ, metrics hooks). Bump effort for **shutdown ordering under in-flight requests** and the **retry-exhaustion → DLQ transition** — both are partial-failure paths that unit tests miss unless deliberately targeted.

### Phase 6 — Realtime & frontend (5 sessions) · Sonnet 5 · medium

`realtime-kit` (WS/SSE, auto-reconnect with backoff, typed channels, `useSubscription()`) reuses the backoff shape already built in `http-client`. `react-query-kit` and `react-forms` are thin layers over extremely well-documented libraries — low novelty, a reasonable place to conserve budget. `react-forms` carries real **accessibility assertions (axe)**, which ties directly to the accessibility blog topic and the Storybook a11y OSS contribution.

### Phase 7 — `module-federation-kit` (2–3 sessions) · **Opus 5 · ultrathink**

Deliberately last, so `core`'s patterns are stable. This is the most niche, least-documented domain in the ecosystem — Module Federation's runtime internals are genuinely under-covered compared to something like React Query. It is also the **highest-differentiation package**: very few people have real production MF experience, and it pairs directly with the MF blog posts and the `module-federation/core` OSS contribution.

### Phase 8 — Docs site (2 sessions) · Sonnet 5 for wiring, Haiku 4.5 for prose · low→medium

Astro Starlight + TypeDoc, deployed to GitHub Pages via `docs.yml`. Include the architecture/dependency diagram page and a "build a mini-app in 10 minutes" page combining 3–4 packages. Mechanical work — a good place to spend less.

### Phase 9 — Examples (2 sessions) · Sonnet 5 · medium

`examples/minimal-api` (api-kit + auth-utils + logger) and `examples/minimal-dashboard` (react-query-kit + react-forms). These are not decoration — they are the first real integration test of whether the packages compose, and they routinely surface API-ergonomics problems that unit tests never do. Expect to fix real issues here.

### Phase 10 — Hardening & first full release wave (2 sessions) · Sonnet 5, Opus 5 for auth/access-control alerts · high

Triage every CodeQL alert, `npm audit` finding, and Dependabot PR across all 13 packages. Verify the §12 Definition of Done for each. Then the coordinated publish wave. This is the last checkpoint before the code is public and installable by strangers.

### Phase 11 — Final polish (1 session) · Sonnet 5 / Haiku 4.5 · medium

Root README (the first thing a recruiter or engineer actually sees), badges including OSSF Scorecard, docs homepage, pin the repo on your GitHub profile.

---

## 5. Definition of Done — per package

No package counts as done until **every** box is checked. From spec §12:

- [ ] `src/index.ts` exports only the intentional public API (internals under `src/internal/`)
- [ ] TSDoc on every exported symbol (enforced by `eslint-plugin-tsdoc`)
- [ ] README complete per spec §8.1 — description + badges, install, quick start, why it exists, API table, 2–3 recipes, license
- [ ] Coverage thresholds met: ≥90% lines/statements, ≥90% functions, ≥85% branches
- [ ] Edge-case tests present (null/empty/boundary/concurrent), not just happy path
- [ ] Type-level tests where generics are non-trivial
- [ ] `size-limit` budget configured and passing
- [ ] `npm audit` clean
- [ ] CodeQL passing with no unaddressed alerts
- [ ] Published with `--provenance`
- [ ] Example under `/examples` showing real usage
- [ ] Listed in root README with a one-line description
- [ ] Docs site page generated and deployed

---

## 6. Standing working agreements

- **One package per branch, one changeset per PR.** `changeset status` runs in CI and fails a PR that changes package code without one.
- **Tests alongside implementation, never after.** Thresholds are met from a package's first commit, not retrofitted.
- **Never introduce a paid-tier dependency.** If unsure, check the pricing page — free tiers change over time.
- **Never weaken a failing test to go green.** Fix the code, or fix a genuinely wrong expectation.
- **`EngineeringCompass` is wired into this repo** (`AGENTS.md` + 15 skills). Agent sessions should route through `AGENTS.md` and reach for an existing skill — `feature-scaffold`, `pr-self-review`, `reproduce-before-fix`, `update-docs-after-change` — before inventing a parallel workflow.
- **Log friction, don't work around it silently.** Playbook friction goes in `EngineeringCompass/FRICTION-LOG.md`.

---

## 7. Parallel track — open-source contributions

Runs alongside package work, not after it. Target: **1–2 merged PRs per repo**, not a scattered spray.

| Window | Target | Type |
|---|---|---|
| Weeks 1–2 | TanStack Query | Docs PR — warm-up, learn the workflow end to end |
| Weeks 3–5 | TanStack Query or Storybook | First real code fix |
| Weeks 6–8 | Zustand | Typing or docs, via Discussions "help wanted" (their Issues tab stays deliberately short) |
| Weeks 9–12 | Module Federation | Docs or bug fix — highest differentiation, timed to support the MF blog posts |
| Once RAG/agent projects are live | LangGraph / LangChain / CrewAI | From real usage gaps only — not cold issue-hunting |

**Issue numbers in `oss-contribution-plan.pdf` are stale by now** (that doc is a year old). Use each repo's current `good first issue` label instead; the workflow is what transfers, not the specific tickets.

Per-PR workflow, in order: read `CONTRIBUTING.md` → comment on the issue before coding → fork, clone, **reproduce the bug locally first** → small single-purpose PR **with a test** → clear description with before/after evidence and `Fixes #N` → respond to review promptly → **log the merged PR immediately**, don't batch.

The Storybook accessibility issue is the strategically best pick: it produces a linkable, real code contribution for the accessibility blog post.

---

## 8. Timeline

| Phase | Sessions |
|---|---|
| 0 · Prerequisites | 1 |
| 1 · Scaffold + CI (**Gate 1**) | 2–3 |
| 2 · `core` (**Gate 2**) | 2 |
| 3 · logger, http-client, cache-kit | 4–5 |
| 4 · api-kit, auth-utils, access-control | 5–6 |
| 5 · bootstrap, queue | 3 |
| 6 · realtime-kit, react-query-kit, react-forms | 5 |
| 7 · module-federation-kit | 2–3 |
| 8 · Docs site | 2 |
| 9 · Examples | 2 |
| 10 · Hardening + release wave | 2 |
| 11 · Final polish | 1 |
| **Total** | **~31–35 sessions** |

At a sustainable 2–3 sessions/week alongside a full-time job and the OSS track: **roughly 3–4 months.** Pace is 1–2 *fully complete* packages per week — partial packages are worse than fewer packages.

---

## 9. Risks and how this plan handles them

| Risk | Mitigation |
|---|---|
| Broken release pipeline discovered late | Gate 1 (CI green on empty scaffold) + Gate 2 (publish `core` first) |
| `core` API shape turns out wrong | Opus 5 + ultrathink + type-level tests + everything stays 0.x until real usage validates it |
| A security bug ships in `auth-utils`/`access-control` | Strongest model, mandatory adversarial review pass, optional mutation testing |
| Accidental npm charges | `"access": "public"` audited per package; public repo; no paid-tier tools |
| Momentum stalls at ~6 packages | Publish incrementally — 6 complete, published packages is already a real portfolio; 13 half-built ones is not |
| Scope name regret | Locked in Phase 0, before anything is published |
| Packages compose badly | `/examples` apps built as real integration tests, expected to surface API problems |

---

## 10. Immediate next steps

1. Confirm the scope name (§2.1) — default `@firstprinciples`.
2. Work Phase 0 (§3) — Node 24, pnpm, SSH key, npm org + 2FA, `NPM_TOKEN`.
3. Start Phase 1 in a fresh session; stop at Gate 1 and confirm green before anything else.

Story-level breakdown: **`Jira_TASK.md`**.
