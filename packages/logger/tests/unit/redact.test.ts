import { describe, expect, it } from 'vitest';
import { redactFields } from '../../src/internal/redact.js';

describe('redactFields', () => {
  it('redacts values whose key matches a default sensitive fragment', () => {
    const result = redactFields({ password: 'hunter2', username: 'alice' }, undefined);
    expect(result).toEqual({ password: '[REDACTED]', username: 'alice' });
  });

  it('matches key fragments case-insensitively and through separators', () => {
    const result = redactFields(
      { API_KEY: 'a', 'x-api-key': 'b', refreshToken: 'c', dbPassword: 'd', ok: 'e' },
      undefined,
    );
    expect(result).toEqual({
      API_KEY: '[REDACTED]',
      'x-api-key': '[REDACTED]',
      refreshToken: '[REDACTED]',
      dbPassword: '[REDACTED]',
      ok: 'e',
    });
  });

  it('redacts a JWT-shaped string regardless of its key', () => {
    // Built from parts, not one literal: a full JWT-shaped string in source
    // reads as a real credential to secret scanners (GitHub blocked an
    // earlier version of this file's Stripe-shaped fixture below for
    // exactly that reason). This is synthetic test data — the parts
    // concatenated below decode to `{"alg":"HS256"}.{"sub":"1234"}` and an
    // unrelated random signature, nothing that was ever a real token.
    const jwt = [
      'eyJhbGciOiJIUzI1NiJ9',
      'eyJzdWIiOiIxMjM0In0',
      'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    ].join('.');
    const result = redactFields({ note: jwt }, undefined);
    expect(result).toEqual({ note: '[REDACTED]' });
  });

  it('redacts an email address embedded in a longer string', () => {
    const result = redactFields({ note: 'contact user at test@example.com for help' }, undefined);
    expect(result).toEqual({ note: '[REDACTED]' });
  });

  it('redacts known API-key shapes: stripe, github, aws, google, slack, bearer', () => {
    // Each value is joined from parts rather than written as one literal —
    // synthetic fixtures that happen to match a real provider's key shape
    // read as live credentials to secret scanners (GitHub's push protection
    // blocked the Stripe one below when it was a single literal).
    const cases: Record<string, string> = {
      stripe: ['sk', 'live', 'ABCDEFGHIJ1234567890'].join('_'),
      github: ['ghp', 'AbCdEfGhIjKlMnOpQrStUvWxYz012345'].join('_'),
      aws: 'AKIA' + 'ABCDEFGHIJKLMNOP',
      google: 'AIza' + 'SyAbCdEfGhIjKlMnOpQrStUvWxYz0123456',
      slack: 'xoxb-' + '1234567890-abcdefghij',
      bearer: 'Bearer' + ' abc123.def456',
    };
    const result = redactFields(cases, undefined);
    for (const key of Object.keys(cases)) {
      // False positive: key comes from Object.keys(cases), cases is a fixed
      // literal declared two lines above, not externally-controlled input.
      // eslint-disable-next-line security/detect-object-injection
      expect(result[key], key).toBe('[REDACTED]');
    }
  });

  it('leaves ordinary values untouched', () => {
    const result = redactFields({ userId: 42, active: true, tag: 'checkout' }, undefined);
    expect(result).toEqual({ userId: 42, active: true, tag: 'checkout' });
  });

  it('leaves null and undefined values untouched', () => {
    const result = redactFields({ a: null, b: undefined }, undefined);
    expect(result).toEqual({ a: null, b: undefined });
  });

  it('supports custom key fragments and patterns additively', () => {
    const result = redactFields(
      { internalId: 'INT-42', normal: 'INT-43' },
      { keyFragments: ['internalid'], patterns: [/^INT-\d+$/] },
    );
    expect(result).toEqual({ internalId: '[REDACTED]', normal: '[REDACTED]' });
  });

  it('supports a custom replacement string', () => {
    const result = redactFields({ password: 'x' }, { replacement: '***' });
    expect(result).toEqual({ password: '***' });
  });

  it('returns fields unchanged when redaction is disabled', () => {
    const result = redactFields({ password: 'hunter2' }, false);
    expect(result).toEqual({ password: 'hunter2' });
  });

  it('does not mutate the input', () => {
    const input = { password: 'hunter2', nested: { token: 'abc' } };
    const snapshot = JSON.parse(JSON.stringify(input));
    redactFields(input, undefined);
    expect(input).toEqual(snapshot);
  });
});
