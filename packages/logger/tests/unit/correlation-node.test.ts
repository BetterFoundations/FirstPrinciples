import { describe, expect, it } from 'vitest';
import {
  generateCorrelationId,
  getCorrelationId,
  runWithCorrelationId,
} from '../../src/internal/correlation-node.js';

describe('correlation-node', () => {
  it('has no active correlation ID outside any run', () => {
    expect(getCorrelationId()).toBeUndefined();
  });

  it('exposes the ID for the duration of a synchronous run', () => {
    const seen = runWithCorrelationId('abc', () => getCorrelationId());
    expect(seen).toBe('abc');
    expect(getCorrelationId()).toBeUndefined();
  });

  it('generates a fresh UUID each call', () => {
    const a = generateCorrelationId();
    const b = generateCorrelationId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
