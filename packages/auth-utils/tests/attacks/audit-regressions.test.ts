import { isErr, isOk } from '@firstprinciples/core';
import { SignJWT, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';

import { RefreshTokenStoreError } from '../../src/errors.js';
import { createJwtSigner, createJwtVerifier } from '../../src/jwt.js';
import { createRefreshTokenService, type RefreshTokenStore } from '../../src/refresh.js';
import { createMemoryRefreshTokenStore } from '../../src/stores.js';
import { AUDIENCE, hmacSecret, ISSUER } from './_harness.js';

/**
 * Regressions from the adversarial review of this package.
 *
 * Each test here was written against the *unfixed* code and observed to
 * fail. That is the only thing that makes a security test worth
 * keeping: a test that has never seen the bug it guards is a claim, not
 * a check.
 */

/* ────────────────────────────────────────────────────────────────────
   AUDIT-1 — `sub` was typed `string` but never required at runtime.
   ──────────────────────────────────────────────────────────────────── */

describe('AUDIT-1: a verified token must actually carry a subject', () => {
  const verifier = (): ReturnType<typeof createJwtVerifier> =>
    createJwtVerifier({
      algorithms: ['HS256'],
      key: hmacSecret(),
      issuer: ISSUER,
      audience: AUDIENCE,
    });

  /** Mints with the real key — this is not a forgery, it is a valid signature. */
  const signWith = async (claims: Record<string, unknown>): Promise<string> => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(hmacSecret());
  };

  it('rejects a correctly-signed token with no `sub` at all', async () => {
    // The scenario is not a forged token — it is any *other* holder of
    // the signing key minting one without a subject: an SDK, a legacy
    // service, a migration script. Before the fix this verified, and
    // `claims.sub` came back `undefined` through a `string` type, so a
    // handler doing `loadUser(claims.sub)` looked up `undefined`.
    const result = await verifier().verify(await signWith({ role: 'admin' }));

    expect(isOk(result)).toBe(false);
    if (isErr(result)) expect(result.error.reason).toBe('claims_invalid');
  });

  it('rejects a `sub` that is present but empty', async () => {
    const result = await verifier().verify(await signWith({ sub: '' }));
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('claims_invalid');
  });

  it.each([42, null, true, { id: 'x' }, ['x']])(
    'rejects a non-string `sub` (%j), which `requiredClaims` alone would pass',
    async (sub) => {
      const result = await verifier().verify(await signWith({ sub }));
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.reason).toBe('claims_invalid');
    },
  );

  it('still accepts a normal token, and `sub` is a real string', async () => {
    const signer = createJwtSigner({
      algorithm: 'HS256',
      key: hmacSecret(),
      issuer: ISSUER,
      audience: AUDIENCE,
      ttlSeconds: 300,
    });

    const result = await verifier().verify(await signer.sign({ sub: 'user-1' }));
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.claims.sub).toBe('user-1');
      expect(typeof result.value.claims.sub).toBe('string');
    }
  });

  it('holds for an asymmetric verifier too', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);

    const result = await createJwtVerifier({
      algorithms: ['RS256'],
      key: publicKey,
      issuer: ISSUER,
      audience: AUDIENCE,
    }).verify(token);

    expect(isErr(result)).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────
   AUDIT-2 — a detected replay was discarded if its write lost a race.
   ──────────────────────────────────────────────────────────────────── */

describe('AUDIT-2: a detected replay survives a lost compare-and-set', () => {
  /**
   * A store whose next `n` writes lose their race, as they would if
   * other requests kept winning, and which then behaves normally.
   * Transient contention is the realistic shape of this: a permanently
   * write-rejecting store is a different failure, covered separately.
   */
  function raceable(): { store: RefreshTokenStore; loseNext: (n: number) => void } {
    const inner = createMemoryRefreshTokenStore();
    let remaining = 0;
    return {
      loseNext: (n) => {
        remaining = n;
      },
      store: {
        read: (id) => inner.read(id),
        create: (family) => inner.create(family),
        compareAndSet: (family, revision) => {
          if (remaining > 0) {
            remaining -= 1;
            return Promise.resolve(false);
          }
          return inner.compareAndSet(family, revision);
        },
        delete: (id) => inner.delete(id),
      },
    };
  }

  it.each([1, 3])(
    'reports `reused` and revokes the family after exhausting maxRetries=%i',
    async (maxRetries) => {
      const { store, loseNext } = raceable();
      const refresh = createRefreshTokenService({
        store,
        ttlSeconds: 3600,
        absoluteTtlSeconds: 86_400,
        maxRetries,
      });

      const stolen = await refresh.issue({ subject: 'user-1' });
      const live = await refresh.rotate(stolen.token);
      if (!isOk(live)) throw new Error('setup: expected a rotation');

      // The attacker replays the rotated token, and every write the
      // rotate loop attempts loses to a racing one. Before the fix the
      // retry budget ran out, a RefreshTokenStoreError was thrown, the
      // family stayed live, and the one alert that fires per compromise
      // never fired.
      loseNext(maxRetries);
      const replay = await refresh.rotate(stolen.token);

      expect(isErr(replay)).toBe(true);
      if (isErr(replay)) expect(replay.error.reason).toBe('reused');

      // The compromise is contained: the token the victim is holding is
      // dead too, which is the entire point of family revocation.
      const after = await refresh.rotate(live.value.token);
      expect(isErr(after)).toBe(true);
      if (isErr(after)) expect(after.error.reason).toBe('revoked');
    },
  );

  it('still reports `reused` when the store never accepts the revoking write', async () => {
    // The honest limit of the fix. If no write can land, the family
    // cannot be revoked — but the caller must still be told this was a
    // replay rather than a transient outage, because that reason is the
    // alert. Reporting 503 here is what let the incident pass silently.
    const inner = createMemoryRefreshTokenStore();
    let refuseWrites = false;
    const store: RefreshTokenStore = {
      read: (id) => inner.read(id),
      create: (family) => inner.create(family),
      compareAndSet: (family, revision) =>
        refuseWrites ? Promise.resolve(false) : inner.compareAndSet(family, revision),
      delete: (id) => inner.delete(id),
    };
    const refresh = createRefreshTokenService({
      store,
      ttlSeconds: 3600,
      absoluteTtlSeconds: 86_400,
      maxRetries: 2,
    });

    const stolen = await refresh.issue({ subject: 'user-1' });
    if (!isOk(await refresh.rotate(stolen.token))) throw new Error('setup');

    refuseWrites = true;
    const replay = await refresh.rotate(stolen.token);

    expect(isErr(replay)).toBe(true);
    if (isErr(replay)) expect(replay.error.reason).toBe('reused');
  });

  it('still throws for contention on an ordinary rotation, which is not a security event', async () => {
    // The fix must not turn every unsettled write into a fake auth
    // failure. A *valid* token that cannot be rotated is infrastructure
    // failing, and the caller should retry rather than sign the user out.
    const { store, loseNext } = raceable();
    const refresh = createRefreshTokenService({
      store,
      ttlSeconds: 3600,
      absoluteTtlSeconds: 86_400,
      maxRetries: 2,
    });

    const issued = await refresh.issue({ subject: 'user-1' });
    loseNext(Number.MAX_SAFE_INTEGER);
    await expect(refresh.rotate(issued.token)).rejects.toThrow(RefreshTokenStoreError);
  });

  it('still fires `reused` exactly once across ten concurrent rotations', async () => {
    // The alert-cardinality property from `refresh-rotation.test.ts`,
    // re-asserted here because the fix touches the same branch: losers
    // that find an already-revoked family must report `revoked`, not
    // pile on nine more `reused` alerts for one incident.
    const refresh = createRefreshTokenService({
      store: createMemoryRefreshTokenStore(),
      ttlSeconds: 3600,
      absoluteTtlSeconds: 86_400,
    });
    const issued = await refresh.issue({ subject: 'user-1' });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => refresh.rotate(issued.token)),
    );
    const reasons = results.map((r) => (isErr(r) ? r.error.reason : 'ok'));

    expect(reasons.filter((r) => r === 'reused')).toHaveLength(1);
    expect(reasons.filter((r) => r === 'ok')).toHaveLength(1);
  });
});

/* ────────────────────────────────────────────────────────────────────
   AUDIT-3 — logout revoked on a family id alone, with no possession proof.
   ──────────────────────────────────────────────────────────────────── */

describe('AUDIT-3: logout requires proof the caller holds a token', () => {
  const build = (): {
    refresh: ReturnType<typeof createRefreshTokenService>;
    store: RefreshTokenStore;
  } => {
    const store = createMemoryRefreshTokenStore();
    return {
      store,
      refresh: createRefreshTokenService({
        store,
        ttlSeconds: 3600,
        absoluteTtlSeconds: 86_400,
      }),
    };
  };

  it('ignores a known family id paired with a guessed secret', async () => {
    // `familyId` is returned to the application and documented "safe to
    // log" — so it turns up in access logs, traces, and any redaction
    // that keeps a token's prefix. Before the fix, anyone who had seen
    // one could end that user's session with a single request.
    const { refresh, store } = build();
    const victim = await refresh.issue({ subject: 'victim' });

    await refresh.revoke(`${victim.familyId}.${'A'.repeat(43)}`);

    const stored = await store.read(victim.familyId);
    expect(stored?.family.revokedAt).toBeUndefined();
    expect(isOk(await refresh.rotate(victim.token))).toBe(true);
  });

  it.each([
    ['an empty-ish secret', '.x'],
    ['a secret of the right shape', `.${'B'.repeat(43)}`],
    ['a long secret', `.${'C'.repeat(400)}`],
  ])('ignores %s', async (_label, suffix) => {
    const { refresh, store } = build();
    const victim = await refresh.issue({ subject: 'victim' });

    await refresh.revoke(`${victim.familyId}${suffix}`);

    expect((await store.read(victim.familyId))?.family.revokedAt).toBeUndefined();
  });

  it('still logs out the holder of the current token', async () => {
    const { refresh } = build();
    const issued = await refresh.issue({ subject: 'user-1' });

    await refresh.revoke(issued.token);

    const result = await refresh.rotate(issued.token);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('revoked');
  });

  it('still logs out a client holding a superseded token', async () => {
    // Logout has to stay idempotent for the client that already rotated
    // and is now retrying with the token it had.
    const { refresh, store } = build();
    const first = await refresh.issue({ subject: 'user-1' });
    const second = await refresh.rotate(first.token);
    if (!isOk(second)) throw new Error('setup: expected a rotation');

    await refresh.revoke(first.token);

    expect((await store.read(first.familyId))?.family.revokedAt).toBeDefined();
  });

  it('leaves `revokeFamily` addressable by id, since that is the admin path', async () => {
    const { refresh } = build();
    const issued = await refresh.issue({ subject: 'user-1' });

    await refresh.revokeFamily(issued.familyId);

    const result = await refresh.rotate(issued.token);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('revoked');
  });

  it('does not answer whether a family id exists', async () => {
    // Both calls must be silent no-ops, so the response cannot be used
    // to enumerate live sessions.
    const { refresh } = build();
    const issued = await refresh.issue({ subject: 'user-1' });

    await expect(refresh.revoke(`${issued.familyId}.${'A'.repeat(43)}`)).resolves.toBeUndefined();
    await expect(refresh.revoke(`nosuchfamily.${'A'.repeat(43)}`)).resolves.toBeUndefined();
  });
});
