import { describe, expect, it } from 'vitest';
import { isEnabled } from '../../src/internal/levels.js';
import type { LogLevel } from '../../src/internal/types.js';

const ORDER: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

describe('isEnabled', () => {
  it('is true when the level meets or exceeds the threshold', () => {
    for (let i = 0; i < ORDER.length; i++) {
      for (let j = 0; j < ORDER.length; j++) {
        // False positive: i/j are loop counters bounded by ORDER.length, not
        // externally-controlled input.
        // eslint-disable-next-line security/detect-object-injection
        expect(isEnabled(ORDER[i]!, ORDER[j]!)).toBe(i >= j);
      }
    }
  });
});
