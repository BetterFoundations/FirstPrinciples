import { err, ok, type Result } from '@firstprinciples/core';
import { jwtVerify, SignJWT, type JWTPayload, type KeyInput } from 'jose';

import { AuthConfigurationError, JwtVerificationError } from './errors.js';
import {
  assertKeyMatchesAllowlist,
  resolveAllowlist,
  type JwtAlgorithm,
} from './internal/jwt-algorithms.js';
import { toVerificationError } from './internal/jwt-errors.js';
import { inspectProtectedHeader, type JwtHeader } from './internal/jwt-header.js';

export type { JwtAlgorithm } from './internal/jwt-algorithms.js';
export type { JwtHeader } from './internal/jwt-header.js';

/**
 * The largest clock skew this package will tolerate, in seconds.
 *
 * @remarks
 * Skew tolerance is not free: it extends the usable life of every
 * expired token by exactly this much. Five minutes covers real NTP
 * drift between hosts. A deployment that needs more than five minutes
 * has a clock problem, and papering over it in the verifier means every
 * revoked-by-expiry token stays live for the length of the paper.
 *
 * @public
 */
export const MAX_CLOCK_TOLERANCE_SECONDS = 300;

/**
 * A verified token's claims.
 *
 * @remarks
 * `sub`, `iss` and `exp` are non-optional because verification would
 * have failed without them — `iss` and `aud` are always checked, and
 * `exp` is required unless the caller explicitly opted out.
 *
 * @public
 */
export interface JwtClaims {
  /**
   * Subject. Whoever the token is about.
   *
   * @remarks
   * Non-optional because the verifier requires it — see the note on
   * {@link JwtVerifierOptions.algorithms}' sibling checks in
   * `createJwtVerifier`. `jose` does not require `sub` on its own, so
   * without that check this field would be a type that lies: a token
   * signed with the right key but carrying no `sub` would verify, and
   * every caller reading `claims.sub` as a user id would get
   * `undefined` while the compiler insisted it was a `string`.
   */
  readonly sub: string;
  /** Issuer. Matched against the verifier's configured issuer. */
  readonly iss: string;
  /** Audience. Matched against the verifier's configured audience. */
  readonly aud: string | readonly string[];
  /** Expiry, as seconds since the Unix epoch. */
  readonly exp?: number;
  /** Not-before, as seconds since the Unix epoch. */
  readonly nbf?: number;
  /** Issued-at, as seconds since the Unix epoch. */
  readonly iat?: number;
  /** Token id. Unique per issued token. */
  readonly jti?: string;
  /** Any additional claims the signer attached. */
  readonly [claim: string]: unknown;
}

/**
 * The result of a successful verification.
 *
 * @public
 */
export interface VerifiedJwt {
  /** The verified claims set. */
  readonly claims: JwtClaims;
  /** The verified protected header. */
  readonly header: JwtHeader;
}

/** Options for {@link createJwtSigner}. */
export interface JwtSignerOptions {
  /**
   * The single algorithm this signer uses.
   *
   * @remarks
   * Singular by design. A signer that could pick between algorithms
   * would need a rule for picking, and that rule is the thing an
   * attacker attacks.
   */
  readonly algorithm: JwtAlgorithm;
  /**
   * The signing key: a `Uint8Array` secret for `HS*`, a private
   * `KeyObject` / `CryptoKey` / JWK for everything else.
   */
  readonly key: KeyInput;
  /** The `iss` claim to stamp on every token. */
  readonly issuer: string;
  /** The `aud` claim to stamp on every token. */
  readonly audience: string | readonly string[];
  /**
   * How long an issued token stays valid, in seconds.
   *
   * @remarks
   * Required, with no default. A token with no expiry is a permanent
   * credential handed to a client, and `jose` will happily verify one
   * forever — reproduced in `tests/attacks/expiry.test.ts`.
   */
  readonly ttlSeconds: number;
  /**
   * The `typ` header to stamp. Defaults to `'JWT'`.
   *
   * @remarks
   * Set a distinct value per token kind once there is more than one, so
   * an access token cannot be replayed where a refresh token is
   * expected (RFC 8725 §3.11).
   */
  readonly typ?: string;
  /**
   * Whether to stamp a random `jti`. Defaults to `true`.
   *
   * @remarks
   * A per-token identifier is what makes a token individually
   * revocable, and what a reuse-detection store keys on.
   */
  readonly includeJti?: boolean;
  /** Time source, in milliseconds. Injectable for tests. Defaults to `Date.now`. */
  readonly clock?: () => number;
}

/** Issues signed tokens with a fixed algorithm, issuer, audience and lifetime. */
export interface JwtSigner {
  /**
   * Signs a claims set.
   *
   * @param claims - Application claims. `sub` is required. `iss`, `aud`, `exp`, `iat` and
   * `jti` are set by the signer and cannot be overridden here.
   *
   * @returns The compact JWS.
   */
  sign(claims: { sub: string } & Record<string, unknown>): Promise<string>;
}

/** Options for {@link createJwtVerifier}. */
export interface JwtVerifierOptions {
  /**
   * Algorithms this verifier will accept. Must be non-empty, and every
   * entry must need the same kind of key.
   *
   * @remarks
   * There is deliberately no default. `jose`'s own default — every
   * algorithm the supplied key supports — is what turns a raw-byte key
   * into a forgery oracle.
   */
  readonly algorithms: readonly JwtAlgorithm[];
  /**
   * The verification key: a `Uint8Array` secret for `HS*`, a public
   * `KeyObject` / `CryptoKey` / JWK for everything else.
   */
  readonly key: KeyInput;
  /** The `iss` a token must carry. Required — an unchecked issuer accepts any issuer's tokens. */
  readonly issuer: string | readonly string[];
  /** The `aud` a token must carry. Required — an unchecked audience accepts another service's tokens. */
  readonly audience: string | readonly string[];
  /** Permitted clock skew in seconds. Defaults to `0`; capped at {@link MAX_CLOCK_TOLERANCE_SECONDS}. */
  readonly clockToleranceSeconds?: number;
  /** Reject tokens whose `iat` is older than this many seconds, regardless of `exp`. */
  readonly maxTokenAgeSeconds?: number;
  /** Whether `exp` must be present. Defaults to `true`. */
  readonly requireExpiration?: boolean;
  /** Additional claim names that must be present. */
  readonly requiredClaims?: readonly string[];
  /** The `typ` header a token must carry. Unset means `typ` is not checked. */
  readonly expectedTyp?: string;
  /** Time source, in milliseconds. Injectable for tests. Defaults to `Date.now`. */
  readonly clock?: () => number;
}

/** Verifies tokens against a fixed allowlist, key, issuer and audience. */
export interface JwtVerifier {
  /**
   * Verifies a token.
   *
   * @remarks
   * Returns a `Result` rather than throwing. A rejected token is the
   * single most ordinary outcome of serving untrusted traffic, not an
   * exception — and a `Result` makes handling it visible in the type,
   * where a `try`/`catch` makes forgetting it invisible.
   *
   * @param token - An untrusted compact JWS.
   */
  verify(token: string): Promise<Result<VerifiedJwt, JwtVerificationError>>;
}

/**
 * Registered claims the signer sets from its own configuration. A
 * caller's value for any of these is discarded rather than merged.
 */
const SIGNER_OWNED_CLAIMS = new Set(['sub', 'iss', 'aud', 'exp', 'iat', 'jti', 'nbf']);

function assertPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new AuthConfigurationError(`\`${label}\` must be a positive integer of seconds.`);
  }
  return value;
}

function assertNonEmptyString(value: unknown, label: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AuthConfigurationError(`\`${label}\` must be a non-empty string.`);
  }
}

function assertAudience(audience: unknown): string[] {
  const list = Array.isArray(audience) ? (audience as unknown[]) : [audience];
  if (list.length === 0) {
    throw new AuthConfigurationError('`audience` must be a non-empty string or array of strings.');
  }
  for (const entry of list) assertNonEmptyString(entry, 'audience');
  return list as string[];
}

/**
 * Creates a signer bound to one algorithm, key, issuer, audience and
 * token lifetime.
 *
 * @remarks
 * Every safety property is decided here rather than per call, so a
 * single misconfiguration fails at startup instead of on whichever
 * request first exercises the bad path.
 *
 * @param options - See {@link JwtSignerOptions}.
 *
 * @throws {@link AuthConfigurationError} if the key cannot safely serve the algorithm.
 *
 * @public
 */
export function createJwtSigner(options: JwtSignerOptions): JwtSigner {
  const allowlist = resolveAllowlist([options.algorithm], 'algorithm');
  assertKeyMatchesAllowlist(options.key, allowlist, 'sign');

  assertNonEmptyString(options.issuer, 'issuer');
  const audience = assertAudience(options.audience);
  const ttlSeconds = assertPositiveInteger(options.ttlSeconds, 'ttlSeconds');

  const typ = options.typ ?? 'JWT';
  assertNonEmptyString(typ, 'typ');

  const includeJti = options.includeJti ?? true;
  const clock = options.clock ?? Date.now;
  const { algorithm, key, issuer } = options;

  return {
    async sign(claims) {
      assertNonEmptyString(claims.sub, 'claims.sub');

      // Registered claims are stripped from the caller's payload and
      // re-applied from configuration, so a handler that spreads
      // user-controlled data into its claims cannot widen the token's
      // audience or push out its expiry. Asserted in
      // `tests/attacks/claims.test.ts`.
      const rest: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(claims)) {
        // `name` is an own enumerable key from Object.entries, and the
        // target is a fresh object literal, so there is no prototype to
        // reach. The reserved-claim filter runs first regardless.
        // eslint-disable-next-line security/detect-object-injection
        if (!SIGNER_OWNED_CLAIMS.has(name)) rest[name] = value;
      }

      const issuedAt = Math.floor(clock() / 1000);
      const signer = new SignJWT(rest as JWTPayload)
        .setProtectedHeader({ alg: algorithm, typ })
        .setSubject(claims.sub)
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + ttlSeconds);

      if (includeJti) signer.setJti(crypto.randomUUID());

      return signer.sign(key);
    },
  };
}

/**
 * Creates a verifier bound to one algorithm allowlist, key, issuer and
 * audience.
 *
 * @remarks
 * The allowlist and the key are validated against each other here, at
 * construction. That placement is the point: algorithm confusion is a
 * *configuration* vulnerability, and a configuration vulnerability
 * caught at request time has already shipped.
 *
 * @param options - See {@link JwtVerifierOptions}.
 *
 * @throws {@link AuthConfigurationError} if the allowlist is empty, mixes key families, or
 * disagrees with the supplied key.
 *
 * @public
 */
export function createJwtVerifier(options: JwtVerifierOptions): JwtVerifier {
  const allowlist = resolveAllowlist(options.algorithms, 'algorithms');
  assertKeyMatchesAllowlist(options.key, allowlist, 'verify');

  const issuers = Array.isArray(options.issuer) ? [...options.issuer] : [options.issuer];
  if (issuers.length === 0) {
    throw new AuthConfigurationError('`issuer` must be a non-empty string or array of strings.');
  }
  for (const issuer of issuers) assertNonEmptyString(issuer, 'issuer');
  const audience = assertAudience(options.audience);

  const clockToleranceSeconds = options.clockToleranceSeconds ?? 0;
  if (
    typeof clockToleranceSeconds !== 'number' ||
    !Number.isFinite(clockToleranceSeconds) ||
    clockToleranceSeconds < 0
  ) {
    throw new AuthConfigurationError('`clockToleranceSeconds` must be a non-negative number.');
  }
  if (clockToleranceSeconds > MAX_CLOCK_TOLERANCE_SECONDS) {
    throw new AuthConfigurationError(
      `\`clockToleranceSeconds\` is ${clockToleranceSeconds}, above the ` +
        `${MAX_CLOCK_TOLERANCE_SECONDS}s cap. Tolerance extends the life of every expired ` +
        'token by exactly this much; fix the clocks instead.',
    );
  }

  const maxTokenAgeSeconds =
    options.maxTokenAgeSeconds === undefined
      ? undefined
      : assertPositiveInteger(options.maxTokenAgeSeconds, 'maxTokenAgeSeconds');

  const requiredClaims = new Set(options.requiredClaims ?? []);
  for (const claim of requiredClaims) assertNonEmptyString(claim, 'requiredClaims entry');
  if (options.requireExpiration ?? true) requiredClaims.add('exp');
  // Not optional, and deliberately not behind a flag. `iss` and `aud`
  // are mandatory here for the same reason: a verifier that cannot say
  // *who* a token is about has verified a signature, not an identity.
  // `jose` never requires `sub` on its own, so omitting this leaves
  // `JwtClaims.sub` a `string` that is `undefined` at runtime.
  requiredClaims.add('sub');

  const { key, expectedTyp } = options;
  const clock = options.clock ?? Date.now;
  const algorithms = [...allowlist.algorithms];

  return {
    async verify(token) {
      try {
        // Our own allowlist check, on the raw header, before jose sees
        // the token. jose repeats it; see `inspectProtectedHeader`.
        const header = inspectProtectedHeader(token, allowlist, expectedTyp);

        const { payload } = await jwtVerify(token, key, {
          algorithms,
          issuer: issuers,
          audience,
          clockTolerance: clockToleranceSeconds,
          currentDate: new Date(clock()),
          requiredClaims: [...requiredClaims],
          ...(maxTokenAgeSeconds === undefined ? {} : { maxTokenAge: maxTokenAgeSeconds }),
          ...(expectedTyp === undefined ? {} : { typ: expectedTyp }),
        });

        // `requiredClaims` above asserts presence; jose only type-checks
        // `sub` when a `subject` option is set, which would pin it to one
        // value. So the shape is checked here instead: without this, a
        // token carrying `sub: 42` or `sub: ""` satisfies jose and still
        // reaches the caller typed as a non-empty `string`.
        const { sub } = payload;
        if (typeof sub !== 'string' || sub.length === 0) {
          throw new JwtVerificationError(
            'claims_invalid',
            'Claim `sub` is absent, empty, or not a string.',
          );
        }

        return ok({ claims: payload as JwtClaims, header });
      } catch (cause) {
        return err(toVerificationError(cause));
      }
    },
  };
}
