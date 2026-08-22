import type { LogEntry, LogLevel, Transport } from './types.js';

const CONSOLE_METHOD: Record<LogLevel, 'trace' | 'debug' | 'info' | 'warn' | 'error'> = {
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'error',
};

/**
 * A {@link Transport} that writes to the platform `console`. Used as the
 * default transport in the browser, and available on Node for local
 * development without pino's JSON output.
 */
export function createConsoleTransport(
  target: Pick<Console, 'trace' | 'debug' | 'info' | 'warn' | 'error'> = console,
): Transport {
  return {
    name: 'console',
    write(entry: LogEntry) {
      const prefix = `[${entry.time}] ${entry.level.toUpperCase()}${entry.correlationId ? ` (${entry.correlationId})` : ''}:`;
      const method = target[CONSOLE_METHOD[entry.level]];
      if (Object.keys(entry.fields).length > 0) {
        method(prefix, entry.msg, entry.fields);
      } else {
        method(prefix, entry.msg);
      }
    },
  };
}
