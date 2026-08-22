/**
 * Best-effort correlation ID tracking for environments with no
 * `AsyncLocalStorage` (every browser today). Backed by a single module-level
 * variable rather than real continuation tracking:
 *
 * - a synchronous `fn` is scoped correctly — the ID is restored the instant
 *   `fn` returns, so it can't leak into unrelated code that runs afterward.
 * - an async `fn` keeps the ID active until its returned promise settles,
 *   which covers the common case (one in-flight async action at a time) but
 *   is **not** isolation: two overlapping calls to `runWithCorrelationId`
 *   racing on the same event loop will see each other's ID, because both
 *   share this one variable. There is no browser primitive that fixes this
 *   short of the still-experimental `AsyncContext` proposal.
 */
let current: string | undefined;

/** A fresh random correlation ID (a UUID v4), via the platform `crypto` global. */
export function generateCorrelationId(): string {
  return globalThis.crypto.randomUUID();
}

export function runWithCorrelationId<T>(id: string, fn: () => T): T {
  const previous = current;
  current = id;
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.finally(() => {
        current = previous;
      }) as T;
    }
    current = previous;
    return result;
  } catch (error) {
    current = previous;
    throw error;
  }
}

export function getCorrelationId(): string | undefined {
  return current;
}
