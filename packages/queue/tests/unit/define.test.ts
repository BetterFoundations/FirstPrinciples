import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '@firstprinciples/core';
import { defineJob, retryPresets } from '../../src/index.js';
import { toBullRetryOptions } from '../../src/internal/shared.js';

describe('defineJob', () => {
  it('defaults to the standard retry preset and no validate/isPermanent', () => {
    const job = defineJob<{ a: number }>();
    expect(job.retry).toBe(retryPresets.standard);
    expect(job.validate).toBeUndefined();
    expect(job.isPermanent).toBeUndefined();
    expect(Object.isFrozen(job)).toBe(true);
  });

  it('keeps the options it is given', () => {
    const validate = (d: unknown) => d as { a: number };
    const isPermanent = () => true;
    const job = defineJob({ retry: retryPresets.none, validate, isPermanent });
    expect(job).toMatchObject({ retry: { attempts: 1 }, validate, isPermanent });
  });

  it.each([
    [{ attempts: 0 }, 'attempts must be an integer ≥ 1'],
    [{ attempts: 1.5 }, 'attempts must be an integer ≥ 1'],
    [
      { attempts: 3, backoff: { type: 'linear' as 'fixed', delayMs: 1 } },
      "backoff.type must be 'fixed' or 'exponential'",
    ],
    [
      { attempts: 3, backoff: { type: 'fixed' as const, delayMs: -1 } },
      'backoff.delayMs must be a finite number ≥ 0',
    ],
    [
      { attempts: 3, backoff: { type: 'fixed' as const, delayMs: Infinity } },
      'backoff.delayMs must be a finite number ≥ 0',
    ],
    [
      { attempts: 3, backoff: { type: 'fixed' as const, delayMs: 1, jitter: 1.5 } },
      'backoff.jitter must be between 0 and 1',
    ],
    [
      { attempts: 3, backoff: { type: 'fixed' as const, delayMs: 1, jitter: -0.1 } },
      'backoff.jitter must be between 0 and 1',
    ],
  ])('rejects an invalid policy at definition time: %j', (retry, message) => {
    expect(() => defineJob({ retry })).toThrow(ValidationError);
    expect(() => defineJob({ retry })).toThrow(message);
  });

  it('reports every policy problem at once', () => {
    try {
      defineJob({ retry: { attempts: 0, backoff: { type: 'fixed', delayMs: -1, jitter: 2 } } });
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationError).details).toEqual({
        problems: [
          'attempts must be an integer ≥ 1',
          'backoff.delayMs must be a finite number ≥ 0',
          'backoff.jitter must be between 0 and 1',
        ],
      });
    }
  });
});

describe('retryPresets', () => {
  it('has the documented shapes', () => {
    expect(retryPresets.none).toEqual({ attempts: 1 });
    expect(retryPresets.standard).toEqual({
      attempts: 5,
      backoff: { type: 'exponential', delayMs: 1000, jitter: 0.5 },
    });
    expect(retryPresets.patient).toEqual({
      attempts: 10,
      backoff: { type: 'exponential', delayMs: 5000, jitter: 0.5 },
    });
    expect(retryPresets.fixed(4, 250)).toEqual({
      attempts: 4,
      backoff: { type: 'fixed', delayMs: 250 },
    });
  });

  it('every preset is a valid policy', () => {
    for (const retry of [
      retryPresets.none,
      retryPresets.standard,
      retryPresets.patient,
      retryPresets.fixed(2, 0),
    ]) {
      expect(() => defineJob({ retry })).not.toThrow();
    }
  });
});

describe('toBullRetryOptions', () => {
  it('maps delayMs to BullMQ delay and passes jitter through only when set', () => {
    expect(toBullRetryOptions({ attempts: 1 })).toEqual({ attempts: 1 });
    expect(toBullRetryOptions(retryPresets.standard)).toEqual({
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000, jitter: 0.5 },
    });
    expect(toBullRetryOptions(retryPresets.fixed(3, 10))).toEqual({
      attempts: 3,
      backoff: { type: 'fixed', delay: 10 },
    });
  });
});

describe('defaultLogger', () => {
  it('writes warnings and errors to the console with their fields', async () => {
    const { defaultLogger } = await import('../../src/internal/shared.js');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      defaultLogger.warn('w', { a: 1 });
      defaultLogger.error('e');
      expect(warn).toHaveBeenCalledWith('w', { a: 1 });
      expect(error).toHaveBeenCalledWith('e', {});
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
