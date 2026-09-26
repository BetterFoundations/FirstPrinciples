import { UnrecoverableError } from 'bullmq';
import type { DeadLetterReason, JobMap, QueueLogger, RetryPolicy } from '../types.js';

/** The fields of a BullMQ job this package reads — a real `Job` satisfies it, and so does a test double. */
export interface JobLike {
  readonly id?: string | undefined;
  readonly name: string;
  readonly data: unknown;
  readonly attemptsMade: number;
  readonly timestamp: number;
  readonly processedOn?: number | undefined;
  readonly opts: { readonly attempts?: number | undefined };
}

export const DEAD_LETTER_REASON = Symbol.for('@firstprinciples/queue/deadLetterReason');

/** The dead-letter queue's name for a queue. A `.` because BullMQ reserves `:` for its keys. */
export const deadLetterQueueName = (queue: string): string => `${queue}.dead-letter`;

/** The dead-letter job id for a main-queue job id — deterministic, so a second write for the same job is a no-op. */
export const deadLetterJobId = (originalId: string): string => `dead-${originalId}`;

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'unknown error';
}

/** Own-property lookup, so a job named `constructor` or `__proto__` never resolves to something inherited. */
export function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  // eslint-disable-next-line security/detect-object-injection -- guarded by the own-property check
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

/**
 * An error BullMQ will not retry, tagged with why. BullMQ checks
 * `instanceof UnrecoverableError || name === 'UnrecoverableError'`, so this
 * is a real `UnrecoverableError` — never a subclass with its own name, which
 * would lose the name check under a duplicated (ESM + CJS) bullmq.
 */
export function unrecoverable(
  message: string,
  reason: DeadLetterReason,
  cause?: unknown,
): UnrecoverableError {
  const error = new UnrecoverableError(message);
  Object.defineProperty(error, DEAD_LETTER_REASON, { value: reason });
  if (cause !== undefined)
    Object.defineProperty(error, 'cause', { value: cause, configurable: true, writable: true });
  return error;
}

export function isUnrecoverable(error: unknown): boolean {
  return (
    error instanceof UnrecoverableError ||
    (error instanceof Error && error.name === 'UnrecoverableError')
  );
}

/** Mirrors BullMQ's retry decision (`Job#shouldRetryJob`), evaluated *before* the attempt is counted. */
export function willRetry(job: JobLike, error: unknown): boolean {
  return !isUnrecoverable(error) && job.attemptsMade + 1 < (job.opts.attempts ?? 1);
}

/** The BullMQ job options a retry policy maps to. */
export function toBullRetryOptions(policy: RetryPolicy): {
  attempts: number;
  backoff?: { type: 'fixed' | 'exponential'; delay: number; jitter?: number };
} {
  if (policy.backoff === undefined) return { attempts: policy.attempts };
  const { type, delayMs, jitter } = policy.backoff;
  return {
    attempts: policy.attempts,
    backoff: { type, delay: delayMs, ...(jitter === undefined ? {} : { jitter }) },
  };
}

/** Calls a metrics hook; a throwing hook is logged, never propagated. */
export function emit<E>(
  hook: ((event: E) => void) | undefined,
  event: E,
  logger: QueueLogger,
  hookName: string,
): void {
  if (hook === undefined) return;
  try {
    hook(event);
  } catch (error) {
    logger.warn('queue metrics hook threw; ignored', { hook: hookName, error: messageOf(error) });
  }
}

export const defaultLogger: QueueLogger = {
  warn: (msg, fields) => console.warn(msg, fields ?? {}),
  error: (msg, fields) => console.error(msg, fields ?? {}),
};

export function assertJobMap(jobs: JobMap): void {
  if (Object.keys(jobs).length === 0)
    throw new TypeError('A queue needs at least one job definition');
}
