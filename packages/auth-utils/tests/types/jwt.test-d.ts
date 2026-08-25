import type { AppError, Err, Ok, Result, UnauthorizedError } from '@firstprinciples/core';
import { isErr, isOk } from '@firstprinciples/core';
import { describe, expectTypeOf, it } from 'vitest';

import type {
  JwtFailureReason,
  JwtVerificationError,
  RefreshTokenError,
} from '../../src/errors.js';
import { createJwtSigner, createJwtVerifier } from '../../src/jwt.js';
import type { JwtAlgorithm, VerifiedJwt } from '../../src/jwt.js';
import { createLoginRateLimiter, type AttemptStore } from '../../src/rate-limit.js';
import { createRefreshTokenService } from '../../src/refresh.js';
import type {
  IssuedRefreshToken,
  RefreshFailureReason,
  RefreshTokenStore,
} from '../../src/refresh.js';
import { createMemoryAttemptStore, createMemoryRefreshTokenStore } from '../../src/stores.js';

const SECRET = new Uint8Array(32);

const verifier = createJwtVerifier({
  algorithms: ['HS256'],
  key: SECRET,
  issuer: 'https://issuer.test',
  audience: 'https://api.test',
});

describe('verify returns a core Result, and narrows like one', () => {
  it('is Result<VerifiedJwt, JwtVerificationError>', async () => {
    const result = await verifier.verify('token');
    expectTypeOf(result).toEqualTypeOf<Result<VerifiedJwt, JwtVerificationError>>();
  });

  it('narrows to Ok on isOk, exposing claims and header', async () => {
    const result = await verifier.verify('token');
    if (isOk(result)) {
      expectTypeOf(result).toEqualTypeOf<Ok<VerifiedJwt>>();
      expectTypeOf(result.value.claims.sub).toEqualTypeOf<string>();
      expectTypeOf(result.value.header.alg).toEqualTypeOf<JwtAlgorithm>();
    }
  });

  it('narrows to Err on isErr, keeping the narrowed details', async () => {
    const result = await verifier.verify('token');
    if (isErr(result)) {
      expectTypeOf(result).toEqualTypeOf<Err<JwtVerificationError>>();
      // The reason survives narrowing as a literal union, so a `switch`
      // over it is exhaustive. This is the `BrandValidationError`
      // pattern from `core`: `AppError.details` stays `unknown` for
      // untrusted catch sites, and a function that knows the shape says so.
      expectTypeOf(result.error.details.reason).toEqualTypeOf<JwtFailureReason>();
      expectTypeOf(result.error.reason).toEqualTypeOf<JwtFailureReason>();
    }
  });

  it('is an UnauthorizedError, so generic auth handling catches it', async () => {
    // The relationship `core` 0.2.0's name/kind split exists to allow.
    const result = await verifier.verify('token');
    if (isErr(result)) {
      expectTypeOf(result.error).toExtend<UnauthorizedError>();
      // Its own identity, distinct from the parent's...
      expectTypeOf(result.error.name).toEqualTypeOf<'JwtVerificationError'>();
      // ...while the taxonomy slot stays the parent's, which is correct:
      // anything switching on `kind` should treat this as a 401.
      expectTypeOf(result.error.kind).toEqualTypeOf<'UnauthorizedError'>();
    }
  });

  it('stays assignable to the ecosystem-wide Result<T>', async () => {
    // A caller that does not care which auth failure happened can treat
    // it as any other AppError-shaped Result — the S7 layering promise.
    const result = await verifier.verify('token');
    expectTypeOf(result).toMatchTypeOf<Result<VerifiedJwt, AppError>>();
  });
});

describe('the algorithm allowlist is closed at the type level as well as at runtime', () => {
  it('accepts a supported algorithm', () => {
    expectTypeOf<'HS256'>().toMatchTypeOf<JwtAlgorithm>();
    expectTypeOf<'EdDSA'>().toMatchTypeOf<JwtAlgorithm>();
  });

  it('does not admit `none`', () => {
    expectTypeOf<'none'>().not.toMatchTypeOf<JwtAlgorithm>();
    expectTypeOf<'NONE'>().not.toMatchTypeOf<JwtAlgorithm>();
  });

  it('rejects an unknown algorithm at the call site', () => {
    createJwtVerifier({
      // @ts-expect-error — 'HS128' is not a JWS algorithm. The directive
      // sits on the property, not the call: TypeScript reports the error
      // at the offending line and an `@ts-expect-error` only suppresses
      // the line directly beneath it.
      algorithms: ['HS128'],
      key: SECRET,
      issuer: 'i',
      audience: 'a',
    });
  });
});

describe('required options cannot be forgotten', () => {
  it('requires issuer and audience on a verifier', () => {
    // @ts-expect-error — `audience` is not optional. An unchecked
    // audience accepts another service's tokens.
    createJwtVerifier({ algorithms: ['HS256'], key: SECRET, issuer: 'i' });

    // @ts-expect-error — `issuer` is not optional.
    createJwtVerifier({ algorithms: ['HS256'], key: SECRET, audience: 'a' });

    // @ts-expect-error — `algorithms` is not optional. jose's own
    // default (every algorithm the key supports) is the vulnerability.
    createJwtVerifier({ key: SECRET, issuer: 'i', audience: 'a' });
  });

  it('requires ttlSeconds on a signer', () => {
    // @ts-expect-error — a token with no expiry is a permanent credential.
    createJwtSigner({ algorithm: 'HS256', key: SECRET, issuer: 'i', audience: 'a' });
  });

  it('requires sub when signing', async () => {
    const signer = createJwtSigner({
      algorithm: 'HS256',
      key: SECRET,
      issuer: 'i',
      audience: 'a',
      ttlSeconds: 60,
    });

    // @ts-expect-error — `sub` is required.
    await signer.sign({ role: 'admin' });

    expectTypeOf(signer.sign).returns.resolves.toEqualTypeOf<string>();
  });

  it('takes a single algorithm on a signer, not a list', () => {
    createJwtSigner({
      // @ts-expect-error — a signer signs with exactly one algorithm.
      algorithms: ['HS256'],
      key: SECRET,
      issuer: 'i',
      audience: 'a',
      ttlSeconds: 60,
    });
  });
});

describe('the refresh-token surface', () => {
  const refresh = createRefreshTokenService({
    store: createMemoryRefreshTokenStore(),
    ttlSeconds: 3600,
    absoluteTtlSeconds: 86_400,
  });

  it('rotate returns a core Result over a RefreshTokenError', async () => {
    const result = await refresh.rotate('t');
    expectTypeOf(result).toEqualTypeOf<Result<IssuedRefreshToken, RefreshTokenError>>();
  });

  it('narrows to the issued token on success', async () => {
    const result = await refresh.rotate('t');
    if (isOk(result)) {
      expectTypeOf(result.value.token).toEqualTypeOf<string>();
      expectTypeOf(result.value.subject).toEqualTypeOf<string>();
      expectTypeOf(result.value.familyId).toEqualTypeOf<string>();
    }
  });

  it('keeps the failure reason a literal union, so a switch is exhaustive', async () => {
    const result = await refresh.rotate('t');
    if (isErr(result)) {
      expectTypeOf(result.error.reason).toEqualTypeOf<RefreshFailureReason>();
      // Same subclassing relationship the core name/kind split enables.
      expectTypeOf(result.error).toExtend<UnauthorizedError>();
      expectTypeOf(result.error.name).toEqualTypeOf<'RefreshTokenError'>();
      expectTypeOf(result.error.kind).toEqualTypeOf<'UnauthorizedError'>();
    }
  });

  it('requires both lifetimes at construction', () => {
    // @ts-expect-error - `absoluteTtlSeconds` is not optional; without a
    // ceiling a stolen-and-rotated chain lives forever.
    createRefreshTokenService({ store: createMemoryRefreshTokenStore(), ttlSeconds: 60 });

    // @ts-expect-error - `store` is not optional.
    createRefreshTokenService({ ttlSeconds: 60, absoluteTtlSeconds: 600 });
  });

  it('accepts any conforming store, not just the bundled one', () => {
    const custom: RefreshTokenStore = {
      read: () => Promise.resolve(undefined),
      create: () => Promise.resolve(true),
      compareAndSet: () => Promise.resolve(true),
      delete: () => Promise.resolve(),
    };
    expectTypeOf(createRefreshTokenService).toBeCallableWith({
      store: custom,
      ttlSeconds: 60,
      absoluteTtlSeconds: 600,
    });
  });
});

describe('the rate-limiter surface', () => {
  it('accepts any conforming attempt store', () => {
    const custom: AttemptStore = {
      increment: () => Promise.resolve({ count: 1, resetAt: 0 }),
      get: () => Promise.resolve(undefined),
      reset: () => Promise.resolve(),
    };
    expectTypeOf(createLoginRateLimiter).toBeCallableWith({
      store: custom,
      maxAttempts: 5,
      windowSeconds: 900,
    });
  });

  it('returns a decision with everything a 429 response needs', async () => {
    const limiter = createLoginRateLimiter({
      store: createMemoryAttemptStore(),
      maxAttempts: 5,
      windowSeconds: 900,
    });
    const decision = await limiter.check('k');

    expectTypeOf(decision.allowed).toEqualTypeOf<boolean>();
    expectTypeOf(decision.remaining).toEqualTypeOf<number>();
    expectTypeOf(decision.resetAt).toEqualTypeOf<number>();
  });

  it('constrains onStoreError to the two real choices', () => {
    createLoginRateLimiter({
      store: createMemoryAttemptStore(),
      maxAttempts: 5,
      windowSeconds: 900,
      // @ts-expect-error - only 'deny' | 'allow'
      onStoreError: 'maybe',
    });
  });
});
