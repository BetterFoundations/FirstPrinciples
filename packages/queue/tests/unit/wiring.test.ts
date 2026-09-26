/**
 * The BullMQ wiring in queue.ts and worker.ts, against a recording fake of
 * `bullmq` — so option pass-through, depth arithmetic and stop semantics
 * are pinned without a Redis. What BullMQ actually *does* with them is the
 * real-Redis integration suite's job (tests/integration/queue-redis.test.ts).
 */
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  queues: [] as FakeQueueShape[],
  workers: [] as FakeWorkerShape[],
  events: [] as {
    name: string;
    opts: unknown;
    waitUntilReady: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }[],
}));

interface FakeJobShape {
  id: string | undefined;
  name: string;
  data: unknown;
  remove: ReturnType<typeof vi.fn>;
  waitUntilFinished: ReturnType<typeof vi.fn>;
}
interface FakeQueueShape {
  name: string;
  opts: Record<string, unknown>;
  add: ReturnType<typeof vi.fn>;
  getJobCounts: ReturnType<typeof vi.fn>;
  getJobs: ReturnType<typeof vi.fn>;
  getJob: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}
interface FakeWorkerShape extends EventEmitter {
  name: string;
  processor: (...args: unknown[]) => unknown;
  opts: Record<string, unknown>;
  run: ReturnType<typeof vi.fn>;
  waitUntilReady: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  cancelAllJobs: ReturnType<typeof vi.fn>;
}

vi.mock('bullmq', async (importActual) => {
  const actual = await importActual<typeof import('bullmq')>();
  const { EventEmitter: Emitter } = await import('node:events');
  const makeJob = (id: string | undefined, name: string, data: unknown): FakeJobShape => ({
    id,
    name,
    data,
    remove: vi.fn(async () => undefined),
    waitUntilFinished: vi.fn(async () => ({ finished: true })),
  });
  class Queue {
    name: string;
    opts: Record<string, unknown>;
    add = vi.fn(async (name: string, data: unknown) =>
      makeJob(`id-${this.add.mock.calls.length}`, name, data),
    );
    getJobCounts = vi.fn(async (...states: string[]) =>
      Object.fromEntries(states.map((s, i) => [s, i + 1])),
    );
    getJobs = vi.fn(async () => [] as FakeJobShape[]);
    getJob = vi.fn(async (): Promise<FakeJobShape | undefined> => undefined);
    close = vi.fn(async () => undefined);
    constructor(name: string, opts: Record<string, unknown>) {
      this.name = name;
      this.opts = opts;
      state.queues.push(this as unknown as FakeQueueShape);
    }
  }
  class Worker extends Emitter {
    run = vi.fn(() => new Promise<void>(() => undefined));
    waitUntilReady = vi.fn(async () => undefined);
    close = vi.fn(async () => undefined);
    cancelAllJobs = vi.fn();
    constructor(
      public name: string,
      public processor: (...args: unknown[]) => unknown,
      public opts: Record<string, unknown>,
    ) {
      super();
      state.workers.push(this as unknown as FakeWorkerShape);
    }
  }
  class QueueEvents {
    waitUntilReady = vi.fn(async () => undefined);
    close = vi.fn(async () => undefined);
    constructor(
      public name: string,
      public opts: unknown,
    ) {
      state.events.push(this);
    }
  }
  return { ...actual, Queue, Worker, QueueEvents, __makeJob: makeJob };
});

const { createQueue, createWorker, defineJob, InvalidJobError, retryPresets } =
  await import('../../src/index.js');
const { recordingLogger } = await import('../helpers/fakes.js');
const makeJob = (
  (await import('bullmq')) as unknown as {
    __makeJob: (id: string | undefined, name: string, data: unknown) => FakeJobShape;
  }
).__makeJob;

const jobs = {
  send: defineJob<{ to: string }, { id: string }>({ retry: retryPresets.fixed(3, 10) }),
  plain: defineJob<{ n: number }>({ retry: retryPresets.none }),
  jittery: defineJob<{ n: number }>({ retry: retryPresets.standard }),
  strict: defineJob({ validate: (d: unknown) => d as { ok: true } }),
};
const connection = { host: 'localhost', port: 6379 };
const noop = { send: vi.fn(), plain: vi.fn(), jittery: vi.fn(), strict: vi.fn() };

beforeEach(() => {
  state.queues.length = 0;
  state.workers.length = 0;
  state.events.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createQueue wiring', () => {
  it('creates the main and dead-letter queues with the same connection and prefix', () => {
    createQueue({ name: 'emails', jobs, connection, prefix: 'app' });
    expect(state.queues.map((q) => [q.name, q.opts])).toEqual([
      ['emails', { connection, prefix: 'app' }],
      ['emails.dead-letter', { connection, prefix: 'app' }],
    ]);
  });

  it('omits prefix when not given', () => {
    createQueue({ name: 'emails', jobs, connection });
    expect(state.queues[0]?.opts).toEqual({ connection });
  });

  it('refuses an empty job map', () => {
    expect(() => createQueue({ name: 'x', jobs: {}, connection })).toThrow(
      'A queue needs at least one job definition',
    );
  });

  it("maps a job's retry policy and the add options onto BullMQ job options", async () => {
    const queue = createQueue({ name: 'emails', jobs, connection });
    await queue.add('send', { to: 'a' }, { delayMs: 500, jobId: 'k-1', priority: 2 });
    await queue.add('plain', { n: 1 });
    await queue.add('jittery', { n: 1 });
    const add = state.queues[0]!.add;
    expect(add.mock.calls[0]).toEqual([
      'send',
      { to: 'a' },
      { attempts: 3, backoff: { type: 'fixed', delay: 10 }, delay: 500, jobId: 'k-1', priority: 2 },
    ]);
    expect(add.mock.calls[1]).toEqual(['plain', { n: 1 }, { attempts: 1 }]);
    expect(add.mock.calls[2]?.[2]).toEqual({
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000, jitter: 0.5 },
    });
  });

  it('enqueues the validated value and rejects a failing one with the cause attached', async () => {
    const transform = {
      t: defineJob({ validate: (d: unknown) => ({ n: Number((d as { n: string }).n) }) }),
    };
    const queue = createQueue({ name: 'x', jobs: transform, connection });
    await queue.add('t', { n: 5 });
    expect(state.queues[0]!.add.mock.calls[0]?.[1]).toEqual({ n: 5 });

    const bad = createQueue({
      name: 'y',
      jobs: {
        b: defineJob({
          validate: () => {
            throw new Error('nope');
          },
        }),
      },
      connection,
    });
    const error = await bad.add('b', undefined as never).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidJobError);
    expect((error as InstanceType<typeof InvalidJobError>).details).toEqual({
      queue: 'y',
      name: 'b',
    });
    expect((error as Error).cause).toEqual(new Error('nope'));
  });

  it('describes a validate that throws a non-Error', async () => {
    const queue = createQueue({
      name: 'y',
      jobs: {
        b: defineJob({
          validate: () => {
            throw 'bad shape';
          },
        }),
      },
      connection,
    });
    await expect(queue.add('b', undefined as never)).rejects.toThrow(
      'Invalid payload for job "b": bad shape',
    );
  });

  it('never treats an inherited name as a job', async () => {
    const queue = createQueue({ name: 'x', jobs, connection });
    await expect(queue.add('constructor' as 'send', { to: 'a' })).rejects.toThrow(InvalidJobError);
  });

  it('result() opens one shared event subscription, lazily, and passes the timeout through', async () => {
    const queue = createQueue({ name: 'emails', jobs, connection });
    const a = await queue.add('send', { to: 'a' });
    const b = await queue.add('send', { to: 'b' });
    expect(state.events).toHaveLength(0);
    expect(await a.result({ timeoutMs: 1234 })).toEqual({ finished: true });
    await b.result();
    expect(state.events).toHaveLength(1);
    expect(state.events[0]?.name).toBe('emails');
    const job = await state.queues[0]!.add.mock.results[0]!.value;
    expect(job.waitUntilFinished).toHaveBeenCalledWith(state.events[0], 1234);
  });

  it('falls back to an empty id when BullMQ returns none', async () => {
    const queue = createQueue({ name: 'emails', jobs, connection });
    state.queues[0]!.add.mockResolvedValueOnce(makeJob(undefined, 'send', {}));
    expect((await queue.add('send', { to: 'a' })).id).toBe('');
  });

  it('depth() sums waiting-like states and reads the dead-letter queue too', async () => {
    const queue = createQueue({ name: 'emails', jobs, connection });
    // The fake returns 1, 2, 3… for the states in the order requested.
    expect(await queue.depth()).toEqual({
      waiting: 1 + 2 + 3,
      active: 4,
      delayed: 5,
      failed: 6,
      deadLettered: 1 + 2 + 3 + 4,
    });
    state.queues[0]!.getJobCounts.mockResolvedValueOnce({});
    state.queues[1]!.getJobCounts.mockResolvedValueOnce({});
    expect(await queue.depth()).toEqual({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      deadLettered: 0,
    });
  });

  it('deadLetter.list maps stored payloads to entries, oldest first, with a limit', async () => {
    const queue = createQueue({ name: 'emails', jobs, connection });
    const parked = makeJob('dead-9', 'send', {
      originalId: '9',
      data: { to: 'a' },
      reason: 'exhausted',
      error: 'x',
      attempts: 3,
      failedAt: 't',
    });
    state.queues[1]!.getJobs.mockResolvedValueOnce([parked, { ...parked, id: undefined }]);
    const entries = await queue.deadLetter.list({ limit: 10 });
    expect(entries[0]).toEqual({
      id: 'dead-9',
      originalId: '9',
      name: 'send',
      data: { to: 'a' },
      reason: 'exhausted',
      error: 'x',
      attempts: 3,
      failedAt: 't',
    });
    expect(entries[1]?.id).toBe('');
    expect(state.queues[1]!.getJobs).toHaveBeenCalledWith(
      ['waiting', 'prioritized', 'waiting-children', 'delayed'],
      0,
      9,
      true,
    );
    await queue.deadLetter.list();
    expect(state.queues[1]!.getJobs).toHaveBeenLastCalledWith(expect.any(Array), 0, 99, true);
    await queue.deadLetter.list({ limit: 0 });
    expect(state.queues[1]!.getJobs).toHaveBeenLastCalledWith(expect.any(Array), 0, 0, true);
  });

  it('deadLetter.count sums the parked states', async () => {
    const queue = createQueue({ name: 'emails', jobs, connection });
    expect(await queue.deadLetter.count()).toBe(1 + 2 + 3 + 4);
  });

  it('redrive re-adds with the job type retry policy, then removes the parked job', async () => {
    const queue = createQueue({ name: 'emails', jobs, connection });
    const parked = makeJob('dead-9', 'send', {
      originalId: '9',
      data: { to: 'a' },
      reason: 'exhausted',
      error: 'x',
      attempts: 3,
      failedAt: 't',
    });
    state.queues[1]!.getJob.mockResolvedValueOnce(parked);
    const newId = await queue.deadLetter.redrive('dead-9');
    expect(state.queues[0]!.add).toHaveBeenCalledWith(
      'send',
      { to: 'a' },
      { attempts: 3, backoff: { type: 'fixed', delay: 10 } },
    );
    expect(parked.remove).toHaveBeenCalledOnce();
    expect(newId).toBe('id-1');
  });

  it('redrive of a job type no longer defined re-adds it with BullMQ defaults', async () => {
    const queue = createQueue({ name: 'emails', jobs, connection });
    state.queues[1]!.getJob.mockResolvedValueOnce(
      makeJob('dead-1', 'retired', {
        originalId: '1',
        data: {},
        reason: 'unknown-job',
        error: 'x',
        attempts: 1,
        failedAt: 't',
      }),
    );
    state.queues[0]!.add.mockResolvedValueOnce(makeJob(undefined, 'retired', {}));
    expect(await queue.deadLetter.redrive('dead-1')).toBe('');
    expect(state.queues[0]!.add).toHaveBeenCalledWith('retired', {}, {});
  });

  it('redrive and remove of a missing id', async () => {
    const queue = createQueue({ name: 'emails', jobs, connection });
    expect(await queue.deadLetter.redrive('nope')).toBeUndefined();
    expect(await queue.deadLetter.remove('nope')).toBe(false);
    const parked = makeJob('dead-2', 'send', {});
    state.queues[1]!.getJob.mockResolvedValueOnce(parked);
    expect(await queue.deadLetter.remove('dead-2')).toBe(true);
    expect(parked.remove).toHaveBeenCalledOnce();
  });

  it('close() closes both queues, and the event subscription only if one was opened', async () => {
    const queue = createQueue({ name: 'emails', jobs, connection });
    await queue.close();
    expect(state.queues.every((q) => q.close.mock.calls.length === 1)).toBe(true);
    const job = await queue.add('send', { to: 'a' });
    await job.result();
    await queue.close();
    expect(state.events[0]?.close).toHaveBeenCalledOnce();
  });

  it('exposes the BullMQ queue', () => {
    const queue = createQueue({ name: 'emails', jobs, connection });
    expect(queue.bull).toBe(state.queues[0]);
    expect(queue.name).toBe('emails');
  });
});

describe('createWorker wiring', () => {
  it('passes BullMQ options through, never autoruns itself, and starts by default', async () => {
    const worker = createWorker({
      name: 'emails',
      jobs,
      connection,
      prefix: 'app',
      handlers: noop,
      concurrency: 4,
      lockDurationMs: 1000,
      stalledIntervalMs: 500,
      maxStalledCount: 2,
      logger: recordingLogger(),
    });
    const bull = state.workers[0]!;
    expect(bull.opts).toEqual({
      connection,
      prefix: 'app',
      autorun: false,
      concurrency: 4,
      lockDuration: 1000,
      stalledInterval: 500,
      maxStalledCount: 2,
    });
    expect(bull.processor.length).toBe(3);
    expect(state.queues.map((q) => q.name)).toEqual(['emails.dead-letter']);
    await worker.start();
    expect(bull.run).toHaveBeenCalledOnce();
    expect(worker.name).toBe('emails-worker');
    expect(worker.bull).toBe(bull);
  });

  it('defaults: concurrency 1, no lock/stall overrides, console logger', () => {
    createWorker({ name: 'q', jobs, connection, handlers: noop, autostart: false });
    expect(state.workers[0]!.opts).toEqual({ connection, autorun: false, concurrency: 1 });
    expect(state.workers[0]!.run).not.toHaveBeenCalled();
  });

  it('refuses an empty job map', () => {
    expect(() => createWorker({ name: 'x', jobs: {}, connection, handlers: {} })).toThrow(
      'at least one job definition',
    );
  });

  it('start() is idempotent and resolves once BullMQ is ready', async () => {
    const worker = createWorker({ name: 'q', jobs, connection, handlers: noop, autostart: false });
    const a = worker.start();
    expect(worker.start()).toBe(a);
    await a;
    expect(state.workers[0]!.run).toHaveBeenCalledOnce();
    expect(state.workers[0]!.waitUntilReady).toHaveBeenCalledOnce();
  });

  it('logs (instead of crashing on) a worker error event and a run() failure', async () => {
    const logger = recordingLogger();
    createWorker({ name: 'q', jobs, connection, handlers: noop, logger, autostart: false });
    const bull = state.workers[0]!;
    bull.run.mockRejectedValueOnce(new Error('loop died'));
    bull.emit('error', new Error('ECONNRESET'));
    expect(logger.lines[0]).toMatchObject({
      level: 'error',
      msg: 'queue worker error',
      fields: { queue: 'q', error: 'ECONNRESET' },
    });
  });

  it('logs a run() loop that dies', async () => {
    const logger = recordingLogger();
    const worker = createWorker({
      name: 'q',
      jobs,
      connection,
      handlers: noop,
      logger,
      autostart: false,
    });
    state.workers[0]!.run.mockRejectedValueOnce(new Error('loop died'));
    await worker.start();
    await vi.waitFor(() =>
      expect(logger.lines.some((l) => l.msg === 'queue worker stopped unexpectedly')).toBe(true),
    );
  });

  it("dead-letters from the worker's failed event and waits for that write before closing", async () => {
    const worker = createWorker({
      name: 'q',
      jobs,
      connection,
      handlers: noop,
      logger: recordingLogger(),
      autostart: false,
    });
    const dlq = state.queues[0]!;
    let finishWrite!: () => void;
    dlq.add.mockImplementationOnce(
      () => new Promise((resolve) => (finishWrite = () => resolve(undefined))),
    );
    state.workers[0]!.emit(
      'failed',
      { id: '5', name: 'send', data: {}, attemptsMade: 3, timestamp: 0, opts: { attempts: 3 } },
      new Error('x'),
    );
    expect(dlq.add).toHaveBeenCalledWith('send', expect.objectContaining({ originalId: '5' }), {
      jobId: 'dead-5',
      removeOnComplete: false,
    });

    let stopped = false;
    const stopping = worker.stop().then(() => (stopped = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(stopped).toBe(false);
    expect(dlq.close).not.toHaveBeenCalled();
    finishWrite();
    await stopping;
    expect(dlq.close).toHaveBeenCalledOnce();
  });

  it('stop() is graceful by default and idempotent', async () => {
    const worker = createWorker({ name: 'q', jobs, connection, handlers: noop, autostart: false });
    const a = worker.stop();
    expect(worker.stop()).toBe(a);
    await a;
    expect(state.workers[0]!.close).toHaveBeenCalledExactlyOnceWith();
    expect(state.workers[0]!.cancelAllJobs).not.toHaveBeenCalled();
  });

  it('stop(signal) cancels in-flight jobs when the signal aborts mid-drain', async () => {
    const worker = createWorker({ name: 'q', jobs, connection, handlers: noop, autostart: false });
    let release!: () => void;
    state.workers[0]!.close.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    const controller = new AbortController();
    const stopping = worker.stop(controller.signal);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    controller.abort();
    expect(state.workers[0]!.cancelAllJobs).toHaveBeenCalledWith('worker shutdown deadline passed');
    release();
    await stopping;
  });

  it('stop(signal) with an already-aborted signal cancels at once', async () => {
    const worker = createWorker({ name: 'q', jobs, connection, handlers: noop, autostart: false });
    const controller = new AbortController();
    controller.abort();
    await worker.stop(controller.signal);
    expect(state.workers[0]!.cancelAllJobs).toHaveBeenCalledOnce();
  });

  it('samples depth on an interval into metrics.onDepth, and stops sampling on stop', async () => {
    vi.useFakeTimers();
    const onDepth = vi.fn();
    const worker = createWorker({
      name: 'q',
      jobs,
      connection,
      handlers: noop,
      autostart: false,
      depthIntervalMs: 1000,
      metrics: { onDepth },
    });
    await worker.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onDepth).toHaveBeenCalledWith(expect.objectContaining({ queue: 'q', active: 4 }));
    await worker.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(onDepth).toHaveBeenCalledOnce();
    // The sampler's own producer (main + DLQ) was closed too.
    expect(state.queues.slice(1).every((q) => q.close.mock.calls.length === 1)).toBe(true);
  });

  it('a failing depth sample is logged, not thrown', async () => {
    vi.useFakeTimers();
    const logger = recordingLogger();
    const worker = createWorker({
      name: 'q',
      jobs,
      connection,
      handlers: noop,
      autostart: false,
      logger,
      depthIntervalMs: 100,
      metrics: { onDepth: vi.fn() },
    });
    await worker.start();
    state.queues[1]!.getJobCounts.mockRejectedValueOnce(new Error('redis busy'));
    await vi.advanceTimersByTimeAsync(100);
    expect(logger.lines[0]).toMatchObject({
      level: 'warn',
      msg: 'queue depth sample failed',
      fields: { error: 'redis busy' },
    });
    await worker.stop();
  });

  it('does not sample depth without both an interval and an onDepth hook', async () => {
    const worker = createWorker({
      name: 'q',
      jobs,
      connection,
      handlers: noop,
      autostart: false,
      depthIntervalMs: 100,
    });
    await worker.start();
    expect(state.queues).toHaveLength(1);
    await worker.stop();
  });

  it('passes prefix to the depth sampler too', async () => {
    const worker = createWorker({
      name: 'q',
      jobs,
      connection,
      prefix: 'p',
      handlers: noop,
      autostart: false,
      depthIntervalMs: 100,
      metrics: { onDepth: vi.fn() },
    });
    await worker.start();
    expect(state.queues.map((q) => q.opts.prefix)).toEqual(['p', 'p', 'p']);
    await worker.stop();
  });
});
