import { describe, expect, it } from 'vitest';
import {
  isEmail,
  isErr,
  isISODateString,
  isOk,
  isUUID,
  parseEmail,
  parseISODateString,
  parseUUID,
  ValidationError,
} from '../../src/index.js';

describe('Email', () => {
  it.each([
    'user@example.com',
    'first.last@example.co.uk',
    'user+tag@example.com',
    "o'brien@example.com",
    'user@sub.domain.example.com',
    'user@münchen.de',
  ])('accepts %s', (value) => {
    expect(isEmail(value)).toBe(true);
    expect(isOk(parseEmail(value))).toBe(true);
  });

  it.each([
    ['no at sign', 'userexample.com'],
    ['nothing before the at', '@example.com'],
    ['nothing after the at', 'user@'],
    ['undotted domain', 'user@localhost'],
    ['leading dot in domain', 'user@.example.com'],
    ['trailing dot in domain', 'user@example.com.'],
    ['consecutive dots in domain', 'user@example..com'],
    ['a space', 'user name@example.com'],
    ['a tab', 'user\t@example.com'],
    ['an empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(isEmail(value)).toBe(false);
    expect(isErr(parseEmail(value))).toBe(true);
  });

  it('reports why, without ever echoing the rejected value', () => {
    const result = parseEmail('definitely-not-an-email');

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(result.error.code).toBe('INVALID_EMAIL');
    expect(result.error.httpStatus).toBe(400);
    expect(result.error.details).toEqual({ expected: 'Email', reason: 'malformed' });
    expect(JSON.stringify(result.error)).not.toContain('definitely-not-an-email');
  });

  it.each([
    ['not-a-string', 42],
    ['empty', ''],
    ['too-long', `${'a'.repeat(250)}@example.com`],
    ['local-part-too-long', `${'a'.repeat(65)}@example.com`],
    ['malformed', 'nope'],
  ])('reports reason %s', (reason, value) => {
    const result = parseEmail(value);
    if (!isErr(result)) throw new Error('expected a failure');
    expect(result.error.details?.reason).toBe(reason);
  });
});

describe('UUID', () => {
  it.each([
    ['v4', '9c858901-8a57-4791-81fe-4c455b099bc9'],
    ['v7', '018f4c1a-7b2d-7c3e-8a9b-1c2d3e4f5a6b'],
    ['v1', 'c232ab00-9414-11ec-b3c8-9f6bdeced846'],
    ['uppercase', '9C858901-8A57-4791-81FE-4C455B099BC9'],
    ['the Nil UUID', '00000000-0000-0000-0000-000000000000'],
  ])('accepts %s', (_label, value) => {
    expect(isUUID(value)).toBe(true);
  });

  it.each([
    ['a bad version nibble', '9c858901-8a57-0791-81fe-4c455b099bc9'],
    ['a bad variant nibble', '9c858901-8a57-4791-c1fe-4c455b099bc9'],
    ['the Max UUID', 'ffffffff-ffff-ffff-ffff-ffffffffffff'],
    ['no dashes', '9c8589018a57479181fe4c455b099bc9'],
    ['a non-hex character', '9c858901-8a57-4791-81fe-4c455b099bcz'],
    ['a too-short group', '9c858901-8a57-4791-81fe-4c455b099bc'],
    ['surrounding whitespace', ' 9c858901-8a57-4791-81fe-4c455b099bc9 '],
    ['an empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(isUUID(value)).toBe(false);
  });

  it('preserves case rather than normalizing it', () => {
    const upper = '9C858901-8A57-4791-81FE-4C455B099BC9';
    const result = parseUUID(upper);

    if (!isOk(result)) throw new Error('expected a success');
    expect(result.value).toBe(upper);
  });

  it('reports a ValidationError with code INVALID_UUID', () => {
    const result = parseUUID('nope');

    if (!isErr(result)) throw new Error('expected a failure');
    expect(result.error.code).toBe('INVALID_UUID');
    expect(result.error.details).toEqual({ expected: 'UUID', reason: 'malformed' });
  });
});

describe('ISODateString', () => {
  it.each([
    ['a Z instant', '2026-08-22T14:30:00Z'],
    ['milliseconds', '2026-08-22T14:30:00.123Z'],
    ['nanosecond precision', '2026-08-22T14:30:00.123456789Z'],
    ['a positive offset', '2026-08-22T14:30:00+05:30'],
    ['a negative offset', '2026-08-22T14:30:00-08:00'],
    ['a real leap day', '2024-02-29T00:00:00Z'],
    ['the last second of a year', '2026-12-31T23:59:59Z'],
  ])('accepts %s', (_label, value) => {
    expect(isISODateString(value)).toBe(true);
    expect(Number.isNaN(new Date(value).getTime())).toBe(false);
  });

  it.each([
    ['a date-only string', '2026-08-22'],
    ['a lowercase separator', '2026-08-22t14:30:00z'],
    ['a space separator', '2026-08-22 14:30:00Z'],
    ['a missing timezone', '2026-08-22T14:30:00'],
    ['a leap second', '2026-08-22T23:59:60Z'],
    ['hour 24', '2026-08-22T24:00:00Z'],
    ['minute 60', '2026-08-22T14:60:00Z'],
    ['month 13', '2026-13-01T00:00:00Z'],
    ['month 0', '2026-00-01T00:00:00Z'],
    ['day 0', '2026-08-00T00:00:00Z'],
    ['day 32, which Date does reject', '2026-01-32T00:00:00Z'],
    ['an out-of-range offset', '2026-08-22T14:30:00+25:00'],
    ['an out-of-range offset minute', '2026-08-22T14:30:00+05:60'],
    ['an empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(isISODateString(value)).toBe(false);
  });

  it.each([
    ['31 February', '2026-02-31T00:00:00Z'],
    ['29 February in a non-leap year', '2026-02-29T00:00:00Z'],
    ['29 February in a non-leap century', '1900-02-29T00:00:00Z'],
    ['31 April', '2026-04-31T00:00:00Z'],
  ])('rejects %s, which Date silently rolls over instead of refusing', (_label, value) => {
    expect(isISODateString(value)).toBe(false);
    // The reason this package does its own calendar arithmetic: Date
    // accepts these and quietly returns a different day.
    expect(Number.isNaN(new Date(value).getTime())).toBe(false);
  });

  it('accepts 29 February in a leap century', () => {
    expect(isISODateString('2000-02-29T00:00:00Z')).toBe(true);
  });

  it('reports a ValidationError with a specific reason', () => {
    const result = parseISODateString('2026-02-31T00:00:00Z');

    if (!isErr(result)) throw new Error('expected a failure');
    expect(result.error.code).toBe('INVALID_ISO_DATE_STRING');
    expect(result.error.details).toEqual({
      expected: 'ISODateString',
      reason: 'invalid-calendar-date',
    });
  });

  it.each([
    ['not-a-string', new Date()],
    ['malformed', 'yesterday'],
    ['invalid-calendar-date', '2026-02-31T00:00:00Z'],
    ['invalid-time', '2026-08-22T25:00:00Z'],
    ['invalid-offset', '2026-08-22T14:30:00+25:00'],
  ])('reports reason %s', (reason, value) => {
    const result = parseISODateString(value);
    if (!isErr(result)) throw new Error('expected a failure');
    expect(result.error.details?.reason).toBe(reason);
  });
});

describe('non-string inputs', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['an object', {}],
    ['an array', []],
    ['a String object', new String('user@example.com')],
  ])('are rejected by every guard: %s', (_label, value) => {
    expect(isEmail(value)).toBe(false);
    expect(isUUID(value)).toBe(false);
    expect(isISODateString(value)).toBe(false);
  });
});
