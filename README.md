# FirstPrinciples

Public TypeScript monorepo for independently published `@firstprinciples/*`
packages.

Agent instructions: [AGENTS.md](AGENTS.md).

## Packages

| Package                                                | Description                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@firstprinciples/core`](packages/core)               | Typed error hierarchy, `Result` type, and branded primitives — the zero-dependency foundation every other package builds on.                      |
| [`@firstprinciples/logger`](packages/logger)           | Structured, isomorphic logging with automatic secret/PII redaction and `AsyncLocalStorage` correlation IDs.                                       |
| [`@firstprinciples/http-client`](packages/http-client) | A typed `fetch` wrapper: discriminated-union results, retry with backoff, combined timeout/abort, pluggable validation.                           |
| [`@firstprinciples/cache-kit`](packages/cache-kit)     | A backend-agnostic cache: `get`/`set`/`wrap`/`invalidate` over in-memory LRU or Redis, tag invalidation, single-flight cache-stampede protection. |

## Contributing

- [CONTRIBUTING.md](CONTRIBUTING.md) — local setup, changesets, PR expectations
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — Contributor Covenant
- [SECURITY.md](SECURITY.md) — supported versions and private vulnerability reporting
- [LICENSE](LICENSE) — MIT
