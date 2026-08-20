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

Do not edit anything under `tools/package-template/` itself to fit one specific package —
this directory must stay generic so it keeps working as the source for the next package too.
