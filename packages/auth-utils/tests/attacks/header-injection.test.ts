import { isErr, isOk } from '@firstprinciples/core';
import { exportJWK, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';

import { createJwtVerifier } from '../../src/jwt.js';
import {
  AUDIENCE,
  baseClaims,
  forgeSigned,
  forgeUnsigned,
  ISSUER,
  rsaFixture,
} from './_harness.js';

/**
 * ATTACK: making the token nominate its own verification key.
 *
 * `jwk` embeds a public key in the header. `jku` and `x5u` point at a
 * URL. `x5c` embeds a certificate chain. Each is a real JOSE parameter
 * with a legitimate use, and each is a complete authentication bypass
 * if a verifier resolves it on an unverified token: the attacker signs
 * with their own key and ships the matching public key alongside.
 */
describe('attack: key-resolution headers', () => {
  const verifier = async (): Promise<ReturnType<typeof createJwtVerifier>> => {
    const { publicKey } = await rsaFixture();
    return createJwtVerifier({
      algorithms: ['RS256'],
      key: publicKey,
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  };

  it('jose ignores an embedded jwk rather than resolving it', async () => {
    // Establishes the baseline: jose is not vulnerable here. It fails
    // on the signature, because it used the configured key.
    const victim = await rsaFixture();
    const attacker = await rsaFixture();
    const forged = await forgeSigned(
      { alg: 'RS256', jwk: await exportJWK(attacker.publicKey) },
      baseClaims({ sub: 'admin' }),
      attacker.privateKey,
    );

    await expect(jwtVerify(forged, victim.publicKey, { algorithms: ['RS256'] })).rejects.toThrow(
      /signature verification failed/,
    );
  });

  it('rejects an embedded jwk outright, before reaching the signature check', async () => {
    // "Ignored" and "rejected" differ in what they leave in your logs.
    // A `signature_invalid` on a token carrying its own key reads like
    // a stale key rotation; `untrusted_header` reads like what it is.
    const attacker = await rsaFixture();
    const forged = await forgeSigned(
      { alg: 'RS256', jwk: await exportJWK(attacker.publicKey) },
      baseClaims({ sub: 'admin' }),
      attacker.privateKey,
    );

    const result = await (await verifier()).verify(forged);
    expect(isOk(result)).toBe(false);
    if (isErr(result)) {
      expect(result.error.reason).toBe('untrusted_header');
      expect(result.error.message).toContain('jwk');
    }
  });

  it.each(['jku', 'x5u', 'x5c', 'x5t', 'x5t#S256'])(
    'rejects a token carrying the %s header',
    async (parameter) => {
      const { privateKey } = await rsaFixture();
      const forged = await forgeSigned(
        { alg: 'RS256', [parameter]: 'https://evil.test/keys.json' },
        baseClaims(),
        privateKey,
      );

      const result = await (await verifier()).verify(forged);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.reason).toBe('untrusted_header');
    },
  );

  it('rejects an unrecognized crit extension, per RFC 7515 §4.1.11', async () => {
    // Hand-forged: jose refuses to *sign* a header with a crit
    // extension it does not recognize, so there is no way to mint this
    // one with SignJWT. An attacker assembling the token by hand has no
    // such scruples, which is the case worth testing.
    const forged = forgeUnsigned(
      { alg: 'RS256', crit: ['exp'], exp: 1 },
      baseClaims(),
      'bm90LWEtcmVhbC1zaWc',
    );

    const result = await (await verifier()).verify(forged);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('untrusted_header');
  });

  it('ignores kid entirely — it never selects a key', async () => {
    // A `kid` is informational here. It is surfaced on the verified
    // header so a caller can log it, and it has no effect on which key
    // was used, so a path-traversal or SQL payload in it is inert.
    const { publicKey, privateKey } = await rsaFixture();
    const forged = await forgeSigned(
      { alg: 'RS256', kid: "../../etc/passwd' OR 1=1--" },
      baseClaims(),
      privateKey,
    );

    const result = await createJwtVerifier({
      algorithms: ['RS256'],
      key: publicKey,
      issuer: ISSUER,
      audience: AUDIENCE,
    }).verify(forged);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.header.kid).toBe("../../etc/passwd' OR 1=1--");
  });

  it('rejects a header whose alg is a prototype-chain property name', async () => {
    // `'toString' in header` is true for any object literal. The
    // allowlist uses a Map and `Object.hasOwn`, so nothing inherited
    // registers as present.
    for (const alg of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      const result = await (await verifier()).verify(forgeUnsigned({ alg }, baseClaims(), 'c2ln'));
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.reason).toBe('algorithm_not_allowed');
    }
  });

  it('rejects a header that is JSON but not an object', async () => {
    for (const header of ['"RS256"', '[1,2,3]', 'null', '42']) {
      const encoded = Buffer.from(header, 'utf8').toString('base64url');
      const token = `${encoded}.${Buffer.from('{}', 'utf8').toString('base64url')}.c2ln`;
      const result = await (await verifier()).verify(token);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.reason).toBe('malformed');
    }
  });

  it('rejects a 5-segment JWE rather than trying to verify it', async () => {
    const result = await (await verifier()).verify('a.b.c.d.e');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.reason).toBe('malformed');
      expect(result.error.message).toContain('JWE');
    }
  });

  it('rejects a typ mismatch when a typ is required', async () => {
    // The cross-token-kind replay guard: an access token presented
    // where a refresh token is expected.
    const { publicKey, privateKey } = await rsaFixture();
    const forged = await forgeSigned({ alg: 'RS256', typ: 'at+jwt' }, baseClaims(), privateKey);

    const result = await createJwtVerifier({
      algorithms: ['RS256'],
      key: publicKey,
      issuer: ISSUER,
      audience: AUDIENCE,
      expectedTyp: 'rt+jwt',
    }).verify(forged);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('type_mismatch');
  });
});
