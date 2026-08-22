import { describe, expectTypeOf, it } from 'vitest';
import {
  AppError,
  err,
  type Err,
  isErr,
  isOk,
  NotFoundError,
  ok,
  type Ok,
  type Result,
  ValidationError,
} from '../../src/index.js';

describe('ok / err inference', () => {
  it('infers the success type from the argument', () => {
    expectTypeOf(ok(42)).toEqualTypeOf<Ok<number>>();
    expectTypeOf(ok('x' as const)).toEqualTypeOf<Ok<'x'>>();
  });

  it('gives the no-argument overload a void value', () => {
    expectTypeOf(ok()).toEqualTypeOf<Ok<void>>();
  });

  it('infers the error type from the argument', () => {
    expectTypeOf(err(new NotFoundError('x'))).toEqualTypeOf<Err<NotFoundError>>();
  });
});

describe('narrowing', () => {
  it('narrows both branches through the ok discriminant', () => {
    const result = ok(1) as Result<number, ValidationError>;

    if (result.ok) {
      expectTypeOf(result).toEqualTypeOf<Ok<number>>();
      expectTypeOf(result.value).toEqualTypeOf<number>();
    } else {
      expectTypeOf(result).toEqualTypeOf<Err<ValidationError>>();
      expectTypeOf(result.error).toEqualTypeOf<ValidationError>();
    }
  });

  it('narrows both branches through isOk', () => {
    const result = ok(1) as Result<number, ValidationError>;

    if (isOk(result)) {
      expectTypeOf(result).toEqualTypeOf<Ok<number>>();
    } else {
      expectTypeOf(result).toEqualTypeOf<Err<ValidationError>>();
    }
  });

  it('narrows both branches through isErr', () => {
    const result = ok(1) as Result<number, ValidationError>;

    if (isErr(result)) {
      expectTypeOf(result).toEqualTypeOf<Err<ValidationError>>();
    } else {
      expectTypeOf(result).toEqualTypeOf<Ok<number>>();
    }
  });

  it('narrows a union error type down to one member', () => {
    const result = ok(1) as Result<number, NotFoundError | ValidationError>;

    if (isErr(result)) {
      expectTypeOf(result.error).toEqualTypeOf<NotFoundError | ValidationError>();
      if (result.error instanceof NotFoundError) {
        expectTypeOf(result.error).toEqualTypeOf<NotFoundError>();
      }
    }
  });

  it('works as a predicate in Array.prototype.filter', () => {
    const results: Result<number, ValidationError>[] = [];
    expectTypeOf(results.filter(isOk)).toEqualTypeOf<Ok<number>[]>();
    expectTypeOf(results.filter(isErr)).toEqualTypeOf<Err<ValidationError>[]>();
  });
});

describe('the AppError default', () => {
  it('defaults the error type to the shared taxonomy', () => {
    expectTypeOf<Result<string>>().toEqualTypeOf<Result<string, AppError>>();

    const result = ok('x') as Result<string>;
    if (isErr(result)) {
      // A one-type-argument Result still gives the whole taxonomy.
      expectTypeOf(result.error.code).toEqualTypeOf<string>();
      expectTypeOf(result.error.httpStatus).toEqualTypeOf<number>();
      expectTypeOf(result.error.details).toEqualTypeOf<unknown>();
    }
  });

  it('accepts a non-error payload when one is asked for', () => {
    const result: Result<number, string> = err('nope');
    if (isErr(result)) expectTypeOf(result.error).toEqualTypeOf<string>();
  });
});

describe('variance', () => {
  it('widens a narrow Err into a wider one, so early returns need no re-wrap', () => {
    function inner(): Result<never, ValidationError> {
      return err(new ValidationError('bad'));
    }
    function outer(): Result<number, NotFoundError | ValidationError> {
      const result = inner();
      if (isErr(result)) return result;
      return ok(result.value);
    }
    expectTypeOf(outer).returns.toEqualTypeOf<Result<number, NotFoundError | ValidationError>>();
  });

  it('accepts a subclass Err where the base class is expected', () => {
    expectTypeOf<Err<NotFoundError>>().toExtend<Err<AppError>>();
    expectTypeOf<Ok<'literal'>>().toExtend<Ok<string>>();
    const widened: Err<AppError> = err(new NotFoundError('x'));
    void widened;
  });

  it('does not accept a wider Err where a narrower one is required', () => {
    // @ts-expect-error - AppError is not necessarily a NotFoundError
    const _widened: Err<NotFoundError> = err(new AppError('boom'));
    void _widened;
  });
});

describe('composition with a downstream ApiResult (the S7 layering decision)', () => {
  // Exactly the shape `@firstprinciples/http-client` is specified to
  // return: the core union widened with transport metadata, its error
  // branch carrying a core error instance. If this stops compiling, the
  // layering decision recorded in EXECUTION-CHECKLIST.md has broken.
  type ApiOk<T> = Ok<T> & { readonly status: number };
  type ApiErr<E extends AppError = AppError> = Err<E> & {
    readonly status: number | undefined;
    readonly kind: 'http' | 'network' | 'validation';
  };
  type ApiResult<T, E extends AppError = AppError> = ApiOk<T> | ApiErr<E>;

  it('stays a discriminated union after being widened', () => {
    const response = { ok: true, value: 1, status: 200 } as ApiResult<number>;

    if (response.ok) {
      expectTypeOf(response).toEqualTypeOf<ApiOk<number>>();
      expectTypeOf(response.status).toEqualTypeOf<number>();
    } else {
      expectTypeOf(response).toEqualTypeOf<ApiErr<AppError>>();
      expectTypeOf(response.kind).toEqualTypeOf<'http' | 'network' | 'validation'>();
    }
  });

  it("narrows through core's own guards without losing the added fields", () => {
    const response = { ok: true, value: 1, status: 200 } as ApiResult<number>;

    if (isOk(response)) {
      expectTypeOf(response).toEqualTypeOf<ApiOk<number>>();
      expectTypeOf(response.value).toEqualTypeOf<number>();
      expectTypeOf(response.status).toEqualTypeOf<number>();
    } else {
      expectTypeOf(response).toEqualTypeOf<ApiErr<AppError>>();
      // The taxonomy survives the widening: this is what makes a single
      // `error.httpStatus` mapping work in api-kit.
      expectTypeOf(response.error.httpStatus).toEqualTypeOf<number>();
      expectTypeOf(response.error).toExtend<AppError>();
    }
  });

  it('is assignable back to a plain Result, so a caller can ignore transport detail', () => {
    expectTypeOf<ApiResult<number>>().toExtend<Result<number, AppError>>();
  });

  it('keeps a narrowed error union usable', () => {
    const typed: ApiResult<number, NotFoundError> = {
      ok: false,
      error: new NotFoundError('x'),
      status: 404,
      kind: 'http',
    };

    if (isErr(typed)) {
      expectTypeOf(typed.error).toEqualTypeOf<NotFoundError>();
    }
  });
});
