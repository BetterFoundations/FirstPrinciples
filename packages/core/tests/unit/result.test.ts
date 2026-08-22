import { describe, expect, it } from 'vitest';
import {
  err,
  isErr,
  isOk,
  NotFoundError,
  ok,
  type Result,
  ValidationError,
} from '../../src/index.js';

describe('ok', () => {
  it('wraps a value', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('wraps nothing, for operations with no interesting success value', () => {
    expect(ok()).toEqual({ ok: true, value: undefined });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['false', false],
    ['zero', 0],
    ['an empty string', ''],
  ])('treats %s as a success, not a failure', (_label, value) => {
    const result = ok(value);
    expect(result.ok).toBe(true);
    expect(isOk(result)).toBe(true);
    expect(result.value).toBe(value);
  });
});

describe('err', () => {
  it('wraps an error', () => {
    const error = new NotFoundError('gone');
    expect(err(error)).toEqual({ ok: false, error });
  });

  it('accepts a non-error payload', () => {
    expect(err('nope')).toEqual({ ok: false, error: 'nope' });
  });
});

describe('isOk / isErr', () => {
  it('agree on the success branch', () => {
    const result = ok(1);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
  });

  it('agree on the failure branch', () => {
    const result = err(new ValidationError('bad'));
    expect(isOk(result)).toBe(false);
    expect(isErr(result)).toBe(true);
  });

  it('work as standalone predicates in a callback position', () => {
    const results: Result<number, ValidationError>[] = [
      ok(1),
      err(new ValidationError('bad')),
      ok(3),
    ];

    expect(results.filter(isOk).map((r) => r.value)).toEqual([1, 3]);
    expect(results.filter(isErr).map((r) => r.error.code)).toEqual(['VALIDATION_ERROR']);
  });
});

describe('the Result/AppError layering', () => {
  it('lets an error branch keep the full core taxonomy', () => {
    const result: Result<string> = err(
      new NotFoundError('No user 42', { code: 'USER_NOT_FOUND', details: { id: 42 } }),
    );

    if (isOk(result)) throw new Error('unreachable');
    expect(result.error.httpStatus).toBe(404);
    expect(result.error.code).toBe('USER_NOT_FOUND');
    expect(result.error.toJSON().details).toEqual({ id: 42 });
  });

  it('propagates a narrower Err through a wider signature unchanged', () => {
    function inner(): Result<never, ValidationError> {
      return err(new ValidationError('bad'));
    }
    function outer(): Result<number, ValidationError | NotFoundError> {
      const result = inner();
      if (isErr(result)) return result;
      return ok(result.value);
    }

    const result = outer();
    expect(isErr(result)).toBe(true);
  });
});
