import { ValidationError } from '@firstprinciples/core';
import { describe, expect, it } from 'vitest';
import { runValidation, type ValidateFn } from '../../src/validation.js';

describe('runValidation', () => {
  it('returns ok with the validator return value on success', () => {
    const validate: ValidateFn = <T>(_schema: unknown, data: unknown) => data as T;
    const result = runValidation<{ id: string }>(
      { target: 'body', schema: {}, validate },
      { id: '42' },
    );
    expect(result).toEqual({ ok: true, value: { id: '42' } });
  });

  it('returns err(ValidationError) when the adapter throws, without echoing its message', () => {
    const validate: ValidateFn = () => {
      throw new Error('expected string at path .email, received number');
    };
    const result = runValidation({ target: 'body', schema: {}, validate }, { email: 1 });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(result.error.code).toBe('REQUEST_VALIDATION_FAILED');
    expect(result.error.message).not.toContain('expected string at path');
  });

  it('preserves the original thrown value as cause', () => {
    const original = new Error('schema library internal error');
    const validate: ValidateFn = () => {
      throw original;
    };
    const result = runValidation({ target: 'query', schema: {}, validate }, {});
    if (result.ok) throw new Error('unreachable');
    expect(result.error.cause).toBe(original);
  });

  it('records which target failed in details', () => {
    const validate: ValidateFn = () => {
      throw new Error('nope');
    };
    const result = runValidation({ target: 'headers', schema: {}, validate }, {});
    if (result.ok) throw new Error('unreachable');
    expect(result.error.details).toEqual({ target: 'headers' });
  });

  it('propagates a non-Error thrown value the same way', () => {
    const validate: ValidateFn = () => {
      throw 'not an Error instance';
    };
    const result = runValidation({ target: 'params', schema: {}, validate }, {});
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(result.error.cause).toBe('not an Error instance');
  });
});
