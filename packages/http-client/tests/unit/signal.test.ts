import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCombinedSignal } from '../../src/internal/signal.js';

describe('createCombinedSignal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns an unaborted signal that has not yet timed out', () => {
    const { signal, cleanup } = createCombinedSignal(1000);
    expect(signal.aborted).toBe(false);
    cleanup();
  });

  it('aborts with a TimeoutError once the timeout elapses, with no caller signal', async () => {
    const { signal, cleanup } = createCombinedSignal(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(signal.aborted).toBe(true);
    expect((signal.reason as DOMException).name).toBe('TimeoutError');
    cleanup();
  });

  it('does not abort before the configured timeout', async () => {
    const { signal, cleanup } = createCombinedSignal(1000);
    await vi.advanceTimersByTimeAsync(999);

    expect(signal.aborted).toBe(false);
    cleanup();
  });

  it('cleanup cancels the pending timer, so it never fires afterward', async () => {
    const { signal, cleanup } = createCombinedSignal(1000);
    cleanup();
    await vi.advanceTimersByTimeAsync(1000);

    expect(signal.aborted).toBe(false);
  });

  describe('with a caller-supplied signal', () => {
    it('still aborts on the internal timeout — the caller signal does not silently replace it', async () => {
      const callerController = new AbortController();
      const { signal, cleanup } = createCombinedSignal(1000, callerController.signal);

      await vi.advanceTimersByTimeAsync(1000);

      expect(signal.aborted).toBe(true);
      expect((signal.reason as DOMException).name).toBe('TimeoutError');
      expect(callerController.signal.aborted).toBe(false);
      cleanup();
    });

    it('aborts immediately when the caller aborts first, before the timeout', async () => {
      const callerController = new AbortController();
      const { signal, cleanup } = createCombinedSignal(5000, callerController.signal);

      await vi.advanceTimersByTimeAsync(100);
      callerController.abort('caller cancelled');

      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBe('caller cancelled');
      cleanup();
    });

    it('clears the timeout once the caller aborts, so no dangling timer remains', async () => {
      const callerController = new AbortController();
      const { cleanup } = createCombinedSignal(5000, callerController.signal);

      callerController.abort();
      cleanup();

      expect(vi.getTimerCount()).toBe(0);
    });

    it('returns the caller signal directly when it is already aborted', () => {
      const callerController = new AbortController();
      callerController.abort('already gone');

      const { signal, cleanup } = createCombinedSignal(1000, callerController.signal);

      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBe('already gone');
      expect(vi.getTimerCount()).toBe(0);
      cleanup();
    });

    it('whichever fires first wins: the timeout, when it is shorter', async () => {
      const callerController = new AbortController();
      const { signal, cleanup } = createCombinedSignal(100, callerController.signal);

      await vi.advanceTimersByTimeAsync(100);
      callerController.abort('too late');

      expect((signal.reason as DOMException).name).toBe('TimeoutError');
      cleanup();
    });

    it('detaches its listeners on cleanup, so a later caller-abort does not throw or relabel the signal', async () => {
      const callerController = new AbortController();
      const { signal, cleanup } = createCombinedSignal(1000, callerController.signal);
      cleanup();

      expect(() => {
        callerController.abort('after cleanup');
      }).not.toThrow();
      expect(signal.aborted).toBe(false);
    });
  });
});
