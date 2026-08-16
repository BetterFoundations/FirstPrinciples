# Security Policy

## Supported versions

Packages in this repository are published under `@firstprinciples/*` and stay
on the `0.x` line until a given package has a real consumer and a `1.0.0`
release (see `Final_plan.md` §2.3). Security fixes land on the latest published
`0.x` of each package.

| Version                                                        | Supported                                                             |
| -------------------------------------------------------------- | --------------------------------------------------------------------- |
| `0.x` (latest published per package)                           | Yes                                                                   |
| Git `main` (unreleased)                                        | Yes — report against current `main` if the issue is not yet published |
| Anything older than the latest published `0.x` of that package | No                                                                    |

There is no long-term support branch yet. When a package reaches `1.x`, this
table will be updated to name the supported major lines explicitly.

## Reporting a vulnerability

**Do not** open a public issue, and **do not** email maintainers personally.

Use GitHub's private vulnerability reporting for this repository:

**[Report a vulnerability](https://github.com/BetterFoundations/FirstPrinciples/security/advisories/new)**

That form is the only supported intake. It creates a confidential draft
advisory that only maintainers can see.

Please include:

- The package name (`@firstprinciples/<name>`) and version (npm version, or
  a git SHA if unreleased)
- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- Any known workarounds

You should receive an acknowledgement within 7 days. We will keep the
conversation in the private advisory until a fix is released (or we agree the
report is not a vulnerability), then publish or dismiss the advisory as
appropriate.

For non-security bugs, use the [bug report](https://github.com/BetterFoundations/FirstPrinciples/issues/new?template=bug_report.md) issue template instead.
