import { err, NotFoundError, ok } from '@firstprinciples/core';
import { describe, expect, it } from 'vitest';
import { envelopeFromResult, toErrorEnvelope, toSuccessEnvelope } from '../../src/envelope.js';

describe('toSuccessEnvelope', () => {
  it('wraps data in a success envelope', () => {
    expect(toSuccessEnvelope({ id: '42' })).toEqual({ success: true, data: { id: '42' } });
  });
});

describe('toErrorEnvelope', () => {
  it('wraps a mapped AppError in an error envelope', () => {
    const envelope = toErrorEnvelope(new NotFoundError('No user 42', { code: 'USER_NOT_FOUND' }));
    expect(envelope.success).toBe(false);
    expect(envelope.error.status).toBe(404);
    expect(envelope.error.code).toBe('USER_NOT_FOUND');
  });
});

describe('envelopeFromResult', () => {
  it('builds a SuccessEnvelope from Ok', () => {
    const envelope = envelopeFromResult(ok({ id: '42' }));
    expect(envelope).toEqual({ success: true, data: { id: '42' } });
  });

  it('builds an ErrorEnvelope from Err', () => {
    const envelope = envelopeFromResult(err(new NotFoundError('No user 42')));
    expect(envelope.success).toBe(false);
    if (envelope.success) throw new Error('unreachable');
    expect(envelope.error.status).toBe(404);
  });

  it('narrows correctly in both branches, matching core Result narrowing', () => {
    const results = [ok(1), err(new NotFoundError('nope'))] as const;
    for (const result of results) {
      const envelope = envelopeFromResult(result);
      if (envelope.success) {
        expect(typeof envelope.data).toBe('number');
      } else {
        expect(envelope.error.status).toBe(404);
      }
    }
  });
});
