---
name: pr-self-review
description: Self-review a change against this playbook's PR checklist before requesting human review — use as the last step before opening or updating a PR.
---

# PR Self-Review

## Purpose

Catch the checklist items an agent is prone to skip (test coverage, doc updates, non-retroactive framing) before a human reviewer has to catch them instead. Uses this playbook's own `checklists/pr-checklist.md` rather than inventing a new list.

## Preconditions

- The change is otherwise complete — this runs last, not as a substitute for implementation review.
- `EngineeringCompass/checklists/pr-checklist.md` exists and has been read.

## Prompt Template

```
Self-review this change against EngineeringCompass/checklists/pr-checklist.md
before I open/update the PR.

Go item by item — for each, state pass/fail/not-applicable with a one-
line reason, not just a checkmark. For anything failing, either fix it
now or state explicitly why it's deferred and to what.

Specifically confirm: no failing test was deleted or weakened to make
this pass; any doc this change should have updated actually was; no
secret/credential value appears anywhere in the diff, including docs.
```

## Expected Output Shape

A checklist run-through, one line per item, with fixes applied inline for anything that failed and could be fixed immediately.

## Postconditions

- Nothing marked "fixed" without the fix actually being in the diff.
