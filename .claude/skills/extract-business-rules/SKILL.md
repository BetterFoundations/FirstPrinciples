---
name: extract-business-rules
description: Extract implicit business logic from code into a cited, reviewable catalog — use for the highest-risk documentation task (plausible-but-wrong output), following the exact method this project used to produce its own business-rules catalogs.
---

# Extract Business Rules

## Purpose

Business-rule extraction is explicitly the highest-risk documentation phase for confident-sounding wrong output. This prompt encodes the method this project used across two full catalogs (80 BE rules, 12 FE rules): every rule cites its source function, and genuinely ambiguous behavior is marked for SME input rather than stated as fact.

## Preconditions

- The target domain/module is scoped (don't attempt "the whole codebase" in one pass — split by domain if the catalog would exceed this playbook's ~500-line file ceiling).
- Validation logic, conditional branches with business meaning, and policy constants (limits, thresholds, rates) are the hunting targets — not general code structure.

## Prompt Template

```
Extract business rules from [module/domain].

Hunt specifically for: validation logic, conditional branches that
encode a business decision (not just control flow), and constants that
encode policy (limits, thresholds, rates, durations).

For every rule: cite the exact file and function. If a rule's intent
can't be confirmed from the code alone (e.g. a clamp that could be
either intentional or an oversight, an asymmetry between two similar
functions), mark it explicitly "needs SME input" — do not state it as
settled fact.

If the resulting catalog would exceed ~500 lines, split into one file
per sub-domain rather than one long file, with an _index.md (one line
per rule) read before the detail files.

Flag the whole output for human review — no extracted rule is final
until confirmed against its cited code.
```

## Expected Output Shape

An `_index.md` (one line per rule, stable ID like `BR-<DOMAIN>-<n>`) plus one or more detail files, each rule stating the rule, its citation, and — where applicable — why it's marked uncertain.

## Postconditions

- The catalog is flagged PENDING HUMAN REVIEW in its frontmatter until the owner confirms it.
- Rules resolving a previously-open question elsewhere in the docs are cross-referenced so the old open question can be closed.
