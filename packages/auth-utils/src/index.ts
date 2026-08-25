/**
 * `@firstprinciples/auth-utils` — authentication primitives that are
 * hard to hold wrong.
 *
 * Two things in this release:
 *
 * - **argon2id password hashing** ({@link hashPassword},
 *   {@link verifyPassword}, {@link passwordNeedsRehash},
 *   {@link verifyPasswordDecoy}) with parameters that are justified
 *   rather than copied, and constant-time verification on both the
 *   digest-comparison axis and the far leakier does-this-account-exist
 *   axis.
 * - **JWT issue and verify** ({@link createJwtSigner},
 *   {@link createJwtVerifier}) behind a **mandatory algorithm
 *   allowlist**, validated against the key at construction time.
 * - **Refresh-token rotation with reuse detection**
 *   ({@link createRefreshTokenService}) over a pluggable store, where
 *   invalidating the old token and issuing its successor are one
 *   atomic write, and replaying a rotated token revokes the entire
 *   family.
 * - **Login-attempt rate limiting** ({@link createLoginRateLimiter})
 *   over the same bring-your-own-store pattern.
 *
 * The design premise is that the well-known JWT vulnerabilities —
 * `alg: none`, RS256-to-HS256 confusion, unbounded lifetimes — are
 * *configuration* failures, not implementation failures. `jose`, which
 * this package builds on, is not vulnerable to any of them when driven
 * correctly; two of them land against it when driven the way a
 * reasonable person would drive it. So every safety property here is
 * decided once, at construction, where getting it wrong fails at
 * startup instead of on whichever request first reaches the bad path.
 * `tests/attacks/` carries a working exploit for each one.
 *
 * Password hashing needs the native `argon2` binding, which is a peer
 * dependency. Import from `@firstprinciples/auth-utils/jwt` instead if
 * you only need tokens — that entry point is pure JavaScript and runs
 * on edge runtimes.
 *
 * @packageDocumentation
 */

export { createJwtSigner, createJwtVerifier, MAX_CLOCK_TOLERANCE_SECONDS } from './jwt.js';
export type {
  JwtAlgorithm,
  JwtClaims,
  JwtHeader,
  JwtSigner,
  JwtSignerOptions,
  JwtVerifier,
  JwtVerifierOptions,
  VerifiedJwt,
} from './jwt.js';

export {
  DEFAULT_ARGON2_PARAMS,
  hashPassword,
  MAX_PASSWORD_BYTES,
  passwordNeedsRehash,
  verifyPassword,
  verifyPasswordDecoy,
} from './password.js';
export type { Argon2Params } from './password.js';

export { createRefreshTokenService } from './refresh.js';
export type {
  FamilyToken,
  IssuedRefreshToken,
  RefreshFailureReason,
  RefreshTokenService,
  RefreshTokenServiceOptions,
  RefreshTokenStore,
  Revision,
  RevocationReason,
  StoredTokenFamily,
  TokenFamily,
} from './refresh.js';

export { createLoginRateLimiter } from './rate-limit.js';
export type {
  AttemptCounter,
  AttemptStore,
  LoginRateLimiter,
  LoginRateLimiterOptions,
  RateLimitDecision,
} from './rate-limit.js';

export { createMemoryAttemptStore, createMemoryRefreshTokenStore } from './stores.js';

export {
  AuthConfigurationError,
  JwtVerificationError,
  PasswordHashError,
  RateLimitStoreError,
  RefreshTokenError,
  RefreshTokenStoreError,
} from './errors.js';
export type { JwtFailureDetails, JwtFailureReason, RefreshFailureDetails } from './errors.js';
