import { describe, expect, it } from 'vitest';

import type { TokenFamily } from '../../src/internal/refresh-state.js';
import {
  hashesMatch,
  mintToken,
  newFamilyId,
  parseToken,
} from '../../src/internal/token-format.js';
import { createMemoryRefreshTokenStore } from '../../src/stores.js';

function family(overrides: Partial<TokenFamily> = {}): TokenFamily {
  const id = newFamilyId();
  return {
    id,
    subject: 'user-1',
    createdAt: 0,
    absoluteExpiresAt: Number.MAX_SAFE_INTEGER,
    current: { hash: mintToken(id).hash, issuedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER },
    usedHashes: [],
    revokedAt: undefined,
    revokedReason: undefined,
    ...overrides,
  };
}

describe('the memory refresh-token store', () => {
  it('reads back what it created, with a revision', async () => {
    const store = createMemoryRefreshTokenStore();
    const f = family();

    expect(await store.create(f)).toBe(true);
    const stored = await store.read(f.id);
    expect(stored?.family).toEqual(f);
    expect(stored?.revision).toBeDefined();
  });

  it('refuses to create over an existing family', async () => {
    const store = createMemoryRefreshTokenStore();
    const f = family();
    await store.create(f);

    expect(await store.create({ ...f, subject: 'attacker' })).toBe(false);
    expect((await store.read(f.id))?.family.subject).toBe('user-1');
  });

  it('returns undefined for an unknown family', async () => {
    expect(await createMemoryRefreshTokenStore().read('nope')).toBeUndefined();
  });

  it('bumps the revision on every write, so a stale one is rejected', async () => {
    const store = createMemoryRefreshTokenStore();
    const f = family();
    await store.create(f);

    const first = await store.read(f.id);
    expect(first).toBeDefined();
    if (first === undefined) return;

    expect(await store.compareAndSet({ ...f, subject: 'changed' }, first.revision)).toBe(true);
    // The same revision a second time is exactly the lost-update case.
    expect(await store.compareAndSet({ ...f, subject: 'again' }, first.revision)).toBe(false);
    expect((await store.read(f.id))?.family.subject).toBe('changed');
  });

  it('rejects a compare-and-set against a family that is gone', async () => {
    const store = createMemoryRefreshTokenStore();
    expect(await store.compareAndSet(family(), 1)).toBe(false);
  });

  it('deletes, and deleting something absent is a no-op', async () => {
    const store = createMemoryRefreshTokenStore();
    const f = family();
    await store.create(f);

    await store.delete(f.id);
    expect(await store.read(f.id)).toBeUndefined();
    await expect(store.delete('never-existed')).resolves.toBeUndefined();
  });

  it('evicts a family once it passes its absolute deadline', async () => {
    let now = 1_000;
    const store = createMemoryRefreshTokenStore({ clock: () => now });
    const f = family({ absoluteExpiresAt: 2_000 });
    await store.create(f);

    expect(await store.read(f.id)).toBeDefined();
    now = 2_000;
    expect(await store.read(f.id)).toBeUndefined();
  });

  it('lets a new family reuse the id of an evicted one', async () => {
    let now = 1_000;
    const store = createMemoryRefreshTokenStore({ clock: () => now });
    const f = family({ absoluteExpiresAt: 2_000 });
    await store.create(f);

    now = 2_000;
    expect(await store.create({ ...f, absoluteExpiresAt: 9_000, subject: 'user-2' })).toBe(true);
    expect((await store.read(f.id))?.family.subject).toBe('user-2');
  });
});

describe('token format', () => {
  it('mints a token that parses back to the same family and hash', () => {
    const id = newFamilyId();
    const minted = mintToken(id);
    const parsed = parseToken(minted.token);

    expect(parsed?.familyId).toBe(id);
    expect(parsed?.presentedHash).toBe(minted.hash);
  });

  it('never puts the stored hash in the token', () => {
    // The store holds a digest; the client holds the preimage. Reading
    // the store must not hand anyone a usable token.
    const minted = mintToken(newFamilyId());
    expect(minted.token).not.toContain(minted.hash);
  });

  it('mints a distinct secret every time', () => {
    const id = newFamilyId();
    const tokens = new Set(Array.from({ length: 100 }, () => mintToken(id).token));
    expect(tokens.size).toBe(100);
  });

  it.each([
    ['a non-string', 42],
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['no separator', 'justonepart'],
    ['a leading separator', '.secret'],
    ['a trailing separator', 'family.'],
    ['two separators', 'family.secret.more'],
    ['only a separator', '.'],
  ])('refuses to parse %s', (_label, token) => {
    expect(parseToken(token)).toBeUndefined();
  });

  it('hashes deterministically, so the same secret always resolves', () => {
    const id = newFamilyId();
    const minted = mintToken(id);
    expect(parseToken(minted.token)?.presentedHash).toBe(parseToken(minted.token)?.presentedHash);
  });
});

describe('hashesMatch', () => {
  it('matches identical hashes and rejects different ones', () => {
    const a = mintToken(newFamilyId()).hash;
    const b = mintToken(newFamilyId()).hash;

    expect(hashesMatch(a, a)).toBe(true);
    expect(hashesMatch(a, b)).toBe(false);
  });

  it('returns false on a length mismatch instead of throwing', () => {
    // `timingSafeEqual` throws a RangeError on unequal lengths. Stored
    // values come from a store this package does not own, so a
    // truncated row has to fail a comparison rather than crash a
    // refresh.
    const a = mintToken(newFamilyId()).hash;

    expect(() => hashesMatch(a, a.slice(0, 10))).not.toThrow();
    expect(hashesMatch(a, a.slice(0, 10))).toBe(false);
    expect(hashesMatch(a, '')).toBe(false);
    expect(hashesMatch('', '')).toBe(true);
  });

  it('rejects a hash differing only in the final character', () => {
    const a = mintToken(newFamilyId()).hash;
    const nearMiss = `${a.slice(0, -1)}${a.endsWith('A') ? 'B' : 'A'}`;

    expect(nearMiss).toHaveLength(a.length);
    expect(hashesMatch(a, nearMiss)).toBe(false);
  });
});
