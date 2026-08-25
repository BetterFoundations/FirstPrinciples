---
---

No release needed. Test-infrastructure only, and nothing under any
package's published `files`.

`turbo.json` now declares ordering that was always implied but never
written down: `test` depends on its own package's `build`, and `build`,
`typecheck` and `lint` depend on `^test` as well as `^build`. Several
packages' integration tests re-run `tsup` mid-test, and tsup's
`clean: true` deletes `dist/` first, which made `test` a writer of
`build`'s declared outputs and raced every task that reads a
dependency's `dist/`.

With that ordering in place those hand-rolled rebuilds are redundant —
turbo's cache is keyed on source hashes, so a cache hit means `dist/`
already matches `src/` — so they were removed from `auth-utils`'s dist
suite and from both of `logger`'s. `logger` is touched only under
`tests/`, and no assertion was removed; this is what finally closed the
intermittent `logger` race parked since S10.

Full write-up, including the four observed failure modes and the 8-of-8
from-clean verification, is in `EXECUTION-CHECKLIST.md`.
