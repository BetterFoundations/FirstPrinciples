/**
 * How a job type is retried before it is dead-lettered.
 *
 * @public
 */
export interface RetryPolicy {
  /** Total attempts, including the first. `1` means never retry. */
  readonly attempts: number;
  /** Delay between attempts. Omitted: retry immediately. */
  readonly backoff?: {
    /** `fixed`: `delayMs` every time. `exponential`: `delayMs × 2^(attempt − 1)`. */
    readonly type: 'fixed' | 'exponential';
    readonly delayMs: number;
    /**
     * Fraction of each delay (0–1) that is randomized, so a burst of
     * failures does not retry in lockstep. Jitter only shortens: `0.5`
     * turns a 4 s delay into 2–4 s. Default 0.
     */
    readonly jitter?: number;
  };
}

/**
 * One job type: its payload and result types, and how it is retried.
 * Build one with {@link defineJob}.
 *
 * @public
 */
export interface JobDefinition<TData = unknown, TResult = unknown> {
  readonly retry: RetryPolicy;
  /**
   * Checks an untrusted payload and returns it typed; throws to reject it.
   * Runs on `add` (so a bad payload fails at the producer) and again in the
   * worker (so a payload from an older or foreign producer is caught before
   * the handler sees it). A rejected payload is never retried.
   */
  readonly validate: ((data: unknown) => TData) | undefined;
  /**
   * Decides whether a handler error can never succeed on retry. Such a job
   * skips its remaining attempts and goes straight to the dead-letter queue.
   * {@link PermanentJobError} is always permanent, whatever this returns.
   */
  readonly isPermanent: ((error: unknown) => boolean) | undefined;
  /** Type-level only; never set at runtime. Carries the payload and result types. */
  readonly __types?: { readonly data: TData; readonly result: TResult };
}

/**
 * A record of job name → {@link JobDefinition}: everything a queue carries.
 *
 * @public
 */
export type JobMap = Readonly<Record<string, JobDefinition>>;

/** The job names in a {@link JobMap}. @public */
export type JobName<J extends JobMap> = keyof J & string;

/** The payload type of a {@link JobDefinition}. @public */
export type DataOf<D> = D extends JobDefinition<infer T, unknown> ? T : never;

/** The result type of a {@link JobDefinition}. @public */
export type ResultOf<D> = D extends JobDefinition<unknown, infer R> ? R : never;

/**
 * What a handler receives besides the payload.
 *
 * @public
 */
export interface JobContext {
  readonly id: string;
  readonly name: string;
  /** 1 on the first try. */
  readonly attempt: number;
  readonly maxAttempts: number;
  /** Aborts when the worker is force-closed or loses the job's lock. Pass it to anything cancellable. */
  readonly signal: AbortSignal | undefined;
}

/**
 * Processes one job type. Its parameter and return types come from the
 * job's definition — no annotations needed.
 *
 * @public
 */
export type JobHandler<TData, TResult> = (
  data: TData,
  context: JobContext,
) => Promise<TResult> | TResult;

/**
 * One handler per job name. Missing a name, or a handler whose types do not
 * match its definition, is a compile error.
 *
 * @public
 */
export type JobHandlers<J extends JobMap> = {
  readonly [N in JobName<J>]: JobHandler<DataOf<J[N]>, ResultOf<J[N]>>;
};

/**
 * Why a job was dead-lettered.
 *
 * - `exhausted` — every attempt failed.
 * - `permanent` — the handler threw {@link PermanentJobError}, or `isPermanent` said so.
 * - `invalid-payload` — the job's `validate` rejected the payload in the worker.
 * - `unknown-job` — no handler for this job name (typically a newer producer).
 * - `stalled` — the job's worker died mid-job more times than `maxStalledCount` allows.
 *
 * @public
 */
export type DeadLetterReason =
  'exhausted' | 'permanent' | 'invalid-payload' | 'unknown-job' | 'stalled';

/**
 * A dead-lettered job, as stored in the dead-letter queue.
 *
 * @public
 */
export interface DeadLetterEntry<J extends JobMap = JobMap> {
  /** The id to pass to `redrive` or `remove`. */
  readonly id: string;
  /** The id the job had in the main queue. */
  readonly originalId: string;
  readonly name: JobName<J>;
  readonly data: DataOf<J[JobName<J>]>;
  readonly reason: DeadLetterReason;
  /** The last error's message. */
  readonly error: string;
  readonly attempts: number;
  /** ISO timestamp. */
  readonly failedAt: string;
}

/**
 * Job counts at one instant.
 *
 * @public
 */
export interface QueueDepth {
  readonly waiting: number;
  readonly active: number;
  readonly delayed: number;
  readonly failed: number;
  readonly deadLettered: number;
}

/**
 * Callbacks for any metrics backend — Prometheus, StatsD, OpenTelemetry.
 * A throwing hook is logged and ignored; it can never fail a job.
 *
 * @public
 */
export interface QueueMetrics {
  onCompleted?(event: {
    readonly queue: string;
    readonly name: string;
    readonly id: string;
    readonly attempt: number;
    readonly durationMs: number;
    /** Time from enqueue to this attempt starting. */
    readonly waitMs: number;
  }): void;
  onFailed?(event: {
    readonly queue: string;
    readonly name: string;
    readonly id: string;
    readonly attempt: number;
    readonly maxAttempts: number;
    readonly durationMs: number;
    readonly error: string;
    /** `false` on the final failure — the job is about to be dead-lettered. */
    readonly willRetry: boolean;
  }): void;
  onDeadLettered?(event: {
    readonly queue: string;
    readonly name: string;
    readonly id: string;
    readonly reason: DeadLetterReason;
    readonly attempts: number;
  }): void;
  onDepth?(event: QueueDepth & { readonly queue: string }): void;
}

/**
 * The minimal logger surface. A `@firstprinciples/logger` `Logger` fits.
 *
 * @public
 */
export interface QueueLogger {
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}
