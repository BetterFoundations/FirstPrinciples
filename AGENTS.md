---
tags: [ai, router]
summary: Canonical entry point for any AI agent working in FirstPrinciples. A router, not a reference doc.
applies to: FirstPrinciples
---

# AGENTS.md — FirstPrinciples

Single entry point for any AI coding agent (Claude Code, Codex, Cursor,
Copilot, or successor) working in **this** repo. Tool adapters
(`CLAUDE.md`, `.cursorrules`, `.cursor/rules/agents.mdc`) point here.

Read this file fully. Then open only the 1–3 files the table below names.

## Roles

Every task is one of: Planner, Implementer, Reviewer, Doc-Updater.
Payments / auth / data-migration → **Planner** mandatory.
See playbook `../EngineeringCompass/ai/agent-roles.md` (link; do not copy).

## Task → what to read

| Task type        | Read (in order)                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------- |
| Bug fix          | 1. File with the bug. 2. Nearest test (if any).                                             |
| New feature      | 1. Closest existing module, if one exists. 2. `README.md`.                                  |
| Doc-only         | The doc file itself + `README.md`.                                                          |
| Coding standards | Playbook `../EngineeringCompass/standards/` index → one relevant file (link, don't vendor). |

## Hard rules

- No secrets in git, logs, or docs.
- Do not delete or weaken failing tests to make CI green — fix code or fix a wrong expectation (playbook testing philosophy).
- Prefer updating `README.md` when adding a doc file — this repo has no `/docs` tree yet.

## Where things live

| Need         | Path                                  |
| ------------ | ------------------------------------- |
| Doc index    | `README.md` (no `docs/_index.md` yet) |
| Known issues | none tracked yet                      |
| Playbook     | `../EngineeringCompass/`              |

This repo is early-stage — mostly empty beyond this router. Update the
tables above as real structure (source dirs, tests, docs) gets added.
