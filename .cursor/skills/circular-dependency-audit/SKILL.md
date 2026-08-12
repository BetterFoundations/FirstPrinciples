---
name: circular-dependency-audit
description: Check whether a new import introduces a circular module dependency before adding it — use when adding a cross-module import, since this codebase already carries three accepted-debt circular dependencies that should not gain a fourth.
---

# Circular Dependency Audit

## Purpose

This codebase has three known circular dependencies, accepted as non-retroactive debt, not a pattern to extend. This prompt is a pre-check for new imports specifically to avoid adding a fourth by accident.

## Preconditions

- A new import is about to be added connecting two modules that didn't previously depend on each other.

## Prompt Template

```
Before adding this import from [module A] to [module B]: does [module B]
(directly or transitively) already import from [module A]?

Trace B's own imports up to 2-3 levels. If a cycle would result, don't
add the import — propose instead: extracting the shared piece into a
common module, or inverting the dependency (B takes what it needs as a
parameter instead of importing A directly).

If a cycle already exists independent of this change, don't fix it as a
side effect — flag it and leave it, per dependency-rules.md's
non-retroactive stance.
```

## Expected Output Shape

A stated trace result (cycle found / not found) and, if found, one of the two resolution options rather than the import being added anyway.

## Postconditions

- No new entry needed in known_issues_documentation.md if the check prevented a cycle — that's the point of running this before the fact rather than after.
