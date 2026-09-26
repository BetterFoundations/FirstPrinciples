import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createService,
  LifecycleError,
  type Resource,
  type ServiceOptions,
} from '../../src/index.js';
import { recordingLogger } from '../support.js';

function tracked(events: string[], name: string, extra: Partial<Resource> = {}): Resource {
  return {
    name,
    start: () => {
      events.push(`start:${name}`);
    },
    stop: () => {
      events.push(`stop:${name}`);
    },
    ...extra,
  };
}

function make(options: Partial<ServiceOptions> = {}) {
  const logger = recordingLogger();
  const signals = new EventEmitter();
  const exit = vi.fn();
  const service = createService({ name: 'test', logger, signalSource: signals, exit, ...options });
  return { service, logger, signals, exit };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createService — registration', () => {
  it('starts idle, with a name', () => {
    const { service } = make();
    expect(service.state).toBe('idle');
    expect(service.name).toBe('test');
  });

  it('defaults the name', () => {
    expect(createService({ logger: recordingLogger(), signals: false }).name).toBe('service');
  });

  it('chains addResource and addCheck', () => {
    const { service } = make();
    expect(service.addResource({ name: 'a' }).addCheck({ name: 'c', check: () => true })).toBe(
      service,
    );
  });

  it('rejects duplicate resource and check names', () => {
    const { service } = make();
    service.addResource({ name: 'db' }).addCheck({ name: 'db', check: () => true });
    expect(() => service.addResource({ name: 'db' })).toThrow(LifecycleError);
    expect(() => service.addCheck({ name: 'db', check: () => true })).toThrow(
      'A health check named "db" is already registered',
    );
  });

  it('refuses registration after start', async () => {
    const { service } = make();
    await service.start();
    expect(() => service.addResource({ name: 'late' })).toThrow(
      'Cannot add a resource once the service is running',
    );
    expect(() => service.addCheck({ name: 'late', check: () => true })).toThrow(LifecycleError);
  });

  it('LifecycleError carries its code, status and details', () => {
    const { service } = make();
    service.addResource({ name: 'db' });
    try {
      service.addResource({ name: 'db' });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        name: 'LifecycleError',
        code: 'LIFECYCLE_ERROR',
        httpStatus: 500,
        details: { service: 'test' },
      });
    }
  });

  it('LifecycleError lets its defaults be overridden', () => {
    const error = new LifecycleError('x', { code: 'Y', httpStatus: 409 });
    expect([error.code, error.httpStatus]).toEqual(['Y', 409]);
  });
});

describe('createService — start', () => {
  it('starts resources in registration order, then reports running', async () => {
    const events: string[] = [];
    const { service, logger } = make();
    service
      .addResource(tracked(events, 'db'))
      .addResource(tracked(events, 'cache'))
      .addResource(tracked(events, 'http'));
    await service.start();
    expect(events).toEqual(['start:db', 'start:cache', 'start:http']);
    expect(service.state).toBe('running');
    expect(logger.messages()).toEqual([
      'service starting',
      'resource started',
      'resource started',
      'resource started',
      'service ready',
    ]);
    expect(logger.lines[0]?.fields).toMatchObject({
      service: 'test',
      pid: process.pid,
      node: process.version,
      resources: ['db', 'cache', 'http'],
      checks: [],
    });
  });

  it('is "starting" while a resource is still starting', async () => {
    let finish!: () => void;
    const { service } = make();
    service.addResource({ name: 'slow', start: () => new Promise<void>((r) => (finish = r)) });
    const started = service.start();
    expect(service.state).toBe('starting');
    finish();
    await started;
    expect(service.state).toBe('running');
  });

  it('accepts resources with no start or stop', async () => {
    const { service } = make();
    service.addResource({ name: 'inert' });
    await service.start();
    expect((await service.shutdown()).ok).toBe(true);
  });

  it('rejects (does not throw) when started twice', async () => {
    const { service } = make();
    await service.start();
    await expect(service.start()).rejects.toThrow('Cannot start once the service is running');
  });

  it('rolls back on a failed start: stops what started, in reverse, and rethrows the original error', async () => {
    const events: string[] = [];
    const boom = new Error('port in use');
    const { service, logger } = make();
    service
      .addResource(tracked(events, 'db'))
      .addResource(tracked(events, 'cache'))
      .addResource(tracked(events, 'http', { start: () => Promise.reject(boom) }))
      .addResource(tracked(events, 'never'));
    await expect(service.start()).rejects.toBe(boom);
    expect(events).toEqual(['start:db', 'start:cache', 'stop:cache', 'stop:db']);
    expect(service.state).toBe('failed');
    expect(logger.lines.find((l) => l.msg === 'resource failed to start')?.fields).toEqual({
      service: 'test',
      resource: 'http',
      error: 'port in use',
    });
  });

  it('describes a non-Error start failure', async () => {
    const { service, logger } = make();
    service.addResource({
      name: 'odd',
      start: () => {
        throw 'string failure';
      },
    });
    await expect(service.start()).rejects.toBe('string failure');
    expect(logger.lines.find((l) => l.msg === 'resource failed to start')?.fields?.error).toBe(
      'string failure',
    );
  });

  it('removes its signal handlers after a failed start', async () => {
    const { service, signals } = make();
    service.addResource({ name: 'bad', start: () => Promise.reject(new Error('x')) });
    await expect(service.start()).rejects.toThrow();
    expect(signals.listenerCount('SIGTERM')).toBe(0);
    expect(signals.listenerCount('SIGINT')).toBe(0);
  });
});

describe('createService — shutdown ordering', () => {
  it('stops in reverse registration order by default', async () => {
    const events: string[] = [];
    const { service } = make();
    for (const name of ['db', 'queue', 'cache', 'http']) service.addResource(tracked(events, name));
    await service.start();
    events.length = 0;
    const result = await service.shutdown();
    expect(events).toEqual(['stop:http', 'stop:cache', 'stop:queue', 'stop:db']);
    expect(result).toMatchObject({
      ok: true,
      reason: 'manual',
      timedOut: false,
      failed: [],
      pending: [],
    });
    expect(service.state).toBe('stopped');
  });

  it('honors stopOrder, with ties in reverse registration order — deterministically', async () => {
    const events: string[] = [];
    const { service } = make();
    service
      .addResource(tracked(events, 'metrics', { stopOrder: 10 }))
      .addResource(tracked(events, 'db', { stopOrder: 5 }))
      .addResource(tracked(events, 'cache', { stopOrder: 5 }))
      .addResource(tracked(events, 'http', { stopOrder: -1 }))
      .addResource(tracked(events, 'worker'));
    await service.start();
    events.length = 0;
    await service.shutdown();
    expect(events).toEqual(['stop:http', 'stop:worker', 'stop:cache', 'stop:db', 'stop:metrics']);
  });

  it('waits for each stop before starting the next', async () => {
    const events: string[] = [];
    const { service } = make();
    service.addResource({ name: 'db', stop: () => void events.push('db') }).addResource({
      name: 'http',
      stop: () =>
        new Promise<void>((r) =>
          setTimeout(() => {
            events.push('http');
            r();
          }, 20),
        ),
    });
    await service.start();
    await service.shutdown();
    expect(events).toEqual(['http', 'db']);
  });

  it('keeps going past a stop that throws, and reports it', async () => {
    const events: string[] = [];
    const { service, logger } = make();
    service
      .addResource(tracked(events, 'db'))
      .addResource(
        tracked(events, 'broken', {
          stop: () => {
            throw new Error('close failed');
          },
        }),
      )
      .addResource(tracked(events, 'http'));
    await service.start();
    events.length = 0;
    const result = await service.shutdown('deploy');
    expect(events).toEqual(['stop:http', 'stop:db']);
    expect(result).toMatchObject({
      ok: false,
      reason: 'deploy',
      failed: ['broken'],
      pending: [],
      timedOut: false,
    });
    expect(logger.lines.find((l) => l.msg === 'resource failed to stop')?.fields).toEqual({
      service: 'test',
      resource: 'broken',
      error: 'close failed',
    });
  });

  it('passes each stop a signal that is not aborted under the deadline', async () => {
    let seen: AbortSignal | undefined;
    const { service } = make();
    service.addResource({ name: 'r', stop: (signal) => void (seen = signal) });
    await service.start();
    await service.shutdown();
    expect(seen?.aborted).toBe(false);
  });

  it('logs shutdown start and completion with the result', async () => {
    const { service, logger } = make({ drainDelayMs: 0, shutdownTimeoutMs: 1234 });
    await service.start();
    await service.shutdown('SIGTERM');
    expect(logger.lines.find((l) => l.msg === 'shutdown started')?.fields).toEqual({
      service: 'test',
      reason: 'SIGTERM',
      drainDelayMs: 0,
      shutdownTimeoutMs: 1234,
    });
    expect(logger.lines.at(-1)).toMatchObject({
      msg: 'shutdown complete',
      fields: { ok: true, reason: 'SIGTERM' },
    });
  });
});

describe('createService — shutdown idempotence and odd states', () => {
  it('returns the same promise to every caller', async () => {
    const stop = vi.fn();
    const { service } = make();
    service.addResource({ name: 'r', stop });
    await service.start();
    const first = service.shutdown('a');
    const second = service.shutdown('b');
    expect(second).toBe(first);
    expect((await first).reason).toBe('a');
    expect(stop).toHaveBeenCalledOnce();
  });

  it('before start: nothing to stop, state becomes stopped, and start is refused after', async () => {
    const { service } = make();
    const result = await service.shutdown();
    expect(result).toMatchObject({ ok: true, failed: [], pending: [], timedOut: false });
    expect(service.state).toBe('stopped');
    await expect(service.start()).rejects.toThrow(LifecycleError);
  });

  it('during start: waits for startup to finish, then stops everything', async () => {
    const events: string[] = [];
    let finish!: () => void;
    const { service } = make();
    service
      .addResource(tracked(events, 'db'))
      .addResource(
        tracked(events, 'slow', { start: () => new Promise<void>((r) => (finish = r)) }),
      );
    const started = service.start();
    const stopping = service.shutdown();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(service.state).toBe('starting');
    finish();
    await started;
    const result = await stopping;
    expect(result.ok).toBe(true);
    expect(events).toEqual(['start:db', 'stop:slow', 'stop:db']);
  });

  it('after a failed start: reports not-ok without stopping anything twice', async () => {
    const events: string[] = [];
    const { service } = make();
    service
      .addResource(tracked(events, 'db'))
      .addResource({ name: 'bad', start: () => Promise.reject(new Error('x')) });
    await expect(service.start()).rejects.toThrow();
    events.length = 0;
    const result = await service.shutdown();
    expect(result.ok).toBe(false);
    expect(events).toEqual([]);
    expect(service.state).toBe('failed');
  });
});

describe('createService — health', () => {
  it('readiness fails in every state but running, with a reason', async () => {
    let finish!: () => void;
    const { service } = make();
    service.addResource({ name: 'slow', start: () => new Promise<void>((r) => (finish = r)) });
    expect(await service.checkReadiness()).toEqual({
      status: 'fail',
      state: 'idle',
      reason: 'service has not started',
      checks: {},
    });
    const started = service.start();
    expect((await service.checkReadiness()).reason).toBe('service is starting');
    finish();
    await started;
    expect((await service.checkReadiness()).status).toBe('pass');
    await service.shutdown();
    expect((await service.checkReadiness()).reason).toBe('service has stopped');
  });

  it('readiness fails after a failed start', async () => {
    const { service } = make();
    service.addResource({ name: 'bad', start: () => Promise.reject(new Error('x')) });
    await expect(service.start()).rejects.toThrow();
    expect((await service.checkReadiness()).reason).toBe('service failed to start');
  });

  it('readiness runs every check; liveness runs only liveness checks', async () => {
    const readiness = vi.fn(() => true);
    const liveness = vi.fn(() => true);
    const { service } = make();
    service
      .addCheck({ name: 'db', check: readiness })
      .addCheck({ name: 'loop', kind: 'liveness', check: liveness });
    await service.start();
    expect(Object.keys((await service.checkReadiness()).checks).sort()).toEqual(['db', 'loop']);
    expect(Object.keys((await service.checkLiveness()).checks)).toEqual(['loop']);
    expect(readiness).toHaveBeenCalledOnce();
    expect(liveness).toHaveBeenCalledTimes(2);
  });

  it('liveness keeps answering honestly while draining, while readiness fails', async () => {
    let release!: () => void;
    const { service } = make();
    service
      .addResource({ name: 'http', stop: () => new Promise<void>((r) => (release = r)) })
      .addCheck({ name: 'loop', kind: 'liveness', check: () => true });
    await service.start();
    const stopping = service.shutdown();
    await vi.waitFor(() => expect(service.state).toBe('stopping'));
    expect(await service.checkLiveness()).toMatchObject({ status: 'pass', state: 'stopping' });
    expect(await service.checkReadiness()).toMatchObject({
      status: 'fail',
      reason: 'service is stopping',
    });
    release();
    await stopping;
  });

  it('liveness fails once startup failed', async () => {
    const { service } = make();
    service.addResource({ name: 'bad', start: () => Promise.reject(new Error('x')) });
    await expect(service.start()).rejects.toThrow();
    expect(await service.checkLiveness()).toMatchObject({
      status: 'fail',
      reason: 'service failed to start',
    });
  });

  it('readiness reflects a shutdown that began while its checks were running', async () => {
    let release!: () => void;
    const { service } = make();
    service.addCheck({ name: 'slow', check: () => new Promise<void>((r) => (release = r)) });
    await service.start();
    const probe = service.checkReadiness();
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const stopping = service.shutdown();
    await vi.waitFor(() => expect(service.state).not.toBe('running'));
    release();
    expect(await probe).toMatchObject({
      status: 'fail',
      reason: expect.stringMatching(/stopp/) as unknown,
    });
    await stopping;
  });

  it('shares one evaluation between concurrent probes (single-flight)', async () => {
    const waiting: (() => void)[] = [];
    const releaseAll = (): void => waiting.splice(0).forEach((release) => release());
    const check = vi.fn(() => new Promise<void>((r) => waiting.push(r)));
    const { service } = make();
    service.addCheck({ name: 'slow', kind: 'liveness', check });
    await service.start();
    const a = service.checkReadiness();
    const b = service.checkReadiness();
    const c = service.checkLiveness();
    const d = service.checkLiveness();
    expect(b).toBe(a);
    expect(d).toBe(c);
    // One evaluation per probe kind, not one per caller.
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(2));
    releaseAll();
    await Promise.all([a, c]);
    // A later probe evaluates again rather than reusing a stale answer.
    const e = service.checkReadiness();
    expect(e).not.toBe(a);
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(3));
    releaseAll();
    expect((await e).status).toBe('pass');
  });

  it('applies the service-wide check timeout', async () => {
    vi.useFakeTimers();
    const { service } = make({ checkTimeoutMs: 100 });
    service.addCheck({ name: 'hang', check: () => new Promise(() => undefined) });
    await service.start();
    const probe = service.checkReadiness();
    await vi.advanceTimersByTimeAsync(100);
    expect((await probe).checks.hang?.error).toBe('timed out after 100ms');
  });
});

describe('createService — defaults', () => {
  it('creates a real logger lazily when none is given', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const service = createService({ name: 'defaults', signals: false });
      await service.start();
      await service.shutdown();
      expect(service.state).toBe('stopped');
    } finally {
      write.mockRestore();
    }
  });

  it('installs handlers on process by default, and removes them afterwards', async () => {
    const before = process.listenerCount('SIGTERM');
    const service = createService({ logger: recordingLogger() });
    await service.start();
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);
    expect(process.listenerCount('SIGINT')).toBeGreaterThan(0);
    await service.shutdown();
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });

  it('installs no handlers with signals: false', async () => {
    const { service, signals } = make({ signals: false });
    await service.start();
    expect(signals.eventNames()).toEqual([]);
    await service.shutdown();
  });
});
