import { describe, expect, it } from 'vitest';

import {
  decideRotation,
  revoke,
  type RefreshFailureReason,
  type TokenFamily,
} from '../../src/internal/refresh-state.js';
import { mintToken, newFamilyId } from '../../src/internal/token-format.js';

/**
 * The rotation state machine, exercised directly.
 *
 * `decideRotation` is a pure function precisely so this can be a
 * complete table rather than a sampling: no store, no clock, no
 * randomness, so every transition is reachable and every one is here.
 * The `covers every outcome` test at the bottom fails if a new
 * `RefreshFailureReason` is added without a case landing on it.
 */

const NOW = 1_700_000_000_000;
const TTL_MS = 60_000;
const ABSOLUTE_MS = 600_000;

interface Scenario {
  readonly family: TokenFamily;
  readonly presentedHash: string;
  readonly currentToken: ReturnType<typeof mintToken>;
}

/** A family with one live token, at `NOW`. */
function scenario(overrides: Partial<TokenFamily> = {}): Scenario {
  const id = newFamilyId();
  const currentToken = mintToken(id);
  const family: TokenFamily = {
    id,
    subject: 'user-1',
    createdAt: NOW,
    absoluteExpiresAt: NOW + ABSOLUTE_MS,
    current: { hash: currentToken.hash, issuedAt: NOW, expiresAt: NOW + TTL_MS },
    usedHashes: [],
    revokedAt: undefined,
    revokedReason: undefined,
    ...overrides,
  };
  return { family, presentedHash: currentToken.hash, currentToken };
}

function decide(
  s: Scenario,
  overrides: { presentedHash?: string; now?: number; maxChainLength?: number } = {},
): ReturnType<typeof decideRotation> {
  return decideRotation({
    family: s.family,
    presentedHash: overrides.presentedHash ?? s.presentedHash,
    minted: mintToken(s.family.id),
    now: overrides.now ?? NOW + 1_000,
    ttlMs: TTL_MS,
    maxChainLength: overrides.maxChainLength ?? 100,
  });
}

describe('the live token rotates', () => {
  it('accepts the current token and issues a successor', () => {
    const s = scenario();
    const decision = decide(s);

    expect(decision.kind).toBe('rotated');
    if (decision.kind !== 'rotated') return;
    expect(decision.family.current?.hash).not.toBe(s.currentToken.hash);
    expect(decision.family.revokedAt).toBeUndefined();
  });

  it('moves the presented token into the used set in the same object', () => {
    // The invariant behind the atomicity claim: invalidating the old
    // token and installing the new one are edits to one value, so they
    // reach the store as one write and no reader sees a state where
    // both are live or neither is.
    const s = scenario();
    const decision = decide(s);
    if (decision.kind !== 'rotated') throw new Error('expected a rotation');

    expect(decision.family.usedHashes).toEqual([s.currentToken.hash]);
    expect(decision.family.current?.hash).toBeDefined();
    expect(decision.family.usedHashes).not.toContain(decision.family.current?.hash);
  });

  it('slides the token expiry but never past the family deadline', () => {
    const nearDeadline = scenario({ absoluteExpiresAt: NOW + 5_000 });
    const decision = decide(nearDeadline, { now: NOW + 1_000 });
    if (decision.kind !== 'rotated') throw new Error('expected a rotation');

    // now + ttl would be NOW + 61_000, well past the family's deadline.
    expect(decision.family.current?.expiresAt).toBe(NOW + 5_000);
    expect(decision.family.absoluteExpiresAt).toBe(NOW + 5_000);
  });

  it('keeps the family deadline fixed across rotations', () => {
    let s = scenario();
    const deadline = s.family.absoluteExpiresAt;

    for (let i = 0; i < 5; i += 1) {
      const decision = decide(s, { now: NOW + i * 1_000 });
      if (decision.kind !== 'rotated') throw new Error('expected a rotation');
      expect(decision.family.absoluteExpiresAt).toBe(deadline);
      s = { ...s, family: decision.family, presentedHash: decision.family.current?.hash ?? '' };
    }
  });

  it('caps the retained chain, dropping the oldest hashes', () => {
    let s = scenario();
    for (let i = 0; i < 6; i += 1) {
      const decision = decide(s, { maxChainLength: 3 });
      if (decision.kind !== 'rotated') throw new Error('expected a rotation');
      s = { ...s, family: decision.family, presentedHash: decision.family.current?.hash ?? '' };
    }

    expect(s.family.usedHashes).toHaveLength(3);
  });
});

describe('replaying a rotated token revokes the whole family', () => {
  it('reports reuse and returns a revoked family to persist', () => {
    const s = scenario();
    const first = decide(s);
    if (first.kind !== 'rotated') throw new Error('expected a rotation');

    // Present the original token again, after it has been rotated away.
    const replay = decideRotation({
      family: first.family,
      presentedHash: s.currentToken.hash,
      minted: mintToken(s.family.id),
      now: NOW + 2_000,
      ttlMs: TTL_MS,
      maxChainLength: 100,
    });

    expect(replay.kind).toBe('reuse');
    if (replay.kind !== 'reuse') return;
    expect(replay.family.revokedAt).toBe(NOW + 2_000);
    expect(replay.family.revokedReason).toBe('reuse_detected');
  });

  it('kills the successor too, not just the replayed token', () => {
    // The point of family revocation. Whoever holds the *current* token
    // — which may well be the attacker, since we cannot tell — loses it
    // as well.
    const s = scenario();
    const first = decide(s);
    if (first.kind !== 'rotated') throw new Error('expected a rotation');
    const successorHash = first.family.current?.hash;

    const replay = decideRotation({
      family: first.family,
      presentedHash: s.currentToken.hash,
      minted: mintToken(s.family.id),
      now: NOW + 2_000,
      ttlMs: TTL_MS,
      maxChainLength: 100,
    });
    if (replay.kind !== 'reuse') throw new Error('expected reuse');

    expect(replay.family.current).toBeUndefined();
    expect(replay.family.usedHashes).toContain(successorHash);
  });

  it('detects reuse of a token from several rotations back', () => {
    let s = scenario();
    const original = s.currentToken.hash;
    for (let i = 0; i < 4; i += 1) {
      const decision = decide(s);
      if (decision.kind !== 'rotated') throw new Error('expected a rotation');
      s = { ...s, family: decision.family, presentedHash: decision.family.current?.hash ?? '' };
    }

    expect(decide(s, { presentedHash: original }).kind).toBe('reuse');
  });

  it('reports reuse even when the replayed token is also expired', () => {
    // Ordering that matters: a replayed token is a security event
    // whether or not it has aged out. Checking expiry first would
    // report `expired`, throw away the only signal that matters, and
    // leave a compromised family live.
    const s = scenario();
    const first = decide(s);
    if (first.kind !== 'rotated') throw new Error('expected a rotation');

    const wayLater = NOW + TTL_MS + 10_000;
    const replay = decideRotation({
      family: first.family,
      presentedHash: s.currentToken.hash,
      minted: mintToken(s.family.id),
      now: wayLater,
      ttlMs: TTL_MS,
      maxChainLength: 100,
    });

    expect(replay.kind).toBe('reuse');
  });

  it('stops reporting reuse once the family is already revoked', () => {
    // `reused` fires exactly once per family, at detection. Repeating
    // it for every later replay would turn one incident into an
    // unbounded stream of identical alerts.
    const s = scenario();
    const first = decide(s);
    if (first.kind !== 'rotated') throw new Error('expected a rotation');
    const replay = decideRotation({
      family: first.family,
      presentedHash: s.currentToken.hash,
      minted: mintToken(s.family.id),
      now: NOW + 2_000,
      ttlMs: TTL_MS,
      maxChainLength: 100,
    });
    if (replay.kind !== 'reuse') throw new Error('expected reuse');

    const again = decideRotation({
      family: replay.family,
      presentedHash: s.currentToken.hash,
      minted: mintToken(s.family.id),
      now: NOW + 3_000,
      ttlMs: TTL_MS,
      maxChainLength: 100,
    });

    expect(again).toEqual({ kind: 'rejected', reason: 'revoked' });
  });
});

describe('every rejection', () => {
  it('rejects a revoked family before anything else', () => {
    const s = scenario();
    const revoked = { ...s, family: revoke(s.family, NOW, 'revoked') };
    expect(decide(revoked)).toEqual({ kind: 'rejected', reason: 'revoked' });
  });

  it('rejects a family past its absolute deadline', () => {
    const s = scenario();
    expect(decide(s, { now: NOW + ABSOLUTE_MS })).toEqual({
      kind: 'rejected',
      reason: 'family_expired',
    });
  });

  it('rejects the live token once it has expired', () => {
    const s = scenario();
    expect(decide(s, { now: NOW + TTL_MS })).toEqual({ kind: 'rejected', reason: 'expired' });
  });

  it('rejects a hash this family never issued, without revoking', () => {
    // Not treated as an attack. Reuse means a token the family really
    // issued came back; an unrecognised value never was one, and
    // revoking on it would let anyone who can send a corrupt cookie end
    // a session.
    const s = scenario();
    const stranger = mintToken(s.family.id).hash;
    const decision = decide(s, { presentedHash: stranger });

    expect(decision).toEqual({ kind: 'rejected', reason: 'unknown_token' });
  });

  it('rejects a family with no live token', () => {
    const s = scenario({ current: undefined });
    expect(decide(s)).toEqual({ kind: 'rejected', reason: 'unknown_token' });
  });

  it('is exactly at the boundary, not one tick early', () => {
    const s = scenario();
    expect(decide(s, { now: NOW + TTL_MS - 1 }).kind).toBe('rotated');
    expect(decide(s, { now: NOW + TTL_MS }).kind).toBe('rejected');
    expect(decide(s, { now: NOW + ABSOLUTE_MS - 1 }).kind).toBe('rejected'); // token expired first
  });
});

describe('revoke', () => {
  it('moves the live token into the used set so it stays recognisable', () => {
    const s = scenario();
    const revoked = revoke(s.family, NOW, 'revoked');

    expect(revoked.current).toBeUndefined();
    expect(revoked.usedHashes).toContain(s.currentToken.hash);
    expect(revoked.revokedReason).toBe('revoked');
  });

  it('is idempotent and keeps the original reason', () => {
    const s = scenario();
    const once = revoke(s.family, NOW, 'reuse_detected');
    const twice = revoke(once, NOW + 5_000, 'revoked');

    expect(twice).toBe(once);
    expect(twice.revokedReason).toBe('reuse_detected');
    expect(twice.revokedAt).toBe(NOW);
  });

  it('handles a family that already has no live token', () => {
    const s = scenario({ current: undefined });
    const revoked = revoke(s.family, NOW, 'revoked');
    expect(revoked.usedHashes).toEqual([]);
    expect(revoked.revokedAt).toBe(NOW);
  });
});

describe('completeness', () => {
  it('produces every outcome the machine is capable of', () => {
    // Guards against a reason being added to `RefreshFailureReason`
    // without a case landing on it. `satisfies` makes the compiler
    // check the table is total, and the runtime assertions check the
    // machine actually reaches each one — a table that merely *names*
    // every reason would prove nothing.
    const s = scenario();

    const cases = {
      revoked: decide({ ...s, family: revoke(s.family, NOW, 'revoked') }),
      family_expired: decide(s, { now: NOW + ABSOLUTE_MS }),
      expired: decide(s, { now: NOW + TTL_MS }),
      unknown_token: decide(s, { presentedHash: mintToken(s.family.id).hash }),
    } satisfies Record<
      Exclude<RefreshFailureReason, 'malformed' | 'unknown_family' | 'reused'>,
      ReturnType<typeof decideRotation>
    >;

    for (const [reason, decision] of Object.entries(cases)) {
      expect(decision.kind, reason).toBe('rejected');
      if (decision.kind === 'rejected') expect(decision.reason).toBe(reason);
    }

    // The three left out are produced elsewhere, by design:
    // `reused` has its own block above (it returns `kind: 'reuse'`, not
    // a rejection, because it must be persisted); `malformed` and
    // `unknown_family` belong to the service, which resolves a token to
    // a family before the machine ever runs. Both are covered in
    // tests/unit/refresh.test.ts.
    expect(decide(s).kind).toBe('rotated');
  });
});
