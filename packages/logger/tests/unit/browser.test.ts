import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLogger,
  generateCorrelationId,
  getCorrelationId,
  runWithCorrelationId,
} from '../../src/browser.js';

describe('browser entry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a working logger that writes through console by default', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const logger = createLogger({ name: 'app' });
    logger.info('started', { page: '/home' });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toContain('started');
  });

  it('picks up the active correlation ID set via runWithCorrelationId', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const logger = createLogger();
    runWithCorrelationId('req-1', () => logger.info('inside'));

    const prefix = spy.mock.calls[0]![0] as string;
    expect(prefix).toContain('req-1');
    expect(getCorrelationId()).toBeUndefined();
  });

  it('redacts by default', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const logger = createLogger();
    logger.info('login', { password: 'hunter2' });
    expect(spy.mock.calls[0]).toContainEqual({ password: '[REDACTED]' });
  });

  it('generateCorrelationId returns distinct UUIDs', () => {
    expect(generateCorrelationId()).not.toBe(generateCorrelationId());
  });
});
