---
name: known-issues-check
description: Check whether a finding is already tracked as accepted debt or a deliberate decision before reporting it as new — use before flagging anything as a bug, to avoid re-litigating something already triaged.
---

# Known-Issues Check

## Purpose

This project maintains a strict taxonomy — real defects, deliberately deferred work, and accepted/closed decisions live in three different places. Re-reporting something already triaged wastes review time and can override a deliberate decision by mistake. This prompt is the lookup step before any new finding gets surfaced.

## Preconditions

- A specific behavior has been identified as possibly worth flagging.

## Prompt Template

```
Before reporting [finding] as a new issue: check known_issues_documentation.md
and planned-improvements.md for this repo.

- If it's already listed under "Not defects — decisions on record" or
  similar, don't re-flag it — cite the existing entry instead and move
  on.
- If it's already listed as accepted debt (Later/Warnings tier), don't
  propose fixing it unless explicitly asked — cite the entry.
- If it's already in planned-improvements.md, don't propose it as new
  scope — cite the section.
- Only if genuinely absent from both, write it up as a new finding,
  triaged into the right tier (Highest / Priority / Later / Warning /
  Pending owner review) rather than dumped in undifferentiated.
```

## Expected Output Shape

Either a citation to the existing entry (and nothing further), or a new, correctly-tiered entry if genuinely absent.

## Postconditions

- No duplicate entries created across the two files for the same underlying issue.
