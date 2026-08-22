import type { LogLevel } from './types.js';

const ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export function isEnabled(level: LogLevel, threshold: LogLevel): boolean {
  // False positive: `level`/`threshold` are typed LogLevel, a closed
  // string-literal union — never an arbitrary runtime string — so this can't
  // be an injection sink.
  // eslint-disable-next-line security/detect-object-injection
  return ORDER[level] >= ORDER[threshold];
}
