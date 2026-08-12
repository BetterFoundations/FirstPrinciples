# FirstPrinciples — Understanding Check

- Build FirstPrinciples as a pnpm + Turborepo monorepo of independently-publishable, scoped npm packages (spec docs use `@sprocket` as a placeholder scope name).
- Everything runs on free-tier infra only: GitHub public repo + Actions, npm public registry, GitHub Pages — no paid services anywhere.
- ~13 packages planned: core, access-control, http-client, logger, api-kit, auth-utils, queue, bootstrap, react-query-kit, react-forms, module-federation-kit, cache-kit, realtime-kit.
- `core` (errors, `Result<T,E>`, branded types) is the foundation every other package depends on — build and get right first.
- Every package: strict TypeScript, ≥90% line / ≥85% branch test coverage, TSDoc, tree-shakeable, bundle-size budget enforced via size-limit.
- A standalone `typed-fetch` API client has its own detailed spec — discriminated-union results (no thrown exceptions), retry/backoff, timeout/abort, one interceptor hook, optional Zod/Valibot validation adapter. Likely feeds into (or becomes) the ecosystem's `http-client` package.
- Full CI/CD per package via GitHub Actions: lint, typecheck, test+coverage, build, bundle-size check, CodeQL, Dependabot, Changesets-driven versioning + provenance-signed npm publish.
- Docs: fixed-structure per-package README + one org-wide Astro Starlight/TypeDoc site on GitHub Pages.
- Governance files from day one: MIT LICENSE, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, issue/PR templates, CODEOWNERS.
- Build order: root scaffold → confirm CI green on empty scaffold → `core` → cross-cutting utils (logger, http-client, cache-kit) → backend conventions (api-kit, auth-utils, access-control) → service lifecycle (bootstrap, queue) → realtime-kit → frontend layer (react-query-kit, react-forms) → module-federation-kit last.
- Pace: roughly 1-2 packages fully done (code + tests + docs + publish) per week rather than 13 in parallel.
- Prerequisites before coding: git/node/pnpm set up, GitHub org + repo created, npm org created with 2FA, `NPM_TOKEN` added as a repo secret for CI publishing.
- Parallel track: contribute to OSS libraries already used in production — priority order TanStack Query, Zustand, Storybook, Module Federation — starting with docs/small-bug PRs before code PRs.
- OSS workflow: comment on the issue before starting → reproduce the bug locally → small single-purpose PR with a test → clear PR description → respond to review promptly → log every merged PR immediately.
- Rough OSS timeline: weeks 1-2 a TanStack docs PR, weeks 3-5 a TanStack/Storybook code-fix PR, weeks 6-8 Zustand, weeks 9-12 Module Federation (timed to support blog posts).
- LangGraph/LangChain or CrewAI OSS contributions come later, only once the (separate) RAG/agent projects are live — not an immediate priority here.
- End goal: this body of work (15+ packages, merged OSS PRs, technical articles) becomes a named "Open Source & Technical Writing" resume/LinkedIn section — a few flagship highlights, not a raw list.
- This workspace already has EngineeringCompass wired in (AGENTS.md + skills), so agent-assisted work on FirstPrinciples should follow that playbook's standards/workflow automatically.

*Nothing else has been set up yet — this file only confirms shared understanding before we build a real plan.*
