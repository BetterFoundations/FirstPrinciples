/**
 * `@firstprinciples/queue` — typed job queue conventions over BullMQ.
 *
 * - {@link defineJob}: declare each job type's payload and result once.
 * - {@link createQueue}: a producer whose `add` is checked against them.
 * - {@link createWorker}: exhaustive, typed handlers; retries per job type;
 *   final failures parked in a real dead-letter queue.
 * - {@link QueueMetrics}: duration, failure, dead-letter and depth hooks for
 *   any metrics backend.
 *
 * @packageDocumentation
 */

export { defineJob, retryPresets } from './define.js';
export type { DefineJobOptions } from './define.js';

export { createQueue } from './queue.js';
export type {
  AddOptions,
  CreateQueueOptions,
  DeadLetterQueue,
  EnqueuedJob,
  TypedQueue,
} from './queue.js';

export { createWorker } from './worker.js';
export type { CreateWorkerOptions, TypedWorker } from './worker.js';

export { InvalidJobError, PermanentJobError } from './errors.js';

export type {
  DataOf,
  DeadLetterEntry,
  DeadLetterReason,
  JobContext,
  JobDefinition,
  JobHandler,
  JobHandlers,
  JobMap,
  JobName,
  QueueDepth,
  QueueLogger,
  QueueMetrics,
  ResultOf,
  RetryPolicy,
} from './types.js';
