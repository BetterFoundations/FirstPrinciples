import { describe, expectTypeOf, it } from 'vitest';
import {
  type Brand,
  type BrandFailureDetails,
  type Email,
  type EmailFailure,
  isEmail,
  isErr,
  isISODateString,
  isOk,
  isUUID,
  type ISODateString,
  parseEmail,
  parseISODateString,
  parseUUID,
  type Result,
  type UUID,
  type UUIDFailure,
  ValidationError,
} from '../../src/index.js';

describe('branded types are not plain strings', () => {
  it('rejects a plain string where a brand is required', () => {
    // @ts-expect-error - a plain string is not an Email
    const email: Email = 'user@example.com';
    // @ts-expect-error - a plain string is not a UUID
    const uuid: UUID = '9c858901-8a57-4791-81fe-4c455b099bc9';
    // @ts-expect-error - a plain string is not an ISODateString
    const at: ISODateString = '2026-08-22T14:30:00Z';
    void email;
    void uuid;
    void at;
  });

  it('rejects one brand where another is required', () => {
    const email = 'user@example.com' as Email;
    // @ts-expect-error - an Email is not a UUID
    const uuid: UUID = email;
    void uuid;
  });

  it('still allows a branded value everywhere a string is accepted', () => {
    expectTypeOf<Email>().toExtend<string>();
    expectTypeOf<UUID>().toExtend<string>();
    expectTypeOf<ISODateString>().toExtend<string>();

    const email = 'user@example.com' as Email;
    expectTypeOf(email.toLowerCase()).toEqualTypeOf<string>();
    expectTypeOf(`mailto:${email}` as const).toExtend<string>();
  });

  it('brands a caller-defined type without a runtime wrapper', () => {
    type UserId = Brand<string, 'UserId'>;
    type Cents = Brand<number, 'Cents'>;

    // @ts-expect-error - a plain number is not Cents
    const amount: Cents = 500;
    void amount;

    expectTypeOf<UserId>().toExtend<string>();
    expectTypeOf<Cents>().toExtend<number>();
    // Distinct brands over the same primitive stay distinct.
    expectTypeOf<UserId>().not.toEqualTypeOf<Email>();
  });
});

describe('guards narrow an unknown input all the way to the brand', () => {
  it('narrows through isEmail', () => {
    const value: unknown = 'user@example.com';
    if (isEmail(value)) expectTypeOf(value).toEqualTypeOf<Email>();
  });

  it('narrows through isUUID and isISODateString', () => {
    const value: unknown = 'x';
    if (isUUID(value)) expectTypeOf(value).toEqualTypeOf<UUID>();
    const other: unknown = 'y';
    if (isISODateString(other)) expectTypeOf(other).toEqualTypeOf<ISODateString>();
  });

  it('keeps the brand through a filter', () => {
    const candidates: string[] = [];
    expectTypeOf(candidates.filter(isEmail)).toEqualTypeOf<Email[]>();
  });
});

describe('parsers return a Result carrying a typed ValidationError', () => {
  it('narrows to the brand on the success branch', () => {
    const result = parseEmail(undefined as unknown);
    if (isOk(result)) expectTypeOf(result.value).toEqualTypeOf<Email>();
  });

  it('exposes an exhaustively switchable reason on the failure branch', () => {
    const result = parseEmail(undefined as unknown);
    if (isErr(result)) {
      expectTypeOf(result.error).toExtend<ValidationError>();
      expectTypeOf(result.error.details).toEqualTypeOf<
        BrandFailureDetails<EmailFailure> | undefined
      >();
      expectTypeOf(result.error.details?.reason).toEqualTypeOf<EmailFailure | undefined>();
    }
  });

  it('gives each parser its own reason union', () => {
    const result = parseUUID(undefined as unknown);
    if (isErr(result)) {
      expectTypeOf(result.error.details?.reason).toEqualTypeOf<UUIDFailure | undefined>();
      // @ts-expect-error - 'too-long' is an Email reason, not a UUID one
      const _reason: UUIDFailure = 'too-long';
      void _reason;
    }
  });

  it('widens into the general taxonomy, so a caller can ignore the specifics', () => {
    function boundary(input: unknown): Result<Email, ValidationError> {
      return parseEmail(input);
    }
    expectTypeOf(boundary).returns.toEqualTypeOf<Result<Email, ValidationError>>();
  });

  it('composes with a wider error union at a call site', () => {
    function parseTimestamp(input: unknown): Result<ISODateString, ValidationError> {
      return parseISODateString(input);
    }
    expectTypeOf(parseTimestamp).returns.toExtend<Result<ISODateString, ValidationError>>();
  });
});
