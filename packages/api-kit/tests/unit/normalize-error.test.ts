import { AppError, ConflictError, isAppError } from '@firstprinciples/core';
import { describe, expect, it } from 'vitest';
import { normalizeError } from '../../src/internal/normalize-error.js';

describe('normalizeError', () => {
  it('returns an AppError unchanged', () => {
    const error = new ConflictError('Email already registered', { code: 'EMAIL_TAKEN' });
    expect(normalizeError(error)).toBe(error);
  });

  it('wraps a plain Error into a generic 500 AppError without leaking its message', () => {
    const original = new Error('connection refused at 10.0.0.5:5432, user=admin');
    const normalized = normalizeError(original);

    expect(isAppError(normalized)).toBe(true);
    expect(normalized.code).toBe('INTERNAL_ERROR');
    expect(normalized.httpStatus).toBe(500);
    expect(normalized.message).not.toContain('10.0.0.5');
    expect(normalized.message).not.toContain('admin');
    expect(normalized.cause).toBe(original);
  });

  it('wraps a non-Error thrown value the same way', () => {
    const normalized = normalizeError('a bare string throw');
    expect(normalized).toBeInstanceOf(AppError);
    expect(normalized.code).toBe('INTERNAL_ERROR');
    expect(normalized.message).not.toContain('a bare string throw');
  });

  it('wraps undefined and null without throwing', () => {
    expect(normalizeError(undefined).code).toBe('INTERNAL_ERROR');
    expect(normalizeError(null).code).toBe('INTERNAL_ERROR');
  });
});
