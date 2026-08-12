# FirstPrinciples — Session-by-Session Prompts

Every session from [Final_plan.md](Final_plan.md) and [Jira_TASK.md](Jira_TASK.md), as a copy-pasteable prompt with the model, effort level, and chat-hygiene guidance for each.

**36 sessions** — 31 build + 5 open-source. Nothing here has been executed.

---

## How to use this file

1. Open the session you're on.
2. Follow the chat marker (🆕 start a new chat / ⛓️ stay in the current one).
3. Set the model and effort as listed (`/model`, `/effort`), or open Cursor where marked.
4. Paste the prompt verbatim.
5. The session ends by updating `EXECUTION-CHECKLIST.md` — that's what makes the next fresh chat safe.

### The mechanism that makes fresh chats safe

Fresh chats aren't a compromise here, because **state lives in files, not in conversation history**:

- `EXECUTION-CHECKLIST.md` — what's done, what's in progress, decisions made, problems parked
- `Final_plan.md` — the plan and the gates
- `AGENTS.md` — routing rules, auto-loaded by both Claude Code and Cursor
- The repo itself — the actual source of truth

Every prompt below starts by reading the checklist. So a fresh chat picks up exactly where the last one left off, minus tens of thousands of tokens of irrelevant history.

### Why the prompts look "thin"

Each prompt names **only** the 1–3 files that session needs, and explicitly says not to read the rest. That's the EngineeringCompass router philosophy (`AGENTS.md`) applied to token cost — pulling in the whole `/Preparation_Docs` tree for a narrow task is the single biggest avoidable expense in this project.

---

## Legend

| Marker | Meaning                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------- |
| 🆕     | **Start a fresh chat.** No context carryover needed — the checklist covers it.                                      |
| ⛓️     | **Stay in the current chat.** Genuine design continuity would be lost otherwise.                                    |
| 🔁     | **Fresh chat required for quality**, not just cost — a review pass must not be anchored on its own prior reasoning. |
| 🖱️     | **Run in Cursor with Grok 4.5, medium.** Mechanical work, verifiable by CI, no meaningful design surface.           |
| 👤     | **Manual — no agent.** Account creation, key generation, dashboard clicks.                                          |

---

## How model choices were made

**Opus 5** is used in only 6 of 31 build sessions — where a mistake is expensive to unwind (`core`, which all twelve other packages import) or the domain is genuinely under-documented (`module-federation-kit`) or a subtle error is a real vulnerability (`auth-utils`, `access-control`).

**Cursor + Grok 4.5** takes 6 sessions that are pure boilerplate with a hard verification signal — governance files, formatter hooks, README assembly. If it's wrong, lint or CI says so immediately.

**These are deliberately NOT delegated to Cursor or a cheaper model,** and it's worth knowing why before overriding:

| Session                       | Why it stays on Claude                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `release.yml` (S4)            | OIDC/provenance wiring fails only at publish time — the worst moment to debug it                                  |
| `core` (S7)                   | Every other package imports this; a bad shape means refactors or silent workarounds                               |
| `http-client` (S10)           | Signal composition and distinct network-vs-HTTP error variants are subtly wrong in a way that looks like it works |
| `cache-kit` (S11)             | Single-flight dedup is a real concurrency race                                                                    |
| `auth-utils` (S13–15)         | A subtle mistake here is a vulnerability, not a bug                                                               |
| `access-control` (S16–17)     | Permission systems fail silently open                                                                             |
| `module-federation-kit` (S23) | Least-documented domain in the ecosystem                                                                          |
| Examples (S26–27)             | These exist to surface real composition problems, which requires noticing them                                    |
| Security sweep (S28)          | Judgement task — deciding what's a real finding                                                                   |

---

# Build sessions

---

### S0 · Prerequisites

👤 **Manual — do not spend agent tokens on this** · Stories: `PREP-1`…`PREP-5`

Account creation, SSH keys, and dashboard toggles. An agent can't click these, and narrating them costs tokens for nothing.

Work `Final_plan.md` §3 directly. Verified gaps on this machine as of 2026-08-11:

- [x] Decide the scope name (`Final_plan.md` §2.1 — default `@firstprinciples`, all candidates confirmed free)

- [x] `nvm install 24 && nvm alias default 24` — current v20.17.0 is on an EOL line

- [x] `corepack enable pnpm`

- [ ] Generate ed25519 key, add to Gitub, verify `ssh -T git@github.com` (currently fails)

- [x] `npm login`; confirm `npm whoami` is a **member of the org**, not just your personal account

- [x] Create npm org + enable 2FA

- [ ] Granular token scoped to the org only → repo secret `NPM_TOKEN`

- [ ] Repo settings: Dependabot, secret scanning + push protection, private vulnerability reporting, Pages (source: Actions)

**Exit:** every box ticked. S1 assumes all of it.

---

### S1 · Monorepo scaffold + execution checklist

🆕 **Fresh chat** · **Claude Sonnet 5** · `/effort medium` · Stories: `SCAF-1`, `SCAF-2`, `SCAF-3`

```
Read Final_plan.md §3 and §4 Phase 1, and sprocket-ecosystem-spec.md §3–§4 in ../Preparation_Docs/.
Read nothing else from Preparation_Docs — the other specs are irrelevant to this session.

Set up the root monorepo scaffold. No package code at all this session.

1. pnpm-workspace.yaml covering packages/*, docs, examples/*
2. Root package.json — must be "private": true so the root can never be published
3. .nvmrc pinned to the Node 24 version installed in S0, plus .gitignore
4. turbo.json with build/test/lint/typecheck, correct dependsOn and outputs.
   Do NOT add a remoteCache block — local + CI cache only, this is an explicit non-goal.
5. tools/tsconfig-base/ and tools/eslint-config/ as real workspace packages.
   TypeScript: strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes,
   declaration, declarationMap, isolatedModules.
   ESLint flat config with @typescript-eslint, eslint-plugin-import,
   eslint-plugin-security, eslint-plugin-tsdoc.

Use scope name @firstprinciples unless EXECUTION-CHECKLIST.md records a different decision.

Verify before finishing:
- pnpm install succeeds from clean
- a second consecutive `turbo run build` reports cache hits
- both tools/ packages are consumable via workspace protocol (prove it with a
  throwaway package, then delete it)

Then create EXECUTION-CHECKLIST.md at the repo root. It is the state-carrier
between sessions, so keep it terse and factual:
- Session log: number, story refs, date, one-line outcome
- Decisions locked (scope name, Node version, anything else settled)
- Gate status: Gate 1 (CI green on empty scaffold), Gate 2 (core published)
- Per-package Definition of Done matrix, 13 rows, all unchecked
- Parked problems / open questions

Fill in S0 and S1. Commit on a branch, open a PR.
```

---

### S2 · Formatter hooks + governance files

🆕 🖱️ **Cursor · Grok 4.5 · medium** · Stories: `SCAF-4`, `GOV-1`, `GOV-2`

> Pure boilerplate from standard templates, with lint as an immediate correctness signal. No design surface.

```
Read AGENTS.md, then EXECUTION-CHECKLIST.md for current state.

Add repo hygiene and governance files.

1. .prettierrc — must not conflict with the ESLint config in tools/eslint-config/
2. Husky pre-commit running lint-staged; lint-staged runs eslint --fix and
   prettier on staged files only. Verify the hook actually fires on a real commit.
3. LICENSE (MIT)
4. CONTRIBUTING.md — local setup, the changeset requirement, PR expectations.
   Write this one carefully: this repo is meant to model good OSS practice.
5. CODE_OF_CONDUCT.md (Contributor Covenant)
6. SECURITY.md — supported versions table, and point reporting at GitHub's
   private vulnerability reporting feature, NOT a personal email address
7. .github/CODEOWNERS
8. .github/ISSUE_TEMPLATE/bug_report.md — must ask for package name, version,
   and a reproduction
9. .github/ISSUE_TEMPLATE/feature_request.md
10. .github/PULL_REQUEST_TEMPLATE.md — include a changeset checkbox

Confirm GitHub's community-standards checklist shows all green.
Update EXECUTION-CHECKLIST.md and open a PR.
```

---

### S3 · CI and security workflows

🆕 **Fresh chat** · **Claude Sonnet 5** · `/effort medium` · Stories: `CI-1`, `CI-2`

```
Read EXECUTION-CHECKLIST.md and sprocket-ecosystem-spec.md §6.1–§6.2 in
../Preparation_Docs/. Nothing else.

Write .github/workflows/ci.yml and codeql.yml, plus .github/dependabot.yml.

ci.yml, on pull_request and push to main:
- pnpm + Node setup, Node version read from .nvmrc, pnpm store cached
- pnpm install --frozen-lockfile
- turbo run lint, typecheck, test with coverage, build
- coverage summary written to $GITHUB_STEP_SUMMARY and HTML uploaded as an
  artifact — this is what replaces a paid Codecov tier, so it must actually work
- the job must FAIL when coverage is under threshold. Prove it: break coverage
  deliberately once, confirm red, then restore.
- npx changeset status --since=origin/main, so a PR that changes package code
  without a changeset fails

codeql.yml: javascript-typescript, on push/PR plus a weekly cron.
dependabot.yml: weekly npm updates, dev-dependencies grouped into one PR.

Update EXECUTION-CHECKLIST.md and open a PR.
```

---

### S4 · Changesets + release workflow

🆕 **Fresh chat** · **Claude Sonnet 5** · `/effort high` · Stories: `SCAF-5`, `CI-3`

> Highest-risk workflow in the repo. OIDC and provenance wiring only fails at actual publish time. Worth full effort once, here, instead of firefighting a broken publish later.

```
Read EXECUTION-CHECKLIST.md and sprocket-ecosystem-spec.md §6.3 in
../Preparation_Docs/. Nothing else.

1. changeset init. In .changeset/config.json set "access": "public" and
   baseBranch to main. Verify changeset creation and `changeset status` locally.

2. .github/workflows/release.yml, on push to main.

This is the fiddliest file in the project — be deliberate:
- permissions must include contents: write, pull-requests: write, and
  id-token: write (id-token is what makes npm provenance work)
- setup-node configured with registry-url
- checkout with fetch-depth: 0, or changesets can't see history
- GITHUB_TOKEN (automatic) and NPM_TOKEN (added in S0) both wired
- changesets/action@v1 with publish: pnpm changeset publish

Walk through the failure modes explicitly before finalizing: what happens with
no pending changesets, with pending changesets, and when the Version Packages
PR is merged. State what you expect at each step.

Full end-to-end publish gets validated in S8 — this session only needs the
workflow to run cleanly as a no-op.

Update EXECUTION-CHECKLIST.md and open a PR.
```

---

### S5 · Size budgets + package template

🆕 **Fresh chat** · **Claude Sonnet 5** · `/effort medium` · Stories: `CI-4`, `GOV-3`

```
Read EXECUTION-CHECKLIST.md and sprocket-ecosystem-spec.md §3.1, §4.3, §8.1, §12
in ../Preparation_Docs/. Nothing else.

1. Wire size-limit into CI with PR comments on size deltas. Exceeding a budget
   must fail the job.

2. Build the per-package template that all 13 packages will follow exactly.
   This uniformity is what lets turbo, size-limit and Changesets work with zero
   per-package special-casing, so it has to be right before any package exists.

   Structure: src/, src/internal/, tests/{unit,edge-cases,integration}/,
   README.md, package.json, tsconfig.json, tsup.config.ts, vitest.config.ts,
   size-limit.json

   package.json must have correct exports (import/require/types),
   sideEffects: false, files: ["dist"], engines, and:
     "publishConfig": { "access": "public", "provenance": true }

   The access: "public" line is the single most important line in this project —
   scoped packages default to private on npm, which requires a paid plan.

   README skeleton follows spec §8.1 section order exactly.
   vitest config carries the coverage thresholds: 90% lines/statements/functions,
   85% branches.

3. Commit the per-package Definition of Done checklist (spec §12) to the repo.

Update EXECUTION-CHECKLIST.md and open a PR.
```

---

### S6 · 🚦 GATE 1 — CI green on empty scaffold

🆕 **Fresh chat** · **Claude Sonnet 5** · `/effort medium` · Story: `CI-5`

> Hard gate. Tooling problems are cheap now and expensive under 13 packages.

```
Read EXECUTION-CHECKLIST.md. Nothing else unless a failure sends you somewhere.

Gate 1: confirm the entire scaffold is green with ZERO packages.

- ci.yml green
- codeql.yml green
- docs.yml green or correctly skipped
- release.yml runs clean as a no-op with no changesets
- branch protection on main requires CI to pass

If anything is red, fix it now — this is exactly the moment it is cheapest.

Then record Gate 1 as PASSED in EXECUTION-CHECKLIST.md with the date and a link
to the green run.

Do not write any package code in this session. S7 starts core.
```

---

### S7 · `core` — design and implement

🆕 **Claude Opus 5** · `/effort high` · **include "ultrathink" in the prompt** · Stories: `CORE-1`, `CORE-2`, `CORE-3`

> The one session where model strength genuinely pays for itself. All twelve other packages import from here. Kept as a single session because the error hierarchy, `Result` composition, and branded types are one design problem, not three.

```
ultrathink

Read Final_plan.md §2.2 and §4 Phase 2, EXECUTION-CHECKLIST.md, and
sprocket-ecosystem-spec.md §10.1 in ../Preparation_Docs/. Nothing else.

Build @firstprinciples/core. This is the highest-leverage design decision in the
project — every other package imports from here, so a bad shape means either
painful refactors later or everyone quietly working around it.

1. Typed error hierarchy: AppError base plus ValidationError, NotFoundError,
   ForbiddenError, UnauthorizedError, ConflictError, each carrying code,
   httpStatus, details?.
   - toJSON() must round-trip losslessly
   - instanceof must work across the hierarchy (watch the TS
     class-extends-Error transpilation pitfall — verify, don't assume)
   - stack traces preserved through the chain
   - zero runtime dependencies

2. Result<T, E> with ok()/err() constructors and isOk()/isErr() guards that
   narrow correctly in both branches under strict.

3. RESOLVE THE LAYERING QUESTION in Final_plan.md §2.2 before writing Result:
   the typed-fetch spec returns ApiResult unions; the ecosystem spec says
   http-client normalizes failures into core error classes. The intended
   resolution is both, layered — the union's error variant carries a core error
   instance, so callers get exhaustive narrowing without losing the shared
   taxonomy. Confirm that actually composes cleanly, or propose better, then
   write the decision into EXECUTION-CHECKLIST.md. http-client (S10), api-kit
   (S12) and access-control (S16) all depend on this answer.

4. Branded primitives: Email, UUID, ISODateString. Validators return Result
   rather than throwing. Type-level tests must confirm a plain string is not
   assignable.

Before finalizing any public signature, write 3–4 realistic call-site snippets
and read them back. If the API is awkward to call, redesign — an awkward
signature is a design bug, not a documentation problem.

Tests: unit, edge cases, and expectTypeOf type-level tests for inference.
TSDoc on every exported symbol.

Update EXECUTION-CHECKLIST.md with the design decisions — especially #3, since
three later sessions read it. Open a PR.
```

---

### S8 · 🚦 GATE 2 — publish `core` 0.1.0

🆕 **Fresh chat** · **Claude Sonnet 5** · `/effort high` · Story: `CORE-4`

> Fresh chat is safe: the design is in the code and the checklist now. This is release-pipeline work, not design work.

```
Read EXECUTION-CHECKLIST.md and the Definition of Done checklist in the repo.

Gate 2: complete the Definition of Done for core and publish it. This is the
real end-to-end proof of the release pipeline — do not build twelve more
packages on an unproven publish path.

1. Walk the full DoD checklist for core
2. README per spec §8.1 — description + badges, install, quick start, why it
   exists, API table, 2–3 recipes, license
3. Coverage at threshold; size-limit budget set and passing
4. Create the changeset, merge the Version Packages PR, let CI publish

Then verify, do not assume:
- the package is live on npm
- it shows a PROVENANCE BADGE (this is the proof OIDC in release.yml is right)
- `npm install @firstprinciples/core` works in a fresh directory outside this repo
- CHANGELOG.md was auto-generated

If provenance is missing, fix release.yml now — every later package depends on
this path working.

Record Gate 2 as PASSED in EXECUTION-CHECKLIST.md and tick core's DoD row.
```

---

### S9 · `logger`

🆕 **Fresh chat** · **Claude Sonnet 5** · `/effort high` · Story: `PKG-LOGGER`

```
Read EXECUTION-CHECKLIST.md, the package template from S5, and
sprocket-ecosystem-spec.md §10.4 in ../Preparation_Docs/. Nothing else.

Build @firstprinciples/logger: structured isomorphic logging.
- pino on Node, lightweight console fallback in browser
- AsyncLocalStorage correlation IDs on Node
- pluggable transports
- automatic secret/PII redaction, configurable patterns

Redaction deserves disproportionate attention — a secret leaking through a
nested object is an incident, not a bug. Treat it adversarially:
- deeply nested objects and arrays
- secret-shaped strings: API keys, JWTs, emails
- circular references
- non-serializable values (functions, symbols, BigInt)
- redaction that must survive the transport boundary, not just the formatter

Also verify the browser build pulls in zero Node built-ins.
Correlation IDs must propagate across async boundaries including Promise.all
and timers.

Full Definition of Done before finishing. Update EXECUTION-CHECKLIST.md, open a PR.
```

---

### S10 · `http-client`

🆕 **Fresh chat** · **Claude Sonnet 5** · `/effort high` · Story: `PKG-HTTP`

> Not Cursor-delegated: the abort-signal composition and network-vs-HTTP error distinction are subtly wrong in ways that still look like they work.

```
Read EXECUTION-CHECKLIST.md (especially the core layering decision from S7) and
../Preparation_Docs/typed-fetch-client-spec.md IN FULL — that spec is
authoritative for this package and wins wherever it differs from the ecosystem
spec's §10.3. Do not read the ecosystem spec this session.

Build @firstprinciples/http-client. Target 3–5KB gzipped.

Client factory, get/post/put/patch/delete, endpoint-definition pattern, retry
with exponential backoff + jitter, timeout via AbortController, onRequest and
onResponse hooks, pluggable validation adapter.

Four things that are easy to get subtly wrong — handle each explicitly:

1. A network failure (timeout/DNS, no response at all) must be a DISTINCT
   result variant from a typed HTTP error response. Callers handle them
   differently — retry UI versus error message.

2. A caller-supplied signal must be COMBINED with the internal timeout
   controller, aborting on whichever fires first. Letting the caller's signal
   replace the timeout is a real bug that passes naive tests.

3. Default retry policy: network errors and 5xx only. NEVER retry 4xx.
   Verify backoff timing with fake timers.

4. The validation adapter is a pluggable slot, not a dependency. Zod and
   Valibot examples go in docs, never in the package. Validation failure is a
   distinct result variant, not a thrown exception.

Error variants carry core error instances per the S7 layering decision.

Verify tree-shaking: a consumer importing only createApiClient must not pull in
unused code. Confirm the bundle actually hits 3–5KB before claiming it anywhere.

Full Definition of Done. Update EXECUTION-CHECKLIST.md, open a PR.
```

---

### S11 · `cache-kit`

🆕 **Fresh chat** · **Claude Sonnet 5** · `/effort high` · Story: `PKG-CACHE`

```
Read EXECUTION-CHECKLIST.md and sprocket-ecosystem-spec.md §10.12 in
../Preparation_Docs/. Nothing else.

Build @firstprinciples/cache-kit: typed get/set/wrap/invalidate over in-memory
LRU and Redis backends, tag-based invalidation, cache-stampede protection.

This is the first package needing testcontainers in CI — budget time for that
Docker wiring. Ephemeral containers inside the Actions runner stay free, which
matters because zero-cost is a hard constraint on this project.

The single-flight dedup is the hardest problem here and the one genuine
concurrency race in the package. Reason about it carefully rather than
pattern-matching. The test that matters: N simultaneous misses for the same key
must produce EXACTLY ONE upstream call.

Also cover: TTL expiry boundaries, eviction under memory pressure, Redis
connection loss mid-operation, and tag invalidation correctness on both backends.

Both backends must be interchangeable behind one interface.

Full Definition of Done. Update EXECUTION-CHECKLIST.md, open a PR.
```

---

### S12 · `api-kit`

🆕 **Fresh chat** · **Claude Sonnet 5** · `/effort high` · Story: `PKG-API`

```
Read EXECUTION-CHECKLIST.md and sprocket-ecosystem-spec.md §10.5 in
../Preparation_Docs/. Nothing else.

Build @firstprinciples/api-kit: standardized typed success/error envelope,
RFC 7807 problem-details formatting, request validation middleware, and
Express/Fastify/Hono adapters.

This package isn't conceptually hard — the risk is DRIFT between the three
adapters. So: write ONE shared conformance test suite and run all three adapters
against it, rather than testing each separately. Effort here buys consistency,
not difficulty.

- core error classes map correctly to RFC 7807 problem details
- validation middleware stays schema-library agnostic
- each adapter's framework is an OPTIONAL peer dependency — installing api-kit
  must not force Express on someone using Hono
- export the envelope types cleanly; react-query-kit (S21) consumes them

Full Definition of Done. Update EXECUTION-CHECKLIST.md, open a PR.
```

---

### S13 · `auth-utils` — hashing and JWT

🆕 **Claude Opus 5** · `/effort high` · **include "ultrathink"** · Story: `PKG-AUTH-1`

> Highest-stakes package in the repo. A subtle mistake here is a vulnerability, not a bug.

```
ultrathink

Read EXECUTION-CHECKLIST.md and sprocket-ecosystem-spec.md §10.6 and §7 in
../Preparation_Docs/. Nothing else.

Build the first half of @firstprinciples/auth-utils: password hashing and JWT.

1. argon2id hashing. Document and justify the memory/time/parallelism
   parameters — state the reasoning, don't just pick numbers. Verify must be
   constant-time.

2. JWT issue and verify with an explicit algorithm ALLOWLIST.

Write negative-path tests that assert rejection for each of these:
- alg: none
- algorithm confusion — an RS256 token replayed as HS256 using the public key
  as the HMAC secret
- expired tokens (exp)
- not-yet-valid tokens (nbf)
- wrong issuer
- wrong audience

Treat each as an attack you are trying to land, not a checkbox. If any of them
passes verification, that's the finding.

Stop after hashing and JWT. Rotation and reuse detection are S14.

Update EXECUTION-CHECKLIST.md, open a PR.
```

---

### S14 · `auth-utils` — rotation, reuse detection, rate limiting

⛓️ **Continue S13's chat** · **Claude Opus 5** · `/effort high` · **"ultrathink"** · Story: `PKG-AUTH-2`

> One of only two places continuing the chat is worth it: the token state machine builds directly on S13's JWT decisions, and re-deriving them costs more than it saves.

```
ultrathink

Continue auth-utils: refresh-token rotation, reuse detection, and rate-limited
login-attempt tracking over a pluggable store.

1. Rotation issues a new refresh token and invalidates the old one ATOMICALLY —
   no window where both are valid or both are dead.

2. Reuse of an already-rotated token must be detected and revoke the ENTIRE
   token family, not just the replayed token. This is the whole point of
   rotation; getting it half-right provides no security benefit.

3. Test the state machine across every transition, including two concurrent
   refresh attempts with the same token.

4. Rate limiting over a pluggable store, with an in-memory default.

Do not run the security review in this chat — S15 does that in a fresh session
deliberately, so the reviewer isn't anchored on your own reasoning.

Update EXECUTION-CHECKLIST.md, open a PR.
```

---

### S15 · `auth-utils` — adversarial security review

🔁 **Fresh chat REQUIRED** · **Claude Opus 5** · `/effort high` · Story: `PKG-AUTH-2` (review gate)

> The fresh chat here is a **quality requirement, not a cost saving**. A model reviewing its own implementation in the same conversation is anchored on the reasoning that produced it. Starting clean is the closest thing to a second pair of eyes.

```
Read only packages/auth-utils/ — the source and the tests. Do NOT read the
planning docs, and do not assume the implementation is correct.

You are reviewing this code adversarially, as an attacker would. You did not
write it.

Focus specifically on:
1. JWT algorithm-confusion vulnerabilities — can any token be crafted that
   verifies under an unintended algorithm?
2. Timing-attack risks in every comparison involving a secret, token, or hash
3. The refresh-token rotation state machine — is there ANY interleaving of
   concurrent requests that leaves a rotated token still valid, or that fails
   to revoke the family on reuse?
4. Fail-open paths — anywhere an error, null, undefined, or malformed input
   results in access being granted rather than denied
5. Whether the tests actually prove the security properties they claim, or just
   exercise the happy path with security-sounding names

For each finding: the exact file and line, a concrete exploitation scenario, and
a fix. If you find nothing in a category, say so explicitly rather than padding.

Then apply the fixes, with a regression test for each.

Record findings and resolutions in EXECUTION-CHECKLIST.md — this is the audit
trail for the highest-risk package in the project.
```

---

### S16 · `access-control`

🆕 **Claude Opus 5** · `/effort high` · **"ultrathink" on rule resolution** · Story: `PKG-ACL`

```
ultrathink on the rule precedence and conflict-resolution logic specifically.

Read EXECUTION-CHECKLIST.md and sprocket-ecosystem-spec.md §10.2 in
../Preparation_Docs/. Nothing else.

Build @firstprinciples/access-control: isomorphic RBAC/ABAC engine.
- portable rule schema, defined once, used on client and server
- can(action, subject, context?) and assertCan(...) which throws ForbiddenError
  from core
- attribute-based rules including ownership checks
- Express/Fastify/Hono guard factories
- <Can> component and usePermission() hook sharing the same rule source

Permission systems fail in subtle ways — rule ordering, ownership edge cases,
silent deny-by-default violations — that surface-level testing misses. The
can() resolution core deserves deep reasoning; the adapter surface around it is
ordinary work.

Non-negotiable properties, each tested explicitly:
- DENY BY DEFAULT, including for unknown actions and unknown subjects
- ownership/attribute rules with missing or null context must fail CLOSED,
  never open
- rule precedence and conflict resolution documented AND exhaustively tested
- the same rule set produces identical decisions on client and server — prove
  it with one shared test suite, not two parallel ones

Full Definition of Done. Update EXECUTION-CHECKLIST.md, open a PR.
```

---

### S17 · `access-control` — fail-open review

🔁 **Fresh chat REQUIRED** · **Claude Opus 5** · `/effort medium` · Story: `PKG-ACL` (review gate)

> Short session, same reasoning as S15. A permission bug that fails open is indistinguishable from working software until someone finds it.

```
Read only packages/access-control/ — source and tests. Do not read planning docs.

Review adversarially. You did not write this code.

Find every path where the answer to "is this allowed?" could be YES when it
should be NO:
1. Unknown action, unknown subject, unknown role
2. Null, undefined, empty, or malformed context
3. A thrown error mid-evaluation — does it deny, or does it escape and get
   treated as allow by a caller?
4. Rule conflicts where an allow and a deny both match
5. Any divergence between the client and server evaluation paths
6. Ownership checks where the owner field is absent or of the wrong type

For each: file, line, concrete scenario, fix. Apply fixes with regression tests.

Record findings in EXECUTION-CHECKLIST.md.
```

---

### S18 · `bootstrap`

🆕 **Fresh chat** · **Claude Sonnet 5** · `/effort high` · Story: `PKG-BOOT`

```
Read EXECUTION-CHECKLIST.md and sprocket-ecosystem-spec.md §10.8 in
../Preparation_Docs/. Nothing else.

Build @firstprinciples/bootstrap: Node service startup/shutdown lifecycle.
- env validation that fails fast BEFORE the port binds
- graceful shutdown on SIGTERM/SIGINT with ordered connection draining
- health-check generator (/healthz, /readyz) with pluggable sub-checks
- structured startup diagnostics via logger

Shutdown ordering under in-flight requests is a partial-failure path that unit
tests miss unless deliberately targeted. Test it under simulated load.

Specifics:
- validation errors must name EVERY missing/invalid variable at once, not fail
  on the first one — anything else is a miserable deploy experience
- in-flight requests drain before connections close
- shutdown ordering deterministic and configurable
- /readyz fails while draining, /healthz stays honest
- double SIGTERM handled without corrupting shutdown state

Full Definition of Done. Update EXECUTION-CHECKLIST.md, open a PR.
```

---

### S19 · `queue`

🆕 **Fresh chat** · **Claude Sonnet 5** · `/effort high` · Story: `PKG-QUEUE`

```
Read EXECUTION-CHECKLIST.md and sprocket-ecosystem-spec.md §10.7 in
../Preparation_Docs/. Reuse the testcontainers Redis setup from cache-kit (S11)
rather than building a second one.

Build @firstprinciples/queue: typed job queue conventions over BullMQ.
- typed job payload/result generics that infer end-to-end with NO call-site
  generics
- retry/backoff presets, configurable per job type
- dead-letter queue handling
- metrics hooks for duration, failures, and depth, wired to any backend

The transition that matters: retry exhaustion must move the job to the DLQ.
Verify with testcontainers Redis, not a mock.

Edge cases: worker crash mid-job, Redis disconnect during processing,
malformed payload.

Full Definition of Done. Update EXECUTION-CHECKLIST.md, open a PR.
```

---

### S20 · `realtime-kit`

🆕 **Fresh chat** · **Claude Sonnet 5** · `/effort medium` · Story: `PKG-RT`

```
Read EXECUTION-CHECKLIST.md and sprocket-ecosystem-spec.md §10.13 in
../Preparation_Docs/. Nothing else.

Build @firstprinciples/realtime-kit: WebSocket/SSE abstraction with
auto-reconnect and backoff, typed pub/sub channels, useSubscription() hook.

Reuse the backoff shape already proven in http-client (S10) rather than
inventing a second one — consistency across the ecosystem is the point.

- WS and SSE behind one interface
- reconnect backoff verified with fake timers
- reconnect GIVES UP per policy rather than retrying forever
- message types narrow correctly per channel
- useSubscription() cleans up on unmount with no leaked listeners
- edge cases: disconnect mid-message, out-of-order delivery, server close
  during a reconnect attempt

Full Definition of Done. Update EXECUTION-CHECKLIST.md, open a PR.
```

---

### S21 · `react-query-kit`

🆕 **Fresh chat** · **Claude Sonnet 5** · `/effort medium` · Story: `PKG-RQ`

```
Read EXECUTION-CHECKLIST.md, packages/api-kit's exported envelope types, and
sprocket-ecosystem-spec.md §10.9 in ../Preparation_Docs/. Nothing else.

Build @firstprinciples/react-query-kit: opinionated TanStack Query layer.
- paginated list hooks typed against api-kit's envelope, inferring types with
  NO manual generics at the call site
- optimistic mutation helpers with rollback
- cache invalidation helpers by resource type

Two things to prove rather than assume:
- optimistic mutation ROLLS BACK correctly on error
- invalidation targets only the intended resource type — assert that unrelated
  queries stay cached, which is the assertion people usually skip

TanStack Query stays a peer dependency, never bundled.
Test with React Testing Library + Vitest.

Full Definition of Done. Update EXECUTION-CHECKLIST.md, open a PR.
```

---

### S22 · `react-forms`

🆕 **Fresh chat** · **Claude Sonnet 5** · `/effort high` · Story: `PKG-FORMS`

> Accessibility work here is directly reusable in the a11y blog post and overlaps with the Storybook contribution (S-OSS-2).

```
Read EXECUTION-CHECKLIST.md and sprocket-ecosystem-spec.md §10.10 in
../Preparation_Docs/. Nothing else.

Build @firstprinciples/react-forms: React Hook Form toolkit.
- prebuilt accessible fields (text, select, async-validated)
- error mapping from api-kit's envelope into field-level errors
- headless-first: logic fully separable from styling

Accessibility is a real requirement here, not a nice-to-have:
- every field passes axe with ZERO violations
- keyboard navigation and screen-reader labelling verified per field
- error messages associated via aria-describedby

The subtle bug to handle deliberately: async validation race conditions. A
stale slow response must NEVER overwrite a fresher result. Test it with
deliberately interleaved timings.

Error mapping: envelope errors land on the right fields, and any error that
maps to no field is SURFACED rather than silently swallowed.

Prove headless-first by writing both a styled and an unstyled consumer.

Full Definition of Done. Update EXECUTION-CHECKLIST.md, open a PR.
```

---

### S23 · `module-federation-kit`

🆕 **Claude Opus 5** · `/effort high` · **"ultrathink"** · Story: `PKG-MF`

> The most niche, least-documented domain in the ecosystem, and the highest-differentiation package — very few contributors have real production MF experience. Deliberately last, so `core`'s patterns are stable.

```
ultrathink

Read EXECUTION-CHECKLIST.md and sprocket-ecosystem-spec.md §10.11 in
../Preparation_Docs/. Nothing else.

Build @firstprinciples/module-federation-kit: a DX layer over Webpack/Rspack
Module Federation.
- dynamic remote registration at RUNTIME, not just build time
- typed host/remote contracts using core's patterns — a mismatch must be a
  compile error
- loading and error boundary components
- retry/fallback strategy on remote load failure, with a bounded ceiling

Module Federation's runtime internals are genuinely under-documented compared
to something like React Query, so reason from first principles rather than
pattern-matching, and verify assumptions against the actual MF runtime API
rather than recalling them.

- simulate a failed remote and verify fallback actually engages
- the error boundary must surface WHICH remote failed and why — generic
  "something went wrong" is useless in a micro-frontend deployment
- document shared-dependency and version-mismatch behaviour, including the real
  production gotchas (shared singletons, eager: true leaking across plugin
  instances). This documentation is itself a differentiator and feeds directly
  into the MF blog posts and the OSS contribution in S-OSS-4.
- works with both Webpack and Rspack

Full Definition of Done. Update EXECUTION-CHECKLIST.md, open a PR.
```

---

### S24 · Docs site infrastructure

🆕 **Fresh chat** · **Claude Sonnet 5** · `/effort medium` · Story: `DOC-1`

```
Read EXECUTION-CHECKLIST.md and sprocket-ecosystem-spec.md §6.5 and §8.2 in
../Preparation_Docs/. Nothing else.

Set up the docs site: Astro Starlight + TypeDoc, deployed to GitHub Pages via
docs.yml.

- Starlight builds to static output
- TypeDoc generates the API reference from TSDoc comments as part of the docs
  build step
- docs.yml deploys to Pages on push to main
- site reachable at the Pages URL

The requirement that matters most: adding a new package must require ZERO
manual docs wiring. If someone has to hand-register each package, this will rot.

Update EXECUTION-CHECKLIST.md, open a PR.
```

---

### S25 · Docs content pages

🆕 🖱️ **Cursor · Grok 4.5 · medium** · Story: `DOC-2`

> Prose assembled from READMEs that already exist. One caveat baked into the prompt: the getting-started code must be _run_, not just written.

```
Read AGENTS.md, EXECUTION-CHECKLIST.md, and the README of each package in
packages/. Do not read the Preparation_Docs specs — the package READMEs are the
current truth.

Write the docs site content pages.

1. Architecture / dependency diagram page showing the REAL dependency graph
   across all 13 packages. Derive it from actual package.json dependencies, not
   from the plan — if they disagree, the code is right and that's a finding
   worth reporting.

2. A "build a mini-app in 10 minutes" getting-started page combining 3–4
   packages.

   IMPORTANT: actually run the code in this page and confirm it works before
   committing it. A getting-started page with broken code is worse than none —
   it's the first thing a new user tries.

3. Confirm every package has a docs page reachable from the homepage.

4. Homepage must state what the ecosystem is within the first screen.

Update EXECUTION-CHECKLIST.md, open a PR.
```

---

### S26 · `examples/minimal-api`

🆕 **Fresh chat** · **Claude Sonnet 5** · `/effort medium` · Story: `EX-1`

> Not delegated: this session exists to _surface_ composition problems, which requires noticing that something is awkward rather than routing around it.

```
Read EXECUTION-CHECKLIST.md and the READMEs of api-kit, auth-utils, and logger.

Build examples/minimal-api — an Express or Fastify service using
api-kit + auth-utils + logger together.

This is NOT decoration. It's the first real integration test of whether these
packages actually compose. Expect to hit genuine API-ergonomics problems.

When something is awkward, clumsy, or requires a workaround: STOP and file it
as an issue rather than quietly working around it. Papering over it here means
every real user hits the same wall. That friction is the main value of this
session.

- runs locally with documented setup
- demonstrates auth, envelope responses, and correlated structured logging
  together in one request path
- consumes packages via workspace protocol

Report every composition problem found, even small ones.
Update EXECUTION-CHECKLIST.md, open a PR.
```

---

### S27 · `examples/minimal-dashboard`

🆕 **Fresh chat** · **Claude Sonnet 5** · `/effort medium` · Story: `EX-2`

```
Read EXECUTION-CHECKLIST.md, the READMEs of react-query-kit and react-forms,
and examples/minimal-api from S26.

Build examples/minimal-dashboard — a React app using react-query-kit +
react-forms, talking to minimal-api.

Same rule as S26: file composition problems as issues, don't work around them.

- runs locally against minimal-api
- demonstrates paginated lists, optimistic mutation with rollback, and form
  error mapping from real API errors
- the thing to prove: END-TO-END type inference from the backend envelope
  through to frontend form errors, with NO manual type duplication anywhere. If
  you find yourself redeclaring a type that already exists on the backend,
  that's a design gap in the packages — report it.

Update EXECUTION-CHECKLIST.md, open a PR.
```

---

### S28 · Security sweep

🆕 **Fresh chat** · **Claude Sonnet 5** · `/effort high` (**switch to Opus 5 for any alert touching auth-utils or access-control**) · Story: `REL-1`

```
Read EXECUTION-CHECKLIST.md, including the S15 and S17 security review findings.

Full security sweep across all 13 packages before anything goes public.

1. Every CodeQL alert: resolved, or explicitly dismissed with a WRITTEN
   justification. "Probably fine" is not a justification.
2. npm audit clean of high/critical
3. Every Dependabot PR merged or closed with a stated reason
4. Run OSSF Scorecard and review the score
5. Verify no secrets anywhere in git HISTORY — check, don't assume. Push
   protection only catches what came after it was enabled.

If any alert touches auth-utils or access-control, stop and switch to Opus 5
before triaging it — those two packages are where a misjudged dismissal is
actually dangerous.

This is a judgement task, not a generation task. For each finding, state
whether it's real and why.

Record every decision in EXECUTION-CHECKLIST.md.
```

---

### S29 · Definition of Done audit

🆕 **Fresh chat** · **Claude Sonnet 5** · `/effort high` · Story: `REL-2`

```
Read EXECUTION-CHECKLIST.md and the Definition of Done checklist in the repo.

Final audit before the code is public and installable by strangers. Walk the
full DoD for ALL 13 packages, one at a time. Do not batch or skim — this is the
last checkpoint.

For each package verify, don't assume:
- src/index.ts exports only the intentional public API
- TSDoc on every exported symbol
- README complete per spec §8.1
- coverage at threshold (90% lines/functions, 85% branches)
- size-limit budget set and passing
- npm audit clean
- published WITH PROVENANCE
- an /examples usage exists
- listed in the root README
- docs site page live

Then two checks across the whole repo:
- "access": "public" confirmed on ALL 13 packages. This is the one setting that
  could accidentally cost money — scoped packages default to private, which
  requires a paid plan.
- every package installs cleanly from npm in a fresh directory outside the repo

Any package that fails: fix it, or hold it back from release. Do not ship a
package that fails its own checklist.

Record the per-package result in EXECUTION-CHECKLIST.md.
```

---

### S30 · Root README and profile polish

🆕 🖱️ **Cursor · Grok 4.5 · medium** · Story: `REL-3`

> Content assembly from material that already exists. Low risk, high visibility.

```
Read AGENTS.md, EXECUTION-CHECKLIST.md, and every package README in packages/.

Write the root README. This is the first thing a recruiter or engineer actually
sees, so it deserves real care even though the work is assembly.

- explain what the ecosystem IS in the first paragraph — not the philosophy,
  the actual thing
- all 13 packages listed with one-line descriptions and links
- badges: npm version, bundle size, license, CI status, OSSF Scorecard
- links to the docs site and to examples
- a short "start here" path for someone who has never seen this repo

Then propose the 2–3 flagship packages best suited to the resume's Open Source
section — pick on the basis of "clearest problem solved," and say why for each.

Update EXECUTION-CHECKLIST.md.
```

---

# Open-source track

Runs in parallel with the build track, not after it. Slot these between build sessions.

> **Note:** the specific issue numbers in `oss-contribution-plan.pdf` are stale by now. Use each repo's current `good first issue` label — the workflow transfers, the tickets don't.

---

### S-OSS-0 · Contribution workflow checklist

🆕 🖱️ **Cursor · Grok 4.5 · medium** · Stories: `OSS-0`, `OSS-5`

```
Read ../Preparation_Docs/oss-contribution-plan.pdf sections 7 and 9 only.

Create two files at the repo root:

1. OSS-WORKFLOW.md — the repeatable per-PR checklist, in order:
   read CONTRIBUTING.md → comment on the issue BEFORE coding → fork and clone →
   reproduce the bug locally FIRST → small single-purpose PR WITH a test →
   description with before/after evidence and "Fixes #N" → respond to review
   promptly → log the merge immediately

2. OSS-LOG.md — a running contribution log, one row per merged PR: repo, link,
   date, one-line description. Empty table with headers for now.

Keep both short. A checklist nobody reads is worse than no checklist.
```

---

### S-OSS-1 · TanStack Query documentation PR

🆕 🖱️ **Cursor · Grok 4.5 · medium** · Story: `OSS-1`

> Docs-only warm-up in a library you already use. Low risk, and the goal is learning the workflow end to end rather than the change itself.

```
Read OSS-WORKFLOW.md.

Target: github.com/TanStack/query — a library already used in production, which
is a real advantage over a cold codebase.

1. Find a CURRENT open, unclaimed documentation issue. The issue numbers in the
   old plan doc are stale — use the repo's live "good first issue" label.
2. Read their CONTRIBUTING.md before anything else — skipping it is the number
   one reason first PRs stall.
3. Draft the issue comment claiming it ("I'd like to work on this — planning to
   [approach]. Any guidance before I start?") and WAIT for me to post it.
4. Once cleared, fork, clone, make the change.
5. Draft the PR description with "Fixes #N".

Do not open the PR yourself — draft everything and hand it to me to submit.

Add the entry to OSS-LOG.md once merged.
```

---

### S-OSS-2 · First code-fix PR (Storybook a11y preferred)

🆕 **Fresh chat** · **Claude Sonnet 5** · `/effort high` · Story: `OSS-2`

> Not delegated: reproducing a bug in a large unfamiliar monorepo is where a weaker model quietly guesses. The Storybook accessibility issue is the strategically best pick — it produces a linkable code contribution for the a11y blog post and overlaps with `react-forms` (S22).

```
Read OSS-WORKFLOW.md.

Target: a Storybook accessibility issue (preferred — it ties to the
accessibility blog topic and to react-forms), or a TanStack Query code issue if
no suitable a11y one is open.

1. Find a current, open, unclaimed issue with the good-first-issue label
2. Read their CONTRIBUTING.md
3. REPRODUCE THE BUG LOCALLY before writing any fix. This is the single biggest
   differentiator between PRs that merge fast and ones that bounce back with
   questions. Do not skip it because the fix looks obvious.
4. Fix it — minimal and single-purpose. No unrelated refactors or style changes
   bundled in; that's the fastest way to stall a review.
5. Include a test
6. Draft the PR description with before/after evidence (screenshot, test output,
   or a short reproduction) and "Fixes #N"

Draft the issue comment and the PR for me to post — don't submit either yourself.

Add to OSS-LOG.md once merged.
```

---

### S-OSS-3 · Zustand contribution

🆕 **Fresh chat** · **Claude Sonnet 5** · `/effort high` · Story: `OSS-3`

```
Read OSS-WORKFLOW.md.

Target: github.com/pmndrs/zustand.

Important: their Issues tab is deliberately kept very short — maintainers route
"help wanted" through GitHub DISCUSSIONS. Look there, not at Issues.

Best fits for this codebase and my TypeScript background:
- improving TypeScript type inference on a middleware (persist or devtools)
- clarifying SSR/hydration behaviour with the persist middleware, which is a
  recurring pain point in their issue history

1. Review current "help wanted" discussions for open asks
2. Scope a contribution and draft a comment proposing it BEFORE coding — this
   repo's maintainers are active and will steer you
3. Implement with tests if code is involved
4. Draft the PR

Draft comments and PR for me to post. Add to OSS-LOG.md once merged.
```

---

### S-OSS-4 · Module Federation contribution

🆕 **Fresh chat** · **Claude Sonnet 5** · `/effort high` · Story: `OSS-4`

> Best sequenced _after_ S23, so the MF package work is fresh and there's real production insight to contribute.

```
Read OSS-WORKFLOW.md and the shared-dependency documentation written in S23 for
module-federation-kit.

Target: github.com/module-federation/core.

This is the highest-differentiation contribution of the four — smaller
community, and very few contributors have real production MF experience, so
even a modest well-written PR stands out disproportionately.

This is also the ONE repo where commenting with production context before
attempting a fix is worth doing on its own — maintainers there value
operational insight as much as code.

1. Look for open issues in the shared-dependency / version-mismatch /
   build-tool-integration space
2. Draft an issue comment sharing the relevant production experience and the
   gotchas documented in S23
3. Either a code fix, OR a documentation contribution writing up a real
   shared-singleton or versioning gotcha — the docs contribution is genuinely
   high-value here, not a consolation prize
4. Draft the PR

Draft everything for me to post. Add to OSS-LOG.md once merged.
```

---

## Summary

| \#    | Session                         | Where     | Model             | Effort            | Chat |
| ----- | ------------------------------- | --------- | ----------------- | ----------------- | ---- |
| S0    | Prerequisites                   | 👤 manual | —                 | —                 | —    |
| S1    | Monorepo scaffold + checklist   | Claude    | Sonnet 5          | medium            | 🆕   |
| S2    | Formatter hooks + governance    | 🖱️ Cursor | Grok 4.5          | medium            | 🆕   |
| S3    | CI + security workflows         | Claude    | Sonnet 5          | medium            | 🆕   |
| S4    | Changesets + release.yml        | Claude    | Sonnet 5          | **high**          | 🆕   |
| S5    | Size budgets + package template | Claude    | Sonnet 5          | medium            | 🆕   |
| S6    | 🚦 Gate 1                       | Claude    | Sonnet 5          | medium            | 🆕   |
| S7    | `core`                          | Claude    | **Opus 5**        | high + ultrathink | 🆕   |
| S8    | 🚦 Gate 2 — publish core        | Claude    | Sonnet 5          | high              | 🆕   |
| S9    | `logger`                        | Claude    | Sonnet 5          | high              | 🆕   |
| S10   | `http-client`                   | Claude    | Sonnet 5          | high              | 🆕   |
| S11   | `cache-kit`                     | Claude    | Sonnet 5          | high              | 🆕   |
| S12   | `api-kit`                       | Claude    | Sonnet 5          | high              | 🆕   |
| S13   | `auth-utils` — hashing + JWT    | Claude    | **Opus 5**        | high + ultrathink | 🆕   |
| S14   | `auth-utils` — rotation         | Claude    | **Opus 5**        | high + ultrathink | ⛓️   |
| S15   | `auth-utils` — security review  | Claude    | **Opus 5**        | high              | 🔁   |
| S16   | `access-control`                | Claude    | **Opus 5**        | high + ultrathink | 🆕   |
| S17   | `access-control` — review       | Claude    | **Opus 5**        | medium            | 🔁   |
| S18   | `bootstrap`                     | Claude    | Sonnet 5          | high              | 🆕   |
| S19   | `queue`                         | Claude    | Sonnet 5          | high              | 🆕   |
| S20   | `realtime-kit`                  | Claude    | Sonnet 5          | medium            | 🆕   |
| S21   | `react-query-kit`               | Claude    | Sonnet 5          | medium            | 🆕   |
| S22   | `react-forms`                   | Claude    | Sonnet 5          | high              | 🆕   |
| S23   | `module-federation-kit`         | Claude    | **Opus 5**        | high + ultrathink | 🆕   |
| S24   | Docs infrastructure             | Claude    | Sonnet 5          | medium            | 🆕   |
| S25   | Docs content                    | 🖱️ Cursor | Grok 4.5          | medium            | 🆕   |
| S26   | `examples/minimal-api`          | Claude    | Sonnet 5          | medium            | 🆕   |
| S27   | `examples/minimal-dashboard`    | Claude    | Sonnet 5          | medium            | 🆕   |
| S28   | Security sweep                  | Claude    | Sonnet 5 / Opus 5 | high              | 🆕   |
| S29   | Definition of Done audit        | Claude    | Sonnet 5          | high              | 🆕   |
| S30   | Root README + polish            | 🖱️ Cursor | Grok 4.5          | medium            | 🆕   |
| OSS-0 | Workflow checklist              | 🖱️ Cursor | Grok 4.5          | medium            | 🆕   |
| OSS-1 | TanStack docs PR                | 🖱️ Cursor | Grok 4.5          | medium            | 🆕   |
| OSS-2 | First code-fix PR               | Claude    | Sonnet 5          | high              | 🆕   |
| OSS-3 | Zustand                         | Claude    | Sonnet 5          | high              | 🆕   |
| OSS-4 | Module Federation               | Claude    | Sonnet 5          | high              | 🆕   |

**Distribution:** 1 manual · 6 Cursor/Grok · 23 Sonnet 5 · 6 Opus 5

**Where the savings come from,** in order of impact: S0 costs nothing because it's manual; 29 of 31 build sessions start fresh so context never compounds; every prompt names only the 1–3 files it needs and says not to read the rest; Opus is reserved for the 6 sessions where it changes the outcome; and 6 boilerplate sessions move to Cursor entirely.

**Where cost was deliberately not optimized:** S13–S17 (security), S7 (`core`), S23 (Module Federation), and the two review passes. Those five decisions account for most of the Opus spend, and each one is somewhere a mistake is either a vulnerability or a refactor across twelve packages.
