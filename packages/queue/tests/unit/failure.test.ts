import { UnrecoverableError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import {
  classify,
  createFailureHandler,
  isFinal,
  type DeadLetterSink,
} from '../../src/internal/failure.js';
import { unrecoverable, willRetry } from '../../src/internal/shared.js';
import { fakeJob, recordingLogger } from '../helpers/fakes.js';

const fixedNow = () => new Date('2026-09-27T10:00:00.000Z');

function setup(sink?: Partial<DeadLetterSink>) {
  const add = vi.fn(async () => undefined);
  const deadLetter: DeadLetterSink = { add, ...sink };
  const onDeadLettered = vi.fn();
  const logger = recordingLogger();
  const handle = createFailureHandler({
    queue: 'emails',
    deadLetter,
    metrics: { onDeadLettered },
    logger,
    now: fixedNow,
  });
  return { handle, add: deadLetter.add as ReturnType<typeof vi.fn>, onDeadLettered, logger };
}

describe('classify', () => {
  it.each([
    ['exhausted', new Error('smtp down')],
    ['permanent', new UnrecoverableError('nope')],
    ['permanent', Object.assign(new Error('renamed'), { name: 'UnrecoverableError' })],
    ['stalled', new UnrecoverableError('job stalled more than allowable limit')],
    ['stalled', new UnrecoverableError('job started more than allowable limit')],
    ['invalid-payload', unrecoverable('x', 'invalid-payload')],
    ['unknown-job', unrecoverable('x', 'unknown-job')],
    ['permanent', unrecoverable('x', 'permanent')],
    ['exhausted', 'a string'],
  ])('%s ← %s', (expected, error) => {
    expect(classify(error)).toBe(expected);
  });

  it('ignores a tag that is not a known reason', () => {
    const error = new Error('x');
    Object.defineProperty(error, Symbol.for('@firstprinciples/queue/deadLetterReason'), {
      value: 'nonsense',
    });
    expect(classify(error)).toBe('exhausted');
  });
});

describe('isFinal and willRetry agree with BullMQ, one attempt apart', () => {
  // Attempt k of n fails. In the processor BullMQ has not counted it yet
  // (attemptsMade = k - 1); in the failed event it has (attemptsMade = k).
  // The two decisions must always be exact opposites.
  it.each([
    [1, 3, true],
    [2, 3, true],
    [3, 3, false],
    [1, 1, false],
    [4, 10, true],
    [10, 10, false],
  ])('attempt %i of %i failing: willRetry=%s, and isFinal is its opposite', (k, n, retries) => {
    const error = new Error('x');
    expect(
      willRetry(fakeJob({ name: 'a', attemptsMade: k - 1, opts: { attempts: n } }), error),
    ).toBe(retries);
    expect(isFinal(fakeJob({ name: 'a', attemptsMade: k, opts: { attempts: n } }), error)).toBe(
      !retries,
    );
  });

  it('an unrecoverable error is final (and never retried) regardless of attempts left', () => {
    const job = fakeJob({ name: 'a', attemptsMade: 1, opts: { attempts: 10 } });
    expect(isFinal(job, new UnrecoverableError('x'))).toBe(true);
    expect(willRetry(job, new UnrecoverableError('x'))).toBe(false);
  });

  it('a job with no attempts option gets one attempt, as in BullMQ', () => {
    expect(isFinal(fakeJob({ name: 'a', attemptsMade: 1, opts: {} }), new Error('x'))).toBe(true);
    expect(willRetry(fakeJob({ name: 'a', attemptsMade: 0, opts: {} }), new Error('x'))).toBe(
      false,
    );
  });
});

describe('createFailureHandler', () => {
  it('dead-letters a final failure under a deterministic id, and reports it', async () => {
    const { handle, add, onDeadLettered } = setup();
    await handle(
      fakeJob({
        name: 'send',
        id: '42',
        data: { to: 'a@b' },
        attemptsMade: 3,
        opts: { attempts: 3 },
      }),
      new Error('smtp down'),
    );
    expect(add).toHaveBeenCalledExactlyOnceWith(
      'send',
      {
        originalId: '42',
        data: { to: 'a@b' },
        reason: 'exhausted',
        error: 'smtp down',
        attempts: 3,
        failedAt: '2026-09-27T10:00:00.000Z',
      },
      { jobId: 'dead-42', removeOnComplete: false },
    );
    expect(onDeadLettered).toHaveBeenCalledWith({
      queue: 'emails',
      name: 'send',
      id: '42',
      reason: 'exhausted',
      attempts: 3,
    });
  });

  it('does nothing for a failure that will be retried', async () => {
    const { handle, add, onDeadLettered } = setup();
    await handle(fakeJob({ name: 'send', attemptsMade: 1, opts: { attempts: 3 } }), new Error('x'));
    expect(add).not.toHaveBeenCalled();
    expect(onDeadLettered).not.toHaveBeenCalled();
  });

  it('dead-letters a permanent failure after a single attempt', async () => {
    const { handle, add } = setup();
    await handle(
      fakeJob({ name: 'send', attemptsMade: 1, opts: { attempts: 5 } }),
      unrecoverable('gone', 'permanent'),
    );
    expect(add.mock.calls[0]?.[1]).toMatchObject({ reason: 'permanent', attempts: 1 });
  });

  it('dead-letters a job BullMQ failed for stalling, which never reached the processor', async () => {
    const { handle, add } = setup();
    await handle(
      fakeJob({ name: 'send', attemptsMade: 1, opts: { attempts: 5 } }),
      new UnrecoverableError('job stalled more than allowable limit'),
    );
    expect(add.mock.calls[0]?.[1]).toMatchObject({ reason: 'stalled' });
  });

  it('warns and skips a failure with no job or no id', async () => {
    const { handle, add, logger } = setup();
    await handle(undefined, new Error('x'));
    await handle({ ...fakeJob({ name: 'send' }), id: undefined, attemptsMade: 9 }, new Error('x'));
    expect(add).not.toHaveBeenCalled();
    expect(logger.lines.map((l) => l.msg)).toEqual([
      'job failed without an id; cannot dead-letter it',
      'job failed without an id; cannot dead-letter it',
    ]);
  });

  it('logs (and does not throw, or report) a dead-letter write that fails', async () => {
    const { handle, logger, onDeadLettered } = setup({
      add: vi.fn(async () => Promise.reject(new Error('redis gone'))),
    });
    await expect(
      handle(fakeJob({ name: 'send', id: '9', attemptsMade: 3 }), new Error('x')),
    ).resolves.toBeUndefined();
    expect(logger.lines[0]).toMatchObject({
      level: 'error',
      msg: 'failed to dead-letter a job; it remains in the failed set',
      fields: { queue: 'emails', name: 'send', id: '9', error: 'redis gone' },
    });
    expect(onDeadLettered).not.toHaveBeenCalled();
  });

  it('defaults the clock to now', async () => {
    const add = vi.fn(async () => undefined);
    const handle = createFailureHandler({
      queue: 'q',
      deadLetter: { add },
      metrics: {},
      logger: recordingLogger(),
    });
    await handle(fakeJob({ name: 'send', attemptsMade: 3 }), new Error('x'));
    const failedAt = (add.mock.calls[0] as unknown[])[1] as { failedAt: string };
    expect(Date.now() - Date.parse(failedAt.failedAt)).toBeLessThan(5000);
  });
});
