# Package template — usage

Not a workspace member (excluded in `pnpm-workspace.yaml`). To start a new package:

```sh
cp -r tools/package-template packages/<name>
rm packages/<name>/_TEMPLATE-USAGE.md
cd packages/<name>
grep -rl 'PACKAGE_NAME' . | xargs sed -i '' "s/PACKAGE_NAME/<name>/g"
```

Then fill in every remaining `PACKAGE_*` placeholder by hand (description, why-it-exists,
API table, recipes) — `grep -rn 'PACKAGE_' .` to find them all. Replace the placeholder
`src/index.ts` export and `tests/unit/index.test.ts` with the real implementation. Add a
`tests/integration/` suite only if this package talks to an external system (spec §5);
otherwise its `.gitkeep` can stay.

The template's `version` is `0.0.0` on purpose. Changesets applies a bump literally,
so `0.0.0` plus the package's first `minor` changeset versions it to exactly `0.1.0` —
the version every package is specified to launch at. Starting the file at `0.1.0` would
make that first release `0.2.0`. Do not "fix" it to `0.1.0`.

Do not edit anything under `tools/package-template/` itself to fit one specific package —
this directory must stay generic so it keeps working as the source for the next package too.
