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
| S2 | SCAF-4, GOV-1, GOV-2 | 2026-08-16 | Prettier (`.prettierrc` + `eslint-config-prettier` last in `tools/eslint-config`), Husky pre-commit → lint-staged (`eslint --fix` + Prettier on staged files only; hook verified on a real commit). MIT LICENSE, CONTRIBUTING.md (setup + changeset requirement + PR expectations), Contributor Covenant 2.1, SECURITY.md (0.x support table; GitHub private vulnerability reporting only). `.github/CODEOWNERS`, bug/feature issue templates, PR template with changeset checkbox. Root `eslint.config.js` added so the pre-commit ESLint run has a config. |

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
  - If any package session needs to bump these, re-check the peer-dependency chain above before doing so — it's the reason these specific versions were chosen over strictly-latest.
- **Formatter vs ESLint:** Prettier is the only formatter. Shared ESLint config does not set formatting rules; `eslint-config-prettier` is appended to disable any stylistic rules that leak in from recommended presets. Do not add `quotes`/`semi`/`indent` ESLint rules.
- **CODEOWNERS:** `@aaasingh905` is the default owner until GitHub teams exist.
- **`tools/*` added to `pnpm-workspace.yaml` packages list** (spec §4.1 only lists `packages/*`, `docs`, `examples/*`). This addition is necessary for `tools/tsconfig-base` and `tools/eslint-config` to be resolvable via `workspace:*` — without it they aren't pnpm workspace members at all.

---

## Gate status

- **Gate 1 (CI green on empty scaffold):** NOT YET PASSED. Scaffold exists locally and verifies clean (`pnpm install`, `turbo run build/lint/typecheck/test` all exit 0 with zero packages). CI workflows (`ci.yml`, `codeql.yml`, `release.yml`, `docs.yml`, `dependabot.yml`) have not been written yet — that's S3–S5. Gate 1 itself is confirmed in S6.
- **Gate 2 (core published to npm 0.1.0 with provenance):** NOT STARTED.

---

## Per-package Definition of Done matrix

All 13 packages unchecked — no package code has been written yet (S1 is scaffold-only). Columns per Final_plan.md §5 / spec §12. ☐ = not done, ☑ = done.

| Package | index.ts clean | TSDoc | README | Coverage | Edge cases | Type-level tests | size-limit | npm audit | CodeQL | Provenance publish | /examples | Root README | Docs page |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| core | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
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

- None yet. S7 (`core` design) must explicitly resolve the `Result`/error-class layering question (Final_plan.md §2.2) and record the decision here — three later sessions (`http-client`, `api-kit`, `access-control`) depend on that answer.

---

## Next session

**S3 · CI and security workflows** — 🆕 Claude Sonnet 5 · `/effort medium`. Stories `CI-1`, `CI-2`. See `sessions-all-prompts.md`.
