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
import { toProblemDetails } from '../../src/problem-details.js';

/**
 * Every built-in `@firstprinciples/core` error class must map to a
 * problem-details object whose `status` matches the class's own
 * `httpStatus` default and whose `title` is that status's reason phrase —
 * not tested one-off per class, but exhaustively over the whole taxonomy,
 * so a future core class added to `ERROR_CONSTRUCTORS` without a matching
 * case here fails loudly instead of silently falling through to a generic
 * mapping.
 */
const TAXONOMY = [
  {
    Ctor: AppError,
    defaultStatus: 500,
    defaultCode: 'INTERNAL_ERROR',
    title: 'Internal Server Error',
  },
  {
    Ctor: ValidationError,
    defaultStatus: 400,
    defaultCode: 'VALIDATION_ERROR',
    title: 'Bad Request',
  },
  { Ctor: NotFoundError, defaultStatus: 404, defaultCode: 'NOT_FOUND', title: 'Not Found' },
  { Ctor: ForbiddenError, defaultStatus: 403, defaultCode: 'FORBIDDEN', title: 'Forbidden' },
  {
    Ctor: UnauthorizedError,
    defaultStatus: 401,
    defaultCode: 'UNAUTHORIZED',
    title: 'Unauthorized',
  },
  { Ctor: ConflictError, defaultStatus: 409, defaultCode: 'CONFLICT', title: 'Conflict' },
  {
    Ctor: NetworkError,
    defaultStatus: 503,
    defaultCode: 'NETWORK_ERROR',
    title: 'Service Unavailable',
  },
] as const;

describe('every core error class maps correctly to RFC 7807 problem details', () => {
  it.each(TAXONOMY)(
    '$Ctor.name → status $defaultStatus, title "$title"',
    ({ Ctor, defaultStatus, defaultCode, title }) => {
      const error = new Ctor('occurrence-specific message');
      const problem = toProblemDetails(error);

      expect(problem.status).toBe(defaultStatus);
      expect(problem.code).toBe(defaultCode);
      expect(problem.title).toBe(title);
      expect(problem.detail).toBe('occurrence-specific message');
      expect(problem.type).toBe('about:blank');
    },
  );

  it('an overridden code/httpStatus is reflected, not the class default', () => {
    const error = new NotFoundError('No order 7', {
      code: 'ORDER_NOT_FOUND',
      httpStatus: 410, // Gone — a deliberate, non-default choice
    });
    const problem = toProblemDetails(error);

    expect(problem.status).toBe(410);
    expect(problem.title).toBe('Gone');
    expect(problem.code).toBe('ORDER_NOT_FOUND');
  });

  it('a subclass with a code containing multiple underscores kebab-cases cleanly for type', () => {
    const error = new ValidationError('Invalid input', { code: 'FIELD_TOO_LONG_MAX_255' });
    const problem = toProblemDetails(error, { typeBaseUrl: 'https://errors.example.com' });
    expect(problem.type).toBe('https://errors.example.com/field-too-long-max-255');
  });
});
