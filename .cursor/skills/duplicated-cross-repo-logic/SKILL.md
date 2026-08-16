---
name: duplicated-cross-repo-logic
description: Add or change a business rule that exists independently on both frontend and backend (e.g. a shared constant, a status-gating list, a computed value both sides re-derive) — use to avoid one-sided fixes that silently desync FE and BE.
---

# Update Duplicated Cross-Repo Logic

## Purpose

This codebase has confirmed, real instances of the same rule implemented independently in two repos (subscription-write-allowed statuses, GST invoice math, admin-approval bounds — see `system-overview.md`'s duplication table). None of these are wired to fail loudly if they diverge. This prompt exists specifically to stop a one-sided edit from becoming silent drift.

## Preconditions

- The rule's cross-repo status is confirmed — check both repos' `docs/business-rules/` for the rule's ID and whether it's flagged as duplicated.
- `docs/system-overview.md` (canonical copy in BE) has been checked for whether this rule is already in its duplication table.

## Prompt Template

```
Change [rule/constant] in [repo].

Before touching code: confirm whether this rule also exists in the other
FuelKhata repo (check its docs/business-rules/ file and
system-overview.md's duplication table). If it does:

1. State both locations explicitly.
2. Change both in the same session/PR — never one side only.
3. If genuinely infeasible to change both now, say so and flag the
   now-diverged pair in known_issues_documentation.md rather than
   leaving it silently inconsistent.

If this is the SECOND time this exact value has needed a synced edit,
propose extracting it into a shared package/contract instead of
continuing to hand-sync it.
```

## Expected Output Shape

Either a matched pair of changes (one per repo) in the same response, or an explicit, named exception with a known-issues entry.

## Postconditions

- `system-overview.md`'s duplication table updated in both repos if the rule's identity or values changed.
- Each repo's `docs/business-rules/` entry for the rule updated to match.
