---
name: schema-change-plan
description: Plan a database schema change in a repo with no formal migration system — use to make the manual migration steps explicit rather than assumed, since an unplanned schema change in this environment has no safety net.
---

# Schema Change Plan

## Purpose

FuelKhata-BE has no migration system today (deliberately deferred, see `planned-improvements.md` §6) — a schema change here has no automatic rollback or version tracking. This prompt forces the manual-migration plan to be written down before any schema file changes, since there's no tooling to fall back on if it goes wrong.

## Preconditions

- The schema change is precisely stated (field added/removed/retyped, on which model).
- Whether the repo has since adopted a migration system is re-checked (this may become outdated once §6 of planned-improvements.md is actioned).

## Prompt Template

```
Plan a schema change: [add/remove/retype field] on [model].

State explicitly:
1. Is this additive (new optional field) or breaking (retype, required-
   without-default, removal)? Prefer additive — it's rollback-safe by
   default per rollback-procedure.md; breaking changes need an explicit
   down-path stated below.
2. What happens to EXISTING documents that predate this field/type? Is a
   backfill needed, and if so, is it a one-time script or does read-path
   code need to tolerate the old shape indefinitely?
3. Does any other module assume the old shape (check for direct field
   reads, not just the owning module)? List them.
4. If this isn't safely additive: what's the manual recovery step if the
   change needs to be undone after some documents were already written
   in the new shape?

Planner role, no read-budget cap — this is a Payments/billing-tier risk
category if the model is money-adjacent.
```

## Expected Output Shape

A four-part answer (additive/breaking, backfill plan, cross-module impact, manual rollback step) before any schema file is touched.

## Postconditions

- `docs/database/` (or equivalent) updated to reflect the new shape, including a note on the migration approach taken since there's no migration-file history to read later.
