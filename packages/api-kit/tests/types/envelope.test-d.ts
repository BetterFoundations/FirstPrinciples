import type { AppError, NotFoundError, Result } from '@firstprinciples/core';
import { describe, expectTypeOf, it } from 'vitest';
import {
  envelopeFromResult,
  type ApiEnvelope,
  type ErrorEnvelope,
  type SuccessEnvelope,
} from '../../src/envelope.js';

describe('ApiEnvelope type-level behavior', () => {
  it('narrows on the success discriminant', () => {
    const envelope = {} as ApiEnvelope<{ id: string }>;
    if (envelope.success) {
      expectTypeOf(envelope).toEqualTypeOf<SuccessEnvelope<{ id: string }>>();
      expectTypeOf(envelope.data).toEqualTypeOf<{ id: string }>();
    } else {
      expectTypeOf(envelope).toEqualTypeOf<ErrorEnvelope>();
    }
  });

  it('envelopeFromResult stays generic over T and widens the error branch to AppError', () => {
    const result = {} as Result<{ id: string }, NotFoundError>;
    const envelope = envelopeFromResult(result);
    expectTypeOf(envelope).toEqualTypeOf<ApiEnvelope<{ id: string }>>();
  });

  it('the error branch carries a ProblemDetails, not a raw AppError', () => {
    const envelope = {} as ErrorEnvelope;
    expectTypeOf(envelope.error.status).toEqualTypeOf<number>();
    expectTypeOf(envelope.error.code).toEqualTypeOf<string>();
    // @ts-expect-error — ErrorEnvelope.error is ProblemDetails, not AppError
    expectTypeOf(envelope.error).toEqualTypeOf<AppError>();
  });
});
