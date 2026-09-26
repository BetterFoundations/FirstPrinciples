import { describe, expect, it } from 'vitest';
import { AppError, ForbiddenError, isAppError } from '@firstprinciples/core';
import { createAccessControl, definePolicy, PermissionDeniedError } from '../../src/index.js';

const policy = definePolicy({
  actions: ['delete'],
  subjects: ['post'],
  rules: [
    {
      id: 'locked',
      effect: 'deny',
      actions: ['delete'],
      subjects: ['post'],
      when: { path: 'resource.locked', op: 'eq', value: true },
    },
  ],
});
const permissions = createAccessControl(policy).for({ id: 'u1' });

function denial(): PermissionDeniedError {
  try {
    permissions.assertCan('delete', 'post', { resource: { locked: true } });
  } catch (error) {
    return error as PermissionDeniedError;
  }
  throw new Error('assertCan did not throw');
}

describe('PermissionDeniedError sits in core’s taxonomy', () => {
  const error = denial();

  it('is a ForbiddenError and an AppError', () => {
    expect(error).toBeInstanceOf(PermissionDeniedError);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).toBeInstanceOf(AppError);
    expect(isAppError(error)).toBe(true);
  });

  it('keeps the inherited taxonomy slot but carries its own name', () => {
    expect(error.kind).toBe('ForbiddenError');
    expect(error.name).toBe('PermissionDeniedError');
  });

  it('carries the right code and status for HTTP', () => {
    expect(error.code).toBe('PERMISSION_DENIED');
    expect(error.httpStatus).toBe(403);
  });

  it('names the action and subject in its message', () => {
    expect(error.message).toBe("Permission denied: 'delete' on 'post'.");
  });
});

describe('what it does and does not put on the wire', () => {
  const error = denial();

  it('carries the reason and rule id as instance fields, for the server', () => {
    expect(error.reason).toBe('explicit_deny');
    expect(error.ruleId).toBe('locked');
    expect(error.action).toBe('delete');
    expect(error.subject).toBe('post');
  });

  it('serializes only what the caller already told us', () => {
    const json = error.toJSON();
    expect(json.details).toEqual({ action: 'delete', subject: 'post' });
    // Which rule refused, and whether it refused outright or because a
    // resource could not be loaded, is policy shape — not owed to
    // whoever was just refused.
    expect(JSON.stringify(json)).not.toContain('explicit_deny');
    expect(JSON.stringify(json)).not.toContain('locked');
  });

  it('survives a JSON round-trip as a ForbiddenError', () => {
    const restored = AppError.fromJSON(JSON.parse(JSON.stringify(error.toJSON())) as unknown);
    expect(restored.ok).toBe(true);
  });

  it('reports the unresolved reason without leaking it either', () => {
    let unresolved: PermissionDeniedError | undefined;
    try {
      permissions.assertCan('delete', 'post');
    } catch (error_) {
      unresolved = error_ as PermissionDeniedError;
    }
    expect(unresolved?.reason).toBe('unresolved_deny');
    expect(unresolved?.toJSON().details).toEqual({ action: 'delete', subject: 'post' });
  });
});
