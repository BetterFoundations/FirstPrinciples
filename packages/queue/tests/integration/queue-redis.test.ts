import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createQueue,
  createWorker,
  defineJob,
  InvalidJobError,
  PermanentJobError,
  retryPresets,
  type QueueMetrics,
  type TypedWorker,
} from '../../src/index.js';
import { recordingLogger } from '../helpers/fakes.js';
import { redisAvailable, startRedis, stopRedis, uniqueQueue } from '../helpers/redis.js';

const jobs = {
  send: defineJob<{ to: string }, { messageId: string }>({ retry: retryPresets.fixed(3, 20) }),
  flaky: defineJob<{ failTimes: number }, { attempt: number }>({
    retry: retryPresets.fixed(4, 10),
  }),
  strict: defineJob({
    retry: retryPresets.fixed(5, 10),
    validate: (d: unknown) => {
      const n = (d as { n?: unknown }).n;
      if (typeof n !== 'number') throw new Error('n must be a number');
      return { n };
    },
  }),
  slow: defineJob<{ ms: number }, string>({ retry: retryPresets.fixed(3, 10) }),
};

describe.skipIf(!redisAvailable())('queue against a real Redis', () => {
  let connection: { host: string; port: number; maxRetriesPerRequest: null };
  const closers: (() => Promise<unknown>)[] = [];

  beforeAll(async () => {
    connection = { ...(await startRedis()), maxRetriesPerRequest: null };
  }, 120_000);

  afterEach(async () => {
    await Promise.allSettled(closers.splice(0).map((close) => close()));
  });

  afterAll(async () => {
    await stopRedis();
  });

  function setup(
    overrides: {
      metrics?: QueueMetrics;
      handlers?: Partial<Parameters<typeof createWorker<typeof jobs>>[0]['handlers']>;
      worker?: Partial<Parameters<typeof createWorker<typeof jobs>>[0]>;
    } = {},
  ) {
    const name = uniqueQueue('q');
    const logger = recordingLogger();
    const queue = createQueue({ name, jobs, connection });
    const worker = createWorker({
      name,
      jobs,
      connection,
      logger,
      ...(overrides.metrics ? { metrics: overrides.metrics } : {}),
      handlers: {
        send: async ({ to }) => ({ messageId: `msg-for-${to}` }),
        flaky: async ({ failTimes }, { attempt }) => {
          if (attempt <= failTimes) throw new Error(`transient failure on attempt ${attempt}`);
          return { attempt };
        },
        strict: async ({ n }) => void n,
        slow: async ({ ms }, { signal }) => {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, ms);
            signal?.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new Error('aborted'));
            });
          });
          return 'done';
        },
        ...overrides.handlers,
      },
      ...overrides.worker,
    });
    closers.push(
      () => worker.stop(),
      () => queue.close(),
    );
    return { name, queue, worker, logger };
  }

  it('adds, processes, and returns a typed result end to end', async () => {
    const { queue, worker } = setup();
    await worker.start();
    const job = await queue.add('send', { to: 'ada@example.com' });
    const result = await job.result({ timeoutMs: 10_000 });
    expect(result).toEqual({ messageId: 'msg-for-ada@example.com' });
  });

  it('retries a transient failure with backoff and succeeds', async () => {
    const onFailed = vi.fn();
    const { queue, worker } = setup({ metrics: { onFailed } });
    await worker.start();
    const job = await queue.add('flaky', { failTimes: 2 });
    expect(await job.result({ timeoutMs: 10_000 })).toEqual({ attempt: 3 });
    expect(onFailed.mock.calls.map(([e]) => [e.attempt, e.willRetry])).toEqual([
      [1, true],
      [2, true],
    ]);
    expect((await queue.deadLetter.list()).length).toBe(0);
  });

  it('THE transition: retry exhaustion moves the job to the dead-letter queue, exactly once', async () => {
    const onFailed = vi.fn();
    const onDeadLettered = vi.fn();
    const { queue, worker } = setup({ metrics: { onFailed, onDeadLettered } });
    await worker.start();
    const job = await queue.add('flaky', { failTimes: 99 });
    await expect(job.result({ timeoutMs: 10_000 })).rejects.toThrow(
      'transient failure on attempt 4',
    );
    await vi.waitFor(async () => expect(await queue.deadLetter.count()).toBe(1), { timeout: 5000 });

    const [entry] = await queue.deadLetter.list();
    expect(entry).toMatchObject({
      id: `dead-${job.id}`,
      originalId: job.id,
      name: 'flaky',
      data: { failTimes: 99 },
      reason: 'exhausted',
      error: 'transient failure on attempt 4',
      attempts: 4,
    });
    expect(Number.isNaN(Date.parse(entry!.failedAt))).toBe(false);
    expect(onFailed.mock.calls.map(([e]) => e.willRetry)).toEqual([true, true, true, false]);
    expect(onDeadLettered).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: 'flaky', id: job.id, reason: 'exhausted', attempts: 4 }),
    );
    expect(await queue.depth()).toMatchObject({
      failed: 1,
      deadLettered: 1,
      waiting: 0,
      active: 0,
    });
  });

  it('a permanent failure skips the remaining attempts and is dead-lettered after one', async () => {
    const handler = vi.fn(async () => {
      throw new PermanentJobError('mailbox does not exist');
    });
    const { queue, worker } = setup({ handlers: { send: handler } });
    await worker.start();
    const job = await queue.add('send', { to: 'nobody@example.com' });
    await expect(job.result({ timeoutMs: 10_000 })).rejects.toThrow('mailbox does not exist');
    await vi.waitFor(async () => expect(await queue.deadLetter.count()).toBe(1));
    expect((await queue.deadLetter.list())[0]).toMatchObject({ reason: 'permanent', attempts: 1 });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('a malformed payload (bypassing the producer) is rejected in the worker, never retried, dead-lettered', async () => {
    const { queue, worker } = setup();
    await worker.start();
    // A foreign or older producer: straight onto the BullMQ queue, no validation.
    const raw = await queue.bull.add('strict', { n: 'not-a-number' }, { attempts: 5 });
    await vi.waitFor(async () => expect(await queue.deadLetter.count()).toBe(1), { timeout: 5000 });
    expect((await queue.deadLetter.list())[0]).toMatchObject({
      originalId: raw.id,
      reason: 'invalid-payload',
      attempts: 1,
      error: 'Invalid payload for job "strict": n must be a number',
    });
  });

  it('the producer rejects a malformed payload before anything is enqueued', async () => {
    const { queue } = setup({ worker: { autostart: false } });
    await expect(queue.add('strict', { n: 'x' } as unknown as { n: number })).rejects.toThrow(
      InvalidJobError,
    );
    await expect(queue.add('nope' as 'send', { to: 'x' })).rejects.toThrow('Unknown job "nope"');
    expect(await queue.depth()).toMatchObject({ waiting: 0, delayed: 0 });
  });

  it('a job name the worker has no handler for (a newer producer) is dead-lettered as unknown-job', async () => {
    const { queue, worker } = setup();
    await worker.start();
    await queue.bull.add('fromTheFuture', { v: 2 }, { attempts: 3 });
    await vi.waitFor(async () => expect(await queue.deadLetter.count()).toBe(1), { timeout: 5000 });
    expect((await queue.deadLetter.list())[0]).toMatchObject({
      name: 'fromTheFuture',
      reason: 'unknown-job',
      attempts: 1,
    });
  });

  it('redrive puts a dead-lettered job back with fresh attempts, and removes it from the DLQ', async () => {
    let healthy = false;
    const { queue, worker } = setup({
      handlers: {
        flaky: async (_data, { attempt }) => {
          if (!healthy) throw new Error('downstream outage');
          return { attempt };
        },
      },
    });
    await worker.start();
    await queue.add('flaky', { failTimes: 0 });
    await vi.waitFor(async () => expect(await queue.deadLetter.count()).toBe(1), { timeout: 5000 });
    const [entry] = await queue.deadLetter.list();

    healthy = true;
    const newId = await queue.deadLetter.redrive(entry!.id);
    expect(newId).toBeTruthy();
    expect(newId).not.toBe(entry!.originalId);
    expect(await queue.deadLetter.count()).toBe(0);
    await vi.waitFor(async () => expect(await queue.bull.getJobState(newId!)).toBe('completed'), {
      timeout: 5000,
    });
    expect(await queue.deadLetter.redrive('dead-does-not-exist')).toBeUndefined();
  });

  it('remove deletes a dead-lettered job', async () => {
    const { queue, worker } = setup({
      handlers: {
        send: async () => {
          throw new PermanentJobError('x');
        },
      },
    });
    await worker.start();
    await queue.add('send', { to: 'a' });
    await vi.waitFor(async () => expect(await queue.deadLetter.count()).toBe(1));
    const [entry] = await queue.deadLetter.list();
    expect(await queue.deadLetter.remove(entry!.id)).toBe(true);
    expect(await queue.deadLetter.remove(entry!.id)).toBe(false);
    expect(await queue.deadLetter.count()).toBe(0);
  });

  it('a custom jobId deduplicates adds', async () => {
    const { queue } = setup({ worker: { autostart: false } });
    const a = await queue.add('send', { to: 'x' }, { jobId: 'welcome-user-7' });
    const b = await queue.add('send', { to: 'y' }, { jobId: 'welcome-user-7' });
    expect(b.id).toBe(a.id);
    expect((await queue.depth()).waiting).toBe(1);
  });

  it('delayed and prioritized jobs are counted', async () => {
    const { queue } = setup({ worker: { autostart: false } });
    await queue.add('send', { to: 'later' }, { delayMs: 60_000 });
    await queue.add('send', { to: 'urgent' }, { priority: 1 });
    expect(await queue.depth()).toMatchObject({ delayed: 1, waiting: 1 });
  });

  it('reports depth to metrics on an interval', async () => {
    const onDepth = vi.fn();
    const { queue, worker } = setup({
      metrics: { onDepth },
      worker: { depthIntervalMs: 50, autostart: false },
    });
    await queue.add('send', { to: 'later' }, { delayMs: 60_000 });
    await worker.start();
    await vi.waitFor(() => expect(onDepth).toHaveBeenCalled(), { timeout: 3000 });
    expect(onDepth.mock.calls[0]?.[0]).toMatchObject({
      queue: queue.name,
      delayed: 1,
      deadLettered: 0,
    });
  });

  it('stop() waits for an in-flight job to finish', async () => {
    const { queue, worker } = setup({ worker: { autostart: false } });
    await worker.start();
    const job = await queue.add('slow', { ms: 300 });
    await vi.waitFor(async () => expect(await queue.bull.getJobState(job.id)).toBe('active'));
    await worker.stop();
    expect(await queue.bull.getJobState(job.id)).toBe('completed');
  });

  it('stop() with an aborted deadline signal aborts in-flight handlers; their jobs are retried, not lost', async () => {
    const { queue, worker } = setup({ worker: { autostart: false } });
    await worker.start();
    const job = await queue.add('slow', { ms: 60_000 });
    await vi.waitFor(async () => expect(await queue.bull.getJobState(job.id)).toBe('active'));
    const controller = new AbortController();
    const stopped = worker.stop(controller.signal);
    controller.abort();
    await stopped;
    const state = await queue.bull.getJobState(job.id);
    expect(['waiting', 'delayed', 'active']).toContain(state);
    expect(await queue.deadLetter.count()).toBe(0);
  });

  it('is usable as a bootstrap resource: start/stop are idempotent', async () => {
    const { worker } = setup({ worker: { autostart: false } });
    const typed: TypedWorker = worker;
    expect(typed.name).toMatch(/-worker$/);
    await Promise.all([worker.start(), worker.start()]);
    const a = worker.stop();
    expect(worker.stop()).toBe(a);
    await a;
  });

  describe('worker crash and connection loss', () => {
    it('a job whose worker dies mid-job is picked up by another worker and completes', async () => {
      const name = uniqueQueue('crash');
      const queue = createQueue({ name, jobs, connection });
      closers.push(() => queue.close());
      const fast = { lockDurationMs: 500, stalledIntervalMs: 250, maxStalledCount: 2 };
      const doomed = createWorker({
        name,
        jobs,
        connection,
        logger: recordingLogger(),
        autostart: false,
        ...fast,
        handlers: {
          send: () => new Promise<never>(() => undefined),
          flaky: vi.fn(),
          strict: vi.fn(),
          slow: vi.fn(),
        },
      });
      await doomed.start();
      const job = await queue.add('send', { to: 'survivor' });
      await vi.waitFor(async () => expect(await queue.bull.getJobState(job.id)).toBe('active'));

      // "Crash": the process vanishes without finishing the job or releasing
      // its lock — no graceful close, no lock renewal.
      await doomed.bull.close(true);

      const rescuer = createWorker({
        name,
        jobs,
        connection,
        logger: recordingLogger(),
        ...fast,
        handlers: {
          send: async ({ to }) => ({ messageId: to }),
          flaky: vi.fn(),
          strict: vi.fn(),
          slow: vi.fn(),
        },
      });
      closers.push(() => rescuer.stop());
      expect(await job.result({ timeoutMs: 15_000 })).toEqual({ messageId: 'survivor' });
      expect(await queue.deadLetter.count()).toBe(0);
    }, 20_000);

    it('a job that stalls more often than allowed is dead-lettered as stalled', async () => {
      const name = uniqueQueue('stall');
      const queue = createQueue({ name, jobs, connection });
      closers.push(() => queue.close());
      const fast = { lockDurationMs: 300, stalledIntervalMs: 150, maxStalledCount: 0 };
      const hang = {
        send: () => new Promise<never>(() => undefined),
        flaky: vi.fn(),
        strict: vi.fn(),
        slow: vi.fn(),
      };
      const first = createWorker({
        name,
        jobs,
        connection,
        logger: recordingLogger(),
        autostart: false,
        ...fast,
        handlers: hang,
      });
      await first.start();
      const job = await queue.add('send', { to: 'x' });
      await vi.waitFor(async () => expect(await queue.bull.getJobState(job.id)).toBe('active'));
      await first.bull.close(true);

      const second = createWorker({
        name,
        jobs,
        connection,
        logger: recordingLogger(),
        ...fast,
        handlers: hang,
      });
      closers.push(() => second.stop());
      await vi.waitFor(async () => expect(await queue.deadLetter.count()).toBe(1), {
        timeout: 15_000,
      });
      expect((await queue.deadLetter.list())[0]).toMatchObject({
        originalId: job.id,
        reason: 'stalled',
      });
    }, 20_000);

    it('a Redis-side disconnect mid-job does not lose the job', async () => {
      const { queue, worker } = setup({ worker: { autostart: false } });
      await worker.start();
      const job = await queue.add('slow', { ms: 400 });
      await vi.waitFor(async () => expect(await queue.bull.getJobState(job.id)).toBe('active'));

      const admin = new Redis({ host: connection.host, port: connection.port });
      closers.push(async () => admin.quit());
      // Kill every normal client connection — the worker's included.
      await admin.call('CLIENT', 'KILL', 'TYPE', 'normal');

      expect(await job.result({ timeoutMs: 15_000 })).toBe('done');
    }, 20_000);
  });
});
