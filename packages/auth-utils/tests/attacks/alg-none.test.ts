import { isErr, isOk } from '@firstprinciples/core';
import { describe, expect, it } from 'vitest';

import { createJwtVerifier } from '../../src/jwt.js';
import { AUDIENCE, baseClaims, forgeUnsigned, hmacSecret, ISSUER, rsaFixture } from './_harness.js';

/**
 * ATTACK: `alg: none`.
 *
 * The oldest JWT vulnerability there is. RFC 7519 defines an "Unsecured
 * JWS" whose signature is the empty string; a verifier that reads `alg`
 * out of the token and dispatches on it will happily conclude that no
 * signature was required and that the (absent) signature checks out.
 * The attacker mints any claims they like — `sub: 'admin'` — and pays
 * nothing.
 *
 * We try to land it against every configuration we can reach.
 */
describe('attack: alg: none', () => {
  const verifierFor = async (): Promise<ReturnType<typeof createJwtVerifier>> => {
    const { publicKey } = await rsaFixture();
    return createJwtVerifier({
      algorithms: ['RS256'],
      key: publicKey,
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  };

  it('rejects the canonical unsecured token (empty signature segment)', async () => {
    const verifier = await verifierFor();
    const token = forgeUnsigned({ alg: 'none', typ: 'JWT' }, baseClaims({ sub: 'admin' }));

    // Prove the forgery is well-formed enough to be worth defending
    // against: it is a real 3-segment compact JWS whose payload decodes.
    expect(token.split('.')).toHaveLength(3);
    expect(token.endsWith('.')).toBe(true);

    const result = await verifier.verify(token);

    expect(isOk(result)).toBe(false);
    if (isErr(result)) {
      expect(result.error.reason).toBe('algorithm_not_allowed');
      expect(result.error.httpStatus).toBe(401);
    }
  });

  it('rejects an unsecured token carrying a plausible-looking signature', async () => {
    // A verifier that only checked "is there something after the last
    // dot" would pass this one. The garbage is never even examined —
    // `alg` is off the allowlist first.
    const verifier = await verifierFor();
    const token = forgeUnsigned(
      { alg: 'none', typ: 'JWT' },
      baseClaims({ sub: 'admin' }),
      'bm90LWEtc2lnbmF0dXJl',
    );

    const result = await verifier.verify(token);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('algorithm_not_allowed');
  });

  it.each(['None', 'NONE', 'nOnE', 'none '])(
    'rejects the case/whitespace variant %j, which a naive `alg !== "none"` check misses',
    async (alg) => {
      const verifier = await verifierFor();
      const result = await verifier.verify(forgeUnsigned({ alg }, baseClaims({ sub: 'admin' })));

      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.reason).toBe('algorithm_not_allowed');
    },
  );

  it('rejects it against an HMAC verifier too, where the key type is no help', async () => {
    // Against an RSA verifier one could argue the key type saves you.
    // It does not save you here: an HS256 verifier holds a secret, and
    // the only thing standing between it and an unsecured token is the
    // allowlist.
    const verifier = createJwtVerifier({
      algorithms: ['HS256'],
      key: hmacSecret(),
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    const result = await verifier.verify(
      forgeUnsigned({ alg: 'none', typ: 'JWT' }, baseClaims({ sub: 'admin' })),
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('algorithm_not_allowed');
  });

  it('cannot be configured back in: `none` is rejected as an allowlist entry', async () => {
    const { publicKey } = await rsaFixture();
    expect(() =>
      createJwtVerifier({
        // Casting past the type is the whole point — the type is erased
        // at runtime, so it cannot be the thing that protects us.
        algorithms: ['none'] as never,
        key: publicKey,
        issuer: ISSUER,
        audience: AUDIENCE,
      }),
    ).toThrow(/not a supported JWS signature algorithm/);
  });

  it('rejects an otherwise-allowed algorithm that arrives unsigned', async () => {
    // `alg: RS256` with an empty signature. The allowlist alone would
    // pass this; the empty-signature check is what catches it.
    const verifier = await verifierFor();
    const result = await verifier.verify(
      forgeUnsigned({ alg: 'RS256', typ: 'JWT' }, baseClaims({ sub: 'admin' })),
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('algorithm_not_allowed');
  });
});
