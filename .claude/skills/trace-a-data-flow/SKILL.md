---
name: trace-a-data-flow
description: Trace one flow end-to-end across files (a request, a payment, a webhook) and produce a cited step-by-step account — use before trusting a doc's description of how something works, or when auditing a suspected defect.
---

# Trace a Data Flow

## Purpose

Several of this project's most important findings (the broken webhook-verification path, the checkout-to-payment flow) came from tracing a flow through actual code end-to-end rather than trusting an existing description of it. This prompt is that method, made repeatable.

## Preconditions

- The flow's entry point is known (an endpoint, a UI action, an event).

## Prompt Template

```
Trace [flow] end-to-end, starting at [entry point].

Follow it through every file it actually touches, in call order. At each
step, cite the file and function. Note explicitly:

- Any point where the flow's actual behavior differs from what an
  existing doc/comment claims it does.
- Any point where error handling silently swallows a failure rather than
  surfacing it.
- Any assumption the code makes about upstream/downstream state that
  isn't validated (e.g. assumes a record exists without checking).

Do not summarize from memory or prior docs — trace the live code.
```

## Expected Output Shape

A numbered step-by-step trace, each step citing file/function, ending with an explicit list of any doc/code mismatches or silent-failure points found.

## Postconditions

- If a doc/code mismatch was found, the doc gets corrected or flagged, not left standing uncorrected.
