import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { createFailureHandler } from './internal/failure.js';
import { createProcessor } from './internal/processor.js';
import {
  assertJobMap,
  deadLetterQueueName,
  defaultLogger,
  emit,
  messageOf,
  type JobLike,
} from './internal/shared.js';
import { createQueue } from './queue.js';
import type { JobHandler, JobHandlers, JobMap, QueueLogger, QueueMetrics } from './types.js';

/**
 * Options for {@link createWorker}.
 *
 * @public
 */
export interface CreateWorkerOptions<J extends JobMap> {
  /** The queue to consume. */
  readonly name: string;
  /** The same job map the producer uses. */
  readonly jobs: J;
  /** One handler per job name — checked exhaustively at compile time. */
  readonly handlers: JobHandlers<J>;
  /** Passed to BullMQ as-is. */
  readonly connection: ConnectionOptions;
  readonly prefix?: string;
  /** Jobs processed at once by this worker. Default 1. */
  readonly concurrency?: number;
  readonly metrics?: QueueMetrics;
  /** Where hook errors and dead-letter write failures go. Default `console`. */
  readonly logger?: QueueLogger;
  /** When set, samples queue depth this often and reports it to `metrics.onDepth`. */
  readonly depthIntervalMs?: number;
  /** How long a job's lock lasts before it is presumed stalled. BullMQ default 30 000. */
  readonly lockDurationMs?: number;
  /** How often to look for stalled jobs. BullMQ default 30 000. */
  readonly stalledIntervalMs?: number;
  /** Stalls allowed before a job is failed and dead-lettered as `stalled`. BullMQ default 1. */
  readonly maxStalledCount?: number;
  /** Start consuming immediately. Default `true`; pass `false` to start from a lifecycle manager. */
  readonly autostart?: boolean;
}

/**
 * A running consumer. Structurally a `@firstprinciples/bootstrap` resource:
 * `service.addResource(worker)` starts it and drains it on shutdown.
 *
 * @public
 */
export interface TypedWorker {
  /** `"<queue>-worker"`. */
  readonly name: string;
  /** Starts consuming, if not already. Resolves once connected. */
  start(): Promise<void>;
  /**
   * Stops taking new jobs and waits for active ones to finish. If `signal`
   * aborts first, active handlers' own signals are aborted so cooperative
   * handlers can stop early (their jobs are retried later).
   */
  stop(signal?: AbortSignal): Promise<void>;
  /** The underlying BullMQ worker. */
  readonly bull: Worker;
}

/**
 * Creates a worker for a queue.
 *
 * @example
 * ```ts
 * const worker = createWorker({
 *   name: 'emails',
 *   jobs,
 *   connection,
 *   handlers: {
 *     sendEmail: async ({ to, template }) => ({ messageId: await mailer.send(to, template) }),
 *   },
 *   metrics: { onDeadLettered: (e) => deadLetters.inc({ queue: e.queue, reason: e.reason }) },
 * });
 * ```
 *
 * @public
 */
export function createWorker<J extends JobMap>(options: CreateWorkerOptions<J>): TypedWorker {
  assertJobMap(options.jobs);
  const logger = options.logger ?? defaultLogger;
  const metrics = options.metrics ?? {};
  const base = {
    connection: options.connection,
    ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
  };

  const deadLetters = new Queue(deadLetterQueueName(options.name), base);
  const processor = createProcessor({
    queue: options.name,
    jobs: options.jobs,
    handlers: options.handlers as Readonly<Record<string, JobHandler<unknown, unknown>>>,
    metrics,
    logger,
  });
  const onFailed = createFailureHandler({
    queue: options.name,
    deadLetter: deadLetters,
    metrics,
    logger,
  });

  const worker = new Worker(options.name, processor, {
    ...base,
    autorun: false,
    concurrency: options.concurrency ?? 1,
    ...(options.lockDurationMs === undefined ? {} : { lockDuration: options.lockDurationMs }),
    ...(options.stalledIntervalMs === undefined
      ? {}
      : { stalledInterval: options.stalledIntervalMs }),
    ...(options.maxStalledCount === undefined ? {} : { maxStalledCount: options.maxStalledCount }),
  });

  // Dead-letter writes still in flight, so stop() can wait for them before
  // closing the connection they use.
  const pendingWrites = new Set<Promise<void>>();
  worker.on('failed', (job, error) => {
    const write = onFailed(job as JobLike | undefined, error).finally(() =>
      pendingWrites.delete(write),
    );
    pendingWrites.add(write);
  });
  // An EventEmitter 'error' with no listener throws and would crash the
  // process on a transient Redis error.
  worker.on('error', (error) =>
    logger.error('queue worker error', { queue: options.name, error: messageOf(error) }),
  );

  let depthTimer: ReturnType<typeof setInterval> | undefined;
  let depthQueue: ReturnType<typeof createQueue<J>> | undefined;
  let running: Promise<void> | undefined;
  let stopping: Promise<void> | undefined;

  const sampleDepth = async (): Promise<void> => {
    if (depthQueue === undefined) return;
    try {
      const depth = await depthQueue.depth();
      emit(metrics.onDepth, { queue: options.name, ...depth }, logger, 'onDepth');
    } catch (error) {
      logger.warn('queue depth sample failed', { queue: options.name, error: messageOf(error) });
    }
  };

  const typed: TypedWorker = {
    name: `${options.name}-worker`,
    bull: worker,

    start() {
      running ??= (async () => {
        void worker.run().catch((error: unknown) => {
          logger.error('queue worker stopped unexpectedly', {
            queue: options.name,
            error: messageOf(error),
          });
        });
        await worker.waitUntilReady();
        if (options.depthIntervalMs !== undefined && metrics.onDepth !== undefined) {
          depthQueue = createQueue({
            name: options.name,
            jobs: options.jobs,
            connection: options.connection,
            ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
          });
          depthTimer = setInterval(() => void sampleDepth(), options.depthIntervalMs);
          depthTimer.unref();
        }
      })();
      return running;
    },

    stop(signal) {
      stopping ??= (async () => {
        if (depthTimer !== undefined) clearInterval(depthTimer);
        const cancel = (): void => worker.cancelAllJobs('worker shutdown deadline passed');
        if (signal?.aborted === true) cancel();
        else signal?.addEventListener('abort', cancel, { once: true });
        try {
          await worker.close();
        } finally {
          signal?.removeEventListener('abort', cancel);
          await Promise.allSettled([...pendingWrites]);
          await Promise.all([deadLetters.close(), depthQueue?.close()]);
        }
      })();
      return stopping;
    },
  };

  if (options.autostart !== false) void typed.start();
  return typed;
}
