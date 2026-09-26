import { UnrecoverableError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { NotFoundError, ValidationError } from '@firstprinciples/core';
import {
  defineJob,
  PermanentJobError,
  retryPresets,
  type JobHandler,
  type QueueMetrics,
} from '../../src/index.js';
import { createProcessor } from '../../src/internal/processor.js';
import { classify } from '../../src/internal/failure.js';
import { fakeJob, recordingLogger } from '../helpers/fakes.js';

const jobs = {
  send: defineJob<{ to: string }, { ok: true }>(),
  checked: defineJob({
    validate: (d: unknown) => {
      if (typeof (d as { n?: unknown }).n !== 'number') throw new Error('n must be a number');
      return d as { n: number };
    },
  }),
  mapped: defineJob<{ id: string }>({ isPermanent: (e) => e instanceof NotFoundError }),
  once: defineJob<{ x: number }>({ retry: retryPresets.none }),
};

function setup(handlers: Record<string, JobHandler<unknown, unknown>>, metrics: QueueMetrics = {}) {
  const logger = recordingLogger();
  const process = createProcessor({ queue: 'q', jobs, handlers, metrics, logger });
  return { process, logger };
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('createProcessor', () => {
  it('declares three parameters, so BullMQ hands it the abort signal', () => {
    expect(setup({}).process.length).toBe(3);
  });

  it('runs the handler with the payload and a context, and returns its result', async () => {
    const handler = vi.fn(async () => ({ ok: true as const }));
    const signal = new AbortController().signal;
    const { process } = setup({ send: handler });
    const result = await process(
      fakeJob({ name: 'send', id: '7', data: { to: 'a@b' }, attemptsMade: 1 }),
      'tok',
      signal,
    );
    expect(result).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledWith(
      { to: 'a@b' },
      { id: '7', name: 'send', attempt: 2, maxAttempts: 3, signal },
    );
  });

  it('reports completion with duration and wait time', async () => {
    const onCompleted = vi.fn();
    const { process } = setup({ send: () => ({ ok: true }) }, { onCompleted });
    await process(
      fakeJob({ name: 'send', timestamp: 1000, processedOn: 1600 }),
      undefined,
      undefined,
    );
    expect(onCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ queue: 'q', name: 'send', id: '1', attempt: 1, waitMs: 600 }),
    );
    expect(onCompleted.mock.calls[0]?.[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('falls back sensibly when a job has no id, processedOn, or attempts', async () => {
    const onCompleted = vi.fn();
    const handler = vi.fn<(data: unknown, context: unknown) => { ok: boolean }>(() => ({
      ok: true,
    }));
    const { process } = setup({ send: handler }, { onCompleted });
    await process(
      { name: 'send', data: {}, attemptsMade: 0, timestamp: Date.now() + 60_000, opts: {} },
      undefined,
      undefined,
    );
    expect(handler.mock.calls[0]?.[1]).toMatchObject({ id: '', maxAttempts: 1 });
    expect(onCompleted.mock.calls[0]?.[0].waitMs).toBe(0);
  });

  it('rethrows an ordinary handler error untouched, so BullMQ retries it', async () => {
    const boom = new Error('smtp down');
    const onFailed = vi.fn();
    const { process } = setup({ send: () => Promise.reject(boom) }, { onFailed });
    expect(
      await failure(process(fakeJob({ name: 'send', attemptsMade: 0 }), undefined, undefined)),
    ).toBe(boom);
    expect(onFailed).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, maxAttempts: 3, error: 'smtp down', willRetry: true }),
    );
  });

  it('reports willRetry false on the last attempt', async () => {
    const onFailed = vi.fn();
    const { process } = setup({ send: () => Promise.reject(new Error('x')) }, { onFailed });
    await failure(process(fakeJob({ name: 'send', attemptsMade: 2 }), undefined, undefined));
    expect(onFailed.mock.calls[0]?.[0]).toMatchObject({ attempt: 3, willRetry: false });
  });

  it('turns PermanentJobError into an UnrecoverableError tagged permanent, keeping the message and cause', async () => {
    const cause = new PermanentJobError('user deleted');
    const onFailed = vi.fn();
    const { process } = setup({ send: () => Promise.reject(cause) }, { onFailed });
    const error = (await failure(
      process(fakeJob({ name: 'send' }), undefined, undefined),
    )) as UnrecoverableError;
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect(error.name).toBe('UnrecoverableError');
    expect(error.message).toBe('user deleted');
    expect(error.cause).toBe(cause);
    expect(classify(error)).toBe('permanent');
    expect(onFailed.mock.calls[0]?.[0].willRetry).toBe(false);
  });

  it('recognizes a PermanentJobError from another copy of this package by its core brand and name', async () => {
    const lookalike = new NotFoundError('gone');
    Object.defineProperty(lookalike, 'name', { value: 'PermanentJobError' });
    const { process } = setup({ send: () => Promise.reject(lookalike) });
    expect(classify(await failure(process(fakeJob({ name: 'send' }), undefined, undefined)))).toBe(
      'permanent',
    );
  });

  it("applies a job's isPermanent predicate", async () => {
    const { process } = setup({ mapped: () => Promise.reject(new NotFoundError('no row')) });
    expect(
      classify(await failure(process(fakeJob({ name: 'mapped' }), undefined, undefined))),
    ).toBe('permanent');
    const other = setup({ mapped: () => Promise.reject(new Error('timeout')) });
    const error = await failure(other.process(fakeJob({ name: 'mapped' }), undefined, undefined));
    expect(error).not.toBeInstanceOf(UnrecoverableError);
  });

  it('treats a throwing isPermanent as "retryable", and logs it', async () => {
    const angry = {
      ...jobs,
      mapped: defineJob<{ id: string }>({
        isPermanent: () => {
          throw new Error('predicate bug');
        },
      }),
    };
    const logger = recordingLogger();
    const process = createProcessor({
      queue: 'q',
      jobs: angry,
      handlers: { mapped: () => Promise.reject(new Error('x')) },
      metrics: {},
      logger,
    });
    const error = await failure(process(fakeJob({ name: 'mapped' }), undefined, undefined));
    expect(error).not.toBeInstanceOf(UnrecoverableError);
    expect(logger.lines[0]).toMatchObject({
      level: 'warn',
      msg: 'isPermanent threw; treating the failure as retryable',
    });
  });

  it('rejects an unknown job name without calling any handler, tagged unknown-job', async () => {
    const handler = vi.fn();
    const { process } = setup({ send: handler });
    const error = await failure(process(fakeJob({ name: 'fromTheFuture' }), undefined, undefined));
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect((error as Error).message).toBe('No handler for job "fromTheFuture"');
    expect(classify(error)).toBe('unknown-job');
    expect(handler).not.toHaveBeenCalled();
  });

  it('treats a defined job with no handler as unknown too', async () => {
    const { process } = setup({});
    expect(classify(await failure(process(fakeJob({ name: 'send' }), undefined, undefined)))).toBe(
      'unknown-job',
    );
  });

  it('never resolves an inherited name like constructor or __proto__ to a handler', async () => {
    const { process } = setup({ send: vi.fn() });
    for (const name of ['constructor', '__proto__', 'toString']) {
      expect(classify(await failure(process(fakeJob({ name }), undefined, undefined)))).toBe(
        'unknown-job',
      );
    }
  });

  it('validates the payload before the handler; a rejection is unrecoverable and tagged invalid-payload', async () => {
    const handler = vi.fn();
    const { process } = setup({ checked: handler });
    const error = await failure(
      process(fakeJob({ name: 'checked', data: { n: 'seven' } }), undefined, undefined),
    );
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect((error as Error).message).toBe('Invalid payload for job "checked": n must be a number');
    expect(classify(error)).toBe('invalid-payload');
    expect(handler).not.toHaveBeenCalled();
  });

  it('passes the validated value, not the raw one, to the handler', async () => {
    const withTransform = {
      ...jobs,
      checked: defineJob({ validate: (d: unknown) => ({ n: Number((d as { n: string }).n) }) }),
    };
    const handler = vi.fn();
    const process = createProcessor({
      queue: 'q',
      jobs: withTransform,
      handlers: { checked: handler },
      metrics: {},
      logger: recordingLogger(),
    });
    await process(fakeJob({ name: 'checked', data: { n: '42' } }), undefined, undefined);
    expect(handler.mock.calls[0]?.[0]).toEqual({ n: 42 });
  });

  it('a throwing metrics hook never fails the job, and is logged', async () => {
    const { process, logger } = setup(
      { send: () => ({ ok: true }) },
      {
        onCompleted: () => {
          throw new Error('statsd down');
        },
      },
    );
    await expect(process(fakeJob({ name: 'send' }), undefined, undefined)).resolves.toEqual({
      ok: true,
    });
    expect(logger.lines[0]).toMatchObject({
      msg: 'queue metrics hook threw; ignored',
      fields: { hook: 'onCompleted', error: 'statsd down' },
    });
  });

  it('a throwing onFailed hook does not replace the job error', async () => {
    const boom = new Error('real failure');
    const { process } = setup(
      { send: () => Promise.reject(boom) },
      {
        onFailed: () => {
          throw new Error('hook');
        },
      },
    );
    expect(await failure(process(fakeJob({ name: 'send' }), undefined, undefined))).toBe(boom);
  });

  it('describes a non-Error rejection', async () => {
    const onFailed = vi.fn();
    const { process } = setup({ send: () => Promise.reject('plain') }, { onFailed });
    await failure(process(fakeJob({ name: 'send' }), undefined, undefined));
    expect(onFailed.mock.calls[0]?.[0].error).toBe('plain');
    const other = setup({ send: () => Promise.reject({ weird: 1 }) }, { onFailed });
    await failure(other.process(fakeJob({ name: 'send' }), undefined, undefined));
    expect(onFailed.mock.calls[1]?.[0].error).toBe('unknown error');
  });

  it('ValidationError from a handler is retried unless the job says otherwise', async () => {
    const { process } = setup({ send: () => Promise.reject(new ValidationError('bad')) });
    expect(
      await failure(process(fakeJob({ name: 'send' }), undefined, undefined)),
    ).not.toBeInstanceOf(UnrecoverableError);
  });
});
