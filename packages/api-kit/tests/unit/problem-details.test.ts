import { ConflictError, NotFoundError, ValidationError } from '@firstprinciples/core';
import { describe, expect, it } from 'vitest';
import { toProblemDetails } from '../../src/problem-details.js';

describe('toProblemDetails', () => {
  it('maps an AppError to its typed fields', () => {
    const error = new NotFoundError('No user 42', { code: 'USER_NOT_FOUND' });
    const problem = toProblemDetails(error);

    expect(problem).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'No user 42',
      code: 'USER_NOT_FOUND',
    });
  });

  it('title is the HTTP status reason phrase, not the error message', () => {
    const a = toProblemDetails(new ConflictError('Email foo@example.com already registered'));
    const b = toProblemDetails(new ConflictError('Username already taken'));

    expect(a.title).toBe('Conflict');
    expect(b.title).toBe('Conflict');
    expect(a.title).toBe(b.title);
    expect(a.detail).not.toBe(b.detail);
  });

  it('omits details when the error has none', () => {
    const problem = toProblemDetails(new NotFoundError('No user 42'));
    expect(problem).not.toHaveProperty('details');
  });

  it('includes details verbatim when present', () => {
    const problem = toProblemDetails(
      new ValidationError('Invalid email', { details: { field: 'email' } }),
    );
    expect(problem.details).toEqual({ field: 'email' });
  });

  it('omits instance by default and includes it when supplied', () => {
    const withoutInstance = toProblemDetails(new NotFoundError('No user 42'));
    expect(withoutInstance).not.toHaveProperty('instance');

    const withInstance = toProblemDetails(new NotFoundError('No user 42'), {
      instance: '/users/42',
    });
    expect(withInstance.instance).toBe('/users/42');
  });

  it('builds type from typeBaseUrl, kebab-casing the code', () => {
    const problem = toProblemDetails(new NotFoundError('No user 42', { code: 'USER_NOT_FOUND' }), {
      typeBaseUrl: 'https://errors.example.com/docs',
    });
    expect(problem.type).toBe('https://errors.example.com/docs/user-not-found');
  });

  it('tolerates a trailing slash on typeBaseUrl', () => {
    const problem = toProblemDetails(new NotFoundError('No user 42', { code: 'USER_NOT_FOUND' }), {
      typeBaseUrl: 'https://errors.example.com/docs/',
    });
    expect(problem.type).toBe('https://errors.example.com/docs/user-not-found');
  });

  it('normalizes a non-AppError without leaking its message', () => {
    const problem = toProblemDetails(new Error('ECONNREFUSED 10.0.0.5:5432'));
    expect(problem.status).toBe(500);
    expect(problem.code).toBe('INTERNAL_ERROR');
    expect(problem.detail).not.toContain('10.0.0.5');
  });

  it('never spreads AppError.toJSON() — an added core field does not silently appear here', () => {
    const error = new NotFoundError('No user 42', { code: 'USER_NOT_FOUND' });
    const problem = toProblemDetails(error);
    const serialized = error.toJSON();

    // toJSON's own keys (name, code, message, httpStatus) are a different
    // shape entirely — this is the regression guard on "map explicitly,
    // never spread" (core's S7 decision 2, consequence for this package).
    expect(problem).not.toHaveProperty('name');
    expect(serialized.name).toBe('NotFoundError');
    expect(problem).not.toHaveProperty('message');
  });
});
