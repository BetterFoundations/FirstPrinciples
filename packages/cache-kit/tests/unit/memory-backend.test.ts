import { describe, expect, it } from 'vitest';
import { createMemoryBackend } from '../../src/backends/memory.js';

describe('createMemoryBackend', () => {
  it('is a miss for a key that was never set', async () => {
    const backend = createMemoryBackend();
    expect(await backend.get('missing')).toEqual({ hit: false });
  });

  it('round-trips a value', async () => {
    const backend = createMemoryBackend();
    await backend.set('a', { n: 1 });
    expect(await backend.get('a')).toEqual({ hit: true, value: { n: 1 } });
  });

  it('caches a value that is itself undefined, distinct from a miss', async () => {
    const backend = createMemoryBackend();
    await backend.set('a', undefined);
    expect(await backend.get('a')).toEqual({ hit: true, value: undefined });
  });

  it('overwrites a previous value on re-set', async () => {
    const backend = createMemoryBackend();
    await backend.set('a', 1);
    await backend.set('a', 2);
    expect(await backend.get('a')).toEqual({ hit: true, value: 2 });
  });

  it('delete removes a key; deleting an absent key is a no-op', async () => {
    const backend = createMemoryBackend();
    await backend.set('a', 1);
    await backend.delete('a');
    expect(await backend.get('a')).toEqual({ hit: false });
    await expect(backend.delete('never-existed')).resolves.toBeUndefined();
  });

  it('rejects a maxEntries below 1', () => {
    expect(() => createMemoryBackend({ maxEntries: 0 })).toThrow(RangeError);
  });

  it('tolerates a duplicate tag in the same set() call without crashing on cleanup', async () => {
    const backend = createMemoryBackend();
    await backend.set('a', 1, { tags: ['x', 'x'] });
    // Re-setting without tags removes 'a' from tag 'x' twice in a row
    // internally (once per duplicate entry in the original tags array) —
    // the second removal must be a tolerated no-op, not a crash.
    await expect(backend.set('a', 2, {})).resolves.toBeUndefined();
    expect(await backend.get('a')).toEqual({ hit: true, value: 2 });
  });
});
