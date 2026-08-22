import { ValidationError } from '@firstprinciples/core';
import { describe, expect, it } from 'vitest';
import { interpolatePath, joinUrl, stripTrailingSlashes } from '../../src/internal/path.js';

describe('stripTrailingSlashes', () => {
  it('removes one trailing slash', () => {
    expect(stripTrailingSlashes('https://api.example.com/')).toBe('https://api.example.com');
  });

  it('removes many trailing slashes', () => {
    expect(stripTrailingSlashes('https://api.example.com///')).toBe('https://api.example.com');
  });

  it('leaves a string with no trailing slash untouched', () => {
    expect(stripTrailingSlashes('https://api.example.com')).toBe('https://api.example.com');
  });

  it('does not touch a slash that is not trailing', () => {
    expect(stripTrailingSlashes('https://api.example.com/v1/')).toBe('https://api.example.com/v1');
  });

  it('reduces an all-slash string to empty', () => {
    expect(stripTrailingSlashes('////')).toBe('');
  });

  it('leaves an empty string untouched', () => {
    expect(stripTrailingSlashes('')).toBe('');
  });

  it('runs in linear time on an adversarial input, unlike the /\\/+$/ regex it replaces', () => {
    // The regex this function replaced degrades polynomially on a long
    // string with no trailing slash at all — CodeQL flagged exactly this
    // ("Polynomial regular expression used on uncontrolled data") because
    // an unanchored-at-start quantifier gets retried at every position. A
    // plain backward scan can't exhibit that: this is the actual proof,
    // not just a claim in a comment.
    const adversarial = `${'a'.repeat(200_000)}b`; // no trailing slash at all
    const start = performance.now();
    const result = stripTrailingSlashes(adversarial);
    const elapsedMs = performance.now() - start;

    expect(result).toBe(adversarial);
    expect(elapsedMs).toBeLessThan(50);
  });
});

describe('joinUrl', () => {
  it('joins a base and a path with exactly one slash', () => {
    expect(joinUrl('https://api.example.com', '/users')).toBe('https://api.example.com/users');
  });

  it('strips a trailing slash from the base', () => {
    expect(joinUrl('https://api.example.com/', '/users')).toBe('https://api.example.com/users');
  });

  it('strips multiple trailing slashes from the base', () => {
    expect(joinUrl('https://api.example.com///', '/users')).toBe('https://api.example.com/users');
  });

  it('adds a leading slash to a path missing one', () => {
    expect(joinUrl('https://api.example.com', 'users')).toBe('https://api.example.com/users');
  });
});

describe('interpolatePath', () => {
  it('substitutes a single :param segment', () => {
    expect(interpolatePath('/users/:id', { id: '123' })).toBe('/users/123');
  });

  it('substitutes multiple :param segments', () => {
    expect(interpolatePath('/orgs/:orgId/users/:userId', { orgId: 'a', userId: 'b' })).toBe(
      '/orgs/a/users/b',
    );
  });

  it('leaves a path with no params untouched', () => {
    expect(interpolatePath('/users', {})).toBe('/users');
    expect(interpolatePath('/users')).toBe('/users');
  });

  it('coerces a numeric param to a string', () => {
    expect(interpolatePath('/users/:id', { id: 123 })).toBe('/users/123');
  });

  it('percent-encodes a param value', () => {
    expect(interpolatePath('/search/:query', { query: 'a b/c' })).toBe('/search/a%20b%2Fc');
  });

  it('throws a ValidationError when a required param is missing', () => {
    expect(() => interpolatePath('/users/:id', {})).toThrow(ValidationError);
  });

  it('the thrown ValidationError names the missing param', () => {
    try {
      interpolatePath('/users/:id', {});
      throw new Error('expected interpolatePath to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details).toEqual({ path: '/users/:id', param: 'id' });
    }
  });
});
