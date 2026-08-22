import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPinoTransport } from '../../src/internal/pino-transport.js';

function readStdout(spy: ReturnType<typeof vi.spyOn>): unknown {
  const call = spy.mock.calls[0]?.[0];
  return JSON.parse(String(call));
}

describe('createPinoTransport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes a JSON line to stdout containing the level, msg and fields', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const transport = createPinoTransport('svc');
    transport.write({
      level: 'info',
      msg: 'hello',
      time: '2026-01-01T00:00:00.000Z',
      correlationId: undefined,
      fields: { userId: 1 },
    });

    const line = readStdout(spy) as Record<string, unknown>;
    expect(line.msg).toBe('hello');
    expect(line.userId).toBe(1);
    expect(line.time).toBe('2026-01-01T00:00:00.000Z');
    expect(line.level).toBeTypeOf('number'); // pino encodes level numerically by default
  });

  it('includes correlationId in the emitted line when present', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const transport = createPinoTransport(undefined);
    transport.write({
      level: 'warn',
      msg: 'careful',
      time: '2026-01-01T00:00:00.000Z',
      correlationId: 'req-9',
      fields: {},
    });

    const line = readStdout(spy) as Record<string, unknown>;
    expect(line.correlationId).toBe('req-9');
  });

  it('never receives an already-redacted secret unredacted (redaction happens upstream)', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const transport = createPinoTransport('svc');
    // Simulates what core.ts hands the transport: fields are pre-redacted by
    // the time write() is called, so pino's own serializer never touches a
    // real secret value.
    transport.write({
      level: 'info',
      msg: 'login',
      time: '2026-01-01T00:00:00.000Z',
      correlationId: undefined,
      fields: { password: '[REDACTED]' },
    });

    const line = readStdout(spy) as Record<string, unknown>;
    expect(line.password).toBe('[REDACTED]');
  });
});
