import { describe, expectTypeOf, it } from 'vitest';
import {
  AppError,
  type AppErrorOptions,
  type BrandFailureDetails,
  type BrandValidationError,
  type EmailFailure,
  isErr,
  parseEmail,
  ConflictError,
  ForbiddenError,
  isAppError,
  NetworkError,
  NotFoundError,
  type Result,
  type SerializedAppError,
  UnauthorizedError,
  ValidationError,
} from '../../src/index.js';

describe('the hierarchy', () => {
  it('makes every variant assignable to the base', () => {
    expectTypeOf<ValidationError>().toExtend<AppError>();
    expectTypeOf<NotFoundError>().toExtend<AppError>();
    expectTypeOf<ForbiddenError>().toExtend<AppError>();
    expectTypeOf<UnauthorizedError>().toExtend<AppError>();
    expectTypeOf<ConflictError>().toExtend<AppError>();
    expectTypeOf<NetworkError>().toExtend<AppError>();
    expectTypeOf<AppError>().toExtend<Error>();
  });

  it('does not make the base assignable to a variant', () => {
    // @ts-expect-error - an AppError is not necessarily a NotFoundError
    const narrowed: NotFoundError = new AppError('boom');
    void narrowed;
  });

  it('keeps siblings distinct, which structural typing alone would not', () => {
    // The subclasses add no members beyond the literal `kind`, so without
    // that discriminant TypeScript would consider these interchangeable.
    // @ts-expect-error - a ConflictError is not a NotFoundError
    const wrong: NotFoundError = new ConflictError('dup');
    void wrong;
  });

  it('discriminates the built-in taxonomy on kind', () => {
    const error = new NotFoundError('x') as
      ConflictError | ForbiddenError | NotFoundError | UnauthorizedError | ValidationError;

    switch (error.kind) {
      case 'NotFoundError':
        expectTypeOf(error).toExtend<NotFoundError>();
        break;
      case 'ConflictError':
        expectTypeOf(error).toExtend<ConflictError>();
        break;
      default:
        expectTypeOf(error).toExtend<ForbiddenError | UnauthorizedError | ValidationError>();
    }
  });

  it('narrows an unknown caught value through instanceof', () => {
    const caught: unknown = new NotFoundError('x');
    if (caught instanceof AppError) {
      expectTypeOf(caught).toExtend<AppError>();
      expectTypeOf(caught.code).toEqualTypeOf<string>();
      expectTypeOf(caught.httpStatus).toEqualTypeOf<number>();
      // `details` is `unknown`, not `any` — assigning it anywhere
      // narrower must be an error, and `any` would not be.
      const asUnknown: unknown = caught.details;
      void asUnknown;
      // @ts-expect-error - details is unknown until you check it
      const asString: string = caught.details;
      void asString;
      if (caught instanceof NotFoundError) {
        expectTypeOf(caught).toExtend<NotFoundError>();
        // `kind` is the literal; `name` is free so subclasses can set it.
        expectTypeOf(caught.kind).toEqualTypeOf<'NotFoundError'>();
        expectTypeOf(caught.name).toEqualTypeOf<string>();
      }
    }
  });

  it('narrows an unknown caught value through isAppError', () => {
    const caught: unknown = new NotFoundError('x');
    if (isAppError(caught)) {
      expectTypeOf(caught).toExtend<AppError>();
      // @ts-expect-error - details is unknown until you check it
      const asString: string = caught.details;
      void asString;
    }
  });
});

describe('details', () => {
  it('is unknown, not any, after narrowing a caught value', () => {
    const caught: unknown = new ValidationError('bad', { details: { field: 'email' } });
    if (caught instanceof ValidationError) {
      const asUnknown: unknown = caught.details;
      void asUnknown;
      // @ts-expect-error - unknown must be narrowed before use. An `any`
      // here would compile, which is exactly the hole this guards.
      const asString: string = caught.details;
      void asString;
    }
  });

  it('is unknown on the classes themselves, so they take no type argument', () => {
    expectTypeOf<AppError['details']>().toBeUnknown();
    // @ts-expect-error - the hierarchy is deliberately not generic
    const generic: ValidationError<{ field: string }> = new ValidationError('bad');
    void generic;
  });

  it('can still be typed by a function that knows what it put there', () => {
    const result = parseEmail(undefined as unknown);
    if (isErr(result)) {
      expectTypeOf(result.error).toExtend<ValidationError>();
      expectTypeOf(result.error.details).toEqualTypeOf<
        BrandFailureDetails<EmailFailure> | undefined
      >();
    }
  });

  it('keeps a typed error assignable everywhere the plain class is expected', () => {
    expectTypeOf<BrandValidationError<EmailFailure>>().toExtend<ValidationError>();
    expectTypeOf<BrandValidationError<EmailFailure>>().toExtend<AppError>();
    expectTypeOf<Result<string, BrandValidationError<EmailFailure>>>().toExtend<
      Result<string, AppError>
    >();
  });
});

describe('construction', () => {
  it('needs nothing but a message', () => {
    expectTypeOf(NotFoundError).toBeConstructibleWith('gone');
    expectTypeOf(NotFoundError).toBeConstructibleWith('gone', {});
  });

  it('accepts an unknown cause, matching what a catch block hands you', () => {
    expectTypeOf<AppErrorOptions['cause']>().toEqualTypeOf<unknown>();
    const caught: unknown = new Error('x');
    expectTypeOf(ConflictError).toBeConstructibleWith('boom', { cause: caught });
  });

  it('rejects a message that is not a string', () => {
    // @ts-expect-error - message must be a string
    const error = new NotFoundError(404);
    void error;
  });

  it('does not accept a name option — the class is the name', () => {
    // @ts-expect-error - `name` is not an AppErrorOptions field
    const error = new NotFoundError('gone', { name: 'Custom' });
    void error;
  });
});

describe('serialization', () => {
  it('types toJSON as the documented wire shape', () => {
    expectTypeOf(new NotFoundError('x').toJSON()).toEqualTypeOf<SerializedAppError>();
  });

  it('has no stack field to leak', () => {
    // @ts-expect-error - toJSON deliberately omits the stack
    const stack: string = new AppError('x').toJSON().stack;
    void stack;
  });

  it('types fromJSON as a Result over untrusted input', () => {
    expectTypeOf(AppError.fromJSON).parameter(0).toEqualTypeOf<unknown>();
    expectTypeOf(AppError.fromJSON).returns.toEqualTypeOf<Result<AppError, ValidationError>>();
  });
});

describe('subclassing a built-in error', () => {
  // The scenario this design exists for, and the one that used to be
  // impossible: `auth-utils` wants a `JwtVerificationError` that *is* an
  // `UnauthorizedError` (so generic auth handling and the 401 come for
  // free) but reports its own name and narrows `details`.
  interface JwtFailureDetails {
    readonly reason: 'expired' | 'signature_invalid';
  }

  class JwtVerificationError extends UnauthorizedError {
    declare name: 'JwtVerificationError';
    declare readonly details: JwtFailureDetails;

    constructor(reason: JwtFailureDetails['reason'], message: string) {
      super(message, { code: `JWT_${reason.toUpperCase()}`, details: { reason } });
      this.name = 'JwtVerificationError';
    }
  }

  it('may declare its own literal name', () => {
    const error = new JwtVerificationError('expired', 'gone');
    expectTypeOf(error.name).toEqualTypeOf<'JwtVerificationError'>();
  });

  it('inherits the parent kind unchanged, which is the correct taxonomy answer', () => {
    const error = new JwtVerificationError('expired', 'gone');
    expectTypeOf(error.kind).toEqualTypeOf<'UnauthorizedError'>();
  });

  it('is still an UnauthorizedError to instanceof and to the type system', () => {
    const error: UnauthorizedError = new JwtVerificationError('expired', 'gone');
    expectTypeOf(error).toExtend<UnauthorizedError>();
    expectTypeOf(error).toExtend<AppError>();
  });

  it('may narrow details, the BrandValidationError pattern', () => {
    const error = new JwtVerificationError('expired', 'gone');
    expectTypeOf(error.details).toEqualTypeOf<JwtFailureDetails>();
    expectTypeOf(error.details.reason).toEqualTypeOf<'expired' | 'signature_invalid'>();
  });

  it('leaves details unknown at an untrusted catch site', () => {
    const caught: unknown = new JwtVerificationError('expired', 'gone');
    if (caught instanceof UnauthorizedError) {
      // @ts-expect-error - the parent's details are still unknown
      const asDetails: JwtFailureDetails = caught.details;
      void asDetails;
    }
  });

  it('is not assignable to a sibling of its parent', () => {
    // @ts-expect-error - a JwtVerificationError is not a NotFoundError
    const wrong: NotFoundError = new JwtVerificationError('expired', 'gone');
    void wrong;
  });

  it('does not let a subclass forge a different kind', () => {
    class Bad extends UnauthorizedError {
      // @ts-expect-error - `kind` is the taxonomy slot and is inherited
      declare kind: 'SomethingElse';
    }
    void Bad;
  });
});
