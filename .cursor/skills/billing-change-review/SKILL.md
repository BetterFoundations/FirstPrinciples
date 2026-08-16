---
name: billing-change-review
description: Review a change that touches payments, subscriptions, or billing logic — use for mandatory second-person review of anything in this risk category, per this playbook's collaboration.md.
---

# Billing / Payment Change Review

## Purpose

Billing is the one category this playbook exempts from normal read budgets and requires mandatory second-person review for (collaboration.md, Session 10) — this project's own audit found a structurally broken webhook-verification path that shipped and went untested end-to-end because tests stubbed around it. This prompt is the review pass meant to catch that class of issue before merge.

## Preconditions

- The diff touches billing/payment/subscription code, confirmed by path (`billing.service.ts`, `SubscriptionCheckoutPage.tsx`, etc.) or by domain (money amounts, subscription status, GST/invoice math).

## Prompt Template

```
Review this billing/payment change as the mandatory second reviewer.

1. Does every money-affecting path have a test that exercises the REAL
   logic, not a stub that bypasses the part being changed? (This
   project's known webhook-verification defect shipped exactly because
   tests stubbed the signature check.)
2. Does this change affect any rule documented in docs/business-rules/
   (subscription-and-billing.md or FE's rules-catalog.md)? If so, does
   the doc need updating in the same PR?
3. Does this change affect a rule duplicated across FE and BE (check
   system-overview.md's duplication table)? If so, is the other side
   updated too?
4. Any rounding/floor/ceiling behavior — does it match the existing
   convention (this codebase floors discounts and CGST, remainder goes
   to SGST) or introduce a new one? New conventions need explicit
   justification, not silent introduction.

State pass/fail for each with reasoning, not just a checkmark.
```

## Expected Output Shape

Four numbered findings, each with a clear pass/fail and reasoning tied to a specific line or test.

## Postconditions

- Any documented business rule affected by this change gets updated in the same PR, not deferred.
