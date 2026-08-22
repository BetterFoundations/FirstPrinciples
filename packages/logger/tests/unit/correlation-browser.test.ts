import { describe, expect, it } from 'vitest';
import {
  generateCorrelationId,
  getCorrelationId,
  runWithCorrelationId,
} from '../../src/internal/correlation-browser.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('correlation-browser', () => {
  it('has no active correlation ID outside any run', () => {
    expect(getCorrelationId()).toBeUndefined();
  });

  it('exposes the ID for the duration of a synchronous run, then restores the previous value', () => {
    const seen = runWithCorrelationId('abc', () => getCorrelationId());
    expect(seen).toBe('abc');
    expect(getCorrelationId()).toBeUndefined();
  });

  it('restores the previous ID even when the synchronous fn throws', () => {
    expect(() =>
      runWithCorrelationId('abc', () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(getCorrelationId()).toBeUndefined();
  });

  it('keeps the ID active until an async fn settles, then restores it', async () => {
    const seen = await runWithCorrelationId('req-1', async () => {
      await delay(1);
      return getCorrelationId();
    });
    expect(seen).toBe('req-1');
    expect(getCorrelationId()).toBeUndefined();
  });

  it('restores the previous ID when an async fn rejects', async () => {
    await expect(
      runWithCorrelationId('abc', async () => {
        await delay(1);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(getCorrelationId()).toBeUndefined();
  });

  it('generates a fresh UUID each call', () => {
    const a = generateCorrelationId();
    const b = generateCorrelationId();
    expect(a).not.toBe(b);
  });

  it('KNOWN LIMITATION: two overlapping async runs leak into each other (no real continuation tracking)', async () => {
    // req-a's shorter delay resolves first, while req-b is still "active" —
    // req-a's continuation incorrectly reads req-b's ID. req-a's `finally`
    // then resets the shared variable to its own `previous` (undefined),
    // which clobbers req-b's still-pending run too. Both results are wrong;
    // that is the point of this test. This is the documented trade-off on
    // correlation-browser.ts — only the Node entry (AsyncLocalStorage) gives
    // real per-call isolation across overlapping async work.
    const runA = runWithCorrelationId('req-a', async () => {
      await delay(1);
      return getCorrelationId();
    });
    const runB = runWithCorrelationId('req-b', async () => {
      await delay(5);
      return getCorrelationId();
    });
    const [a, b] = await Promise.all([runA, runB]);
    expect(a).toBe('req-b');
    expect(b).toBeUndefined();
  });
});
