---
name: feature-scaffold
description: Plan and scaffold a new feature end-to-end, reading only the index files and one pattern-reference file before proposing a plan — use when starting new feature work in any repo that follows this playbook.
---

# Feature Scaffold

## Purpose

Start new feature work without over-reading the codebase or skipping the plan-first step. Grounded in this project's repeated pattern: every multi-file session in this playbook plans in bullets first, waits for confirmation, then generates — skipping that step produces work that has to be redone.

## Preconditions

- The target repo's `AGENTS.md` has been read (routes to the rest).
- The relevant folder's `_index.md` has been read — not the whole folder.
- One existing similar feature identified as a pattern reference (naming, file layout, error-handling style).

## Prompt Template

```
Add [feature description] to [repo/module].

Read only: AGENTS.md, [relevant _index.md], and [one existing similar
feature] as a pattern reference. Do not read beyond this without flagging
why more is needed.

Plan in 3-5 bullets first: files touched, new files created, and which
existing pattern you're following. Wait for confirmation before writing
any code.

If this touches payments, auth, or a data migration, say so now — those
require the Planner role and no read-budget cap per this playbook's
tool-permissions.md.
```

## Expected Output Shape

A short bulleted plan (not code) naming exact files, followed — only after confirmation — by the actual changes plus any doc updates the change requires.

## Postconditions

- If the feature adds a new business rule, the relevant `docs/business-rules/` file gets a new entry citing the implementing function.
- If the feature is genuinely reusable across projects (not just this one), flag it as a candidate for promotion into this central prompt library rather than staying project-local.
