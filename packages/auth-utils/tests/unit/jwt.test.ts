import { isErr, isOk } from '@firstprinciples/core';
import { decodeJwt, decodeProtectedHeader, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';

import { AuthConfigurationError } from '../../src/errors.js';
import { createJwtSigner, createJwtVerifier } from '../../src/jwt.js';

const ISSUER = 'https://issuer.test';
const AUDIENCE = 'https://api.test';

function hmacSecret(fill = 0x2a): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

function hmacPair(secret = hmacSecret()): {
  signer: ReturnType<typeof createJwtSigner>;
  verifier: ReturnType<typeof createJwtVerifier>;
} {
  return {
    signer: createJwtSigner({
      algorithm: 'HS256',
      key: secret,
      issuer: ISSUER,
      audience: AUDIENCE,
      ttlSeconds: 300,
    }),
    verifier: createJwtVerifier({
      algorithms: ['HS256'],
      key: secret,
      issuer: ISSUER,
      audience: AUDIENCE,
    }),
  };
}

describe('issue and verify, happy path', () => {
  it('round-trips a token', async () => {
    const { signer, verifier } = hmacPair();
    const token = await signer.sign({ sub: 'user-1', role: 'admin' });

    const result = await verifier.verify(token);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.claims.sub).toBe('user-1');
      expect(result.value.claims.role).toBe('admin');
      expect(result.value.claims.iss).toBe(ISSUER);
      expect(result.value.claims.aud).toEqual([AUDIENCE]);
      expect(result.value.header.alg).toBe('HS256');
      expect(result.value.header.typ).toBe('JWT');
    }
  });

  it('stamps iat, exp and a unique jti', async () => {
    const { signer } = hmacPair();
    const [a, b] = await Promise.all([signer.sign({ sub: 'u' }), signer.sign({ sub: 'u' })]);

    const first = decodeJwt(a);
    const second = decodeJwt(b);

    expect(typeof first.iat).toBe('number');
    expect(first.exp).toBe((first.iat as number) + 300);
    expect(typeof first.jti).toBe('string');
    expect(first.jti).not.toBe(second.jti);
  });

  it('can be told not to stamp a jti', async () => {
    const token = await createJwtSigner({
      algorithm: 'HS256',
      key: hmacSecret(),
      issuer: ISSUER,
      audience: AUDIENCE,
      ttlSeconds: 60,
      includeJti: false,
    }).sign({ sub: 'u' });

    expect(decodeJwt(token).jti).toBeUndefined();
  });

  it('stamps a custom typ', async () => {
    const token = await createJwtSigner({
      algorithm: 'HS256',
      key: hmacSecret(),
      issuer: ISSUER,
      audience: AUDIENCE,
      ttlSeconds: 60,
      typ: 'at+jwt',
    }).sign({ sub: 'u' });

    expect(decodeProtectedHeader(token).typ).toBe('at+jwt');
  });

  it('round-trips over every supported asymmetric algorithm', async () => {
    for (const algorithm of ['RS256', 'PS256', 'ES256', 'ES384', 'EdDSA'] as const) {
      const { publicKey, privateKey } = await generateKeyPair(algorithm);
      const signer = createJwtSigner({
        algorithm,
        key: privateKey,
        issuer: ISSUER,
        audience: AUDIENCE,
        ttlSeconds: 60,
      });
      const verifier = createJwtVerifier({
        algorithms: [algorithm],
        key: publicKey,
        issuer: ISSUER,
        audience: AUDIENCE,
      });

      const result = await verifier.verify(await signer.sign({ sub: 'u' }));
      expect(isOk(result), `${algorithm} should round-trip`).toBe(true);
      if (isOk(result)) expect(result.value.header.alg).toBe(algorithm);
    }
  });

  it('round-trips over every supported HMAC algorithm', async () => {
    for (const [algorithm, bytes] of [
      ['HS256', 32],
      ['HS384', 48],
      ['HS512', 64],
    ] as const) {
      const secret = new Uint8Array(bytes).fill(7);
      const signer = createJwtSigner({
        algorithm,
        key: secret,
        issuer: ISSUER,
        audience: AUDIENCE,
        ttlSeconds: 60,
      });
      const verifier = createJwtVerifier({
        algorithms: [algorithm],
        key: secret,
        issuer: ISSUER,
        audience: AUDIENCE,
      });

      expect(isOk(await verifier.verify(await signer.sign({ sub: 'u' })))).toBe(true);
    }
  });

  it('supports a multi-value audience', async () => {
    const secret = hmacSecret();
    const signer = createJwtSigner({
      algorithm: 'HS256',
      key: secret,
      issuer: ISSUER,
      audience: ['https://a.test', 'https://b.test'],
      ttlSeconds: 60,
    });
    const verifier = createJwtVerifier({
      algorithms: ['HS256'],
      key: secret,
      issuer: ISSUER,
      audience: 'https://b.test',
    });

    expect(isOk(await verifier.verify(await signer.sign({ sub: 'u' })))).toBe(true);
  });
});

describe('injectable clock', () => {
  it('is used for issuance', async () => {
    const fixed = Date.UTC(2030, 0, 1);
    const token = await createJwtSigner({
      algorithm: 'HS256',
      key: hmacSecret(),
      issuer: ISSUER,
      audience: AUDIENCE,
      ttlSeconds: 120,
      clock: () => fixed,
    }).sign({ sub: 'u' });

    const claims = decodeJwt(token);
    expect(claims.iat).toBe(Math.floor(fixed / 1000));
    expect(claims.exp).toBe(Math.floor(fixed / 1000) + 120);
  });

  it('is used for verification, and moving it forward expires the token', async () => {
    const secret = hmacSecret();
    const issuedAt = Date.UTC(2030, 0, 1);
    const token = await createJwtSigner({
      algorithm: 'HS256',
      key: secret,
      issuer: ISSUER,
      audience: AUDIENCE,
      ttlSeconds: 60,
      clock: () => issuedAt,
    }).sign({ sub: 'u' });

    const verifierAt = (now: number): ReturnType<typeof createJwtVerifier> =>
      createJwtVerifier({
        algorithms: ['HS256'],
        key: secret,
        issuer: ISSUER,
        audience: AUDIENCE,
        clock: () => now,
      });

    expect(isOk(await verifierAt(issuedAt + 30_000).verify(token))).toBe(true);
    const late = await verifierAt(issuedAt + 61_000).verify(token);
    expect(isErr(late)).toBe(true);
    if (isErr(late)) expect(late.error.reason).toBe('expired');
  });
});

describe('maxTokenAgeSeconds', () => {
  it('rejects a token older than the maximum, even before it expires', async () => {
    const secret = hmacSecret();
    const issuedAt = Date.UTC(2030, 0, 1);
    const token = await createJwtSigner({
      algorithm: 'HS256',
      key: secret,
      issuer: ISSUER,
      audience: AUDIENCE,
      ttlSeconds: 3600,
      clock: () => issuedAt,
    }).sign({ sub: 'u' });

    const verifier = createJwtVerifier({
      algorithms: ['HS256'],
      key: secret,
      issuer: ISSUER,
      audience: AUDIENCE,
      maxTokenAgeSeconds: 60,
      clock: () => issuedAt + 600_000,
    });

    const result = await verifier.verify(token);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('too_old');
  });
});

describe('requiredClaims', () => {
  it('rejects a token missing a caller-required claim', async () => {
    const secret = hmacSecret();
    const token = await createJwtSigner({
      algorithm: 'HS256',
      key: secret,
      issuer: ISSUER,
      audience: AUDIENCE,
      ttlSeconds: 60,
    }).sign({ sub: 'u' });

    const verifier = createJwtVerifier({
      algorithms: ['HS256'],
      key: secret,
      issuer: ISSUER,
      audience: AUDIENCE,
      requiredClaims: ['tenant_id'],
    });

    const result = await verifier.verify(token);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('claims_invalid');
  });

  it('accepts it once the claim is present', async () => {
    const secret = hmacSecret();
    const token = await createJwtSigner({
      algorithm: 'HS256',
      key: secret,
      issuer: ISSUER,
      audience: AUDIENCE,
      ttlSeconds: 60,
    }).sign({ sub: 'u', tenant_id: 't-1' });

    const verifier = createJwtVerifier({
      algorithms: ['HS256'],
      key: secret,
      issuer: ISSUER,
      audience: AUDIENCE,
      requiredClaims: ['tenant_id'],
    });

    expect(isOk(await verifier.verify(token))).toBe(true);
  });
});

describe('construction-time configuration checks', () => {
  it.each([
    ['an empty allowlist', { algorithms: [] }],
    ['a non-array allowlist', { algorithms: 'HS256' }],
    ['an undefined allowlist', { algorithms: undefined }],
    ['an unknown algorithm', { algorithms: ['HS128'] }],
    ['a non-string algorithm', { algorithms: [256] }],
  ])('rejects %s', (_label, override) => {
    expect(() =>
      createJwtVerifier({
        algorithms: ['HS256'],
        key: hmacSecret(),
        issuer: ISSUER,
        audience: AUDIENCE,
        ...(override as object),
      }),
    ).toThrow(AuthConfigurationError);
  });

  it.each([
    ['an empty issuer', { issuer: '' }],
    ['a non-string issuer', { issuer: 42 }],
    ['an empty issuer list', { issuer: [] }],
    ['an empty audience', { audience: '' }],
    ['an empty audience list', { audience: [] }],
    ['a negative clock tolerance', { clockToleranceSeconds: -1 }],
    ['a NaN clock tolerance', { clockToleranceSeconds: Number.NaN }],
    ['a zero maxTokenAgeSeconds', { maxTokenAgeSeconds: 0 }],
    ['an empty requiredClaims entry', { requiredClaims: [''] }],
  ])('rejects %s', (_label, override) => {
    expect(() =>
      createJwtVerifier({
        algorithms: ['HS256'],
        key: hmacSecret(),
        issuer: ISSUER,
        audience: AUDIENCE,
        ...(override as object),
      }),
    ).toThrow(AuthConfigurationError);
  });

  it.each([
    ['a zero ttl', { ttlSeconds: 0 }],
    ['a negative ttl', { ttlSeconds: -60 }],
    ['a non-integer ttl', { ttlSeconds: 1.5 }],
    ['a missing ttl', { ttlSeconds: undefined }],
    ['an empty issuer', { issuer: '' }],
    ['an empty typ', { typ: '' }],
  ])('rejects a signer with %s', (_label, override) => {
    expect(() =>
      createJwtSigner({
        algorithm: 'HS256',
        key: hmacSecret(),
        issuer: ISSUER,
        audience: AUDIENCE,
        ttlSeconds: 60,
        ...(override as object),
      }),
    ).toThrow(AuthConfigurationError);
  });

  it('rejects an unrecognized key shape', () => {
    expect(() =>
      createJwtVerifier({
        algorithms: ['HS256'],
        key: 'a-string-secret' as never,
        issuer: ISSUER,
        audience: AUDIENCE,
      }),
    ).toThrow(/Unrecognized key/);
  });

  it('rejects a signer handed the public key', async () => {
    const { publicKey } = await generateKeyPair('RS256');
    expect(() =>
      createJwtSigner({
        algorithm: 'RS256',
        key: publicKey,
        issuer: ISSUER,
        audience: AUDIENCE,
        ttlSeconds: 60,
      }),
    ).toThrow(/needs the private key/);
  });

  it('rejects an empty sub at sign time', async () => {
    const { signer } = hmacPair();
    await expect(signer.sign({ sub: '' })).rejects.toThrow(/claims.sub/);
  });

  it('accepts an oct JWK secret of adequate length, and rejects a short one', () => {
    const adequate = { kty: 'oct', k: Buffer.alloc(32, 1).toString('base64url') };
    const short = { kty: 'oct', k: Buffer.alloc(8, 1).toString('base64url') };

    expect(() =>
      createJwtVerifier({
        algorithms: ['HS256'],
        key: adequate as never,
        issuer: ISSUER,
        audience: AUDIENCE,
      }),
    ).not.toThrow();

    expect(() =>
      createJwtVerifier({
        algorithms: ['HS256'],
        key: short as never,
        issuer: ISSUER,
        audience: AUDIENCE,
      }),
    ).toThrow(/at least 32 bytes/);
  });
});
