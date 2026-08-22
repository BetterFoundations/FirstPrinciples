import { describe, expect, it } from 'vitest';
import { isAppError } from '@firstprinciples/core';
import { CacheBackendError } from '../../src/errors.js';

describe('CacheBackendError', () => {
  it('defaults code and httpStatus', () => {
    const error = new CacheBackendError('backend unreachable');
    expect(error.code).toBe('CACHE_BACKEND_ERROR');
    expect(error.httpStatus).toBe(503);
    expect(error.name).toBe('CacheBackendError');
  });

  it('is recognized by core isAppError, carrying the ecosystem-wide taxonomy', () => {
    const error = new CacheBackendError('backend unreachable');
    expect(isAppError(error)).toBe(true);
  });

  it('allows overriding code, e.g. for a deserialization failure', () => {
    const error = new CacheBackendError('bad json', { code: 'CACHE_CORRUPT_VALUE' });
    expect(error.code).toBe('CACHE_CORRUPT_VALUE');
  });

  it('preserves a wrapped cause', () => {
    const cause = new Error('ECONNREFUSED');
    const error = new CacheBackendError('backend unreachable', { cause });
    expect(error.cause).toBe(cause);
  });
});
