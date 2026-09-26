/**
 * @firstprinciples/queue against a real Redis (set REDIS_URL):
 *
 *   1. A typed job succeeds and its result comes back typed.
 *   2. A flaky job fails twice, is retried with backoff, then succeeds.
 *   3. A job whose downstream is down exhausts its attempts and lands in the
 *      dead-letter queue — with the reason, attempts and last error.
 *   4. A malformed payload from a "foreign" producer is dead-lettered after
 *      one attempt, never reaching the handler.
 *   5. The outage is fixed; the dead-lettered job is redriven and succeeds.
 */
import {
  createQueue,
  createWorker,
  defineJob,
  PermanentJobError,
  retryPresets,
} from '@firstprinciples/queue';

const url = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
const connection = {
  host: url.hostname,
  port: Number(url.port || 6379),
  maxRetriesPerRequest: null,
};
const name = `example-${process.pid}`;

const jobs = {
  sendEmail: defineJob<{ to: string }, { messageId: string }>({ retry: retryPresets.fixed(3, 50) }),
  chargeCard: defineJob<{ amountCents: number }, { receipt: string }>({
    retry: retryPresets.fixed(3, 50),
  }),
  resize: defineJob({
    retry: retryPresets.fixed(5, 50),
    validate: (d: unknown) => {
      const width = (d as { width?: unknown }).width;
      if (typeof width !== 'number' || width <= 0)
        throw new Error('width must be a positive number');
      return { width };
    },
  }),
};

let paymentsUp = false;
let emailFailures = 0;

const queue = createQueue({ name, jobs, connection });
const worker = createWorker({
  name,
  jobs,
  connection,
  handlers: {
    sendEmail: async ({ to }, { attempt }) => {
      if (emailFailures++ < 2) throw new Error(`SMTP timeout (attempt ${attempt})`);
      return { messageId: `msg-${to}` };
    },
    chargeCard: async ({ amountCents }) => {
      if (amountCents < 0) throw new PermanentJobError('negative amount');
      if (!paymentsUp) throw new Error('payments API 503');
      return { receipt: `rcpt-${amountCents}` };
    },
    resize: async ({ width }) => void width,
  },
  metrics: {
    onFailed: (e) =>
      console.log(
        `   ↳ ${e.name} attempt ${e.attempt}/${e.maxAttempts} failed: ${e.error}${e.willRetry ? ' — will retry' : ' — final'}`,
      ),
    onDeadLettered: (e) =>
      console.log(`   ↳ dead-lettered ${e.name} #${e.id} (${e.reason}, ${e.attempts} attempt(s))`),
  },
});

const waitForDeadLetters = async (count: number) => {
  while ((await queue.deadLetter.count()) < count) await new Promise((r) => setTimeout(r, 50));
};

try {
  console.log('\n1+2. A flaky job, retried until it succeeds:');
  const email = await queue.add('sendEmail', { to: 'ada@example.com' });
  const { messageId } = await email.result({ timeoutMs: 10_000 });
  console.log(`   result (typed { messageId: string }): ${messageId}`);

  console.log('\n3. A job whose downstream is down exhausts its attempts:');
  const charge = await queue.add('chargeCard', { amountCents: 4200 });
  await charge
    .result({ timeoutMs: 10_000 })
    .catch((error: Error) => console.log(`   result() rejected: ${error.message}`));
  await waitForDeadLetters(1);

  console.log('\n4. A malformed payload from a producer that skipped validation:');
  await queue.bull.add('resize', { width: 'wide' }, { attempts: 5 });
  await waitForDeadLetters(2);

  console.log('\n   The dead-letter queue now holds:');
  for (const entry of await queue.deadLetter.list()) {
    console.log(
      `   - ${entry.id}: ${entry.name} ${JSON.stringify(entry.data)} — ${entry.reason}, ${entry.attempts} attempt(s), "${entry.error}"`,
    );
  }
  console.log(`   depth: ${JSON.stringify(await queue.depth())}`);

  console.log('\n5. Payments recover; redrive the dead-lettered charge:');
  paymentsUp = true;
  const [parked] = (await queue.deadLetter.list()).filter((e) => e.name === 'chargeCard');
  const newId = await queue.deadLetter.redrive(parked!.id);
  while ((await queue.bull.getJobState(newId!)) !== 'completed')
    await new Promise((r) => setTimeout(r, 50));
  const redriven = await queue.bull.getJob(newId!);
  console.log(
    `   redriven as #${newId}: ${JSON.stringify(redriven?.returnvalue)}; dead letters left: ${await queue.deadLetter.count()}`,
  );
} finally {
  await worker.stop();
  await queue.bull.obliterate({ force: true });
  const { Queue } = await import('bullmq');
  const dlq = new Queue(`${name}.dead-letter`, { connection });
  await dlq.obliterate({ force: true });
  await dlq.close();
  await queue.close();
}
console.log();
