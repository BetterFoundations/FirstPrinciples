import { afterEach, describe, expect, it } from 'vitest';
import {
  AppError,
  ConflictError,
  isAppError,
  isErr,
  isOk,
  NotFoundError,
  type SerializedError,
} from '../../src/index.js';

/** Walk a serialized cause chain and report how many links it has. */
function chainDepth(json: SerializedError): number {
  let depth = 1;
  let current = json.cause;
  while (current !== undefined) {
    depth += 1;
    current = current.cause;
  }
  return depth;
}

describe('cause chains that could hang or overflow', () => {
  it('terminates on a cycle instead of recursing forever', () => {
    const inner = new AppError('inner');
    const outer = new AppError('outer', { cause: inner });
    (inner as { cause?: unknown }).cause = outer;

    const json = outer.toJSON();
    expect(json.cause?.message).toBe('inner');
    // The link back to `outer` is dropped rather than followed.
    expect(json.cause?.cause).toBeUndefined();
  });

  it('terminates on a self-referential cause', () => {
    const error = new AppError('self');
    (error as { cause?: unknown }).cause = error;

    expect(error.toJSON().cause).toBeUndefined();
  });

  it('truncates a chain deeper than the 16-link cap', () => {
    let error = new AppError('link-0');
    for (let i = 1; i < 40; i += 1) {
      error = new AppError(`link-${String(i)}`, { cause: error });
    }

    const json = error.toJSON();
    expect(chainDepth(json)).toBeLessThanOrEqual(17);
    expect(chainDepth(json)).toBeGreaterThan(1);
  });

  it('round-trips a chain at exactly the cap without losing a link', () => {
    let error = new AppError('link-0');
    for (let i = 1; i < 16; i += 1) {
      error = new AppError(`link-${String(i)}`, { cause: error });
    }

    const revived = AppError.fromJSON(JSON.parse(JSON.stringify(error)));
    if (!isOk(revived)) throw new Error('expected a success');
    expect(revived.value.toJSON()).toEqual(error.toJSON());
  });
});

describe('causes that are not Errors', () => {
  it.each([
    ['a string', 'boom', 'boom'],
    ['a number', 42, '42'],
    ['a boolean', false, 'false'],
    ['a symbol', Symbol('nope'), 'Symbol(nope)'],
  ])('serializes %s as a NonError link', (_label, cause, expected) => {
    expect(new AppError('outer', { cause }).toJSON().cause).toEqual({
      name: 'NonError',
      message: expected,
    });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('treats %s as no cause at all', (_label, cause) => {
    expect(new AppError('outer', { cause }).toJSON().cause).toBeUndefined();
  });

  it('survives a cause with a throwing getter instead of losing the real error', () => {
    const cause = {
      message: 'readable',
      get name(): string {
        throw new Error('hostile getter');
      },
    };

    // Serializing happens while something has already gone wrong; a
    // secondary throw here would discard the original failure.
    expect(new AppError('outer', { cause }).toJSON().cause).toEqual({
      name: 'Error',
      message: 'readable',
    });
  });

  it('survives a cause whose toString throws', () => {
    const cause = {
      toString(): string {
        throw new Error('hostile toString');
      },
    };

    expect(new AppError('outer', { cause }).toJSON().cause).toEqual({
      name: 'Error',
      message: '[unserializable value]',
    });
  });

  it('survives a null-prototype object as a cause', () => {
    const cause = Object.assign(Object.create(null) as object, { message: 'bare' });
    expect(new AppError('outer', { cause }).toJSON().cause).toEqual({
      name: 'Error',
      message: 'bare',
    });
  });

  it('falls back to a stringified form when a cause has no message', () => {
    const json = new AppError('outer', { cause: { code: 'X' } }).toJSON();
    expect(json.cause).toEqual({ name: 'Error', message: '[object Object]' });
  });
});

describe('AppError.fromJSON on untrusted input', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', '{"name":"AppError"}'],
    ['a number', 42],
    ['an empty object', {}],
    ['a missing code', { name: 'AppError', message: 'x', httpStatus: 500 }],
    ['a missing httpStatus', { name: 'AppError', message: 'x', code: 'X' }],
    ['a non-string name', { name: 1, message: 'x', code: 'X', httpStatus: 500 }],
    ['a non-string message', { name: 'AppError', message: 1, code: 'X', httpStatus: 500 }],
    ['a non-number httpStatus', { name: 'AppError', message: 'x', code: 'X', httpStatus: '500' }],
  ])('rejects %s', (_label, value) => {
    expect(isErr(AppError.fromJSON(value))).toBe(true);
  });

  it('does not recurse without bound on a hostile nested payload', () => {
    let payload: Record<string, unknown> = {
      name: 'AppError',
      message: 'deep',
      code: 'X',
      httpStatus: 500,
    };
    for (let i = 0; i < 5000; i += 1) {
      payload = { name: 'AppError', message: 'deep', code: 'X', httpStatus: 500, cause: payload };
    }

    const revived = AppError.fromJSON(payload);
    expect(isOk(revived)).toBe(true);
    if (!isOk(revived)) return;
    expect(chainDepth(revived.value.toJSON())).toBeLessThanOrEqual(17);
  });

  it('preserves the name of a subclass this package cannot know about', () => {
    const payload = {
      name: 'PaymentDeclinedError',
      message: 'card declined',
      code: 'CARD_DECLINED',
      httpStatus: 402,
      details: { last4: '4242' },
    };

    const revived = AppError.fromJSON(payload);
    if (!isOk(revived)) throw new Error('expected a success');
    expect(revived.value).toBeInstanceOf(AppError);
    expect(revived.value.name).toBe('PaymentDeclinedError');
    expect(revived.value.toJSON()).toEqual(payload);
  });

  it('restores an explicit null detail rather than dropping the key', () => {
    const original = new NotFoundError('gone', { details: null });
    expect(original.toJSON().details).toBeNull();

    const revived = AppError.fromJSON(original.toJSON());
    if (!isOk(revived)) throw new Error('expected a success');
    expect(revived.value.details).toBeNull();
  });
});

describe('unusual but legal construction', () => {
  it('accepts an empty message', () => {
    const error = new AppError('');
    expect(error.message).toBe('');
    expect(error.toJSON().message).toBe('');
  });

  it('accepts httpStatus 0, which is falsy but explicit', () => {
    expect(new AppError('boom', { httpStatus: 0 }).httpStatus).toBe(0);
  });

  it('accepts an empty-string code, which is falsy but explicit', () => {
    expect(new AppError('boom', { code: '' }).code).toBe('');
  });

  it('brands a hand-rolled subclass so isAppError still recognises it', () => {
    class PaymentDeclinedError extends AppError {
      constructor(message: string) {
        super(message, { code: 'CARD_DECLINED', httpStatus: 402 });
        this.name = 'PaymentDeclinedError';
      }
    }

    const error = new PaymentDeclinedError('declined');
    expect(error).toBeInstanceOf(PaymentDeclinedError);
    expect(error).toBeInstanceOf(AppError);
    expect(isAppError(error)).toBe(true);
    expect(error.toJSON()).toEqual({
      name: 'PaymentDeclinedError',
      message: 'declined',
      code: 'CARD_DECLINED',
      httpStatus: 402,
    });
  });

  it('refuses to let the brand be overwritten', () => {
    const error = new AppError('boom');
    expect(() => {
      Object.defineProperty(error, Symbol.for('@firstprinciples/core/AppError'), { value: false });
    }).toThrow(TypeError);
  });
});

describe('on a runtime without Error.captureStackTrace', () => {
  const original = (Error as { captureStackTrace?: unknown }).captureStackTrace;

  afterEach(() => {
    (Error as { captureStackTrace?: unknown }).captureStackTrace = original;
  });

  it('still produces a usable stack', () => {
    // Restore before asserting: vitest's own `expect` calls
    // captureStackTrace, so it has to be missing only while the error is
    // being constructed.
    delete (Error as { captureStackTrace?: unknown }).captureStackTrace;
    let error: ConflictError;
    try {
      error = new ConflictError('boom');
    } finally {
      (Error as { captureStackTrace?: unknown }).captureStackTrace = original;
    }

    expect(error.stack).toBeDefined();
    expect(error.stack?.split('\n')[0]).toBe('ConflictError: boom');
    expect(error.stack).not.toMatch(/at new (AppError|ConflictError)/);
    expect(error.name).toBe('ConflictError');
    expect(error.httpStatus).toBe(409);
    expect(error.code).toBe('CONFLICT');
  });
});
