import { describe, expect, it, vi } from 'vitest';
import { createConsoleTransport } from '../../src/internal/console-transport.js';
import type { LogEntry } from '../../src/internal/types.js';

function entry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    level: 'info',
    msg: 'hello',
    time: '2026-01-01T00:00:00.000Z',
    correlationId: undefined,
    fields: {},
    ...overrides,
  };
}

describe('createConsoleTransport', () => {
  it('dispatches each level to the matching console method, fatal falling back to error', () => {
    const target = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const transport = createConsoleTransport(target);
    transport.write(entry({ level: 'trace' }));
    transport.write(entry({ level: 'debug' }));
    transport.write(entry({ level: 'info' }));
    transport.write(entry({ level: 'warn' }));
    transport.write(entry({ level: 'error' }));
    transport.write(entry({ level: 'fatal' }));

    expect(target.trace).toHaveBeenCalledTimes(1);
    expect(target.debug).toHaveBeenCalledTimes(1);
    expect(target.info).toHaveBeenCalledTimes(1);
    expect(target.warn).toHaveBeenCalledTimes(1);
    expect(target.error).toHaveBeenCalledTimes(2); // error + fatal
  });

  it('includes fields only when there are any', () => {
    const target = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const transport = createConsoleTransport(target);

    transport.write(entry({ fields: {} }));
    expect(target.info).toHaveBeenLastCalledWith(expect.stringContaining('INFO'), 'hello');

    transport.write(entry({ fields: { userId: 1 } }));
    expect(target.info).toHaveBeenLastCalledWith(expect.stringContaining('INFO'), 'hello', {
      userId: 1,
    });
  });

  it('includes the correlation ID in the prefix when present', () => {
    const target = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const transport = createConsoleTransport(target);
    transport.write(entry({ correlationId: 'req-1' }));
    expect(target.info).toHaveBeenCalledWith(expect.stringContaining('(req-1)'), 'hello');
  });
});
