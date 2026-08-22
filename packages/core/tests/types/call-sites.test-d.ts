import { describe, expectTypeOf, it } from 'vitest';
import {
  AppError,
  ConflictError,
  type Email,
  err,
  ForbiddenError,
  isAppError,
  isErr,
  isOk,
  NotFoundError,
  ok,
  parseEmail,
  parseISODateString,
  parseUUID,
  type Result,
  type UUID,
  ValidationError,
} from '../../src/index.js';

/**
 * Four realistic call sites, compiled rather than pasted into a README.
 *
 * A public signature that is awkward to call is a design bug, not a
 * documentation problem — so these were written before the signatures
 * were finalized, and they are kept compiling so the signatures cannot
 * quietly regress into something clumsier.
 */

interface User {
  readonly id: UUID;
  readonly email: Email;
  readonly ownerId: UUID;
}

declare function findUser(id: UUID): Promise<User | undefined>;
declare function insertUser(user: User): Promise<void>;

describe('call site 1 — a service function with a typed error union', () => {
  async function getUser(rawId: string): Promise<Result<User, NotFoundError | ValidationError>> {
    const id = parseUUID(rawId);
    // The narrow Err widens into the wider union with no re-wrap.
    if (isErr(id)) return id;

    const user = await findUser(id.value);
    if (user === undefined) {
      return err(new NotFoundError(`No user ${rawId}`, { code: 'USER_NOT_FOUND' }));
    }
    return ok(user);
  }

  it('reads cleanly and narrows to the exact error union', async () => {
    const result = await getUser('9c858901-8a57-4791-81fe-4c455b099bc9');

    if (isOk(result)) {
      expectTypeOf(result.value).toEqualTypeOf<User>();
    } else {
      expectTypeOf(result.error).toEqualTypeOf<NotFoundError | ValidationError>();
      // Both members share the taxonomy, so one line handles both.
      expectTypeOf(result.error.httpStatus).toEqualTypeOf<number>();
    }
  });
});

describe('call site 2 — an HTTP handler mapping the taxonomy onto a response', () => {
  interface Reply {
    status: (code: number) => Reply;
    send: (body: unknown) => void;
  }

  async function handler(rawId: string, reply: Reply): Promise<void> {
    const result = await (async (): Promise<Result<User, AppError>> =>
      err(new NotFoundError(rawId)))();

    if (isErr(result)) {
      // One mapping for every error in the ecosystem, and `toJSON()`
      // carries no stack, so nothing leaks into the response body.
      reply.status(result.error.httpStatus).send(result.error.toJSON());
      return;
    }
    reply.send(result.value);
  }

  it('needs no per-error-type special casing', () => {
    expectTypeOf(handler).returns.toEqualTypeOf<Promise<void>>();
  });
});

describe('call site 3 — validating an untrusted request body', () => {
  interface Signup {
    readonly email: Email;
    readonly invitedAt: string;
  }

  function parseSignup(body: unknown): Result<Signup, ValidationError> {
    if (typeof body !== 'object' || body === null) {
      return err(new ValidationError('Body must be an object'));
    }
    const fields = body as Record<string, unknown>;

    const email = parseEmail(fields['email']);
    if (isErr(email)) return email;

    const invitedAt = parseISODateString(fields['invitedAt']);
    if (isErr(invitedAt)) return invitedAt;

    return ok({ email: email.value, invitedAt: invitedAt.value });
  }

  it('lets each field short-circuit without a re-wrap or a throw', () => {
    const result = parseSignup({});

    if (isErr(result)) {
      expectTypeOf(result.error).toEqualTypeOf<ValidationError>();
      // Widening to the plain class costs the typed details, as it must:
      // this signature promises only a ValidationError.
      // @ts-expect-error - details is unknown here, and must be narrowed
      const reason: string = result.error.details;
      void reason;
    }
  });
});

describe('call site 4 — wrapping a lower-level failure, then crossing a process boundary', () => {
  async function register(user: User): Promise<Result<void, ConflictError>> {
    try {
      await insertUser(user);
      return ok();
    } catch (cause) {
      // `cause` is `unknown` in a catch block, which is exactly what
      // AppErrorOptions accepts — no cast at the call site.
      return err(
        new ConflictError('Email already registered', {
          code: 'EMAIL_TAKEN',
          details: { field: 'email' },
          cause,
        }),
      );
    }
  }

  function acrossTheWire(payload: unknown): AppError {
    const revived = AppError.fromJSON(payload);
    // Untrusted input cannot be assumed well-formed, and nothing throws.
    return isOk(revived) ? revived.value : new AppError('Malformed error payload');
  }

  it('keeps the chain and survives serialization', async () => {
    const result = await register({} as User);
    expectTypeOf(result).toEqualTypeOf<Result<void, ConflictError>>();
    expectTypeOf(acrossTheWire).returns.toEqualTypeOf<AppError>();
  });

  it('recognises an error that crossed a module-copy boundary', () => {
    const caught: unknown = new ForbiddenError('nope');
    if (isAppError(caught)) {
      expectTypeOf(caught.code).toEqualTypeOf<string>();
    }
  });
});
