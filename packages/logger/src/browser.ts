/**
 * `@firstprinciples/logger` — browser entry. No pino, no Node built-ins:
 * writes to the platform `console` and tracks correlation IDs with a
 * best-effort module variable (see {@link "./internal/correlation-browser.js"}
 * for the exact guarantees, which are weaker than the Node entry's
 * `AsyncLocalStorage`). Resolved automatically by bundlers that honour the
 * `browser` export condition (Vite, webpack, etc.); Node itself never sees
 * this file.
 */
import {
  getCorrelationId,
  runWithCorrelationId,
  generateCorrelationId,
} from './internal/correlation-browser.js';
import { createLoggerCore } from './internal/core.js';
import { createConsoleTransport } from './internal/console-transport.js';
import type { Logger, LoggerOptions } from './internal/types.js';

export function createLogger(options: LoggerOptions = {}): Logger {
  return createLoggerCore(options, {
    getCorrelationId,
    createDefaultTransport: () => createConsoleTransport(),
  });
}

export { runWithCorrelationId, getCorrelationId, generateCorrelationId, createConsoleTransport };

export type {
  LogLevel,
  LogFields,
  LogEntry,
  Logger,
  LoggerOptions,
  RedactionOptions,
  Transport,
} from './internal/types.js';
