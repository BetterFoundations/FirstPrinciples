import type { AttemptCounter, AttemptStore } from './rate-limit.js';
import type { RefreshTokenStore, Revision, StoredTokenFamily } from './refresh.js';
import type { TokenFamily } from './internal/refresh-state.js';

/**
 * An in-process {@link RefreshTokenStore}.
 *
 * @remarks
 * Correct, and correct only for one process. Two instances of your
 * application each get their own map, so a token issued by one is
 * unknown to the other and — worse — reuse detection cannot see across
 * them. Use it for development, tests, and single-process deployments;
 * reach for Redis or your database otherwise.
 *
 * **Why its `compareAndSet` is genuinely atomic**, which is easy to
 * doubt: JavaScript runs one turn of the event loop at a time, and this
 * implementation performs its check and its write in a single
 * synchronous block with no `await` between them. Nothing can interleave
 * there. The race the revision counter exists to catch is the one that
 * spans a caller's own `await` between `read` and `compareAndSet`, and
 * that race is real — it is what two concurrent rotations hit.
 *
 * Entries are evicted lazily, when read, so a family that is never
 * touched again lingers until then. That is fine at development scale
 * and is another reason not to ship it.
 *
 * @param options - Optional injectable clock, for tests.
 *
 * @public
 */
export function createMemoryRefreshTokenStore(
  options: { readonly clock?: () => number } = {},
): RefreshTokenStore {
  const clock = options.clock ?? Date.now;
  const families = new Map<string, { family: TokenFamily; revision: number }>();

  function live(familyId: string): { family: TokenFamily; revision: number } | undefined {
    const entry = families.get(familyId);
    if (entry === undefined) return undefined;
    if (clock() >= entry.family.absoluteExpiresAt) {
      families.delete(familyId);
      return undefined;
    }
    return entry;
  }

  return {
    read(familyId: string): Promise<StoredTokenFamily | undefined> {
      const entry = live(familyId);
      return Promise.resolve(
        entry === undefined ? undefined : { family: entry.family, revision: entry.revision },
      );
    },

    create(family: TokenFamily): Promise<boolean> {
      if (live(family.id) !== undefined) return Promise.resolve(false);
      families.set(family.id, { family, revision: 1 });
      return Promise.resolve(true);
    },

    compareAndSet(family: TokenFamily, expectedRevision: Revision): Promise<boolean> {
      const entry = families.get(family.id);
      if (entry === undefined || entry.revision !== expectedRevision) {
        return Promise.resolve(false);
      }
      families.set(family.id, { family, revision: entry.revision + 1 });
      return Promise.resolve(true);
    },

    delete(familyId: string): Promise<void> {
      families.delete(familyId);
      return Promise.resolve();
    },
  };
}

/**
 * An in-process {@link AttemptStore}.
 *
 * @remarks
 * Same caveat as the refresh store, and it bites harder: per-process
 * counters mean an attacker spread across N application instances gets
 * N times the attempts. A shared store is not optional in production.
 *
 * @param options - Optional injectable clock, for tests.
 *
 * @public
 */
export function createMemoryAttemptStore(
  options: { readonly clock?: () => number } = {},
): AttemptStore {
  const clock = options.clock ?? Date.now;
  const counters = new Map<string, AttemptCounter>();

  function live(key: string): AttemptCounter | undefined {
    const counter = counters.get(key);
    if (counter === undefined) return undefined;
    if (clock() >= counter.resetAt) {
      counters.delete(key);
      return undefined;
    }
    return counter;
  }

  return {
    increment(key: string, windowMs: number): Promise<AttemptCounter> {
      const existing = live(key);
      // The expiry is set when the key is created and never extended,
      // so the window starts at the first failure. Sliding it on every
      // increment would let a steady attacker hold it open forever.
      const next: AttemptCounter =
        existing === undefined
          ? { count: 1, resetAt: clock() + windowMs }
          : { count: existing.count + 1, resetAt: existing.resetAt };
      counters.set(key, next);
      return Promise.resolve(next);
    },

    get(key: string): Promise<AttemptCounter | undefined> {
      return Promise.resolve(live(key));
    },

    reset(key: string): Promise<void> {
      counters.delete(key);
      return Promise.resolve();
    },
  };
}
