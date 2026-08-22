import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createConsoleTransport,
  createLogger,
  generateCorrelationId,
  getCorrelationId,
  runWithCorrelationId,
} from '../../src/index.js';

describe('index (Node entry)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a working logger that writes through pino by default', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger({ name: 'svc' });
    logger.info('started', { port: 3000 });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(spy.mock.calls[0]![0])) as Record<string, unknown>;
    expect(line.msg).toBe('started');
    expect(line.port).toBe(3000);
  });

  it('picks up the active correlation ID set via runWithCorrelationId', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger();
    runWithCorrelationId('req-42', () => logger.info('inside'));

    const line = JSON.parse(String(spy.mock.calls[0]![0])) as Record<string, unknown>;
    expect(line.correlationId).toBe('req-42');
    expect(getCorrelationId()).toBeUndefined();
  });

  it('redacts by default', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger();
    logger.info('login', { password: 'hunter2' });

    const line = JSON.parse(String(spy.mock.calls[0]![0])) as Record<string, unknown>;
    expect(line.password).toBe('[REDACTED]');
  });

  it('accepts a custom transport (createConsoleTransport) in place of pino', () => {
    const target = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const logger = createLogger({ transports: [createConsoleTransport(target)] });
    logger.info('hello');
    expect(target.info).toHaveBeenCalledTimes(1);
  });

  it('generateCorrelationId returns distinct UUIDs', () => {
    expect(generateCorrelationId()).not.toBe(generateCorrelationId());
  });
});
