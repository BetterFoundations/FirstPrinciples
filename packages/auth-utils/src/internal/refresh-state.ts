import type { MintedToken } from './token-format.js';
import { hashesMatch } from './token-format.js';

/**
 * Why a family was revoked.
 *
 * @public
 */
export type RevocationReason =
  /** A token that had already been rotated was presented again. */
  | 'reuse_detected'
  /** Revoked explicitly — a logout, an admin action, a password change. */
  | 'revoked';

/**
 * One refresh-token *family*: everything descended from a single
 * successful authentication.
 *
 * @remarks
 * The whole chain is one record on purpose, and it is the reason
 * rotation can be atomic at all. Invalidating the presented token and
 * issuing its successor are edits to the *same* object, so they reach
 * the store as one write — there is no ordering in which both are valid
 * or both are dead, because there is no intermediate state to observe.
 * A design that stored tokens individually would need a transaction
 * spanning two keys, which most stores cannot give you.
 *
 * @public
 */
export interface TokenFamily {
  /** Opaque family identifier. Carried in the token, not secret on its own. */
  readonly id: string;
  /** Whoever authenticated. Returned on a successful rotation so the caller can mint an access token. */
  readonly subject: string;
  /** When the family's first token was issued, in epoch milliseconds. */
  readonly createdAt: number;
  /**
   * When the family dies regardless of activity, in epoch milliseconds.
   *
   * @remarks
   * Rotation slides each token's own expiry forward but never moves
   * this. Without an absolute cap, a stolen-and-rotated chain lives
   * forever as long as the attacker keeps refreshing.
   */
  readonly absoluteExpiresAt: number;
  /** The one token currently accepted, or `undefined` once the family has none. */
  readonly current: FamilyToken | undefined;
  /**
   * Hashes of every token already rotated away, newest last.
   *
   * @remarks
   * This is the reuse-detection index. A presented token whose hash is
   * in here was valid once and has since been superseded, which means
   * either the client replayed it or somebody else has a copy — and
   * there is no way to tell which, so the family dies.
   */
  readonly usedHashes: readonly string[];
  /** When the family was revoked, in epoch milliseconds, or `undefined`. */
  readonly revokedAt: number | undefined;
  /** Why it was revoked, or `undefined`. */
  readonly revokedReason: RevocationReason | undefined;
}

/** One issued token's stored form. The secret itself is never stored. */
export interface FamilyToken {
  /** Base64url SHA-256 of the token's secret half. */
  readonly hash: string;
  /** When it was issued, in epoch milliseconds. */
  readonly issuedAt: number;
  /** When it stops being accepted, in epoch milliseconds. */
  readonly expiresAt: number;
}

/**
 * Why a refresh attempt was refused.
 *
 * @public
 */
export type RefreshFailureReason =
  /** Not a well-formed refresh token. */
  | 'malformed'
  /** No family with that id — expired out of the store, or never existed. */
  | 'unknown_family'
  /** The family exists but has never issued this token. A guess, or a corrupted value. */
  | 'unknown_token'
  /** The presented token is past its own expiry. */
  | 'expired'
  /** The family is past its absolute lifetime. Re-authenticate. */
  | 'family_expired'
  /** The family was revoked — by logout, by an admin, or by an earlier reuse detection. */
  | 'revoked'
  /**
   * A token that had already been rotated was presented again. **The
   * entire family has been revoked.** This is a security event: alert on it.
   */
  | 'reused';

/** What {@link decideRotation} concluded. Only the caller writes. */
export type RefreshDecision =
  /** Persist `family`, then hand `minted` to the client. */
  | { readonly kind: 'rotated'; readonly family: TokenFamily }
  /**
   * Reuse detected. Persist `family` — it is revoked — and refuse.
   * Distinct from `rejected` because it *requires* a write.
   */
  | { readonly kind: 'reuse'; readonly family: TokenFamily }
  /** Refuse, and write nothing. */
  | { readonly kind: 'rejected'; readonly reason: RefreshFailureReason };

/**
 * The rotation state machine, as a pure function.
 *
 * @remarks
 * Pure so that every transition can be tested directly, without a store,
 * a clock, or a source of randomness — which is why `minted` is passed
 * in already generated rather than created here. A pre-minted token that
 * turns out to be unused is just discarded randomness.
 *
 * **Order of checks is load-bearing** and is not the order you would get
 * by writing them in the order they occur to you:
 *
 * 1. *Revocation before everything.* A revoked family is terminal.
 *    Re-reporting `reused` against a family that is already dead would
 *    fire the security alert repeatedly for one incident; checking
 *    revocation first means **`reused` is emitted exactly once per
 *    family, at the moment of detection**, which is the cardinality an
 *    alert wants.
 * 2. *Reuse before expiry.* A replayed token that has also expired is
 *    still a replayed token. Reporting it as merely `expired` would
 *    discard the one signal that matters and leave a compromised family
 *    live.
 * 3. *Family expiry before token expiry*, so the caller is told to
 *    re-authenticate rather than to retry.
 *
 * @param input - See the property docs.
 */
export function decideRotation(input: {
  /** The family as read from the store. */
  readonly family: TokenFamily;
  /** Base64url SHA-256 of the presented token's secret half. */
  readonly presentedHash: string;
  /** A freshly minted successor, used only if the rotation is allowed. */
  readonly minted: MintedToken;
  /** Current time in epoch milliseconds. */
  readonly now: number;
  /** How long the successor is valid for, in milliseconds. */
  readonly ttlMs: number;
  /** Cap on retained `usedHashes`. */
  readonly maxChainLength: number;
}): RefreshDecision {
  const { family, presentedHash, minted, now, ttlMs, maxChainLength } = input;

  // 1. Terminal states first.
  if (family.revokedAt !== undefined) {
    return { kind: 'rejected', reason: 'revoked' };
  }

  // 2. Reuse, before any expiry check — a replayed token is a security
  //    event whether or not it has also aged out.
  if (family.usedHashes.some((used) => hashesMatch(used, presentedHash))) {
    return { kind: 'reuse', family: revoke(family, now, 'reuse_detected') };
  }

  // 3. Absolute family lifetime.
  if (now >= family.absoluteExpiresAt) {
    return { kind: 'rejected', reason: 'family_expired' };
  }

  const { current } = family;
  if (current === undefined) {
    // Not reachable through this module's own transitions — a family
    // always has a `current` until it is revoked, and revocation was
    // handled above. Treated as an unknown token rather than trusted,
    // because the family came from a store this package does not own.
    return { kind: 'rejected', reason: 'unknown_token' };
  }

  // 4. Neither the live token nor a known-used one: a guess.
  if (!hashesMatch(current.hash, presentedHash)) {
    // Deliberately *not* a revocation. Reuse means a token this family
    // really issued came back; an unrecognised value never was one, and
    // treating a corrupted cookie as an attack would hand anyone who
    // can send a bad string the power to end a session.
    return { kind: 'rejected', reason: 'unknown_token' };
  }

  // 5. The live token, but stale.
  if (now >= current.expiresAt) {
    return { kind: 'rejected', reason: 'expired' };
  }

  // 6. Rotate. One object, so one write.
  const usedHashes = [...family.usedHashes, current.hash];
  return {
    kind: 'rotated',
    family: {
      ...family,
      current: {
        hash: minted.hash,
        issuedAt: now,
        // Never past the family's absolute deadline: a sliding window
        // inside a fixed one.
        expiresAt: Math.min(now + ttlMs, family.absoluteExpiresAt),
      },
      usedHashes:
        usedHashes.length > maxChainLength
          ? usedHashes.slice(usedHashes.length - maxChainLength)
          : usedHashes,
    },
  };
}

/**
 * Whether `presentedHash` is a token this family actually issued —
 * either the live one or one already rotated away.
 *
 * @remarks
 * This is the possession proof behind logout. The family id travels in
 * the token's first segment, is returned to the caller as
 * `IssuedRefreshToken.familyId`, and is documented as safe to log — so
 * it is exactly the sort of value that ends up in an access log, an APM
 * trace, or a half-redacted token prefix. Treating knowledge of it as
 * authority to end a session would hand anyone who has ever read a log
 * line the power to log any user out.
 *
 * A rotated-away hash counts. A client retrying a logout it already
 * half-completed is holding a superseded token, and refusing it would
 * make logout non-idempotent for the one case that most needs to be.
 *
 * Constant-time per candidate, via {@link hashesMatch}.
 *
 * @param family - The family as read from the store.
 * @param presentedHash - Base64url SHA-256 of the presented token's secret half.
 */
export function familyIssued(family: TokenFamily, presentedHash: string): boolean {
  if (family.current !== undefined && hashesMatch(family.current.hash, presentedHash)) {
    return true;
  }
  return family.usedHashes.some((used) => hashesMatch(used, presentedHash));
}

/** Returns `family` marked revoked. A no-op if it already is. */
export function revoke(family: TokenFamily, now: number, reason: RevocationReason): TokenFamily {
  if (family.revokedAt !== undefined) return family;
  return {
    ...family,
    // The live token joins the used set so that presenting it after
    // revocation is still recognised as a token this family issued.
    current: undefined,
    usedHashes:
      family.current === undefined
        ? family.usedHashes
        : [...family.usedHashes, family.current.hash],
    revokedAt: now,
    revokedReason: reason,
  };
}
