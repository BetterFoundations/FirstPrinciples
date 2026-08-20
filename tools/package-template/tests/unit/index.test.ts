import { describe, expect, it } from 'vitest';
import { placeholder } from '../../src/index.js';

describe('placeholder', () => {
  it('returns the package name placeholder', () => {
    expect(placeholder()).toBe('PACKAGE_NAME');
  });
});
