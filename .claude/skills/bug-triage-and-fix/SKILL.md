---
name: bug-triage-and-fix
description: Triage a reported bug to its root cause and fix it, citing the exact function responsible — use for any bug fix where the cause isn't already known.
---

# Bug Triage & Fix

## Purpose

Fix the actual root cause, cited to a specific function, rather than patching the symptom. Grounded in this project's evidence-based-only rule: findings must cite source, never be guessed, and ambiguous behavior gets flagged rather than assumed.

## Preconditions

- The bug is reproducible, or the report is specific enough to trace without reproducing.
- The file most likely responsible has been identified (via the bug's error message, endpoint, or symptom).

## Prompt Template

```
Triage this bug: [description/error/repro steps].

1. Trace it to the exact function and line responsible — cite it.
2. State whether this is a code defect, a data issue, or expected
   behavior being misread as a bug. Don't assume defect by default.
3. If you can't confirm the root cause from the code, say so explicitly
   rather than guessing at a fix.

Once confirmed: propose the fix. If a test doesn't already cover this
case, write one that fails before your fix and passes after — see
testing-philosophy.md. Never delete or weaken an existing test to make
this bug fix "pass."
```

## Expected Output Shape

Root-cause statement with a file/function citation, followed by the fix and (if none existed) a new regression test.

## Postconditions

- If the bug reveals a pattern likely to recur elsewhere (same mistake in a sibling function), flag it — don't silently fix only the reported instance.
- If the bug was already known and accepted as debt (check `known_issues_documentation.md` first), don't re-fix it without flagging the existing entry.
