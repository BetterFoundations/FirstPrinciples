# Per-package Definition of Done

Per spec §12. Run through this checklist for a package before considering it "released" —
not just "code complete" (spec §13, point 7). The matching row in
[EXECUTION-CHECKLIST.md](EXECUTION-CHECKLIST.md)'s Definition of Done matrix tracks these
same columns across all 13 packages; check a box here during the package's session, then
mark that session's row in the matrix.

- [ ] `src/index.ts` exports only the intentional public API
- [ ] TSDoc comments on every exported symbol
- [ ] README complete per spec §8.1
- [ ] Coverage thresholds met (spec §5: 90% lines/statements/functions, 85% branches)
- [ ] `size-limit` budget configured and passing
- [ ] `npm audit` clean
- [ ] CodeQL passing, no unaddressed alerts
- [ ] `CHANGELOG.md` present (auto-generated on first release)
- [ ] Published with `--provenance`
- [ ] Example added under `/examples` showing real usage
- [ ] Listed in root `README.md` with one-line description + link
- [ ] Docs site page generated and deployed
