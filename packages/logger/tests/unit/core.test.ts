import { describe, expect, it, vi } from 'vitest';
import { createLoggerCore } from '../../src/internal/core.js';
import type { LogEntry, Transport } from '../../src/internal/types.js';

function capturingTransport(): { transport: Transport; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return { transport: { name: 'capture', write: (e) => entries.push(e) }, entries };
}

describe('createLoggerCore', () => {
  const deps = {
    getCorrelationId: () => undefined,
    createDefaultTransport: vi.fn(),
  };

  it('drops calls below the configured level before touching transports', () => {
    const { transport, entries } = capturingTransport();
    const logger = createLoggerCore({ level: 'warn', transports: [transport] }, deps);
    logger.info('ignored');
    logger.debug('ignored');
    logger.warn('kept');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.msg).toBe('kept');
  });

  it('every level method logs at its own level when the threshold allows it', () => {
    const { transport, entries } = capturingTransport();
    const logger = createLoggerCore({ level: 'trace', transports: [transport] }, deps);
    logger.trace('t');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    logger.fatal('f');
    expect(entries.map((e) => e.level)).toEqual([
      'trace',
      'debug',
      'info',
      'warn',
      'error',
      'fatal',
    ]);
  });

  it('defaults to info level', () => {
    const { transport, entries } = capturingTransport();
    const logger = createLoggerCore({ transports: [transport] }, deps);
    logger.debug('ignored');
    logger.info('kept');
    expect(entries).toHaveLength(1);
  });

  it('merges base fields with per-call fields, call fields winning on conflict', () => {
    const { transport, entries } = capturingTransport();
    const logger = createLoggerCore(
      { base: { service: 'api', env: 'dev' }, transports: [transport] },
      deps,
    );
    logger.info('msg', { env: 'prod', userId: 1 });
    expect(entries[0]!.fields).toEqual({ service: 'api', env: 'prod', userId: 1 });
  });

  it('redacts fields before they reach the transport', () => {
    const { transport, entries } = capturingTransport();
    const logger = createLoggerCore({ transports: [transport] }, deps);
    logger.info('msg', { password: 'hunter2' });
    expect(entries[0]!.fields).toEqual({ password: '[REDACTED]' });
  });

  it('passes redaction: false through to skip redaction', () => {
    const { transport, entries } = capturingTransport();
    const logger = createLoggerCore({ transports: [transport], redaction: false }, deps);
    logger.info('msg', { password: 'hunter2' });
    expect(entries[0]!.fields).toEqual({ password: 'hunter2' });
  });

  it('attaches the active correlation ID to every entry', () => {
    const { transport, entries } = capturingTransport();
    const logger = createLoggerCore(
      { transports: [transport] },
      { ...deps, getCorrelationId: () => 'req-1' },
    );
    logger.info('msg');
    expect(entries[0]!.correlationId).toBe('req-1');
  });

  it('fans out a single call to every configured transport', () => {
    const a = capturingTransport();
    const b = capturingTransport();
    const logger = createLoggerCore({ transports: [a.transport, b.transport] }, deps);
    logger.info('msg');
    expect(a.entries).toHaveLength(1);
    expect(b.entries).toHaveLength(1);
  });

  it('child() merges bindings into base without mutating the parent', () => {
    const { transport, entries } = capturingTransport();
    const parent = createLoggerCore({ base: { service: 'api' }, transports: [transport] }, deps);
    const child = parent.child({ requestId: 'r1' });

    child.info('from child');
    parent.info('from parent');

    expect(entries[0]!.fields).toEqual({ service: 'api', requestId: 'r1' });
    expect(entries[1]!.fields).toEqual({ service: 'api' });
  });

  it('child() inherits level, redaction and transports from the parent', () => {
    const { transport, entries } = capturingTransport();
    const parent = createLoggerCore({ level: 'error', transports: [transport] }, deps);
    const child = parent.child({ requestId: 'r1' });
    child.warn('below threshold');
    child.error('at threshold');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.msg).toBe('at threshold');
  });

  it('a grandchild merges bindings from every ancestor', () => {
    const { transport, entries } = capturingTransport();
    const logger = createLoggerCore({ base: { a: 1 }, transports: [transport] }, deps)
      .child({ b: 2 })
      .child({ c: 3 });
    logger.info('msg');
    expect(entries[0]!.fields).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('uses the environment default transport when none is supplied', () => {
    const createDefaultTransport = vi.fn().mockReturnValue({ name: 'default', write: vi.fn() });
    const logger = createLoggerCore(
      { name: 'svc' },
      { getCorrelationId: () => undefined, createDefaultTransport },
    );
    logger.info('msg');
    expect(createDefaultTransport).toHaveBeenCalledWith('svc');
  });
});
