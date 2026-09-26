import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createService, type ServiceOptions } from '../../src/index.js';
import { deferred, recordingLogger } from '../support.js';

function make(options: Partial<ServiceOptions> = {}) {
  const logger = recordingLogger();
  const signals = new EventEmitter();
  const exit = vi.fn();
  const service = createService({ name: 'edge', logger, signalSource: signals, exit, ...options });
  return { service, logger, signals, exit };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('signals', () => {
  it('SIGTERM shuts down gracefully and exits 0', async () => {
    const stop = vi.fn();
    const { service, signals, exit } = make();
    service.addResource({ name: 'r', stop });
    await service.start();
    signals.emit('SIGTERM', 'SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(0));
    expect(stop).toHaveBeenCalledOnce();
    expect(service.state).toBe('stopped');
  });

  it('SIGINT is handled the same way, and the reason is the signal name', async () => {
    const { service, signals, exit, logger } = make();
    await service.start();
    signals.emit('SIGINT', 'SIGINT');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(logger.lines.find((l) => l.msg === 'shutdown started')?.fields?.reason).toBe('SIGINT');
  });

  it('exits 1 when a resource failed to stop', async () => {
    const { service, signals, exit } = make();
    service.addResource({ name: 'bad', stop: () => Promise.reject(new Error('x')) });
    await service.start();
    signals.emit('SIGTERM', 'SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });

  it('a second SIGTERM mid-shutdown neither restarts nor corrupts it: one stop per resource, one exit', async () => {
    const gate = deferred();
    const stops: string[] = [];
    const { service, signals, exit, logger } = make();
    service.addResource({ name: 'db', stop: () => void stops.push('db') }).addResource({
      name: 'http',
      stop: async () => {
        stops.push('http');
        await gate.promise;
      },
    });
    await service.start();

    signals.emit('SIGTERM', 'SIGTERM');
    await vi.waitFor(() => expect(stops).toEqual(['http']));
    signals.emit('SIGTERM', 'SIGTERM');
    signals.emit('SIGINT', 'SIGINT');
    expect(service.state).toBe('stopping');

    gate.resolve();
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(stops).toEqual(['http', 'db']);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(
      logger.lines.filter((l) => l.msg === 'shutdown already in progress, ignoring signal'),
    ).toHaveLength(2);
    expect(logger.lines.filter((l) => l.msg === 'shutdown started')).toHaveLength(1);
  });

  it('a signal during startup waits for startup, then stops everything and exits', async () => {
    const gate = deferred();
    const events: string[] = [];
    const { service, signals, exit } = make();
    service
      .addResource({
        name: 'db',
        start: () => void events.push('start:db'),
        stop: () => void events.push('stop:db'),
      })
      .addResource({
        name: 'slow',
        start: async () => {
          events.push('start:slow');
          await gate.promise;
        },
        stop: () => void events.push('stop:slow'),
      });
    const started = service.start();
    await vi.waitFor(() => expect(events).toContain('start:slow'));
    signals.emit('SIGTERM', 'SIGTERM');
    gate.resolve();
    await started;
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(events).toEqual(['start:db', 'start:slow', 'stop:slow', 'stop:db']);
  });

  it('a signal during a startup that then fails exits 1 after the rollback', async () => {
    const gate = deferred();
    const { service, signals, exit } = make();
    service.addResource({
      name: 'bad',
      start: () => gate.promise.then(() => Promise.reject(new Error('nope'))),
    });
    const started = service.start();
    signals.emit('SIGTERM', 'SIGTERM');
    gate.resolve();
    await expect(started).rejects.toThrow('nope');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });

  it('listens only to the configured signals', async () => {
    const { service, signals } = make({ signals: ['SIGUSR2'] });
    await service.start();
    expect(signals.eventNames()).toEqual(['SIGUSR2']);
    await service.shutdown();
    expect(signals.eventNames()).toEqual([]);
  });

  it('a manual shutdown never exits the process', async () => {
    const { service, exit } = make();
    await service.start();
    await service.shutdown();
    expect(exit).not.toHaveBeenCalled();
  });

  it('a signal after a manual shutdown began is ignored, and still does not exit', async () => {
    const gate = deferred();
    const { service, signals, exit } = make();
    service.addResource({ name: 'r', stop: () => gate.promise });
    await service.start();
    const done = service.shutdown();
    signals.emit('SIGTERM', 'SIGTERM');
    gate.resolve();
    await done;
    expect(exit).not.toHaveBeenCalled();
  });
});

describe('the shutdown deadline', () => {
  it('abandons a stop that ignores its signal, reports it and everything after it as pending, and exits 1', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const { service, signals, exit, logger } = make({ shutdownTimeoutMs: 1000 });
    service
      .addResource({ name: 'db', stop: () => void events.push('stop:db') })
      .addResource({ name: 'queue', stop: () => void events.push('stop:queue') })
      .addResource({ name: 'stuck', stop: () => new Promise<void>(() => undefined) });
    await service.start();
    signals.emit('SIGTERM', 'SIGTERM');
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(events).toEqual([]);
    expect(
      logger.lines.find((l) => l.msg === 'shutdown deadline passed with resources still stopping')
        ?.fields,
    ).toEqual({
      service: 'edge',
      pending: ['stuck', 'queue', 'db'],
      shutdownTimeoutMs: 1000,
    });
    const complete = logger.lines.find((l) => l.msg === 'shutdown complete')?.fields;
    expect(complete).toMatchObject({
      ok: false,
      timedOut: true,
      pending: ['stuck', 'queue', 'db'],
      failed: [],
    });
  });

  it('aborts the signal of the stop in progress when the deadline passes', async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | undefined;
    const { service } = make({ shutdownTimeoutMs: 500 });
    service.addResource({
      name: 'cooperative',
      stop: (signal) => {
        seen = signal;
        return new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
      },
    });
    await service.start();
    const done = service.shutdown();
    await vi.advanceTimersByTimeAsync(499);
    expect(seen?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await done;
    expect(seen?.aborted).toBe(true);
    expect(result.timedOut).toBe(true);
    expect(result.pending).toEqual(['cooperative']);
  });

  it('a clean shutdown well inside the deadline leaves no timer behind', async () => {
    vi.useFakeTimers();
    const { service } = make({ shutdownTimeoutMs: 60_000 });
    service.addResource({ name: 'r' });
    await service.start();
    await service.shutdown();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the drain delay keeps resources up (and readiness failing) before anything stops', async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    const { service } = make({ drainDelayMs: 5000 });
    service.addResource({ name: 'http', stop });
    await service.start();
    const done = service.shutdown();
    await vi.advanceTimersByTimeAsync(4999);
    expect(stop).not.toHaveBeenCalled();
    expect(service.state).toBe('stopping');
    expect((await service.checkReadiness()).status).toBe('fail');
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(stop).toHaveBeenCalledOnce();
  });

  it('the drain delay counts against the deadline, not on top of it', async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | undefined;
    const { service } = make({ drainDelayMs: 800, shutdownTimeoutMs: 1000 });
    service.addResource({
      name: 'slow',
      stop: (signal) => {
        seen = signal;
        return new Promise<void>(() => undefined);
      },
    });
    await service.start();
    const done = service.shutdown();
    await vi.advanceTimersByTimeAsync(1000);
    const result = await done;
    expect(seen?.aborted).toBe(true);
    expect(result.durationMs).toBe(1000);
  });

  it('a drain delay longer than the deadline is capped at the deadline', async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    const { service } = make({ drainDelayMs: 10_000, shutdownTimeoutMs: 1000 });
    service.addResource({ name: 'r', stop });
    await service.start();
    const done = service.shutdown();
    await vi.advanceTimersByTimeAsync(1000);
    const result = await done;
    expect(result.durationMs).toBe(1000);
    expect(result.pending).toEqual(['r']);
    expect(stop).not.toHaveBeenCalled();
  });

  it('a rollback after a failed start is bounded by the same deadline', async () => {
    vi.useFakeTimers();
    const { service, logger } = make({ shutdownTimeoutMs: 300 });
    service
      .addResource({ name: 'stuck', stop: () => new Promise<void>(() => undefined) })
      .addResource({ name: 'bad', start: () => Promise.reject(new Error('bind failed')) });
    const started = service.start();
    const assertion = expect(started).rejects.toThrow('bind failed');
    await vi.advanceTimersByTimeAsync(300);
    await assertion;
    expect(
      logger.lines.find((l) => l.msg === 'shutdown deadline passed with resources still stopping')
        ?.fields?.pending,
    ).toEqual(['stuck']);
  });
});
