// Runnable usage example for \@firstprinciples/core.
//
// Run with: pnpm --filter examples-core start
//
// Four scenarios, each backed by a tiny in-memory "database" so the whole
// thing runs standalone with no network or process I/O.
import {
  AppError,
  ConflictError,
  type Email,
  err,
  isErr,
  isOk,
  NotFoundError,
  ok,
  parseEmail,
  parseISODateString,
  parseUUID,
  type Result,
  type UUID,
  type ValidationError,
} from '@firstprinciples/core';

interface User {
  readonly id: UUID;
  readonly email: Email;
}

const users = new Map<string, User>([
  [
    '9c858901-8a57-4791-81fe-4c455b099bc9',
    { id: '9c858901-8a57-4791-81fe-4c455b099bc9' as UUID, email: 'ada@example.com' as Email },
  ],
]);

// --- 1. A service function with a typed error union -----------------------
// `Result<T, E>` puts "not found" and "bad input" in the return type instead
// of behind a throw, so the compiler flags a caller that forgets a branch.

function getUser(rawId: string): Result<User, NotFoundError | ValidationError> {
  const id = parseUUID(rawId);
  if (isErr(id)) return id; // a narrow Err widens into the union, no re-wrap

  const user = users.get(id.value);
  if (!user) return err(new NotFoundError(`No user ${rawId}`, { code: 'USER_NOT_FOUND' }));

  return ok(user);
}

console.log('--- 1. typed error union ---');
for (const rawId of [
  '9c858901-8a57-4791-81fe-4c455b099bc9',
  'not-a-uuid',
  '00000000-0000-0000-0000-000000000000',
]) {
  const result = getUser(rawId);
  console.log(
    isOk(result)
      ? `found: ${result.value.email}`
      : `error (${result.error.name}): ${result.error.message}`,
  );
}

// --- 2. Mapping every error to an HTTP response in one place --------------
// `httpStatus` lives on the base class, so the boundary needs no knowledge
// of which subclass it is holding. `toJSON()` never carries a stack, so this
// is safe even though `JSON.stringify` calls it implicitly.

interface FakeResponse {
  status: number;
  body: unknown;
}

function toHttpResponse<T>(result: Result<T, AppError>): FakeResponse {
  if (isOk(result)) return { status: 200, body: result.value };
  return { status: result.error.httpStatus, body: result.error.toJSON() };
}

console.log('\n--- 2. HTTP response mapping ---');
console.log(toHttpResponse(getUser('missing-id-does-not-exist')));

// --- 3. Validating an untrusted request body, without throwing ------------

interface Signup {
  readonly email: Email;
  readonly invitedAt: string;
}

function parseSignup(body: Record<string, unknown>): Result<Signup, ValidationError> {
  const email = parseEmail(body.email);
  if (isErr(email)) return email;

  const invitedAt = parseISODateString(body.invitedAt);
  if (isErr(invitedAt)) return invitedAt;

  return ok({ email: email.value, invitedAt: invitedAt.value });
}

console.log('\n--- 3. validating a request body ---');
for (const body of [
  { email: 'ada@example.com', invitedAt: '2026-01-15T00:00:00Z' },
  { email: 'not-an-email', invitedAt: '2026-01-15T00:00:00Z' },
]) {
  // parseSignup's declared return widens to plain ValidationError, so
  // `details` reads as `unknown` here — as it must, since this signature no
  // longer promises which field failed. Widening is opt-in per call site.
  const result = parseSignup(body);
  console.log(
    isOk(result) ? `valid signup: ${result.value.email}` : `rejected: ${result.error.message}`,
  );
}

// --- 4. Wrapping a lower-level failure, then crossing a process boundary --
// `cause` is `unknown`, matching a `catch` binding with no cast needed. The
// error survives a JSON round-trip via toJSON()/fromJSON() with no stack.

function register(email: string): Result<void, ConflictError> {
  try {
    if (email === 'ada@example.com') throw new Error('duplicate key: users.email');
    return ok();
  } catch (cause) {
    return err(
      new ConflictError('Email already registered', {
        code: 'EMAIL_TAKEN',
        details: { field: 'email' },
        cause,
      }),
    );
  }
}

console.log('\n--- 4. wrapping a lower-level failure ---');
const registration = register('ada@example.com');
if (isErr(registration)) {
  const wireFormat = JSON.stringify(registration.error); // implicitly calls toJSON(), no stack included
  console.log('sent over the wire:', wireFormat);

  const revived = AppError.fromJSON(JSON.parse(wireFormat));
  if (isOk(revived)) {
    console.log('restored on the other side:', revived.value.code, revived.value.httpStatus);
  }
}
