---
name: update-docs-after-change
description: Determine which docs a code change should update, and update them in the same pass — use as a standing habit after any implementation, not a separate later task.
---

# Update Docs After Code Change

## Purpose

This playbook's own maintenance model treats doc updates as a standing per-task responsibility, not a periodic catch-up project — doc drift compounds silently otherwise. This prompt is the trigger to check that before calling a task done.

## Preconditions

- The code change is complete and (if applicable) tested.

## Prompt Template

```
This change just modified [file(s)/behavior]. Before considering this
task done:

1. Does this touch anything documented in docs/business-rules/,
   docs/api/, or an equivalent contract doc? If yes, update it in this
   same pass, citing the same function as before (update the citation
   if the function moved).
2. Does this resolve or invalidate an entry in known_issues_documentation.md
   or planned-improvements.md? If yes, mark it resolved with a one-line
   note, don't just leave it stale.
3. Does this introduce a new cross-repo duplication (same logic now
   exists in both FE and BE)? If yes, add it to system-overview.md's
   duplication table.
4. If nothing above applies, say so explicitly rather than silently
   skipping this check.
```

## Expected Output Shape

A short checklist response — which docs were touched, which were checked and found not applicable, with reasoning for each.

## Postconditions

- No doc references a function/file that no longer exists at that name after this change.
