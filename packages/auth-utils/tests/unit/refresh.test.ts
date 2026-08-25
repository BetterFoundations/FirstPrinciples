import { isErr, isOk, UnauthorizedError } from '@firstprinciples/core';
import { describe, expect, it } from 'vitest';

import {
  AuthConfigurationError,
  RefreshTokenError,
  RefreshTokenStoreError,
} from '../../src/errors.js';
import { createRefreshTokenService, type RefreshTokenStore } from '../../src/refresh.js';
import { createMemoryRefreshTokenStore } from '../../src/stores.js';

const HOUR = 3600;
const DAY = 86_400;

function build(
  overrides: Partial<Parameters<typeof createRefreshTokenService>[0]> = {},
): ReturnType<typeof createRefreshTokenService> {
  return createRefreshTokenService({
    store: createMemoryRefreshTokenStore(),
    ttlSeconds: HOUR,
    absoluteTtlSeconds: DAY,
    ...overrides,
  });
}

describe('issue', () => {
  it('returns a token, its family, the subject and both deadlines', async () => {
    const at = Date.UTC(2030, 0, 1);
    const refresh = build({ clock: () => at });
    const issued = await refresh.issue({ subject: 'user-1' });

    expect(issued.token).toContain('.');
    expect(issued.familyId).toBeTruthy();
    expect(issued.subject).toBe('user-1');
    expect(issued.expiresAt).toBe(at + HOUR * 1000);
    expect(issued.familyExpiresAt).toBe(at + DAY * 1000);
  });

  it('starts a distinct family every time', async () => {
    const refresh = build();
    const [a, b] = await Promise.all([
      refresh.issue({ subject: 'user-1' }),
      refresh.issue({ subject: 'user-1' }),
    ]);

    expect(a.familyId).not.toBe(b.familyId);
    // Two independent sessions for one user: rotating one must not
    // touch the other.
    expect(isOk(await refresh.rotate(a.token))).toBe(true);
    expect(isOk(await refresh.rotate(b.token))).toBe(true);
  });

  it('never lets a token outlive its family', async () => {
    const at = Date.UTC(2030, 0, 1);
    const refresh = createRefreshTokenService({
      store: createMemoryRefreshTokenStore({ clock: () => at }),
      ttlSeconds: HOUR,
      absoluteTtlSeconds: HOUR, // equal, so the first token is already at the ceiling
      clock: () => at,
    });

    const issued = await refresh.issue({ subject: 'user-1' });
    expect(issued.expiresAt).toBe(issued.familyExpiresAt);
  });

  it.each([[''], [null], [undefined], [42]])('rejects the subject %p', async (subject) => {
    await expect(build().issue({ subject: subject as never })).rejects.toThrow(
      AuthConfigurationError,
    );
  });

  it('refuses rather than overwriting if the family id already exists', async () => {
    const inner = createMemoryRefreshTokenStore();
    const colliding: RefreshTokenStore = {
      read: (id) => inner.read(id),
      create: () => Promise.resolve(false),
      compareAndSet: (family, revision) => inner.compareAndSet(family, revision),
      delete: (id) => inner.delete(id),
    };

    await expect(build({ store: colliding }).issue({ subject: 'user-1' })).rejects.toThrow(
      RefreshTokenStoreError,
    );
  });
});

describe('rotate', () => {
  it('carries the subject through so the caller can mint an access token', async () => {
    const refresh = build();
    const issued = await refresh.issue({ subject: 'user-42' });
    const rotated = await refresh.rotate(issued.token);

    expect(isOk(rotated)).toBe(true);
    if (isOk(rotated)) {
      expect(rotated.value.subject).toBe('user-42');
      expect(rotated.value.familyId).toBe(issued.familyId);
      expect(rotated.value.token).not.toBe(issued.token);
    }
  });

  it.each([
    ['an empty string', ''],
    ['no separator', 'abcdef'],
    ['nothing after the separator', 'family.'],
    ['nothing before the separator', '.secret'],
    ['two separators', 'family.secret.extra'],
  ])('rejects %s as malformed', async (_label, token) => {
    const result = await build().rotate(token);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('malformed');
  });

  it.each([[null], [undefined], [42], [{}]])(
    'rejects the non-string token %p as malformed',
    async (token) => {
      const result = await build().rotate(token as never);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.reason).toBe('malformed');
    },
  );

  it('reports an unknown family', async () => {
    const result = await build().rotate('nosuchfamily.nosuchsecret');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('unknown_family');
  });

  it('reports an expired token', async () => {
    let now = Date.UTC(2030, 0, 1);
    const store = createMemoryRefreshTokenStore({ clock: () => now });
    const refresh = createRefreshTokenService({
      store,
      ttlSeconds: 60,
      absoluteTtlSeconds: DAY,
      clock: () => now,
    });

    const issued = await refresh.issue({ subject: 'user-1' });
    now += 61_000;

    const result = await refresh.rotate(issued.token);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('expired');
  });

  it('reports a family past its absolute lifetime', async () => {
    let now = Date.UTC(2030, 0, 1);
    // The store must not evict the family before the service can judge
    // it, or this would surface as `unknown_family` instead.
    const families = new Map<string, { family: unknown; revision: number }>();
    const store: RefreshTokenStore = {
      read: (id) => Promise.resolve(families.get(id) as never),
      create: (family) => {
        families.set(family.id, { family, revision: 1 });
        return Promise.resolve(true);
      },
      compareAndSet: (family, revision) => {
        const entry = families.get(family.id);
        if (entry === undefined || entry.revision !== revision) return Promise.resolve(false);
        families.set(family.id, { family, revision: entry.revision + 1 });
        return Promise.resolve(true);
      },
      delete: (id) => {
        families.delete(id);
        return Promise.resolve();
      },
    };

    const refresh = createRefreshTokenService({
      store,
      ttlSeconds: 60,
      absoluteTtlSeconds: 120,
      clock: () => now,
    });

    const issued = await refresh.issue({ subject: 'user-1' });
    now += 121_000;

    const result = await refresh.rotate(issued.token);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('family_expired');
  });

  it('keeps rotating happily across a long session', async () => {
    const refresh = build();
    const issued = await refresh.issue({ subject: 'user-1' });

    let token = issued.token;
    for (let i = 0; i < 25; i += 1) {
      const next = await refresh.rotate(token);
      if (!isOk(next)) throw new Error(`rotation ${i} failed`);
      expect(next.value.familyId).toBe(issued.familyId);
      token = next.value.token;
    }
  });
});

describe('revoke', () => {
  it('kills the family a token belongs to', async () => {
    const refresh = build();
    const issued = await refresh.issue({ subject: 'user-1' });

    await refresh.revoke(issued.token);

    const result = await refresh.rotate(issued.token);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('revoked');
  });

  it('is idempotent, so a retried logout does not error', async () => {
    const refresh = build();
    const issued = await refresh.issue({ subject: 'user-1' });

    await refresh.revoke(issued.token);
    await expect(refresh.revoke(issued.token)).resolves.toBeUndefined();
    await expect(refresh.revoke(issued.token)).resolves.toBeUndefined();
  });

  it('quietly succeeds for a malformed or unknown token', async () => {
    // Logging out of a session that is already gone is the desired end
    // state, not an error worth surfacing to a client that is leaving.
    const refresh = build();
    await expect(refresh.revoke('garbage')).resolves.toBeUndefined();
    await expect(refresh.revoke('nosuch.family')).resolves.toBeUndefined();
  });

  it('revokes by family id, for an admin action or password change', async () => {
    const refresh = build();
    const issued = await refresh.issue({ subject: 'user-1' });

    await refresh.revokeFamily(issued.familyId);

    const result = await refresh.rotate(issued.token);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('revoked');
  });

  it('does not touch other families of the same subject', async () => {
    const refresh = build();
    const laptop = await refresh.issue({ subject: 'user-1' });
    const phone = await refresh.issue({ subject: 'user-1' });

    await refresh.revoke(laptop.token);

    expect(isErr(await refresh.rotate(laptop.token))).toBe(true);
    expect(isOk(await refresh.rotate(phone.token))).toBe(true);
  });

  it('throws if it cannot settle', async () => {
    const inner = createMemoryRefreshTokenStore();
    const hostile: RefreshTokenStore = {
      read: (id) => inner.read(id),
      create: (family) => inner.create(family),
      compareAndSet: () => Promise.resolve(false),
      delete: (id) => inner.delete(id),
    };
    const refresh = build({ store: hostile, maxRetries: 2 });
    const issued = await refresh.issue({ subject: 'user-1' });

    await expect(refresh.revoke(issued.token)).rejects.toThrow(RefreshTokenStoreError);
  });
});

describe('errors', () => {
  it('are UnauthorizedErrors carrying a reason and a 401', async () => {
    const result = await build().rotate('nosuchfamily.nosuchsecret');
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;

    expect(result.error).toBeInstanceOf(RefreshTokenError);
    expect(result.error).toBeInstanceOf(UnauthorizedError);
    expect(result.error.kind).toBe('UnauthorizedError');
    expect(result.error.name).toBe('RefreshTokenError');
    expect(result.error.httpStatus).toBe(401);
    expect(result.error.code).toBe('REFRESH_UNKNOWN_FAMILY');
    expect(result.error.details.reason).toBe('unknown_family');
  });

  it('never echo the token', async () => {
    const marker = 'SUPER-SECRET-TOKEN-VALUE';
    const result = await build().rotate(`family.${marker}`);
    if (isErr(result)) expect(result.error.message).not.toContain(marker);
  });

  it('give every reason a distinct message', async () => {
    const reasons = [
      'malformed',
      'unknown_family',
      'unknown_token',
      'expired',
      'family_expired',
      'revoked',
      'reused',
    ] as const;

    const messages = new Set(reasons.map((r) => new RefreshTokenError(r, r).message));
    expect(messages.size).toBe(reasons.length);
  });
});

describe('configuration', () => {
  it.each([
    ['a missing store', { store: undefined }],
    ['a store missing methods', { store: { read: () => undefined } }],
    ['a zero ttl', { ttlSeconds: 0 }],
    ['a non-integer ttl', { ttlSeconds: 1.5 }],
    ['a zero absolute ttl', { absoluteTtlSeconds: 0 }],
    ['a zero chain length', { maxChainLength: 0 }],
    ['a zero retry count', { maxRetries: 0 }],
  ])('rejects %s', (_label, override) => {
    expect(() => build(override as never)).toThrow(AuthConfigurationError);
  });

  it('rejects an absolute lifetime shorter than the per-token one', () => {
    // Every issued token would already be past the family deadline, so
    // nothing would ever verify.
    expect(() => build({ ttlSeconds: DAY, absoluteTtlSeconds: HOUR })).toThrow(
      /shorter than `ttlSeconds`/,
    );
  });
});
