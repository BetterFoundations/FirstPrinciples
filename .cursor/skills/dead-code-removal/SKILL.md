---
name: dead-code-removal
description: Confirm code is truly unreferenced before deleting it — use before removing anything flagged as "possibly dead," since this project has repeatedly found dead-looking code that turned out to be load-bearing or vice versa.
---

# Dead Code Removal

## Purpose

This codebase has multiple confirmed dead-code findings (`src/infra/http/`, FE `exampleCalls.ts`/`apiClient.ts`) that were verified by actual call-site search, not assumption. This prompt exists to keep that bar — a file that "looks unused" isn't confirmed unused until searched for.

## Preconditions

- The candidate file/export is named specifically, not "this looks messy."

## Prompt Template

```
Confirm whether [file/export] is actually dead code before deleting it.

1. Search for every import/reference across the whole repo (not just the
   obvious callers) — include dynamic imports, re-exports, and test
   files.
2. If zero real call sites exist, it's safe to delete — state the search
   you ran.
3. If it's referenced only by other dead code, trace the whole dead
   chain before deleting any of it.
4. If it's referenced by exactly one live call site that could easily be
   replaced, flag that as a separate decision (replace-then-delete) —
   don't delete out from under a live caller.

Only delete after confirming. Update known_issues_documentation.md to
mark the finding resolved if it was previously tracked there.
```

## Expected Output Shape

A stated search method and result (e.g. "grepped for `apiClient` and `exampleCalls` repo-wide, X references, all within the file itself") before any deletion.

## Postconditions

- The known-issues entry (if one existed) is updated to resolved, not left stale.
