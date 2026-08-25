import { describe, expect, it } from 'vitest';
import { statusText } from '../../src/internal/status-text.js';

describe('statusText', () => {
  it('returns the standard reason phrase for a known status', () => {
    expect(statusText(404)).toBe('Not Found');
    expect(statusText(409)).toBe('Conflict');
    expect(statusText(500)).toBe('Internal Server Error');
    expect(statusText(503)).toBe('Service Unavailable');
  });

  it('falls back to a generic label for an unlisted status', () => {
    expect(statusText(599)).toBe('Error 599');
  });

  it('never returns undefined, even for a nonsensical status', () => {
    expect(statusText(0)).toBe('Error 0');
    expect(statusText(-1)).toBe('Error -1');
  });
});
