---
name: additive-migration-check
description: Verify a schema change is genuinely backward-compatible before shipping it, so a rollback doesn't leave the system in a broken in-between state — use for any schema change touching a model already in production use.
---

# Additive Migration Check

## Purpose

`rollback-procedure.md` states plainly: a code rollback does not undo a data migration that already ran, and a non-additive change with no down-path can leave rolled-back code unable to read already-migrated data. This prompt is the pre-ship check that catches that specific failure mode.

## Preconditions

- The schema change is implemented and ready to ship.
- The model is one already holding production data (not a brand-new model with no existing rows).

## Prompt Template

```
Check this schema change for rollback-safety before it ships: [describe
change].

1. If the application were rolled back to the PREVIOUS code version
   after this change's data started being written, would the old code
   still read the new documents correctly? Walk through it — don't just
   assert yes.
2. If the answer is no, this isn't safely additive. Either redesign it
   to be additive, or write an explicit down-migration/manual recovery
   step and get it reviewed BEFORE shipping, not after something breaks.
3. If this model is money-adjacent (payments, invoices, subscriptions),
   also check: does an in-flight webhook or callback assume the old
   shape? See webhook-handling.md for what "in-flight" means here.
```

## Expected Output Shape

A yes/no rollback-safety verdict with the actual walkthrough shown, not asserted — and, if unsafe, the down-path written out before shipping.

## Postconditions

- If a down-path was needed, it's documented somewhere durable (not just in this conversation) before the change merges.
