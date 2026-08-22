import { ValidationError } from '@firstprinciples/core';
import { describe, expect, it } from 'vitest';
import { interpolatePath, joinUrl } from '../../src/internal/path.js';

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
