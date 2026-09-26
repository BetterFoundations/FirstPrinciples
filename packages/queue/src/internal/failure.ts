import type { DeadLetterReason, QueueLogger, QueueMetrics } from '../types.js';
import {
  DEAD_LETTER_REASON,
  deadLetterJobId,
  emit,
  isUnrecoverable,
  messageOf,
  type JobLike,
} from './shared.js';

/** What a dead-letter job stores. */
export interface DeadLetterPayload {
  readonly originalId: string;
  readonly data: unknown;
  readonly reason: DeadLetterReason;
  readonly error: string;
  readonly attempts: number;
  readonly failedAt: string;
}

export interface DeadLetterSink {
  add(
    name: string,
    data: DeadLetterPayload,
    opts: { jobId: string; removeOnComplete: boolean },
  ): Promise<unknown>;
}

const REASONS: ReadonlySet<string> = new Set([
  'exhausted',
  'permanent',
  'invalid-payload',
  'unknown-job',
  'stalled',
]);

// The two messages BullMQ's worker fails a job with *without* calling the
// processor: a job whose worker died mid-job too often (a deferred failure
// set by moveStalledJobsToWait) and one started too many times.
const STALLED = /stalled more than allowable limit|started more than allowable limit/;

export function classify(error: unknown): DeadLetterReason {
  if (error instanceof Error) {
    // eslint-disable-next-line security/detect-object-injection -- a fixed, package-owned Symbol key
    const tagged = (error as unknown as Record<symbol, unknown>)[DEAD_LETTER_REASON];
    if (typeof tagged === 'string' && REASONS.has(tagged)) return tagged as DeadLetterReason;
    if (STALLED.test(error.message)) return 'stalled';
  }
  return isUnrecoverable(error) ? 'permanent' : 'exhausted';
}

/**
 * Whether BullMQ has just failed `job` for good. Evaluated in the worker's
 * `failed` event, i.e. *after* BullMQ incremented `attemptsMade` — the same
 * rule as `Job#shouldRetryJob`, one attempt later.
 */
export function isFinal(job: JobLike, error: unknown): boolean {
  return isUnrecoverable(error) || job.attemptsMade >= (job.opts.attempts ?? 1);
}

export interface FailureDeps {
  readonly queue: string;
  readonly deadLetter: DeadLetterSink;
  readonly metrics: QueueMetrics;
  readonly logger: QueueLogger;
  readonly now?: () => Date;
}

/**
 * The worker's `failed` listener. Every final failure — exhausted retries,
 * a permanent error, a bad payload, an unknown job, a job that stalled too
 * often — reaches BullMQ's `failed` event, so this is the one place jobs are
 * dead-lettered. The dead-letter job id is derived from the original id, so
 * a repeated call for the same job cannot create a second entry.
 */
export function createFailureHandler(deps: FailureDeps) {
  const { queue, deadLetter, metrics, logger } = deps;
  const now = deps.now ?? (() => new Date());

  return async (job: JobLike | undefined, error: unknown): Promise<void> => {
    if (job === undefined || job.id === undefined) {
      logger.warn('job failed without an id; cannot dead-letter it', {
        queue,
        error: messageOf(error),
      });
      return;
    }
    if (!isFinal(job, error)) return;

    const reason = classify(error);
    const payload: DeadLetterPayload = {
      originalId: job.id,
      data: job.data,
      reason,
      error: messageOf(error),
      attempts: job.attemptsMade,
      failedAt: now().toISOString(),
    };
    try {
      await deadLetter.add(job.name, payload, {
        jobId: deadLetterJobId(job.id),
        removeOnComplete: false,
      });
    } catch (writeError) {
      // The job stays in the main queue's failed set; nothing is lost, it
      // is only not in the dead-letter queue.
      logger.error('failed to dead-letter a job; it remains in the failed set', {
        queue,
        name: job.name,
        id: job.id,
        error: messageOf(writeError),
      });
      return;
    }
    emit(
      metrics.onDeadLettered,
      { queue, name: job.name, id: job.id, reason, attempts: job.attemptsMade },
      logger,
      'onDeadLettered',
    );
  };
}
