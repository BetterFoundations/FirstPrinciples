import {
  AppError,
  ConflictError,
  ForbiddenError,
  NetworkError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@firstprinciples/core';
import { describe, expect, it } from 'vitest';
import { toHttpError, toNetworkError } from '../../src/internal/errors.js';

describe('toNetworkError', () => {
  it('builds a NetworkError with httpStatus 503, per the core convention', () => {
    const error = toNetworkError(new TypeError('fetch failed'), 'https://api.example.com/x', false);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error.httpStatus).toBe(503);
    expect(error.code).toBe('NETWORK_ERROR');
  });

  it('preserves the original failure as the cause', () => {
    const cause = new TypeError('fetch failed');
    const error = toNetworkError(cause, 'https://api.example.com/x', false);
    expect(error.cause).toBe(cause);
  });

  it('describes a timeout distinctly from a generic network failure', () => {
    const timeout = toNetworkError(new DOMException('x', 'TimeoutError'), 'https://x/y', true);
    expect(timeout.message).toContain('timed out');

    const generic = toNetworkError(new TypeError('ECONNREFUSED'), 'https://x/y', false);
    expect(generic.message).toContain('failed');
    expect(generic.message).not.toContain('timed out');
  });

  it('describes an explicit caller abort distinctly from a timeout', () => {
    const aborted = toNetworkError(new DOMException('x', 'AbortError'), 'https://x/y', true);
    expect(aborted.message).toContain('aborted');
  });

  it('trusts the `aborted` flag over the cause shape — a caller can abort with any reason at all', () => {
    // AbortController#abort(reason) accepts anything, not just a
    // DOMException — a plain string is common. This is the exact case
    // that a naive "is `cause` a DOMException?" check gets subtly wrong:
    // it looks correct against the default AbortError shape and silently
    // misclassifies a real, common abort as a generic network failure.
    const aborted = toNetworkError('user navigated away', 'https://x/y', true);
    expect(aborted.message).toContain('aborted');
  });

  it('never calls an unaborted request "aborted", even if the cause happens to be a DOMException', () => {
    const notAborted = toNetworkError(new DOMException('unrelated'), 'https://x/y', false);
    expect(notAborted.message).not.toContain('aborted');
    expect(notAborted.message).not.toContain('timed out');
  });
});

describe('toHttpError', () => {
  const response = (status: number, statusText = ''): Response =>
    new Response(null, { status, statusText });

  it.each([
    [400, ValidationError],
    [401, UnauthorizedError],
    [403, ForbiddenError],
    [404, NotFoundError],
    [409, ConflictError],
  ] as const)('maps status %i to %s', (status, Ctor) => {
    const error = toHttpError(response(status), undefined);
    expect(error).toBeInstanceOf(Ctor);
    expect(error.httpStatus).toBe(status);
  });

  it('falls back to a plain AppError for an unmapped status, with the real status set', () => {
    const error = toHttpError(response(418, "I'm a teapot"), undefined);
    expect(error).toBeInstanceOf(AppError);
    expect(error).not.toBeInstanceOf(ValidationError);
    expect(error.httpStatus).toBe(418);
    expect(error.message).toContain('418');
  });

  it('falls back for a 5xx status too', () => {
    const error = toHttpError(response(503, 'Service Unavailable'), undefined);
    expect(error.httpStatus).toBe(503);
  });

  it('reads message and code from a body shaped like { message, code }', () => {
    const error = toHttpError(response(404), {
      message: 'No such widget',
      code: 'WIDGET_NOT_FOUND',
    });
    expect(error.message).toBe('No such widget');
    expect(error.code).toBe('WIDGET_NOT_FOUND');
  });

  it('keeps the subclass default code when the body has none', () => {
    const error = toHttpError(response(404), { message: 'gone' });
    expect(error.code).toBe('NOT_FOUND');
  });

  it('falls back to a generic message when the body has no usable message field', () => {
    const cases = [undefined, null, 'plain text body', 42, { message: 123 }];
    for (const body of cases) {
      const error = toHttpError(response(404, 'Not Found'), body);
      expect(error.message).toContain('404');
    }
  });

  it('always attaches the raw body as details, for callers who need the full payload', () => {
    const body = { message: 'bad', code: 'X', extra: { field: 'email' } };
    const error = toHttpError(response(400), body);
    expect(error.details).toEqual(body);
  });
});
