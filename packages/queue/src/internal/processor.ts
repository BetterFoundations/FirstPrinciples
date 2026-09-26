import { isAppError } from '@firstprinciples/core';
import { PermanentJobError } from '../errors.js';
import type { JobHandler, JobMap, QueueLogger, QueueMetrics } from '../types.js';
import { emit, messageOf, own, unrecoverable, willRetry, type JobLike } from './shared.js';

export interface ProcessorDeps {
  readonly queue: string;
  readonly jobs: JobMap;
  readonly handlers: Readonly<Record<string, JobHandler<unknown, unknown>>>;
  readonly metrics: QueueMetrics;
  readonly logger: QueueLogger;
}

function isPermanentJobError(error: unknown): boolean {
  // `isAppError` is `core`'s Symbol.for brand, so this holds across a
  // duplicated (ESM + CJS) copy of this package too.
  return (
    error instanceof PermanentJobError || (isAppError(error) && error.name === 'PermanentJobError')
  );
}

/**
 * The function BullMQ calls for each job. Resolves the handler, validates
 * the payload, runs the handler, times it, and turns a permanent failure
 * into an `UnrecoverableError` so BullMQ skips the remaining attempts.
 * Declared with three parameters on purpose: BullMQ only passes the abort
 * signal to a processor whose arity is at least 3.
 */
export function createProcessor(deps: ProcessorDeps) {
  const { queue, jobs, handlers, metrics, logger } = deps;

  return async (
    job: JobLike,
    _token: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<unknown> => {
    const id = job.id ?? '';
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? 1;
    const startedAt = Date.now();

    const fail = (error: unknown): never => {
      emit(
        metrics.onFailed,
        {
          queue,
          name: job.name,
          id,
          attempt,
          maxAttempts,
          durationMs: Date.now() - startedAt,
          error: messageOf(error),
          willRetry: willRetry(job, error),
        },
        logger,
        'onFailed',
      );
      throw error;
    };

    const definition = own(jobs, job.name);
    const handler = own(handlers, job.name);
    if (definition === undefined || handler === undefined) {
      return fail(unrecoverable(`No handler for job "${job.name}"`, 'unknown-job'));
    }

    let data = job.data;
    if (definition.validate !== undefined) {
      try {
        data = definition.validate(job.data);
      } catch (error) {
        return fail(
          unrecoverable(
            `Invalid payload for job "${job.name}": ${messageOf(error)}`,
            'invalid-payload',
            error,
          ),
        );
      }
    }

    let result: unknown;
    try {
      result = await handler(data, { id, name: job.name, attempt, maxAttempts, signal });
    } catch (error) {
      let permanent = isPermanentJobError(error);
      if (!permanent && definition.isPermanent !== undefined) {
        try {
          permanent = definition.isPermanent(error) === true;
        } catch (predicateError) {
          logger.warn('isPermanent threw; treating the failure as retryable', {
            queue,
            name: job.name,
            error: messageOf(predicateError),
          });
        }
      }
      return fail(permanent ? unrecoverable(messageOf(error), 'permanent', error) : error);
    }

    emit(
      metrics.onCompleted,
      {
        queue,
        name: job.name,
        id,
        attempt,
        durationMs: Date.now() - startedAt,
        waitMs: Math.max(0, (job.processedOn ?? startedAt) - job.timestamp),
      },
      logger,
      'onCompleted',
    );
    return result;
  };
}
