---
name: reproduce-before-fix
description: Write a failing test that proves a bug exists before touching the fix — use when a bug report has no existing test coverage, to guarantee the fix is verified rather than assumed.
---

# Reproduce Before Fix

## Purpose

A fix without a test that failed beforehand is unverified — it's plausible the "fix" didn't actually change the failing behavior. This enforces the order: red test, then green fix. Directly downstream of this playbook's testing-philosophy.md rule that a failing test is a fact about the code, not an obstacle.

## Preconditions

- The bug's expected-vs-actual behavior is precisely stated (not just "it's broken").
- The relevant test file/runner for this repo is known (check `docs/testing.md` or equivalent — note some repos use non-standard runners).

## Prompt Template

```
Before fixing [bug], write a test that reproduces it.

1. Write the test so it currently FAILS for the reason described in the
   bug report — run it and show the failure.
2. Only then implement the fix.
3. Re-run the same test and show it now passes.
4. Do not modify the test's assertions between steps 1 and 3 unless the
   test itself was wrong (state explicitly if so, and why).
```

## Expected Output Shape

Three artifacts in order: the new test, its failing run output, the fix, its passing run output.

## Postconditions

- The new test stays in the suite permanently — it's the regression guard, not a scratch file.
