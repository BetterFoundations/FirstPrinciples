import type { JobLike } from '../../src/internal/shared.js';
import type { QueueLogger } from '../../src/index.js';

export function fakeJob(overrides: Partial<JobLike> & { name: string }): JobLike {
  return {
    id: '1',
    data: {},
    attemptsMade: 0,
    timestamp: 1_000,
    processedOn: 1_250,
    opts: { attempts: 3 },
    ...overrides,
  };
}

export function recordingLogger(): QueueLogger & {
  lines: { level: string; msg: string; fields?: Record<string, unknown> }[];
} {
  const lines: { level: string; msg: string; fields?: Record<string, unknown> }[] = [];
  return {
    lines,
    warn: (msg, fields) => void lines.push({ level: 'warn', msg, ...(fields ? { fields } : {}) }),
    error: (msg, fields) => void lines.push({ level: 'error', msg, ...(fields ? { fields } : {}) }),
  };
}
