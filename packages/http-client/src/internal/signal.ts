/** A combined signal, and the cleanup that must run once the attempt settles. */
export interface CombinedSignal {
  /** Aborts when the internal timeout fires, the caller's signal fires, or both. */
  readonly signal: AbortSignal;
  /** Clears the timeout timer and detaches listeners. Idempotent. */
  readonly cleanup: () => void;
}

/**
 * Builds the signal a single attempt is issued with: an internal timeout
 * controller, combined with an optional caller-supplied signal so that
 * whichever fires first aborts the request.
 *
 * @remarks
 * This is the fix for the "easy to get subtly wrong" bug named in this
 * package's brief: a caller-supplied `signal` must never silently replace
 * the timeout. Every path below produces a signal that is still bound to
 * the timeout even when a caller signal is present.
 */
export function createCombinedSignal(
  timeoutMs: number,
  callerSignal?: AbortSignal,
): CombinedSignal {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => {
    timeoutController.abort(
      new DOMException(`Timed out after ${String(timeoutMs)}ms`, 'TimeoutError'),
    );
  }, timeoutMs);

  if (!callerSignal) {
    return {
      signal: timeoutController.signal,
      cleanup: () => {
        clearTimeout(timer);
      },
    };
  }

  if (callerSignal.aborted) {
    clearTimeout(timer);
    return { signal: callerSignal, cleanup: () => undefined };
  }

  const combinedController = new AbortController();
  const onTimeout = (): void => combinedController.abort(timeoutController.signal.reason);
  const onCallerAbort = (): void => combinedController.abort(callerSignal.reason);

  timeoutController.signal.addEventListener('abort', onTimeout, { once: true });
  callerSignal.addEventListener('abort', onCallerAbort, { once: true });

  return {
    signal: combinedController.signal,
    cleanup: () => {
      clearTimeout(timer);
      timeoutController.signal.removeEventListener('abort', onTimeout);
      callerSignal.removeEventListener('abort', onCallerAbort);
    },
  };
}
