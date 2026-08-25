import { isErr, isOk, type Result } from '@firstprinciples/core';
import { describe, expect, it, vi } from 'vitest';

import { RefreshTokenError, RefreshTokenStoreError } from '../../src/errors.js';
import {
  createRefreshTokenService,
  type IssuedRefreshToken,
  type RefreshTokenStore,
} from '../../src/refresh.js';
import { createMemoryRefreshTokenStore } from '../../src/stores.js';

/**
 * ATTACK: getting value out of a stolen refresh token.
 *
 * Rotation's whole premise is that a refresh token is used once. That
 * turns theft from a silent, indefinite compromise into a race the
 * attacker cannot win quietly: whichever of the two parties refreshes
 * second presents a token that has already been rotated, and that is
 * the detection. It only works if replay revokes the **entire family**
 * — revoking just the replayed token leaves whoever holds the current
 * one, quite possibly the attacker, logged in.
 */

function service(
  store: RefreshTokenStore = createMemoryRefreshTokenStore(),
  overrides: { ttlSeconds?: number; absoluteTtlSeconds?: number; maxRetries?: number } = {},
): ReturnType<typeof createRefreshTokenService> {
  return createRefreshTokenService({
    store,
    ttlSeconds: overrides.ttlSeconds ?? 3600,
    absoluteTtlSeconds: overrides.absoluteTtlSeconds ?? 86_400,
    ...(overrides.maxRetries === undefined ? {} : { maxRetries: overrides.maxRetries }),
  });
}

function reasonOf(result: Result<IssuedRefreshToken, RefreshTokenError>): string {
  return isErr(result) ? result.error.reason : 'ok';
}

describe('attack: replaying a stolen refresh token', () => {
  it('victim refreshes first, then the attacker replays — family dies', async () => {
    const refresh = service();
    const original = await refresh.issue({ subject: 'user-1' });

    // The attacker copies the token off the wire and sits on it.
    const stolen = original.token;

    // The legitimate client refreshes normally.
    const victim = await refresh.rotate(original.token);
    expect(isOk(victim)).toBe(true);
    if (!isOk(victim)) return;

    // The attacker plays their copy.
    const replay = await refresh.rotate(stolen);
    expect(reasonOf(replay)).toBe('reused');

    // And the victim's freshly issued token is dead too — that is the
    // family revocation, and it is the whole point. Revoking only the
    // replayed token would have left the attacker's next rotation
    // working if they had been the one to refresh first.
    expect(reasonOf(await refresh.rotate(victim.value.token))).toBe('revoked');
  });

  it('attacker refreshes first, then the victim — family still dies', async () => {
    // The mirror case, and the one that actually protects the user: the
    // attacker got in first and holds a live token, but the moment the
    // real client refreshes, its now-stale token trips detection and
    // the attacker is evicted along with everyone else.
    const refresh = service();
    const original = await refresh.issue({ subject: 'user-1' });
    const victimsCopy = original.token;

    const attacker = await refresh.rotate(original.token);
    expect(isOk(attacker)).toBe(true);
    if (!isOk(attacker)) return;

    expect(reasonOf(await refresh.rotate(victimsCopy))).toBe('reused');
    expect(reasonOf(await refresh.rotate(attacker.value.token))).toBe('revoked');
  });

  it('leaves no window where the old token is still accepted', async () => {
    const refresh = service();
    const first = await refresh.issue({ subject: 'user-1' });
    const rotated = await refresh.rotate(first.token);
    if (!isOk(rotated)) throw new Error('expected a rotation');

    // The old one is refused on the very next call, and the new one
    // works on the very next call. Both properties come from the same
    // single write.
    expect(reasonOf(await refresh.rotate(first.token))).toBe('reused');
  });

  it('leaves no window where neither token is accepted', async () => {
    const refresh = service();
    const first = await refresh.issue({ subject: 'user-1' });
    const rotated = await refresh.rotate(first.token);
    if (!isOk(rotated)) throw new Error('expected a rotation');

    const next = await refresh.rotate(rotated.value.token);
    expect(isOk(next)).toBe(true);
  });

  it('detects a replay from many rotations ago', async () => {
    const refresh = service();
    const first = await refresh.issue({ subject: 'user-1' });

    let current = first.token;
    for (let i = 0; i < 10; i += 1) {
      const next = await refresh.rotate(current);
      if (!isOk(next)) throw new Error('expected a rotation');
      current = next.value.token;
    }

    expect(reasonOf(await refresh.rotate(first.token))).toBe('reused');
    expect(reasonOf(await refresh.rotate(current))).toBe('revoked');
  });

  it('does not revoke on a guessed token that was never issued', async () => {
    // An attacker who knows a family id — or a client with a corrupted
    // cookie — must not be able to end a session by sending rubbish.
    const refresh = service();
    const issued = await refresh.issue({ subject: 'user-1' });
    const guess = `${issued.familyId}.${'A'.repeat(43)}`;

    expect(reasonOf(await refresh.rotate(guess))).toBe('unknown_token');
    // The real token still works.
    expect(isOk(await refresh.rotate(issued.token))).toBe(true);
  });
});

describe('attack: two clients presenting the same token at once', () => {
  it('lets exactly one through and revokes the family for the other', async () => {
    const refresh = service();
    const issued = await refresh.issue({ subject: 'user-1' });

    const [a, b] = await Promise.all([refresh.rotate(issued.token), refresh.rotate(issued.token)]);

    const outcomes = [reasonOf(a), reasonOf(b)].sort();
    expect(outcomes).toEqual(['ok', 'reused']);

    // Whichever one won, its token is dead: the loser's retry detected
    // reuse and took the family with it. Indistinguishable from theft
    // from where the server stands, which is why it is treated as theft.
    const winner = isOk(a) ? a.value.token : isOk(b) ? b.value.token : undefined;
    expect(winner).toBeDefined();
    expect(reasonOf(await refresh.rotate(winner as string))).toBe('revoked');
  });

  it('holds with ten concurrent attempts, and alerts exactly once', async () => {
    const refresh = service();
    const issued = await refresh.issue({ subject: 'user-1' });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => refresh.rotate(issued.token)),
    );

    const tally = results.reduce<Record<string, number>>((counts, result) => {
      const reason = reasonOf(result);
      // Keys come from this module's own reason strings, not from input.
      // eslint-disable-next-line security/detect-object-injection
      return { ...counts, [reason]: (counts[reason] ?? 0) + 1 };
    }, {});

    // Exactly one rotation succeeds. Exactly one loser is the *first*
    // to notice, and it revokes the family. Every later loser finds a
    // family that is already dead and says so — which is the
    // "`reused` fires once per family" property holding under
    // concurrency rather than emitting nine identical alerts for one
    // incident.
    expect(tally).toEqual({ ok: 1, reused: 1, revoked: 8 });
  });

  it('really does race — the losers go through the compare-and-set retry', async () => {
    // Without this the concurrency tests above could be passing for the
    // wrong reason: if the awaits never interleaved, each rotation
    // would run to completion in turn and the second would simply see a
    // rotated token, exercising none of the retry path. Counting the
    // failed writes proves the race is real.
    const inner = createMemoryRefreshTokenStore();
    let lostRaces = 0;
    const counting: RefreshTokenStore = {
      read: (id) => inner.read(id),
      create: (family) => inner.create(family),
      async compareAndSet(family, revision) {
        const written = await inner.compareAndSet(family, revision);
        if (!written) lostRaces += 1;
        return written;
      },
      delete: (id) => inner.delete(id),
    };

    const refresh = service(counting);
    const issued = await refresh.issue({ subject: 'user-1' });
    await Promise.all([refresh.rotate(issued.token), refresh.rotate(issued.token)]);

    expect(lostRaces).toBeGreaterThan(0);
  });

  it('concurrent rotations of *different* families do not interfere', async () => {
    const refresh = service();
    const families = await Promise.all([
      refresh.issue({ subject: 'user-1' }),
      refresh.issue({ subject: 'user-2' }),
      refresh.issue({ subject: 'user-3' }),
    ]);

    const results = await Promise.all(families.map((f) => refresh.rotate(f.token)));

    expect(results.every(isOk)).toBe(true);
    expect(results.filter(isOk).map((r) => r.value.subject)).toEqual([
      'user-1',
      'user-2',
      'user-3',
    ]);
  });
});

describe('contention that never settles', () => {
  it('throws rather than returning an auth failure', async () => {
    // A store that always reports a lost race. This is infrastructure
    // misbehaving, not a bad credential — the caller should retry the
    // request, and telling them to re-authenticate the user would be
    // wrong. Hence a throw, not an `Err`.
    const inner = createMemoryRefreshTokenStore();
    const hostile: RefreshTokenStore = {
      read: (id) => inner.read(id),
      create: (family) => inner.create(family),
      compareAndSet: () => Promise.resolve(false),
      delete: (id) => inner.delete(id),
    };

    const refresh = service(hostile, { maxRetries: 3 });
    const issued = await refresh.issue({ subject: 'user-1' });

    await expect(refresh.rotate(issued.token)).rejects.toThrow(RefreshTokenStoreError);
    await expect(refresh.rotate(issued.token)).rejects.toThrow(/after 3 attempts/);
  });

  it('gives up after exactly maxRetries reads', async () => {
    const inner = createMemoryRefreshTokenStore();
    const reads = vi.fn(inner.read);
    const hostile: RefreshTokenStore = {
      read: reads,
      create: (family) => inner.create(family),
      compareAndSet: () => Promise.resolve(false),
      delete: (id) => inner.delete(id),
    };

    const refresh = service(hostile, { maxRetries: 2 });
    const issued = await refresh.issue({ subject: 'user-1' });
    reads.mockClear();

    await expect(refresh.rotate(issued.token)).rejects.toThrow(RefreshTokenStoreError);
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('reports 503, not 401', async () => {
    const inner = createMemoryRefreshTokenStore();
    const hostile: RefreshTokenStore = {
      read: (id) => inner.read(id),
      create: (family) => inner.create(family),
      compareAndSet: () => Promise.resolve(false),
      delete: (id) => inner.delete(id),
    };
    const refresh = service(hostile);
    const issued = await refresh.issue({ subject: 'user-1' });

    await refresh.rotate(issued.token).then(
      () => expect.fail('expected a throw'),
      (error: unknown) => {
        expect(error).toBeInstanceOf(RefreshTokenStoreError);
        expect((error as RefreshTokenStoreError).httpStatus).toBe(503);
      },
    );
  });
});
