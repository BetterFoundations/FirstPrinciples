import { err, ok, type Result } from '@firstprinciples/core';

import { AuthConfigurationError, RefreshTokenError, RefreshTokenStoreError } from './errors.js';
import {
  decideRotation,
  revoke,
  type RefreshFailureReason,
  type RevocationReason,
  type TokenFamily,
} from './internal/refresh-state.js';
import { mintToken, newFamilyId, parseToken } from './internal/token-format.js';

export type {
  FamilyToken,
  RefreshFailureReason,
  RevocationReason,
  TokenFamily,
} from './internal/refresh-state.js';

/**
 * A store's opaque marker for "the version of this record I read".
 *
 * @remarks
 * Produced and consumed only by the store, so a backend is free to use
 * a counter, a row version, a Redis `WATCH` handle turned into a
 * string, or an ETag.
 *
 * @public
 */
export type Revision = string | number;

/** A family plus the revision it was read at. */
export interface StoredTokenFamily {
  readonly family: TokenFamily;
  readonly revision: Revision;
}

/**
 * The persistence contract for refresh-token families.
 *
 * @remarks
 * Four methods, and only one of them has to be clever: **`compareAndSet`
 * must be atomic.** Everything this package promises about rotation
 * rests on that single operation, so it is worth understanding why the
 * contract is shaped this way before implementing one.
 *
 * Rotation has to invalidate the presented token and issue its
 * successor with no observable state in between. Because a whole family
 * is one record, that is one write rather than two, and "atomic across
 * two keys" — which most stores cannot offer — never comes up. What is
 * left is the ordinary read-modify-write race, handled with optimistic
 * concurrency: read a revision, compute, write *only if* the revision
 * is unchanged.
 *
 * Compare-and-set was chosen over a lock deliberately. A lock needs a
 * lease, and a lease needs a correct answer to "what if the holder
 * stalls past it", which is the question distributed locking has never
 * answered cleanly. Compare-and-set has no such failure mode: the loser
 * of a race simply retries, and on retry it sees a rotated token and
 * detects the reuse.
 *
 * Every mainstream store can do this:
 *
 * - **In-memory** — {@link createMemoryRefreshTokenStore}, a counter.
 * - **Redis** — `WATCH`/`MULTI`/`EXEC`, or a Lua script comparing a
 *   `rev` field.
 * - **SQL** — `UPDATE … WHERE id = ? AND revision = ?`, checking the
 *   affected row count.
 * - **DynamoDB** — a conditional write on the revision attribute.
 *
 * Throw {@link RefreshTokenStoreError} for genuine backend failures. Do
 * not throw for a lost race — return `false`, which is a normal outcome.
 *
 * @public
 */
export interface RefreshTokenStore {
  /** Reads a family and the revision it was read at, or `undefined` if absent. */
  read(familyId: string): Promise<StoredTokenFamily | undefined>;
  /** Inserts a family. Returns `false` if the id already exists, without overwriting. */
  create(family: TokenFamily): Promise<boolean>;
  /**
   * Writes `family` **only if** its stored revision is still
   * `expectedRevision`. Returns `false` if it changed, having written
   * nothing. This must be atomic.
   */
  compareAndSet(family: TokenFamily, expectedRevision: Revision): Promise<boolean>;
  /** Removes a family outright. A no-op if absent. */
  delete(familyId: string): Promise<void>;
}

/** A token handed to the client, and the metadata the caller needs alongside it. */
export interface IssuedRefreshToken {
  /** The token string. Give this to the client; it is never recoverable from the store. */
  readonly token: string;
  /** The family it belongs to. Safe to log — useful for correlating a session's whole chain. */
  readonly familyId: string;
  /** Whoever authenticated. Mint the access token for this subject. */
  readonly subject: string;
  /** When this token stops being accepted, in epoch milliseconds. */
  readonly expiresAt: number;
  /** When the family dies regardless of activity, in epoch milliseconds. */
  readonly familyExpiresAt: number;
}

/** Options for {@link createRefreshTokenService}. */
export interface RefreshTokenServiceOptions {
  /** Where families live. {@link createMemoryRefreshTokenStore} for a single process. */
  readonly store: RefreshTokenStore;
  /**
   * How long one refresh token is valid, in seconds.
   *
   * @remarks
   * This is the window in which a stolen token is useful *if the victim
   * never refreshes again*. Any refresh by the legitimate client inside
   * the window trips reuse detection and kills the family, so shorter
   * values mostly reduce the damage from a client that has gone quiet.
   */
  readonly ttlSeconds: number;
  /**
   * How long a family lives regardless of activity, in seconds.
   *
   * @remarks
   * The session's hard ceiling, and the thing that stops a
   * stolen-and-continuously-rotated chain living forever. Rotation
   * slides each token's own expiry but never moves this.
   */
  readonly absoluteTtlSeconds: number;
  /**
   * How many rotated hashes to retain for reuse detection. Defaults to `100`.
   *
   * @remarks
   * Unbounded retention is a memory leak an attacker can drive by
   * refreshing in a loop. When the cap is passed the oldest hashes are
   * dropped, so replaying a token from more than this many rotations
   * ago reports `unknown_token` rather than `reused`. That token is
   * inert either way — the cost is a missed *alert*, not a missed
   * rejection.
   */
  readonly maxChainLength?: number;
  /**
   * How many times to retry a lost compare-and-set. Defaults to `3`.
   *
   * @remarks
   * A retry is not a workaround for contention; it is how the loser of
   * a race reaches the point where it can see what the winner did. Only
   * genuinely pathological contention exhausts this.
   */
  readonly maxRetries?: number;
  /** Time source in milliseconds. Injectable for tests. Defaults to `Date.now`. */
  readonly clock?: () => number;
}

/** Issues, rotates and revokes refresh tokens. */
export interface RefreshTokenService {
  /**
   * Starts a new family. Call this after authenticating, never to
   * recover from a failed rotation.
   */
  issue(input: { subject: string }): Promise<IssuedRefreshToken>;
  /**
   * Exchanges a valid refresh token for its successor, invalidating the
   * presented one in the same write.
   *
   * @remarks
   * A `reused` error means the entire family has just been revoked.
   * **Alert on it** — it fires exactly once per family, at detection.
   */
  rotate(token: string): Promise<Result<IssuedRefreshToken, RefreshTokenError>>;
  /** Revokes the family a token belongs to. The logout path. Idempotent. */
  revoke(token: string): Promise<void>;
  /** Revokes a family by id, for an admin action or a password change. Idempotent. */
  revokeFamily(familyId: string, reason?: RevocationReason): Promise<void>;
}

function assertPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new AuthConfigurationError(`\`${label}\` must be a positive integer.`);
  }
  return value;
}

/**
 * Creates the refresh-token service.
 *
 * @param options - See {@link RefreshTokenServiceOptions}.
 *
 * @throws {@link AuthConfigurationError} for an unusable configuration.
 *
 * @public
 */
export function createRefreshTokenService(
  options: RefreshTokenServiceOptions,
): RefreshTokenService {
  const store = options.store as RefreshTokenStore | undefined;
  if (
    store === undefined ||
    typeof store.read !== 'function' ||
    typeof store.create !== 'function' ||
    typeof store.compareAndSet !== 'function' ||
    typeof store.delete !== 'function'
  ) {
    throw new AuthConfigurationError(
      '`store` must implement read, create, compareAndSet and delete. See RefreshTokenStore.',
    );
  }

  const ttlMs = assertPositiveInteger(options.ttlSeconds, 'ttlSeconds') * 1000;
  const absoluteTtlMs =
    assertPositiveInteger(options.absoluteTtlSeconds, 'absoluteTtlSeconds') * 1000;
  if (absoluteTtlMs < ttlMs) {
    throw new AuthConfigurationError(
      '`absoluteTtlSeconds` is shorter than `ttlSeconds`, so every issued token would already ' +
        'be past the family deadline. The absolute lifetime is a ceiling over the sliding one.',
    );
  }

  const maxChainLength = assertPositiveInteger(options.maxChainLength ?? 100, 'maxChainLength');
  const maxRetries = assertPositiveInteger(options.maxRetries ?? 3, 'maxRetries');
  const clock = options.clock ?? Date.now;

  function reject(reason: RefreshFailureReason): Result<never, RefreshTokenError> {
    return err(new RefreshTokenError(reason, MESSAGES.get(reason) ?? 'Refresh token refused.'));
  }

  return {
    async issue({ subject }) {
      if (typeof subject !== 'string' || subject.length === 0) {
        throw new AuthConfigurationError('`subject` must be a non-empty string.');
      }

      const now = clock();
      const familyId = newFamilyId();
      const minted = mintToken(familyId);
      const absoluteExpiresAt = now + absoluteTtlMs;
      const expiresAt = Math.min(now + ttlMs, absoluteExpiresAt);

      const created = await store.create({
        id: familyId,
        subject,
        createdAt: now,
        absoluteExpiresAt,
        current: { hash: minted.hash, issuedAt: now, expiresAt },
        usedHashes: [],
        revokedAt: undefined,
        revokedReason: undefined,
      });

      if (!created) {
        // 128 bits of randomness collided, or the store is broken.
        // Either way this is not something to paper over by retrying.
        throw new RefreshTokenStoreError('Refused to issue: a family with this id already exists.');
      }

      return {
        token: minted.token,
        familyId,
        subject,
        expiresAt,
        familyExpiresAt: absoluteExpiresAt,
      };
    },

    async rotate(token) {
      const parsed = parseToken(token);
      if (parsed === undefined) return reject('malformed');

      for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        const stored = await store.read(parsed.familyId);
        if (stored === undefined) return reject('unknown_family');

        const now = clock();
        const minted = mintToken(parsed.familyId);
        const decision = decideRotation({
          family: stored.family,
          presentedHash: parsed.presentedHash,
          minted,
          now,
          ttlMs,
          maxChainLength,
        });

        if (decision.kind === 'rejected') return reject(decision.reason);

        // Both remaining outcomes write, and the write is the atomic
        // point: for `rotated` it carries the old token's invalidation
        // and the new token's issue together, so no reader can observe
        // one without the other.
        const written = await store.compareAndSet(decision.family, stored.revision);
        if (!written) continue; // Lost the race — re-read and re-decide.

        if (decision.kind === 'reuse') return reject('reused');

        const { current } = decision.family;
        /* c8 ignore next -- a `rotated` decision always sets `current`. */
        if (current === undefined) return reject('unknown_token');

        return ok({
          token: minted.token,
          familyId: decision.family.id,
          subject: decision.family.subject,
          expiresAt: current.expiresAt,
          familyExpiresAt: decision.family.absoluteExpiresAt,
        });
      }

      // Not an authentication outcome, so not a `Result` branch — the
      // same split S13 drew between a rejected token and a
      // misconfigured verifier. The caller should retry, not
      // re-authenticate the user.
      throw new RefreshTokenStoreError(
        `Could not rotate after ${maxRetries} attempts: the family kept changing underneath. ` +
          'Retry the request.',
      );
    },

    async revoke(token) {
      const parsed = parseToken(token);
      if (parsed === undefined) return;
      await revokeById(store, parsed.familyId, 'revoked', clock, maxRetries);
    },

    async revokeFamily(familyId, reason = 'revoked') {
      await revokeById(store, familyId, reason, clock, maxRetries);
    },
  };
}

async function revokeById(
  store: RefreshTokenStore,
  familyId: string,
  reason: RevocationReason,
  clock: () => number,
  maxRetries: number,
): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const stored = await store.read(familyId);
    // Revoking something that is not there is the desired end state, so
    // it succeeds rather than reporting. Logout must be idempotent: a
    // client retrying it should not get an error.
    if (stored === undefined) return;
    if (stored.family.revokedAt !== undefined) return;

    const next = revoke(stored.family, clock(), reason);
    if (await store.compareAndSet(next, stored.revision)) return;
  }

  throw new RefreshTokenStoreError(
    `Could not revoke family after ${maxRetries} attempts: it kept changing underneath.`,
  );
}

/**
 * A `Map` rather than an object literal, matching `jwt-algorithms.ts`:
 * a prototype-chain key can never register as a hit, and there is no
 * dynamic-property sink for a reader (or a linter) to have to reason
 * about.
 *
 * None of these echo the token, a family id, or a subject.
 */
const MESSAGES = new Map<RefreshFailureReason, string>([
  ['malformed', 'Refresh token is not well-formed.'],
  ['unknown_family', 'Refresh token does not belong to a known session.'],
  ['unknown_token', 'Refresh token was never issued for this session.'],
  ['expired', 'Refresh token has expired.'],
  ['family_expired', 'Session has reached its maximum lifetime. Sign in again.'],
  ['revoked', 'Session has been revoked. Sign in again.'],
  ['reused', 'Refresh token was already used. The whole session has been revoked.'],
]);
