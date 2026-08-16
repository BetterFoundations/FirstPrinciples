# Contributing to FirstPrinciples

Thank you for taking the time to contribute. This repository is a public
monorepo of independently published TypeScript packages under the
`@firstprinciples` npm scope. We treat the contribution path itself as part of
the product: if the docs, templates, or hooks make contributing harder than
writing the change, that is a bug.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## What belongs in a contribution

| Kind                                             | Where it lands           | Needs a changeset?                   |
| ------------------------------------------------ | ------------------------ | ------------------------------------ |
| Package API, behaviour, types, or package README | `packages/<name>/`       | **Yes**                              |
| Shared compiler / lint config                    | `tools/`                 | No (not published)                   |
| CI, hooks, governance files                      | `.github/`, root configs | No                                   |
| Docs site / examples                             | `docs/`, `examples/`     | No, unless you also change a package |

If you are unsure which package should own a change, open a
[feature request](https://github.com/BetterFoundations/FirstPrinciples/issues/new?template=feature_request.md)
before writing a large PR. Small, reviewable PRs are easier to land than a
single sweeping one.

## Local setup

1. **Node 24 LTS**, matching [`.nvmrc`](.nvmrc). If you use nvm:

   ```bash
   nvm install
   nvm use
   ```

2. **pnpm** via Corepack (do not install pnpm globally from npm — the
   `packageManager` field in the root `package.json` is the pin):

   ```bash
   corepack enable pnpm
   ```

3. Clone and install from the repository root:

   ```bash
   git clone git@github.com:BetterFoundations/FirstPrinciples.git
   cd FirstPrinciples
   pnpm install
   ```

   `pnpm install` also runs the `prepare` script, which installs the Husky
   git hooks. After that, every commit on your machine runs **lint-staged**:
   ESLint `--fix` and Prettier on _staged files only_.

4. Confirm the workspace:

   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm build
   ```

   On an empty scaffold some of these are no-ops at the package level; they
   still have to exit 0.

## Making a change

1. Branch from an up-to-date `main` (`git switch -c feat/<short-name>`).
2. Keep the diff scoped to the story. Do not mix a formatter drive-by with a
   behaviour change.
3. Match the surrounding code. Formatting is Prettier's job (see
   [`.prettierrc`](.prettierrc)); ESLint is for correctness. They are wired so
   they do not fight — do not re-enable formatting rules in ESLint.
4. Do not commit secrets, `.env` files, or credentials. The pre-commit hook
   does not catch those for you.

### Changesets (required for published packages)

This monorepo versions and publishes with
[Changesets](https://github.com/changesets/changesets). If your PR changes
anything a consumer of `@firstprinciples/<package>` would notice — public API,
runtime behaviour, TypeScript types, or the package README — you **must** add
a changeset in the same PR.

```bash
pnpm changeset
```

That command asks which packages changed and whether the bump is `patch`,
`minor`, or `major`, then writes a markdown file under `.changeset/`. Commit
that file with your change.

Even while packages are on `0.x`, treat a breaking change as breaking: choose
`major` (or the Changesets equivalent for pre-1.0) and say so in the changeset
summary. Do not hide a break in a `patch`.

Skip a changeset only when the PR is genuinely not a published-package change
(CI, Husky, LICENSE, issue templates, and so on). The pull request template
has a checkbox for this; CI will fail a package-code PR that has no changeset
once that check is enabled.

`pnpm changeset` is already on the root scripts. The Changesets config
(`.changeset/config.json`) is initialized in a dedicated scaffold session; if
the prompt is missing locally, the branch is behind `main`.

### Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(optional-scope): <imperative summary>
```

Common types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`,
`perf`, `style`. Keep the summary imperative and short.

If an AI coding agent authored or substantially drafted the commit, include
both trailers:

```
ai-assisted: yes
ai-tool: cursor
```

(`ai-assisted` is `yes`, `partial`, or `no`. `ai-tool` is `claude-code`,
`codex`, `cursor`, `copilot`, or `none`.)

## Pull requests

Open the PR against `main`. Fill in
[`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) rather
than deleting it — the changeset checkbox is there on purpose.

A PR is ready for review when:

- The description matches the diff (no unlabeled extra refactors).
- The changeset checkbox is honest.
- Relevant `pnpm` scripts were run locally.
- New behaviour has tests, or the PR is explicitly docs/tooling.
- You would be willing to maintain the change after it merges.

Maintainers review via [CODEOWNERS](.github/CODEOWNERS). Do not self-merge
onto `main`.

## Bugs and security

- **Bugs:** [bug report template](https://github.com/BetterFoundations/FirstPrinciples/issues/new?template=bug_report.md).
  Package name, version, and a reproduction are required.
- **Features:** [feature request template](https://github.com/BetterFoundations/FirstPrinciples/issues/new?template=feature_request.md).
- **Vulnerabilities:** do not file a public issue. Follow [SECURITY.md](SECURITY.md)
  and use GitHub's private vulnerability reporting.

## License

Contributions are licensed under the [MIT License](LICENSE).
