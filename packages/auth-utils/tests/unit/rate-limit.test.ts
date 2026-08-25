import { describe, expect, it, vi } from 'vitest';

import { AuthConfigurationError, RateLimitStoreError } from '../../src/errors.js';
import { createLoginRateLimiter, type AttemptStore } from '../../src/rate-limit.js';
import { createMemoryAttemptStore } from '../../src/stores.js';

const KEY = 'user-1|203.0.113.4';

function build(
  overrides: Partial<Parameters<typeof createLoginRateLimiter>[0]> = {},
): ReturnType<typeof createLoginRateLimiter> {
  return createLoginRateLimiter({
    store: createMemoryAttemptStore(),
    maxAttempts: 5,
    windowSeconds: 900,
    ...overrides,
  });
}

describe('the counting', () => {
  it('allows a key that has never failed', async () => {
    const decision = await build().check(KEY);
    expect(decision.allowed).toBe(true);
    expect(decision.count).toBe(0);
    expect(decision.remaining).toBe(5);
  });

  it('counts down with each failure and refuses at the limit', async () => {
    const limiter = build();

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const decision = await limiter.recordFailure(KEY);
      expect(decision.allowed).toBe(true);
      expect(decision.count).toBe(attempt);
      expect(decision.remaining).toBe(5 - attempt);
    }

    const fifth = await limiter.recordFailure(KEY);
    expect(fifth.allowed).toBe(false);
    expect(fifth.remaining).toBe(0);
    expect((await limiter.check(KEY)).allowed).toBe(false);
  });

  it('stays refused past the limit rather than wrapping around', async () => {
    const limiter = build({ maxAttempts: 2 });
    for (let i = 0; i < 10; i += 1) await limiter.recordFailure(KEY);

    const decision = await limiter.check(KEY);
    expect(decision.allowed).toBe(false);
    expect(decision.count).toBe(10);
    expect(decision.remaining).toBe(0);
  });

  it('clears the counter on a successful login', async () => {
    const limiter = build({ maxAttempts: 3 });
    await limiter.recordFailure(KEY);
    await limiter.recordFailure(KEY);

    await limiter.recordSuccess(KEY);

    const decision = await limiter.check(KEY);
    expect(decision.allowed).toBe(true);
    expect(decision.count).toBe(0);
  });

  it('keys are independent', async () => {
    const limiter = build({ maxAttempts: 1 });
    await limiter.recordFailure('user-1');

    expect((await limiter.check('user-1')).allowed).toBe(false);
    expect((await limiter.check('user-2')).allowed).toBe(true);
  });
});

describe('the window', () => {
  it('starts at the first failure and is not pushed forward by later ones', async () => {
    // Sliding the expiry on every increment would let a steady attacker
    // hold one window open indefinitely, so the counter never resets.
    let now = Date.UTC(2030, 0, 1);
    const limiter = build({
      store: createMemoryAttemptStore({ clock: () => now }),
      maxAttempts: 5,
      windowSeconds: 100,
      clock: () => now,
    });

    const first = await limiter.recordFailure(KEY);
    const expectedReset = now + 100_000;

    now += 50_000;
    const second = await limiter.recordFailure(KEY);

    expect(first.resetAt).toBe(expectedReset);
    expect(second.resetAt).toBe(expectedReset);
  });

  it('releases the lockout when the window ends', async () => {
    let now = Date.UTC(2030, 0, 1);
    const limiter = build({
      store: createMemoryAttemptStore({ clock: () => now }),
      maxAttempts: 2,
      windowSeconds: 100,
      clock: () => now,
    });

    await limiter.recordFailure(KEY);
    await limiter.recordFailure(KEY);
    expect((await limiter.check(KEY)).allowed).toBe(false);

    now += 100_000;
    expect((await limiter.check(KEY)).allowed).toBe(true);
  });

  it('reports resetAt so a caller can send Retry-After', async () => {
    let now = Date.UTC(2030, 0, 1);
    const limiter = build({
      store: createMemoryAttemptStore({ clock: () => now }),
      maxAttempts: 1,
      windowSeconds: 60,
      clock: () => now,
    });

    const decision = await limiter.recordFailure(KEY);
    expect(decision.allowed).toBe(false);
    expect(decision.resetAt).toBe(now + 60_000);
  });
});

describe('when the store fails', () => {
  const broken: AttemptStore = {
    increment: () => Promise.reject(new Error('redis is down')),
    get: () => Promise.reject(new Error('redis is down')),
    reset: () => Promise.reject(new Error('redis is down')),
  };

  it('fails closed by default', async () => {
    // Deliberately the opposite call to cache-kit's: a limiter is a
    // control, not an optimisation. Failing open would mean anyone who
    // can knock over the store has bought unlimited password guesses.
    const limiter = build({ store: broken });

    await expect(limiter.check(KEY)).rejects.toThrow(RateLimitStoreError);
    await expect(limiter.recordFailure(KEY)).rejects.toThrow(RateLimitStoreError);
  });

  it('reports 503 and keeps the underlying failure as the cause', async () => {
    const limiter = build({ store: broken });
    await limiter.check(KEY).then(
      () => expect.fail('expected a throw'),
      (error: unknown) => {
        expect(error).toBeInstanceOf(RateLimitStoreError);
        expect((error as RateLimitStoreError).httpStatus).toBe(503);
        expect((error as RateLimitStoreError).cause).toBeInstanceOf(Error);
      },
    );
  });

  it('fails open only when told to', async () => {
    const limiter = build({ store: broken, onStoreError: 'allow' });

    expect((await limiter.check(KEY)).allowed).toBe(true);
    expect((await limiter.recordFailure(KEY)).allowed).toBe(true);
    await expect(limiter.recordSuccess(KEY)).resolves.toBeUndefined();
  });

  it('still throws from recordSuccess when failing closed', async () => {
    const limiter = build({ store: broken });
    await expect(limiter.recordSuccess(KEY)).rejects.toThrow(RateLimitStoreError);
  });
});

describe('configuration', () => {
  it.each([
    ['a missing store', { store: undefined }],
    ['a store missing methods', { store: { increment: () => undefined } }],
    ['a zero maxAttempts', { maxAttempts: 0 }],
    ['a non-integer maxAttempts', { maxAttempts: 2.5 }],
    ['a zero window', { windowSeconds: 0 }],
    ['an unknown onStoreError', { onStoreError: 'shrug' }],
  ])('rejects %s', (_label, override) => {
    expect(() => build(override as never)).toThrow(AuthConfigurationError);
  });

  it.each([[''], [null], [42]])('rejects the key %p', async (key) => {
    await expect(build().check(key as never)).rejects.toThrow(AuthConfigurationError);
    await expect(build().recordFailure(key as never)).rejects.toThrow(AuthConfigurationError);
    await expect(build().recordSuccess(key as never)).rejects.toThrow(AuthConfigurationError);
  });
});

describe('the two-limiter pattern the docs recommend', () => {
  it('bounds a single attacker tightly and a distributed one loosely', async () => {
    // Per user+IP, tight. Per user, looser — so an attacker spreading
    // across addresses still cannot grind one account, while one noisy
    // office IP cannot lock everyone out.
    const perPair = build({ maxAttempts: 3, windowSeconds: 900 });
    const perUser = build({ maxAttempts: 10, windowSeconds: 900 });

    for (let ip = 0; ip < 3; ip += 1) {
      const pairKey = `alice|198.51.100.${ip}`;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect((await perPair.check(pairKey)).allowed).toBe(true);
        await perPair.recordFailure(pairKey);
        await perUser.recordFailure('alice');
      }
      expect((await perPair.check(pairKey)).allowed).toBe(false);
    }

    // Nine failures across three addresses: the per-pair limiter saw
    // only three from each and let them through, but the per-user one
    // has been counting all along.
    expect((await perUser.check('alice')).count).toBe(9);
    expect((await perUser.check('alice')).allowed).toBe(true);

    await perUser.recordFailure('alice');
    expect((await perUser.check('alice')).allowed).toBe(false);
  });

  it('counts against a key whether or not the account exists', async () => {
    // A limiter that only counts for real users tells an attacker which
    // usernames exist — the same enumeration oracle verifyPasswordDecoy
    // closes on the timing side.
    const limiter = build({ maxAttempts: 2 });
    await limiter.recordFailure('nosuchuser|198.51.100.7');
    await limiter.recordFailure('nosuchuser|198.51.100.7');

    expect((await limiter.check('nosuchuser|198.51.100.7')).allowed).toBe(false);
  });
});

describe('the memory attempt store', () => {
  it('increments atomically under concurrency', async () => {
    const store = createMemoryAttemptStore();
    const results = await Promise.all(
      Array.from({ length: 50 }, () => store.increment(KEY, 60_000)),
    );

    // Every caller must see a distinct count, and the last must be 50 —
    // a lost update would show up as a repeat.
    expect(new Set(results.map((r) => r.count)).size).toBe(50);
    expect(Math.max(...results.map((r) => r.count))).toBe(50);
  });

  it('forgets a key once its window ends', async () => {
    let now = Date.UTC(2030, 0, 1);
    const store = createMemoryAttemptStore({ clock: () => now });

    await store.increment(KEY, 1_000);
    expect(await store.get(KEY)).toBeDefined();

    now += 1_000;
    expect(await store.get(KEY)).toBeUndefined();
  });

  it('starts a fresh window after expiry rather than resuming the old count', async () => {
    let now = Date.UTC(2030, 0, 1);
    const store = createMemoryAttemptStore({ clock: () => now });

    await store.increment(KEY, 1_000);
    await store.increment(KEY, 1_000);
    now += 1_000;

    const fresh = await store.increment(KEY, 1_000);
    expect(fresh.count).toBe(1);
    expect(fresh.resetAt).toBe(now + 1_000);
  });

  it('reset clears the key, and is a no-op for an absent one', async () => {
    const store = createMemoryAttemptStore();
    await store.increment(KEY, 60_000);
    await store.reset(KEY);

    expect(await store.get(KEY)).toBeUndefined();
    await expect(store.reset('never-seen')).resolves.toBeUndefined();
  });

  it('is called with the configured window', async () => {
    const inner = createMemoryAttemptStore();
    const increment = vi.fn(inner.increment);
    const limiter = build({
      store: { increment, get: inner.get, reset: inner.reset },
      windowSeconds: 42,
    });

    await limiter.recordFailure(KEY);
    expect(increment).toHaveBeenCalledWith(KEY, 42_000);
  });
});
