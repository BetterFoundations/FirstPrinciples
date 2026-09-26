---
'@firstprinciples/queue': minor
---

Initial release of `@firstprinciples/queue`: typed job queue conventions over BullMQ 6 — job payload and result types declared once and inferred at every `add` and handler with no call-site generics, retry presets per job type, a real dead-letter queue (list, redrive, remove) fed from every final-failure path including stalled jobs, and metrics hooks for duration, failures, dead-letters and depth.
