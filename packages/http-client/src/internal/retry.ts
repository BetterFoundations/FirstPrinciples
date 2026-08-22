import type { AppError } from '@firstprinciples/core';
import type { ApiErr, ApiResult, RetryConfig } from '../types.js';

const DEFAULT_ATTEMPTS = 2;
const DEFAULT_BACKOFF_MS = 200;

/** Never retries a 4xx response or a schema-validation failure. */
export function defaultRetryOn(failure: ApiErr): boolean {
  if (failure.kind === 'network') return true;
  if (failure.kind === 'validation') return false;
  return failure.status !== undefined && failure.status >= 500;
}

/** A fully-resolved retry policy — every field of {@link RetryConfig} present. */
export interface ResolvedRetryConfig {
  readonly attempts: number;
  readonly backoffMs: number;
  readonly retryOn: (failure: ApiErr) => boolean;
}

const NO_RETRY: ResolvedRetryConfig = {
  attempts: 1,
  backoffMs: 0,
  retryOn: () => false,
};

/**
 * Resolves a possibly-partial {@link RetryConfig} — from client defaults, a
 * per-call override, or `false` to disable retries — into a config with
 * every field present.
 */
export function resolveRetryConfig(
  override: false | RetryConfig | undefined,
  base: ResolvedRetryConfig | undefined = undefined,
): ResolvedRetryConfig {
  if (override === false) return NO_RETRY;
  if (override === undefined) return base ?? resolveRetryConfig({});
  return {
    attempts: override.attempts ?? base?.attempts ?? DEFAULT_ATTEMPTS,
    backoffMs: override.backoffMs ?? base?.backoffMs ?? DEFAULT_BACKOFF_MS,
    retryOn: override.retryOn ?? base?.retryOn ?? defaultRetryOn,
  };
}

/**
 * Computes a "full jitter" backoff delay for a 0-indexed retry attempt:
 * a value drawn uniformly from `[0, backoffMs * 2^attemptIndex]`.
 *
 * @remarks
 * Full jitter (rather than a fixed exponential delay, or "equal jitter")
 * is what actually avoids a thundering herd: every client backs off by a
 * different amount even when they all failed at the same instant.
 */
export function computeBackoffMs(attemptIndex: number, backoffMs: number): number {
  const cap = backoffMs * 2 ** attemptIndex;
  return Math.random() * cap;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Runs `attempt` up to `config.attempts` times, waiting a jittered
 * exponential backoff between attempts, stopping as soon as `attempt`
 * succeeds or `config.retryOn` returns `false` for the failure.
 */
export async function executeWithRetry<T, E extends AppError>(
  attempt: () => Promise<ApiResult<T, E>>,
  config: ResolvedRetryConfig,
): Promise<ApiResult<T, E>> {
  let result = await attempt();

  for (let attemptIndex = 0; attemptIndex < config.attempts - 1; attemptIndex += 1) {
    if (result.ok) return result;
    if (!config.retryOn(result)) return result;

    await delay(computeBackoffMs(attemptIndex, config.backoffMs));
    result = await attempt();
  }

  return result;
}
