import { Queue, QueueEvents, type ConnectionOptions, type Job } from 'bullmq';
import { InvalidJobError } from './errors.js';
import type { DeadLetterPayload } from './internal/failure.js';
import {
  assertJobMap,
  deadLetterQueueName,
  messageOf,
  own,
  toBullRetryOptions,
} from './internal/shared.js';
import type { DataOf, DeadLetterEntry, JobMap, JobName, QueueDepth, ResultOf } from './types.js';

/**
 * Options for {@link createQueue}.
 *
 * @public
 */
export interface CreateQueueOptions<J extends JobMap> {
  /** The queue's name. Producers and workers must agree on it. */
  readonly name: string;
  /** Every job type this queue carries. See {@link defineJob}. */
  readonly jobs: J;
  /** Passed to BullMQ as-is: ioredis options, a URL, or a client. */
  readonly connection: ConnectionOptions;
  /** BullMQ key prefix. Default BullMQ's (`bull`). */
  readonly prefix?: string;
}

/**
 * Per-job options for {@link TypedQueue.add}.
 *
 * @public
 */
export interface AddOptions {
  /** Run no earlier than this many ms from now. */
  readonly delayMs?: number;
  /**
   * A custom id — also a deduplication key: adding a job whose id already
   * exists is a no-op. Must not be a plain integer or contain `:` (BullMQ's
   * rules).
   */
  readonly jobId?: string;
  /** Lower runs sooner; 1 is highest. */
  readonly priority?: number;
}

/**
 * A job that was added.
 *
 * @public
 */
export interface EnqueuedJob<TResult> {
  readonly id: string;
  readonly name: string;
  /**
   * Waits for the job to finish and resolves to its handler's result;
   * rejects with the failure reason if it fails for good, or after
   * `timeoutMs`. Opens one shared event subscription per queue on first use.
   */
  result(options?: { readonly timeoutMs?: number }): Promise<TResult>;
}

/**
 * The dead-letter queue attached to a {@link TypedQueue}. Dead-lettered jobs
 * are parked, never processed, until redriven or removed.
 *
 * @public
 */
export interface DeadLetterQueue<J extends JobMap> {
  /** Oldest first. Default limit 100. */
  list(options?: { readonly limit?: number }): Promise<DeadLetterEntry<J>[]>;
  count(): Promise<number>;
  /**
   * Re-adds a dead-lettered job to the main queue with a fresh set of
   * attempts, then removes it from the dead-letter queue. Resolves to the
   * new job's id, or `undefined` if `id` is not in the dead-letter queue.
   */
  redrive(id: string): Promise<string | undefined>;
  /** Resolves `false` if `id` was not there. */
  remove(id: string): Promise<boolean>;
}

/**
 * A typed producer for one queue.
 *
 * @public
 */
export interface TypedQueue<J extends JobMap> {
  readonly name: string;
  /**
   * Adds a job. The name must be one of the queue's job types and the
   * payload must match its definition — both checked at compile time, and
   * at runtime by the job's `validate` if it has one.
   *
   * @throws `InvalidJobError` (as a rejection) for an unknown name or a
   * payload its `validate` rejects. Nothing is enqueued.
   */
  add<N extends JobName<J>>(
    name: N,
    data: DataOf<J[N]>,
    options?: AddOptions,
  ): Promise<EnqueuedJob<ResultOf<J[N]>>>;
  /** Job counts, dead-lettered included. */
  depth(): Promise<QueueDepth>;
  readonly deadLetter: DeadLetterQueue<J>;
  /** Closes this producer's connections. Does not affect workers. */
  close(): Promise<void>;
  /** The underlying BullMQ queue, for anything this package does not wrap. */
  readonly bull: Queue;
}

// BullMQ 6 has no separate `paused` state: a paused queue's jobs stay
// `waiting`. `prioritized` jobs are waiting too, just ordered.
const WAITING_STATES = ['waiting', 'prioritized', 'waiting-children'] as const;

function total(counts: Record<string, number>, states: readonly string[]): number {
  return states.reduce((sum, state) => sum + (own(counts, state) ?? 0), 0);
}

/**
 * Creates a typed producer.
 *
 * @example
 * ```ts
 * const emails = createQueue({ name: 'emails', jobs, connection: { url: process.env.REDIS_URL } });
 * const job = await emails.add('sendEmail', { to: 'a@b.co', template: 'welcome' });
 * const { messageId } = await job.result({ timeoutMs: 30_000 });
 * ```
 *
 * @public
 */
export function createQueue<J extends JobMap>(options: CreateQueueOptions<J>): TypedQueue<J> {
  assertJobMap(options.jobs);
  const base = {
    connection: options.connection,
    ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
  };
  const queue = new Queue(options.name, base);
  const deadLetters = new Queue(deadLetterQueueName(options.name), base);
  let events: QueueEvents | undefined;

  const eventsReady = async (): Promise<QueueEvents> => {
    events ??= new QueueEvents(options.name, base);
    await events.waitUntilReady();
    return events;
  };

  const toEntry = (job: Job): DeadLetterEntry<J> => {
    const payload = job.data as DeadLetterPayload;
    return {
      id: job.id ?? '',
      originalId: payload.originalId,
      name: job.name as JobName<J>,
      data: payload.data as DeadLetterEntry<J>['data'],
      reason: payload.reason,
      error: payload.error,
      attempts: payload.attempts,
      failedAt: payload.failedAt,
    };
  };

  return {
    name: options.name,
    bull: queue,

    async add(name, data, addOptions = {}) {
      const definition = own(options.jobs, name);
      if (definition === undefined) {
        throw new InvalidJobError(`Unknown job "${name}" for queue "${options.name}"`, {
          details: { queue: options.name, name },
        });
      }
      let payload: unknown = data;
      if (definition.validate !== undefined) {
        try {
          payload = definition.validate(data);
        } catch (error) {
          throw new InvalidJobError(`Invalid payload for job "${name}": ${messageOf(error)}`, {
            details: { queue: options.name, name },
            cause: error,
          });
        }
      }
      const job = await queue.add(name, payload, {
        ...toBullRetryOptions(definition.retry),
        ...(addOptions.delayMs === undefined ? {} : { delay: addOptions.delayMs }),
        ...(addOptions.jobId === undefined ? {} : { jobId: addOptions.jobId }),
        ...(addOptions.priority === undefined ? {} : { priority: addOptions.priority }),
      });
      const id = job.id ?? '';
      return {
        id,
        name,
        async result(resultOptions = {}) {
          const subscription = await eventsReady();
          return (await job.waitUntilFinished(subscription, resultOptions.timeoutMs)) as ResultOf<
            J[typeof name]
          >;
        },
      };
    },

    async depth() {
      const [main, dead] = await Promise.all([
        queue.getJobCounts(...WAITING_STATES, 'active', 'delayed', 'failed'),
        deadLetters.getJobCounts(...WAITING_STATES, 'delayed'),
      ]);
      return {
        waiting: total(main, WAITING_STATES),
        active: main.active ?? 0,
        delayed: main.delayed ?? 0,
        failed: main.failed ?? 0,
        deadLettered: total(dead, [...WAITING_STATES, 'delayed']),
      };
    },

    deadLetter: {
      async list(listOptions = {}) {
        const limit = listOptions.limit ?? 100;
        const jobs = await deadLetters.getJobs(
          [...WAITING_STATES, 'delayed'],
          0,
          Math.max(0, limit - 1),
          true,
        );
        return jobs.map((job) => toEntry(job as Job));
      },

      async count() {
        return total(await deadLetters.getJobCounts(...WAITING_STATES, 'delayed'), [
          ...WAITING_STATES,
          'delayed',
        ]);
      },

      async redrive(id) {
        const parked = (await deadLetters.getJob(id)) as Job | undefined;
        if (parked === undefined) return undefined;
        const entry = toEntry(parked);
        const definition = own(options.jobs, entry.name);
        const job = await queue.add(
          entry.name,
          entry.data,
          definition === undefined ? {} : toBullRetryOptions(definition.retry),
        );
        await parked.remove();
        return job.id ?? '';
      },

      async remove(id) {
        const parked = await deadLetters.getJob(id);
        if (parked === undefined) return false;
        await parked.remove();
        return true;
      },
    },

    async close() {
      await Promise.all([queue.close(), deadLetters.close(), events?.close()]);
    },
  };
}
