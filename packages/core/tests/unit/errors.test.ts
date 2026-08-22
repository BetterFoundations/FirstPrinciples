import { describe, expect, it } from 'vitest';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  isAppError,
  isErr,
  isOk,
  NetworkError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../src/index.js';

/** Every built-in subclass with the defaults it is contracted to carry. */
const VARIANTS = [
  { Ctor: AppError, name: 'AppError', code: 'INTERNAL_ERROR', httpStatus: 500 },
  { Ctor: ValidationError, name: 'ValidationError', code: 'VALIDATION_ERROR', httpStatus: 400 },
  { Ctor: NotFoundError, name: 'NotFoundError', code: 'NOT_FOUND', httpStatus: 404 },
  { Ctor: ForbiddenError, name: 'ForbiddenError', code: 'FORBIDDEN', httpStatus: 403 },
  { Ctor: UnauthorizedError, name: 'UnauthorizedError', code: 'UNAUTHORIZED', httpStatus: 401 },
  { Ctor: ConflictError, name: 'ConflictError', code: 'CONFLICT', httpStatus: 409 },
  { Ctor: NetworkError, name: 'NetworkError', code: 'NETWORK_ERROR', httpStatus: 503 },
] as const;

describe.each(VARIANTS)('$name', ({ Ctor, name, code, httpStatus }) => {
  it('carries its documented defaults', () => {
    const error = new Ctor('boom');
    expect(error.name).toBe(name);
    expect(error.code).toBe(code);
    expect(error.httpStatus).toBe(httpStatus);
    expect(error.message).toBe('boom');
    expect(error.details).toBeUndefined();
  });

  it('lets every default be overridden', () => {
    const error = new Ctor('boom', {
      code: 'CUSTOM_CODE',
      httpStatus: 418,
      details: { field: 'email' },
    });
    expect(error.code).toBe('CUSTOM_CODE');
    expect(error.httpStatus).toBe(418);
    expect(error.details).toEqual({ field: 'email' });
    // The name is the class's identity, not an option.
    expect(error.name).toBe(name);
  });

  it('is an instance of its own class, of AppError, and of Error', () => {
    const error = new Ctor('boom');
    expect(error).toBeInstanceOf(Ctor);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(isAppError(error)).toBe(true);
  });

  it('round-trips losslessly through toJSON/fromJSON', () => {
    const original = new Ctor('boom', { code: 'CUSTOM_CODE', details: { a: 1 } });
    const revived = AppError.fromJSON(JSON.parse(JSON.stringify(original)));

    expect(isOk(revived)).toBe(true);
    if (!isOk(revived)) return;
    expect(revived.value).toBeInstanceOf(Ctor);
    expect(revived.value.toJSON()).toEqual(original.toJSON());
  });
});

describe('AppError construction', () => {
  it('produces a stack that starts at the throw site, not in the constructor', () => {
    const error = new NotFoundError('gone');
    expect(error.stack).toBeDefined();
    expect(error.stack?.split('\n')[0]).toBe('NotFoundError: gone');
    expect(error.stack).not.toMatch(/at new (AppError|NotFoundError)/);
  });

  it('does not define a `cause` property when none was given', () => {
    const error = new AppError('boom');
    expect('cause' in error).toBe(false);
  });

  it('preserves the wrapped error, and its stack, as the native cause', () => {
    const cause = new TypeError('underlying');
    const error = new ConflictError('wrapping', { cause });

    expect(error.cause).toBe(cause);
    expect((error.cause as Error).stack).toBe(cause.stack);
  });

  it('preserves a whole chain of causes', () => {
    const root = new Error('root');
    const middle = new AppError('middle', { cause: root });
    const top = new ConflictError('top', { cause: middle });

    expect(top.cause).toBe(middle);
    expect((top.cause as AppError).cause).toBe(root);
  });
});

describe('toJSON', () => {
  it('emits every semantic field', () => {
    const error = new NotFoundError('No user 42', {
      code: 'USER_NOT_FOUND',
      details: { id: 42 },
    });

    expect(error.toJSON()).toEqual({
      name: 'NotFoundError',
      message: 'No user 42',
      code: 'USER_NOT_FOUND',
      httpStatus: 404,
      details: { id: 42 },
    });
  });

  it('omits absent keys rather than setting them to undefined', () => {
    const json = new AppError('boom').toJSON();
    expect(Object.keys(json).sort()).toEqual(['code', 'httpStatus', 'message', 'name']);
  });

  it('never includes a stack trace', () => {
    const error = new ForbiddenError('nope', { cause: new Error('inner') });
    const serialized = JSON.stringify(error);

    expect(serialized).not.toContain('stack');
    expect(serialized).not.toContain('.test.ts');
  });

  it('is picked up implicitly by JSON.stringify', () => {
    const error = new UnauthorizedError('no token');
    expect(JSON.parse(JSON.stringify(error))).toEqual(error.toJSON());
  });

  it('serializes an AppError cause with its full taxonomy', () => {
    const error = new ConflictError('outer', {
      cause: new ValidationError('inner', { details: { field: 'email' } }),
    });

    expect(error.toJSON().cause).toEqual({
      name: 'ValidationError',
      message: 'inner',
      code: 'VALIDATION_ERROR',
      httpStatus: 400,
      details: { field: 'email' },
    });
  });

  it('serializes a plain Error cause as name and message only', () => {
    const error = new AppError('outer', { cause: new TypeError('inner') });
    expect(error.toJSON().cause).toEqual({ name: 'TypeError', message: 'inner' });
  });
});

describe('AppError.fromJSON', () => {
  it('restores the matching subclass', () => {
    const revived = AppError.fromJSON(new ConflictError('dup').toJSON());
    expect(isOk(revived)).toBe(true);
    if (!isOk(revived)) return;
    expect(revived.value).toBeInstanceOf(ConflictError);
    expect(revived.value).toBeInstanceOf(AppError);
  });

  it('restores a mixed cause chain, AppError and plain Error alike', () => {
    const original = new ConflictError('top', {
      cause: new NotFoundError('middle', { cause: new TypeError('root') }),
    });
    const revived = AppError.fromJSON(original.toJSON());

    expect(isOk(revived)).toBe(true);
    if (!isOk(revived)) return;

    const middle = revived.value.cause;
    expect(middle).toBeInstanceOf(NotFoundError);
    expect((middle as NotFoundError).cause).toBeInstanceOf(Error);
    expect(((middle as NotFoundError).cause as Error).name).toBe('TypeError');
    expect(revived.value.toJSON()).toEqual(original.toJSON());
  });

  it('rejects a value that is not a serialized error', () => {
    const revived = AppError.fromJSON({ nope: true });

    expect(isErr(revived)).toBe(true);
    if (!isErr(revived)) return;
    expect(revived.error).toBeInstanceOf(ValidationError);
    expect(revived.error.code).toBe('INVALID_SERIALIZED_ERROR');
    expect(revived.error.details).toEqual({
      expected: 'SerializedAppError',
      received: 'object',
    });
  });
});

describe('isAppError', () => {
  it.each([
    ['a plain Error', new Error('boom')],
    ['a TypeError', new TypeError('boom')],
    ['a plain object shaped like one', { name: 'AppError', code: 'X', httpStatus: 500 }],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'AppError'],
  ])('returns false for %s', (_label, value) => {
    expect(isAppError(value)).toBe(false);
  });
});
