import { AppError, UnauthorizedError } from '@firstprinciples/core';

import type { RefreshFailureReason } from './internal/refresh-state.js';

/**
 * Why a JWT was rejected.
 *
 * @remarks
 * Every value is a *verification* outcome — something about the token
 * the caller was handed. A misconfigured verifier is not in this list;
 * that is an {@link AuthConfigurationError} and it throws.
 *
 * These reasons are safe to return to the client. Distinguishing
 * `expired` from `signature_invalid` is not a credential oracle the way
 * distinguishing "no such user" from "wrong password" is: the holder of
 * an expired token already knows it is theirs, and needs to be told to
 * refresh rather than to re-authenticate. Nothing here echoes the token,
 * a claim value, or any key material.
 *
 * @public
 */
export type JwtFailureReason =
  /** Not a well-formed compact JWS: wrong segment count, empty signature, undecodable header. */
  | 'malformed'
  /** The token's `alg` is absent, unrecognized, or not on the verifier's allowlist. Covers `alg: none`. */
  | 'algorithm_not_allowed'
  /** The header carries a key-resolution parameter (`jwk`, `jku`, `x5u`, `x5c`) or an unrecognized `crit`. */
  | 'untrusted_header'
  /** The `typ` header did not match the value the verifier requires. */
  | 'type_mismatch'
  /** The signature did not verify against the configured key. */
  | 'signature_invalid'
  /** `exp` is in the past (or `exp` was required and absent). */
  | 'expired'
  /** `nbf` is in the future. */
  | 'not_yet_valid'
  /** `iat` is older than the configured maximum token age. */
  | 'too_old'
  /** `iss` did not match. */
  | 'issuer_mismatch'
  /** `aud` did not match. */
  | 'audience_mismatch'
  /** A required claim was missing, or a claim failed validation. */
  | 'claims_invalid'
  /** Verification failed for a reason this package does not classify. Never silently treated as success. */
  | 'verification_failed';

/**
 * The `details` payload carried by every {@link JwtVerificationError}.
 *
 * @public
 */
export interface JwtFailureDetails {
  /** Machine-readable rejection reason. */
  readonly reason: JwtFailureReason;
}

/**
 * A JWT was rejected during verification.
 *
 * @remarks
 * Extends `core`'s {@link UnauthorizedError}, so a generic auth handler
 * that catches `UnauthorizedError` sees this too, and `api-kit` renders
 * it as a 401 RFC 7807 problem document with no extra wiring. `code`
 * (`JWT_EXPIRED`, `JWT_ALGORITHM_NOT_ALLOWED`, …) stays specific enough
 * for a client to branch on, and `kind` stays `'UnauthorizedError'`
 * because for anything switching on the taxonomy that is exactly what
 * this is.
 *
 * This subclass is the reason `core` keeps its taxonomy discriminant
 * (`kind`) separate from the per-class identity (`name`). With both on
 * `name`, the built-ins are mutually distinct and simultaneously
 * unsubclassable, since a subclass declaring its own literal `name` is
 * not assignable to its parent's. The first draft of this package
 * worked around that by extending `AppError` directly and losing
 * `instanceof UnauthorizedError`; `core` was fixed instead.
 *
 * Kept local to `auth-utils` rather than promoted into `core` — the
 * `CacheBackendError` precedent, not the `NetworkError` one. Promotion
 * exists so a *different* package can recognize an error without
 * importing the package that defines it; nothing in this ecosystem needs
 * to recognize a JWT failure specifically, and everything that needs the
 * 401 already gets it from the base class.
 *
 * `details` is narrowed to {@link JwtFailureDetails} — the same technique
 * `core`'s `BrandValidationError` uses to keep `AppError.details`
 * `unknown` for untrusted catch sites while letting a function that
 * *does* know the shape say so.
 *
 * @public
 */
export class JwtVerificationError extends UnauthorizedError {
  /** This class's own identity. Free to differ from the parent's — that is what `core`'s name/kind split is for. */
  declare name: 'JwtVerificationError';

  /** Narrowed from `AppError`'s `unknown`. Always present. */
  declare readonly details: JwtFailureDetails;

  /** Machine-readable rejection reason. Mirrors `details.reason`. */
  readonly reason: JwtFailureReason;

  /**
   * @param reason - Why the token was rejected.
   * @param message - Human-readable description. Must not contain the token or any key material.
   * @param cause - The underlying failure, when there is a more specific one worth keeping.
   */
  constructor(reason: JwtFailureReason, message: string, cause?: unknown) {
    super(message, {
      code: `JWT_${reason.toUpperCase()}`,
      details: { reason },
      cause,
    });
    this.name = 'JwtVerificationError';
    this.reason = reason;
  }
}

/**
 * A signer, verifier, or hashing call was configured in a way that
 * cannot be made safe.
 *
 * @remarks
 * This is thrown, not returned as a `Result`, and that asymmetry is
 * deliberate. A rejected token is an expected outcome of serving
 * untrusted traffic and every caller must branch on it. A verifier
 * configured to accept `HS256` against an RSA public key is a
 * programming error with no runtime recovery — the only correct
 * response is to fail loudly at startup, before the process serves a
 * single request. Every check that raises this runs at construction
 * time for exactly that reason.
 *
 * `httpStatus` is 500: it is never the client's fault.
 *
 * @public
 */
export class AuthConfigurationError extends AppError {
  /** Narrowed to a string literal so this class is structurally distinct from its siblings. */
  declare name: 'AuthConfigurationError';

  /**
   * @param message - What is misconfigured and what to do instead.
   */
  constructor(message: string) {
    super(message, { code: 'AUTH_CONFIGURATION_ERROR', httpStatus: 500 });
    this.name = 'AuthConfigurationError';
  }
}

/**
 * Deriving a password hash failed inside the argon2 binding.
 *
 * @remarks
 * Not a wrong password — that is `false` from `verifyPassword`, not an
 * error. This means the derivation itself could not run: the process
 * could not allocate `memoryCost` KiB, or the native module failed.
 *
 * Distinguishing the two matters operationally. Under a login burst with
 * a high `memoryCost`, allocation failure is the realistic outcome, and
 * reporting it as "wrong password" would turn a capacity problem into a
 * silent, self-inflicted lockout of every user at once.
 *
 * @public
 */
export class PasswordHashError extends AppError {
  /** Narrowed to a string literal so this class is structurally distinct from its siblings. */
  declare name: 'PasswordHashError';

  /**
   * @param message - Human-readable description. Never contains the password.
   * @param cause - The underlying failure from the argon2 binding.
   */
  constructor(message: string, cause?: unknown) {
    super(message, { code: 'PASSWORD_HASH_ERROR', httpStatus: 500, cause });
    this.name = 'PasswordHashError';
  }
}

/**
 * A refresh token was refused.
 *
 * @remarks
 * Extends `core`'s {@link UnauthorizedError} for the same reasons
 * {@link JwtVerificationError} does: a generic auth handler catches it,
 * and `api-kit` renders it as a 401 problem document unchanged.
 *
 * `reason` `'reused'` is not an ordinary rejection. It means a token
 * that had already been rotated came back, the whole family has just
 * been revoked, and somebody has a copy of a credential they should not
 * have. **Alert on it.** It fires exactly once per family — see the
 * ordering note on `decideRotation`.
 *
 * @public
 */
export class RefreshTokenError extends UnauthorizedError {
  /** This class's own identity. */
  declare name: 'RefreshTokenError';

  /** Narrowed from `AppError`'s `unknown`. Always present. */
  declare readonly details: RefreshFailureDetails;

  /** Machine-readable rejection reason. Mirrors `details.reason`. */
  readonly reason: RefreshFailureReason;

  /**
   * @param reason - Why the token was refused.
   * @param message - Human-readable description. Never contains the token.
   */
  constructor(reason: RefreshFailureReason, message: string) {
    super(message, {
      code: `REFRESH_${reason.toUpperCase()}`,
      details: { reason },
    });
    this.name = 'RefreshTokenError';
    this.reason = reason;
  }
}

/**
 * The `details` payload carried by every {@link RefreshTokenError}.
 *
 * @public
 */
export interface RefreshFailureDetails {
  /** Machine-readable rejection reason. */
  readonly reason: RefreshFailureReason;
}

/**
 * The refresh-token store failed, or could not settle.
 *
 * @remarks
 * Thrown rather than returned, and that is the S13 split again: a
 * refused token is an expected outcome of serving untrusted traffic and
 * belongs in a `Result`; a store that is down, or contention that never
 * resolves, is infrastructure. The caller should retry the request, not
 * make the user sign in again — which is precisely the distinction a
 * 401 would erase.
 *
 * `httpStatus` is 503, matching `cache-kit`'s `CacheBackendError`.
 *
 * @public
 */
export class RefreshTokenStoreError extends AppError {
  /** Narrowed to a string literal so this class is structurally distinct from its siblings. */
  declare name: 'RefreshTokenStoreError';

  /**
   * @param message - What failed.
   * @param cause - The underlying failure, if there is one.
   */
  constructor(message: string, cause?: unknown) {
    super(message, { code: 'REFRESH_TOKEN_STORE_ERROR', httpStatus: 503, cause });
    this.name = 'RefreshTokenStoreError';
  }
}

/**
 * The login-attempt store failed.
 *
 * @remarks
 * Raised only when the limiter is configured `onStoreError: 'deny'`,
 * which is the default. `httpStatus` is 503: the caller should surface
 * a "try again shortly", not an authentication failure — the user's
 * credentials were never the problem.
 *
 * @public
 */
export class RateLimitStoreError extends AppError {
  /** Narrowed to a string literal so this class is structurally distinct from its siblings. */
  declare name: 'RateLimitStoreError';

  /**
   * @param message - What failed.
   * @param cause - The underlying failure from the store.
   */
  constructor(message: string, cause?: unknown) {
    super(message, { code: 'RATE_LIMIT_STORE_ERROR', httpStatus: 503, cause });
    this.name = 'RateLimitStoreError';
  }
}
