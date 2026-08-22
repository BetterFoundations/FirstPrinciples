import { describe, expect, it } from 'vitest';
import { getCorrelationId, runWithCorrelationId } from '../../src/internal/correlation-node.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('correlation-node — propagation across async boundaries', () => {
  it('survives a chain of awaits', async () => {
    const seen = await runWithCorrelationId('req-1', async () => {
      await delay(1);
      await delay(1);
      return getCorrelationId();
    });
    expect(seen).toBe('req-1');
  });

  it('survives setTimeout and setInterval callbacks', async () => {
    const timeoutSeen = await runWithCorrelationId('req-timeout', () => {
      return new Promise<string | undefined>((resolve) => {
        setTimeout(() => resolve(getCorrelationId()), 1);
      });
    });
    expect(timeoutSeen).toBe('req-timeout');

    const intervalSeen = await runWithCorrelationId('req-interval', () => {
      return new Promise<string | undefined>((resolve) => {
        let ticks = 0;
        const handle = setInterval(() => {
          ticks++;
          if (ticks === 2) {
            clearInterval(handle);
            resolve(getCorrelationId());
          }
        }, 1);
      });
    });
    expect(intervalSeen).toBe('req-interval');
  });

  it('survives process.nextTick and queueMicrotask', async () => {
    const seen = await runWithCorrelationId('req-microtask', () => {
      return new Promise<string | undefined>((resolve) => {
        process.nextTick(() => {
          queueMicrotask(() => resolve(getCorrelationId()));
        });
      });
    });
    expect(seen).toBe('req-microtask');
  });

  it('propagates to every branch of a Promise.all', async () => {
    const results = await runWithCorrelationId('req-fanout', async () => {
      return Promise.all([
        delay(3).then(() => getCorrelationId()),
        delay(1).then(() => getCorrelationId()),
        delay(2).then(() => getCorrelationId()),
      ]);
    });
    expect(results).toEqual(['req-fanout', 'req-fanout', 'req-fanout']);
  });

  it('isolates two concurrent runs from each other, including interleaved timers', async () => {
    const [a, b] = await Promise.all([
      runWithCorrelationId('req-a', async () => {
        await delay(5);
        return getCorrelationId();
      }),
      runWithCorrelationId('req-b', async () => {
        await delay(1);
        return getCorrelationId();
      }),
    ]);
    expect(a).toBe('req-a');
    expect(b).toBe('req-b');
  });

  it('a nested run temporarily overrides the outer ID, then the outer ID resumes', async () => {
    const seenInside: (string | undefined)[] = [];
    await runWithCorrelationId('outer', async () => {
      seenInside.push(getCorrelationId());
      await runWithCorrelationId('inner', async () => {
        await delay(1);
        seenInside.push(getCorrelationId());
      });
      seenInside.push(getCorrelationId());
    });
    expect(seenInside).toEqual(['outer', 'inner', 'outer']);
  });
});
