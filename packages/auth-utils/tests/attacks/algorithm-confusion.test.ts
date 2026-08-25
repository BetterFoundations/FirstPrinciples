import { isErr, isOk } from '@firstprinciples/core';
import { jwtVerify } from 'jose';
import { createPublicKey } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { AuthConfigurationError } from '../../src/errors.js';
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
 * ATTACK: RS256 → HS256 algorithm confusion.
 *
 * The service signs with an RSA private key and verifies with the
 * matching public key. The public key is, by construction, public. The
 * attacker takes it, treats its PEM text as an HMAC secret, signs a
 * token of their own choosing as `HS256`, and sends it. A verifier that
 * takes the algorithm from the token and the key from configuration
 * computes `HMAC(publicKey, token)` — which the attacker could also
 * compute — and accepts.
 *
 * The precondition is always the same: the verifier must be willing to
 * treat its key as a symmetric secret. This package removes that
 * precondition at construction time rather than trying to detect the
 * attack at verify time.
 */
describe('attack: RS256 replayed as HS256 using the public key as the HMAC secret', () => {
  it('LANDS against jose driven the way a reasonable person would drive it', async () => {
    // This test documents the vulnerability we exist to prevent. If it
    // ever starts failing, jose changed its defaults and the note in
    // `resolveAllowlist` should be revisited — but do not delete it:
    // the wrapper's construction-time checks are what the rest of this
    // file asserts, and they only mean something if the underlying
    // hazard is real.
    const { publicKey, spkiPem } = await rsaFixture();
    void publicKey;

    const forged = await forgeSigned(
      { alg: 'HS256' },
      baseClaims({ sub: 'admin' }),
      new TextEncoder().encode(spkiPem),
    );

    // A verifier that loads its PEM with `fs.readFileSync` (a Buffer,
    // which is a Uint8Array) and omits jose's optional `algorithms`.
    const { payload } = await jwtVerify(forged, new TextEncoder().encode(spkiPem));

    expect(payload.sub).toBe('admin');
  });

  it('is refused at construction when the allowlist mixes families', async () => {
    // The sloppy-but-plausible config: "we accept RS256, and HS256 for
    // the legacy service." That single line is the whole attack.
    const { publicKey } = await rsaFixture();

    expect(() =>
      createJwtVerifier({
        algorithms: ['RS256', 'HS256'],
        key: publicKey,
        issuer: ISSUER,
        audience: AUDIENCE,
      }),
    ).toThrow(AuthConfigurationError);

    expect(() =>
      createJwtVerifier({
        algorithms: ['RS256', 'HS256'],
        key: publicKey,
        issuer: ISSUER,
        audience: AUDIENCE,
      }),
    ).toThrow(/mixes symmetric and asymmetric/);
  });

  it('is refused at construction when the "secret" is a PEM document', async () => {
    const { spkiPem } = await rsaFixture();

    // The exact primitive from the landing test above, now rejected
    // with an error that names the real mistake.
    expect(() =>
      createJwtVerifier({
        algorithms: ['HS256'],
        key: new TextEncoder().encode(spkiPem),
        issuer: ISSUER,
        audience: AUDIENCE,
      }),
    ).toThrow(/looks like a PEM document/);
  });

  it('is refused at construction when an asymmetric allowlist gets raw bytes', async () => {
    const { spkiPem } = await rsaFixture();
    // Strip the PEM armour so the PEM-specific check cannot be what
    // catches it — the family check must stand on its own.
    const der = Buffer.from(
      spkiPem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, ''),
      'base64',
    );

    expect(() =>
      createJwtVerifier({
        algorithms: ['RS256'],
        key: der,
        issuer: ISSUER,
        audience: AUDIENCE,
      }),
    ).toThrow(/jose reads as an HMAC secret/);
  });

  it('rejects the forged token at verify time under a correct RS256 config', async () => {
    const { publicKey, spkiPem } = await rsaFixture();
    const forged = await forgeSigned(
      { alg: 'HS256' },
      baseClaims({ sub: 'admin' }),
      new TextEncoder().encode(spkiPem),
    );

    const verifier = createJwtVerifier({
      algorithms: ['RS256'],
      key: publicKey,
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    const result = await verifier.verify(forged);
    expect(isOk(result)).toBe(false);
    if (isErr(result)) expect(result.error.reason).toBe('algorithm_not_allowed');
  });

  it('rejects it with a Node KeyObject public key as well as a CryptoKey', async () => {
    const { spkiPem } = await rsaFixture();
    const keyObject = createPublicKey(spkiPem);
    const forged = await forgeSigned(
      { alg: 'HS256' },
      baseClaims({ sub: 'admin' }),
      new TextEncoder().encode(spkiPem),
    );

    const verifier = createJwtVerifier({
      algorithms: ['RS256'],
      key: keyObject,
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    const result = await verifier.verify(forged);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('algorithm_not_allowed');
  });

  it('rejects a token signed by a *different* RSA key of the same algorithm', async () => {
    // Confusion is not the only substitution attack: an attacker with
    // their own keypair signs a perfectly valid RS256 token. Only the
    // signature check stops this one.
    const victim = await rsaFixture();
    const attacker = await rsaFixture();

    const forged = await forgeSigned(
      { alg: 'RS256' },
      baseClaims({ sub: 'admin' }),
      attacker.privateKey,
    );

    const verifier = createJwtVerifier({
      algorithms: ['RS256'],
      key: victim.publicKey,
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    const result = await verifier.verify(forged);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('signature_invalid');
  });

  it('rejects a swap within the asymmetric family (RS512 where RS256 is expected)', async () => {
    // Hand-forged rather than signed: jose refuses to *produce* an
    // RS512 signature from a key generated for RS256 ("its
    // algorithm.hash must be SHA-512"). That refusal is jose's, on the
    // signing side, and says nothing about what a verifier accepts — so
    // the token is assembled directly, with a signature that is never
    // reached because the allowlist rejects `alg` first.
    const { publicKey } = await rsaFixture();
    const forged = forgeUnsigned({ alg: 'RS512' }, baseClaims(), 'bm90LWEtcmVhbC1zaWc');

    const verifier = createJwtVerifier({
      algorithms: ['RS256'],
      key: publicKey,
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    const result = await verifier.verify(forged);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('algorithm_not_allowed');
  });

  it('refuses a verifier given the private key instead of the public one', async () => {
    const { privateKey } = await rsaFixture();
    expect(() =>
      createJwtVerifier({
        algorithms: ['RS256'],
        key: privateKey,
        issuer: ISSUER,
        audience: AUDIENCE,
      }),
    ).toThrow(/needs the public key/);
  });

  it('refuses an HMAC secret shorter than RFC 7518 §3.2 requires', () => {
    // jose does not enforce this. A four-byte HS256 secret is
    // brute-forceable offline from one captured token.
    expect(() =>
      createJwtVerifier({
        algorithms: ['HS256'],
        key: new Uint8Array(8),
        issuer: ISSUER,
        audience: AUDIENCE,
      }),
    ).toThrow(/at least 32 bytes/);

    expect(() =>
      createJwtVerifier({
        algorithms: ['HS512'],
        key: new Uint8Array(32),
        issuer: ISSUER,
        audience: AUDIENCE,
      }),
    ).toThrow(/at least 64 bytes/);
  });
});
