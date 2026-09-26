import { ValidationError } from '@firstprinciples/core';
import type { JobDefinition, RetryPolicy } from './types.js';

/**
 * Ready-made {@link RetryPolicy} values. Exponential presets carry 50 %
 * jitter so a burst of failures does not retry in lockstep. (BullMQ's
 * jitter only shortens a delay: each lands in `[½ × max, max]`.)
 *
 * - `none` — one attempt; straight to the dead-letter queue on failure.
 * - `standard` — 5 attempts, exponential from 1 s: retries after 0.5–1,
 *   1–2, 2–4 and 4–8 s.
 * - `patient` — 10 attempts, exponential from 5 s: nine retries spread over
 *   21–43 minutes in total. For flaky third-party APIs.
 * - `fixed(attempts, delayMs)` — the same delay every time.
 *
 * @public
 */
export const retryPresets = {
  none: { attempts: 1 },
  standard: { attempts: 5, backoff: { type: 'exponential', delayMs: 1000, jitter: 0.5 } },
  patient: { attempts: 10, backoff: { type: 'exponential', delayMs: 5000, jitter: 0.5 } },
  fixed: (attempts: number, delayMs: number): RetryPolicy => ({
    attempts,
    backoff: { type: 'fixed', delayMs },
  }),
} as const satisfies Record<string, RetryPolicy | ((...args: never[]) => RetryPolicy)>;

/**
 * Options for {@link defineJob}.
 *
 * @public
 */
export interface DefineJobOptions<TData> {
  /** Default {@link retryPresets}.standard. */
  readonly retry?: RetryPolicy;
  /** See {@link JobDefinition.validate}. When given, the payload type is inferred from its return type. */
  readonly validate?: (data: unknown) => TData;
  /** See {@link JobDefinition.isPermanent}. */
  readonly isPermanent?: (error: unknown) => boolean;
}

function assertPolicy(policy: RetryPolicy): void {
  const problems: string[] = [];
  if (!Number.isInteger(policy.attempts) || policy.attempts < 1)
    problems.push('attempts must be an integer ≥ 1');
  const backoff = policy.backoff;
  if (backoff !== undefined) {
    if (backoff.type !== 'fixed' && backoff.type !== 'exponential')
      problems.push("backoff.type must be 'fixed' or 'exponential'");
    if (!Number.isFinite(backoff.delayMs) || backoff.delayMs < 0)
      problems.push('backoff.delayMs must be a finite number ≥ 0');
    const jitter = backoff.jitter ?? 0;
    if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1)
      problems.push('backoff.jitter must be between 0 and 1');
  }
  if (problems.length > 0) {
    throw new ValidationError(`Invalid retry policy: ${problems.join('; ')}`, {
      details: { problems },
    });
  }
}

/**
 * Declares one job type. The payload and result types are written here,
 * once; every `add` call and every handler is checked against them.
 *
 * @example
 * ```ts
 * const jobs = {
 *   sendEmail: defineJob<{ to: string; template: string }, { messageId: string }>(),
 *   resizeImage: defineJob({ validate: (d) => imageSchema.parse(d), retry: retryPresets.patient }),
 * };
 * ```
 *
 * @throws `ValidationError` if the retry policy is invalid — at definition
 * time, not on the first failure in production.
 *
 * @public
 */
export function defineJob<TData, TResult = void>(
  options: DefineJobOptions<TData> = {},
): JobDefinition<TData, TResult> {
  const retry = options.retry ?? retryPresets.standard;
  assertPolicy(retry);
  return Object.freeze({ retry, validate: options.validate, isPermanent: options.isPermanent });
}
