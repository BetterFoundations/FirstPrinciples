---
name: safe-refactor-plan
description: Plan a refactor spanning multiple files with a fixed, non-expanding file list — use for any refactor to prevent scope creep mid-implementation.
---

# Safe Refactor Plan

## Purpose

A refactor's file list should be decided once, in the plan, not discovered incrementally while editing — incremental discovery is how a bounded refactor turns into an unbounded one. Matches this playbook's context-loading-rules.md: "Refactor spanning multiple files: Plan first (Planner role), then budget = files listed in the plan, no more."

## Preconditions

- The refactor's motivation is stated (not just "clean this up") — what breaks or is hard because of the current structure.
- No behavior change is intended (a refactor that changes behavior is a feature, plan it as one).

## Prompt Template

```
Plan a refactor: [what, and why the current structure is a problem].

List the exact files this will touch — this list becomes the budget, not
a starting point. If you discover mid-implementation that another file
needs to change, stop and flag it rather than silently expanding scope.

State explicitly: what behavior must be identical before and after. If
existing tests don't already cover that behavior, note where coverage is
thin before proceeding — don't refactor code you can't verify.

Wait for confirmation on the file list before implementing.
```

## Expected Output Shape

A fixed file list with one line per file stating what changes there, followed by the refactor itself once confirmed.

## Postconditions

- All pre-existing tests pass unchanged (their assertions, not just their pass/fail status) — a refactor that required changing test expectations wasn't behavior-preserving and should be re-scoped as a feature change.
