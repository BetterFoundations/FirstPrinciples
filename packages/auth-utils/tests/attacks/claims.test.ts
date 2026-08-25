import { isErr, isOk } from '@firstprinciples/core';
import { jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';

import { createJwtSigner, createJwtVerifier, MAX_CLOCK_TOLERANCE_SECONDS } from '../../src/jwt.js';
import { AUDIENCE, baseClaims, forgeSigned, ISSUER, omitClaim, rsaFixture } from './_harness.js';

const NOW = Math.floor(Date.now() / 1000);

async function attackScenario(): Promise<{
  sign: (claims: Record<string, unknown>) => Promise<string>;
  verifier: ReturnType<typeof createJwtVerifier>;
}> {
  const { publicKey, privateKey } = await rsaFixture();
  return {
    sign: (claims) => forgeSigned({ alg: 'RS256', typ: 'JWT' }, claims, privateKey),
    verifier: createJwtVerifier({
      algorithms: ['RS256'],
      key: publicKey,
      issuer: ISSUER,
      audience: AUDIENCE,
    }),
  };
}

/**
 * ATTACK: replaying a token whose claims say it should not be accepted.
 *
 * Every token here carries a **valid signature from the real signing
 * key** — that is what makes these worth testing. The signature is not
 * what stops them; claim validation is. A verifier that checks the
 * signature and stops has accepted an expired session, another
 * service's token, or a credential that was never meant to be live yet.
 */
describe('attack: expired token (exp)', () => {
  it('rejects a token that expired an hour ago', async () => {
    const { sign, verifier } = await attackScenario();
    const token = await sign(baseClaims({ iat: NOW - 7200, exp: NOW - 3600 }));

    const result = await verifier.verify(token);
    expect(isOk(result)).toBe(false);
    if (isErr(result)) {
      expect(result.error.reason).toBe('expired');
      expect(result.error.code).toBe('JWT_EXPIRED');
    }
  });

  it('rejects a token that expired one second ago', async () => {
    // The boundary is where an off-by-one lives.
    const { sign, verifier } = await attackScenario();
    const result = await verifier.verify(await sign(baseClaims({ exp: NOW - 1 })));

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('expired');
  });

  it('LANDS against jose: a token with no exp at all verifies forever', async () => {
    // Documents the second real gap this package closes. jose does not
    // require `exp`; a token minted without one is a permanent bearer
    // credential.
    const { publicKey, privateKey } = await rsaFixture();
    const noExp = await forgeSigned(
      { alg: 'RS256' },
      { sub: 'admin', iss: ISSUER, aud: AUDIENCE, iat: NOW - 31_536_000 },
      privateKey,
    );

    const { payload } = await jwtVerify(noExp, publicKey, {
      algorithms: ['RS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    expect(payload.sub).toBe('admin');
  });

  it('rejects a token with no exp, because exp is required by default', async () => {
    const { sign, verifier } = await attackScenario();
    const result = await verifier.verify(await sign(omitClaim(baseClaims(), 'exp')));

    expect(isErr(result)).toBe(true);
    // Reported as `expired` rather than `claims_invalid`, and that is
    // the honest label: a token with no expiry is not a token that
    // might still be fresh, it is one that can never stop being fresh.
    // A client seeing `JWT_EXPIRED` re-authenticates, which is exactly
    // the right response.
    if (isErr(result)) expect(result.error.reason).toBe('expired');
  });

  it('can be opted out of, for the deployment that genuinely needs it', async () => {
    const { publicKey, privateKey } = await rsaFixture();
    const forged = await forgeSigned({ alg: 'RS256' }, omitClaim(baseClaims(), 'exp'), privateKey);

    const verifier = createJwtVerifier({
      algorithms: ['RS256'],
      key: publicKey,
      issuer: ISSUER,
      audience: AUDIENCE,
      requireExpiration: false,
    });

    expect(isOk(await verifier.verify(forged))).toBe(true);
  });

  it('does not let clock tolerance be widened past the cap', async () => {
    const { publicKey } = await rsaFixture();
    expect(() =>
      createJwtVerifier({
        algorithms: ['RS256'],
        key: publicKey,
        issuer: ISSUER,
        audience: AUDIENCE,
        clockToleranceSeconds: MAX_CLOCK_TOLERANCE_SECONDS + 1,
      }),
    ).toThrow(/above the 300s cap/);
  });

  it('honours clock tolerance within the cap, and only within it', async () => {
    const { publicKey, privateKey } = await rsaFixture();
    const tolerant = createJwtVerifier({
      algorithms: ['RS256'],
      key: publicKey,
      issuer: ISSUER,
      audience: AUDIENCE,
      clockToleranceSeconds: 60,
    });

    const token = (exp: number): Promise<string> =>
      forgeSigned({ alg: 'RS256' }, baseClaims({ exp }), privateKey);

    // 30s past expiry, inside a 60s tolerance: accepted.
    expect(isOk(await tolerant.verify(await token(NOW - 30)))).toBe(true);
    // 120s past expiry, outside it: rejected.
    expect(isErr(await tolerant.verify(await token(NOW - 120)))).toBe(true);
  });

  it('rejects at expiry with the default zero tolerance', async () => {
    const { sign, verifier } = await attackScenario();
    expect(isErr(await verifier.verify(await sign(baseClaims({ exp: NOW - 5 }))))).toBe(true);
  });
});

describe('attack: not-yet-valid token (nbf)', () => {
  it('rejects a token whose nbf is an hour in the future', async () => {
    const { sign, verifier } = await attackScenario();
    const token = await sign(baseClaims({ nbf: NOW + 3600, exp: NOW + 7200 }));

    const result = await verifier.verify(token);
    expect(isOk(result)).toBe(false);
    if (isErr(result)) {
      expect(result.error.reason).toBe('not_yet_valid');
      expect(result.error.code).toBe('JWT_NOT_YET_VALID');
    }
  });

  it('rejects a token whose nbf is one second in the future', async () => {
    const { sign, verifier } = await attackScenario();
    const result = await verifier.verify(await sign(baseClaims({ nbf: NOW + 60 })));

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('not_yet_valid');
  });

  it('accepts a token whose nbf has passed', async () => {
    const { sign, verifier } = await attackScenario();
    expect(isOk(await verifier.verify(await sign(baseClaims({ nbf: NOW - 60 }))))).toBe(true);
  });
});

describe('attack: wrong issuer', () => {
  it('rejects a validly-signed token from a different issuer', async () => {
    const { sign, verifier } = await attackScenario();
    const token = await sign(baseClaims({ iss: 'https://evil.test' }));

    const result = await verifier.verify(token);
    expect(isOk(result)).toBe(false);
    if (isErr(result)) {
      expect(result.error.reason).toBe('issuer_mismatch');
      expect(result.error.code).toBe('JWT_ISSUER_MISMATCH');
    }
  });

  it('rejects a prefix-extension of the real issuer', async () => {
    // `https://issuer.test.evil.com` starts with the real issuer. A
    // `startsWith` check would pass it.
    const { sign, verifier } = await attackScenario();
    const result = await verifier.verify(await sign(baseClaims({ iss: `${ISSUER}.evil.com` })));

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('issuer_mismatch');
  });

  it('rejects a token with no iss claim at all', async () => {
    const { sign, verifier } = await attackScenario();
    const result = await verifier.verify(await sign(omitClaim(baseClaims(), 'iss')));

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(['issuer_mismatch', 'claims_invalid']).toContain(result.error.reason);
    }
  });

  it('accepts any issuer on a configured multi-issuer list, and nothing else', async () => {
    const { publicKey, privateKey } = await rsaFixture();
    const verifier = createJwtVerifier({
      algorithms: ['RS256'],
      key: publicKey,
      issuer: [ISSUER, 'https://second-issuer.test'],
      audience: AUDIENCE,
    });
    const sign = (iss: string): Promise<string> =>
      forgeSigned({ alg: 'RS256' }, baseClaims({ iss }), privateKey);

    expect(isOk(await verifier.verify(await sign('https://second-issuer.test')))).toBe(true);
    expect(isErr(await verifier.verify(await sign('https://third-issuer.test')))).toBe(true);
  });
});

describe('attack: wrong audience', () => {
  it('rejects a validly-signed token minted for another service', async () => {
    // The realistic version: the same identity provider signs tokens
    // for `billing` and for `admin`, with the same key. A verifier that
    // skips `aud` lets a billing token administer the system.
    const { sign, verifier } = await attackScenario();
    const token = await sign(baseClaims({ aud: 'https://other-service.test' }));

    const result = await verifier.verify(token);
    expect(isOk(result)).toBe(false);
    if (isErr(result)) {
      expect(result.error.reason).toBe('audience_mismatch');
      expect(result.error.code).toBe('JWT_AUDIENCE_MISMATCH');
    }
  });

  it('rejects a token with no aud claim at all', async () => {
    const { sign, verifier } = await attackScenario();
    const result = await verifier.verify(await sign(omitClaim(baseClaims(), 'aud')));

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(['audience_mismatch', 'claims_invalid']).toContain(result.error.reason);
    }
  });

  it('rejects an aud array that does not include this service', async () => {
    const { sign, verifier } = await attackScenario();
    const result = await verifier.verify(
      await sign(baseClaims({ aud: ['https://a.test', 'https://b.test'] })),
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('audience_mismatch');
  });

  it('accepts an aud array that does include this service', async () => {
    const { sign, verifier } = await attackScenario();
    const result = await verifier.verify(
      await sign(baseClaims({ aud: ['https://a.test', AUDIENCE] })),
    );

    expect(isOk(result)).toBe(true);
  });
});

describe('attack: claim injection through the signer', () => {
  it('cannot widen its own audience or push out its own expiry', async () => {
    // A handler that spreads user-controlled data into the claims it
    // signs. The registered claims must win.
    const { publicKey, privateKey } = await rsaFixture();
    // A pinned clock, so the expiry assertion is exact rather than
    // "within a second of whenever this line happened to run".
    const issuedAt = Date.UTC(2030, 0, 1);
    const signer = createJwtSigner({
      algorithm: 'RS256',
      key: privateKey,
      issuer: ISSUER,
      audience: AUDIENCE,
      ttlSeconds: 60,
      clock: () => issuedAt,
    });

    const token = await signer.sign({
      sub: 'user-1',
      aud: 'https://admin.test',
      exp: Math.floor(issuedAt / 1000) + 31_536_000,
      nbf: Math.floor(issuedAt / 1000) + 31_536_000,
      iss: 'https://evil.test',
      jti: 'attacker-chosen',
      role: 'viewer',
    } as never);

    const verifier = createJwtVerifier({
      algorithms: ['RS256'],
      key: publicKey,
      issuer: ISSUER,
      audience: AUDIENCE,
      clock: () => issuedAt + 1000,
    });

    const result = await verifier.verify(token);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.claims.aud).toEqual([AUDIENCE]);
      expect(result.value.claims.iss).toBe(ISSUER);
      expect(result.value.claims.exp).toBe(Math.floor(issuedAt / 1000) + 60);
      // An attacker-supplied `nbf` is dropped rather than honoured —
      // otherwise the token above would not have verified at all.
      expect(result.value.claims.nbf).toBeUndefined();
      expect(result.value.claims.jti).not.toBe('attacker-chosen');
      expect(result.value.claims.role).toBe('viewer');
    }
  });
});
