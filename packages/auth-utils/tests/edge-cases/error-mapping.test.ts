import { errors as joseErrors } from 'jose';
import { describe, expect, it, vi } from 'vitest';

import {
  AuthConfigurationError,
  JwtVerificationError,
  PasswordHashError,
} from '../../src/errors.js';
import {
  assertKeyMatchesAllowlist,
  classifyKey,
  resolveAllowlist,
} from '../../src/internal/jwt-algorithms.js';
import { toVerificationError } from '../../src/internal/jwt-errors.js';

/**
 * The mapper from "whatever jose threw" to a `JwtFailureReason` is the
 * one place where a mistake turns a rejection into something other than
 * a 401 — an unhandled 500, or worse, a mislabelled reason a client
 * acts on. Its unusual branches are hard to reach through the public
 * API by design (the construction-time checks make most of them
 * unreachable), so they are driven directly here.
 */
describe('every jose failure maps to a rejection, never to a pass', () => {
  it.each([
    ['JOSEAlgNotAllowed', new joseErrors.JOSEAlgNotAllowed('nope'), 'algorithm_not_allowed'],
    [
      'JWSSignatureVerificationFailed',
      new joseErrors.JWSSignatureVerificationFailed(),
      'signature_invalid',
    ],
    ['JWSInvalid', new joseErrors.JWSInvalid('bad'), 'malformed'],
    ['JWTInvalid', new joseErrors.JWTInvalid('bad'), 'malformed'],
    ['JOSENotSupported', new joseErrors.JOSENotSupported('bad'), 'malformed'],
    ['a bare TypeError', new TypeError('key mismatch'), 'algorithm_not_allowed'],
    ['an unrecognized Error', new Error('something else'), 'verification_failed'],
    ['a thrown string', 'not even an error', 'verification_failed'],
    ['a thrown null', null, 'verification_failed'],
    ['a thrown undefined', undefined, 'verification_failed'],
    ['a thrown plain object', { message: 'nope' }, 'verification_failed'],
  ])('maps %s to %s', (_label, thrown, expected) => {
    const error = toVerificationError(thrown);

    expect(error.reason).toBe(expected);
    expect(error.httpStatus).toBe(401);
    expect(error.name).toBe('JwtVerificationError');
    expect(error.details.reason).toBe(expected);
  });

  it('passes an already-classified error straight through', () => {
    const original = new JwtVerificationError('untrusted_header', 'carries jku');
    expect(toVerificationError(original)).toBe(original);
  });

  it.each([
    ['nbf', 'not_yet_valid'],
    ['exp', 'expired'],
    ['iat', 'too_old'],
    ['iss', 'issuer_mismatch'],
    ['aud', 'audience_mismatch'],
    ['sub', 'claims_invalid'],
    ['tenant_id', 'claims_invalid'],
  ])('maps a JWTClaimValidationFailed on %s to %s', (claim, expected) => {
    const error = toVerificationError(
      new joseErrors.JWTClaimValidationFailed('failed', {}, claim, 'check_failed'),
    );
    expect(error.reason).toBe(expected);
  });

  it.each([
    ['exp', 'expired'],
    ['iat', 'too_old'],
  ])('maps a JWTExpired on %s to %s', (claim, expected) => {
    // jose reports a `maxTokenAge` violation as JWTExpired with
    // claim `iat`. Reading only the class would mislabel it `expired`
    // and tell the client to refresh a token that has not expired.
    const error = toVerificationError(
      new joseErrors.JWTExpired('expired', {}, claim, 'check_failed'),
    );
    expect(error.reason).toBe(expected);
  });

  it('gives every claim failure a distinct, non-empty message', () => {
    const messages = new Set(
      ['nbf', 'exp', 'iat', 'iss', 'aud', 'other'].map(
        (claim) =>
          toVerificationError(
            new joseErrors.JWTClaimValidationFailed('failed', {}, claim, 'check_failed'),
          ).message,
      ),
    );

    expect(messages.size).toBe(6);
    for (const message of messages) expect(message.length).toBeGreaterThan(0);
  });

  it('derives the error code from the reason', () => {
    expect(toVerificationError(new joseErrors.JWSInvalid('x')).code).toBe('JWT_MALFORMED');
    expect(toVerificationError(new Error('x')).code).toBe('JWT_VERIFICATION_FAILED');
  });
});

describe('classifyKey', () => {
  it.each([
    ['a Uint8Array', new Uint8Array(32), 'secret'],
    ['a Buffer', Buffer.alloc(32), 'secret'],
    ['an oct JWK', { kty: 'oct', k: 'AAAA' }, 'secret'],
    ['a public RSA JWK', { kty: 'RSA', n: 'x', e: 'AQAB' }, 'public'],
    ['a private RSA JWK', { kty: 'RSA', n: 'x', e: 'AQAB', d: 'y' }, 'private'],
    ['a KeyObject-shaped public key', { type: 'public' }, 'public'],
    ['a KeyObject-shaped private key', { type: 'private' }, 'private'],
  ])('classifies %s as %s', (_label, key, expected) => {
    expect(classifyKey(key)).toBe(expected);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'secret'],
    ['a number', 42],
    ['an object with no kty', { foo: 'bar' }],
    ['a JWK with a non-string kty', { kty: 42 }],
    ['an object with an unrecognized type', { type: 'quantum' }],
  ])('returns undefined for %s', (_label, key) => {
    expect(classifyKey(key)).toBeUndefined();
  });
});

describe('assertKeyMatchesAllowlist', () => {
  it('rejects a public key for an HMAC allowlist', () => {
    const allowlist = resolveAllowlist(['HS256'], 'algorithms');
    expect(() =>
      assertKeyMatchesAllowlist({ type: 'public' } as never, allowlist, 'verify'),
    ).toThrow(/the key is a public key/);
  });

  it('rejects a private key for an HMAC allowlist', () => {
    const allowlist = resolveAllowlist(['HS256'], 'algorithms');
    expect(() =>
      assertKeyMatchesAllowlist({ type: 'private' } as never, allowlist, 'sign'),
    ).toThrow(/the key is a private key/);
  });

  it('skips the length check when the secret length is not visible', () => {
    // A non-extractable CryptoKey exposes no size. Refusing it outright
    // would break a legitimate WebCrypto key; the check is documented as
    // best-effort rather than pretending otherwise.
    const allowlist = resolveAllowlist(['HS256'], 'algorithms');
    expect(() =>
      assertKeyMatchesAllowlist({ type: 'secret' } as never, allowlist, 'verify'),
    ).not.toThrow();
  });

  it('reads the length off a KeyObject symmetricKeySize', () => {
    const allowlist = resolveAllowlist(['HS256'], 'algorithms');
    expect(() =>
      assertKeyMatchesAllowlist(
        { type: 'secret', symmetricKeySize: 8 } as never,
        allowlist,
        'verify',
      ),
    ).toThrow(/at least 32 bytes/);
  });

  it('reports the full mixed allowlist in the error, not just the last entry', () => {
    expect(() => resolveAllowlist(['RS256', 'PS256', 'HS256'], 'algorithms')).toThrow(
      /RS256, PS256 and HS256/,
    );
  });

  it('deduplicates a repeated algorithm', () => {
    const allowlist = resolveAllowlist(['HS256', 'HS256'], 'algorithms');
    expect([...allowlist.algorithms]).toEqual(['HS256']);
  });

  it('does not flag a short Uint8Array as PEM', () => {
    const allowlist = resolveAllowlist(['HS256'], 'algorithms');
    expect(() => assertKeyMatchesAllowlist(new Uint8Array(2), allowlist, 'verify')).toThrow(
      /at least 32 bytes/,
    );
  });
});

describe('PasswordHashError', () => {
  it('is raised when the derivation itself fails, carrying the cause', async () => {
    const argon2 = (await import('argon2')).default;
    const spy = vi
      .spyOn(argon2, 'hash')
      .mockRejectedValueOnce(new Error('cannot allocate 19456 KiB'));

    const { hashPassword } = await import('../../src/password.js');

    await expect(hashPassword('pw')).rejects.toThrow(PasswordHashError);
    spy.mockRestore();
  });

  it('reports 500, not 401 — a capacity failure is not a wrong password', async () => {
    const error = new PasswordHashError('nope', new Error('root cause'));
    expect(error.httpStatus).toBe(500);
    expect(error.code).toBe('PASSWORD_HASH_ERROR');
    expect(error.name).toBe('PasswordHashError');
    expect(error.cause).toBeInstanceOf(Error);
  });

  it('is distinguishable from a configuration error', () => {
    expect(new AuthConfigurationError('x').code).toBe('AUTH_CONFIGURATION_ERROR');
    expect(new AuthConfigurationError('x').httpStatus).toBe(500);
  });
});
