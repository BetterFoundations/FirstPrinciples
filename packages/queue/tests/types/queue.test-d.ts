import { describe, expectTypeOf, it } from 'vitest';
import {
  createQueue,
  createWorker,
  defineJob,
  type DataOf,
  type EnqueuedJob,
  type JobContext,
  type ResultOf,
} from '../../src/index.js';

const connection = { host: 'localhost' };

const jobs = {
  sendEmail: defineJob<{ to: string; template: 'welcome' | 'reset' }, { messageId: string }>(),
  resize: defineJob({ validate: (d: unknown) => d as { url: string; width: number } }),
  ping: defineJob<Record<string, never>>(),
};

describe('end-to-end inference, with no generics at any call site', () => {
  it('infers payload and result from the definition', () => {
    expectTypeOf<DataOf<typeof jobs.sendEmail>>().toEqualTypeOf<{
      to: string;
      template: 'welcome' | 'reset';
    }>();
    expectTypeOf<ResultOf<typeof jobs.sendEmail>>().toEqualTypeOf<{ messageId: string }>();
    // From `validate`'s return type alone:
    expectTypeOf<DataOf<typeof jobs.resize>>().toEqualTypeOf<{ url: string; width: number }>();
    expectTypeOf<ResultOf<typeof jobs.resize>>().toEqualTypeOf<void>();
  });

  it('add() checks the name and payload, and types the result', async () => {
    const queue = createQueue({ name: 'q', jobs, connection });
    const job = await queue.add('sendEmail', { to: 'a@b', template: 'welcome' });
    expectTypeOf(job).toEqualTypeOf<EnqueuedJob<{ messageId: string }>>();
    expectTypeOf(await job.result()).toEqualTypeOf<{ messageId: string }>();

    // @ts-expect-error — not a job in this queue
    await queue.add('sendSms', { to: 'x' });
    // @ts-expect-error — wrong template literal
    await queue.add('sendEmail', { to: 'a@b', template: 'goodbye' });
    // @ts-expect-error — missing field
    await queue.add('resize', { url: 'x' });
  });

  it('handlers are typed from the definitions, and must be exhaustive', () => {
    createWorker({
      name: 'q',
      jobs,
      connection,
      handlers: {
        sendEmail: async (data, context) => {
          expectTypeOf(data).toEqualTypeOf<{ to: string; template: 'welcome' | 'reset' }>();
          expectTypeOf(context).toEqualTypeOf<JobContext>();
          return { messageId: data.to };
        },
        resize: ({ width }) => {
          expectTypeOf(width).toEqualTypeOf<number>();
        },
        ping: () => undefined,
      },
    });

    createWorker({
      name: 'q',
      jobs,
      connection,
      // @ts-expect-error — `ping` has no handler
      handlers: {
        sendEmail: async () => ({ messageId: 'x' }),
        resize: () => undefined,
      },
    });

    createWorker({
      name: 'q',
      jobs,
      connection,
      handlers: {
        // @ts-expect-error — result does not match the definition
        sendEmail: async () => ({ id: 1 }),
        resize: () => undefined,
        ping: () => undefined,
      },
    });
  });

  it('dead-letter entries carry the job names and payload union', async () => {
    const queue = createQueue({ name: 'q', jobs, connection });
    const [entry] = await queue.deadLetter.list();
    expectTypeOf(entry!.name).toEqualTypeOf<'sendEmail' | 'resize' | 'ping'>();
    expectTypeOf(entry!.reason).toEqualTypeOf<
      'exhausted' | 'permanent' | 'invalid-payload' | 'unknown-job' | 'stalled'
    >();
  });
});
