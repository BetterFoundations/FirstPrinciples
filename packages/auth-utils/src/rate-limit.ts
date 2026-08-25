import { AuthConfigurationError, RateLimitStoreError } from './errors.js';

/** A counter and when its window ends. */
export interface AttemptCounter {
  /** Failures recorded in the current window. */
  readonly count: number;
  /** When the window ends, in epoch milliseconds. */
  readonly resetAt: number;
}

/**
 * The persistence contract for login-attempt counters.
 *
 * @remarks
 * Deliberately smaller than {@link RefreshTokenStore}'s, because the
 * only operation that has to be atomic here is an increment — and every
 * store has one natively (`INCR`, `UPDATE … SET n = n + 1`,
 * `ADD` on DynamoDB). No compare-and-set, no revisions.
 *
 * `increment` must set the expiry **only when it creates the key**, so
 * that a window starts on the first failure and is not pushed forward
 * by later ones. Sliding it on every write would let a steady attacker
 * hold a window open indefinitely.
 *
 * Throw {@link RateLimitStoreError} on backend failure; see
 * `onStoreError` on {@link LoginRateLimiterOptions} for what happens
 * next, and why the default is what it is.
 *
 * @public
 */
export interface AttemptStore {
  /**
   * Adds one to `key`'s counter, creating it with a `windowMs` expiry
   * if absent, and returns the new value. Must be atomic.
   */
  increment(key: string, windowMs: number): Promise<AttemptCounter>;
  /** Reads `key`'s counter without changing it. `undefined` if absent or expired. */
  get(key: string): Promise<AttemptCounter | undefined>;
  /** Clears `key`. A no-op if absent. */
  reset(key: string): Promise<void>;
}

/** Whether an attempt may proceed. */
export interface RateLimitDecision {
  /** `true` if the caller may attempt authentication. */
  readonly allowed: boolean;
  /** Failures recorded in the current window. */
  readonly count: number;
  /** How many more failures are permitted before lockout. `0` once locked. */
  readonly remaining: number;
  /** When the window ends, in epoch milliseconds. Feed this to a `Retry-After` header. */
  readonly resetAt: number;
}

/** Options for {@link createLoginRateLimiter}. */
export interface LoginRateLimiterOptions {
  /** Where counters live. {@link createMemoryAttemptStore} for a single process. */
  readonly store: AttemptStore;
  /** Failures allowed within a window before attempts are refused. */
  readonly maxAttempts: number;
  /**
   * Window length in seconds, which is also the lockout length.
   *
   * @remarks
   * One knob rather than two, on purpose. "Five failures in fifteen
   * minutes, then locked out" and "five failures, then locked out for
   * the rest of a fifteen-minute window" describe the same behaviour,
   * and the second needs one fewer number to explain and one fewer
   * store key to keep consistent.
   *
   * This is a fixed window, so an attacker who times failures either
   * side of a boundary gets up to `2 × maxAttempts` in quick
   * succession. That is a real property of fixed windows and it is
   * accepted here: the bound over any sustained period is still
   * `maxAttempts` per window, which is what stops password guessing.
   */
  readonly windowSeconds: number;
  /**
   * What to do when the store itself fails. Defaults to `'deny'`.
   *
   * @remarks
   * `'deny'` — fail closed. A limiter is a *control*, not an
   * optimisation, and this is the one place this package deliberately
   * decides the opposite way to `cache-kit`, whose `wrap` swallows
   * backend errors because a cache being down must not become a new
   * failure mode. Here it must: failing open means anyone who can knock
   * over your Redis has bought themselves unlimited password guesses,
   * and that is a strictly worse outcome than a login outage caused by
   * a store that is already broken.
   *
   * `'allow'` — fail open. Choose it consciously, and only if you have
   * another throttle in front (an edge rate limit, a WAF).
   */
  readonly onStoreError?: 'deny' | 'allow';
  /** Time source in milliseconds. Injectable for tests. Defaults to `Date.now`. */
  readonly clock?: () => number;
}

/**
 * Throttles authentication attempts per caller-chosen key.
 *
 * @remarks
 * **The key is yours to choose, and the choice is a security decision
 * rather than a detail.**
 *
 * - Keying on the username alone lets anyone lock out any account they
 *   can name, by failing against it on purpose.
 * - Keying on the client IP alone punishes everyone behind a NAT or
 *   corporate proxy together, and does nothing to an attacker with a
 *   pool of addresses.
 *
 * Use both, as two limiters with different thresholds: a tight one per
 * `username|ip` pair, and a looser one per username to bound a
 * distributed guessing attack. Neither key should depend on whether the
 * account exists — a limiter that only counts against real users is a
 * user-enumeration oracle, the same one `verifyPasswordDecoy` exists to
 * close.
 */
export interface LoginRateLimiter {
  /** Whether `key` may attempt right now. Call before verifying a password. */
  check(key: string): Promise<RateLimitDecision>;
  /** Records a failed attempt and returns the decision for the *next* one. */
  recordFailure(key: string): Promise<RateLimitDecision>;
  /** Clears `key`'s counter after a successful authentication. */
  recordSuccess(key: string): Promise<void>;
}

function assertPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new AuthConfigurationError(`\`${label}\` must be a positive integer.`);
  }
  return value;
}

function assertKey(key: unknown): string {
  if (typeof key !== 'string' || key.length === 0) {
    throw new AuthConfigurationError('`key` must be a non-empty string.');
  }
  return key;
}

/**
 * Creates a login-attempt limiter.
 *
 * @param options - See {@link LoginRateLimiterOptions}.
 *
 * @throws {@link AuthConfigurationError} for an unusable configuration.
 *
 * @public
 */
export function createLoginRateLimiter(options: LoginRateLimiterOptions): LoginRateLimiter {
  const store = options.store as AttemptStore | undefined;
  if (
    store === undefined ||
    typeof store.increment !== 'function' ||
    typeof store.get !== 'function' ||
    typeof store.reset !== 'function'
  ) {
    throw new AuthConfigurationError(
      '`store` must implement increment, get and reset. See AttemptStore.',
    );
  }

  const maxAttempts = assertPositiveInteger(options.maxAttempts, 'maxAttempts');
  const windowMs = assertPositiveInteger(options.windowSeconds, 'windowSeconds') * 1000;
  const onStoreError = options.onStoreError ?? 'deny';
  if (onStoreError !== 'deny' && onStoreError !== 'allow') {
    throw new AuthConfigurationError("`onStoreError` must be 'deny' or 'allow'.");
  }
  const clock = options.clock ?? Date.now;

  function decide(counter: AttemptCounter): RateLimitDecision {
    const remaining = Math.max(0, maxAttempts - counter.count);
    return {
      allowed: counter.count < maxAttempts,
      count: counter.count,
      remaining,
      resetAt: counter.resetAt,
    };
  }

  function onFailure(error: unknown): RateLimitDecision {
    if (onStoreError === 'deny') {
      throw new RateLimitStoreError(
        'The attempt store failed, and this limiter is configured to fail closed. ' +
          'Set `onStoreError: "allow"` only if another throttle sits in front of this one.',
        error,
      );
    }
    // Failing open is a deliberate choice the caller made; report it as
    // an allowed attempt with no useful counters rather than pretending
    // to know the count.
    return { allowed: true, count: 0, remaining: maxAttempts, resetAt: clock() + windowMs };
  }

  return {
    async check(key) {
      assertKey(key);
      try {
        const counter = await store.get(key);
        return counter === undefined
          ? { allowed: true, count: 0, remaining: maxAttempts, resetAt: clock() + windowMs }
          : decide(counter);
      } catch (error) {
        return onFailure(error);
      }
    },

    async recordFailure(key) {
      assertKey(key);
      try {
        return decide(await store.increment(key, windowMs));
      } catch (error) {
        return onFailure(error);
      }
    },

    async recordSuccess(key) {
      assertKey(key);
      try {
        await store.reset(key);
      } catch (error) {
        // A counter that outlives a successful login costs the user a
        // lockout they did not earn; it never lets an attacker through.
        // So this is the one place a store failure is survivable, and
        // failing closed here would mean refusing a login that already
        // succeeded.
        if (onStoreError === 'deny') {
          throw new RateLimitStoreError(
            'The attempt store failed while clearing a counter.',
            error,
          );
        }
      }
    },
  };
}
