/**
 * `@firstprinciples/logger` — Node entry. Wraps pino for structured JSON
 * output and uses `AsyncLocalStorage` for correlation IDs. Bundlers resolving
 * the `browser` export condition get {@link "./browser.js"} instead, which
 * pulls in neither pino nor any Node built-in.
 */
import {
  getCorrelationId,
  runWithCorrelationId,
  generateCorrelationId,
} from './internal/correlation-node.js';
import { createLoggerCore } from './internal/core.js';
import { createPinoTransport } from './internal/pino-transport.js';
import { createConsoleTransport } from './internal/console-transport.js';
import type { Logger, LoggerOptions } from './internal/types.js';

export function createLogger(options: LoggerOptions = {}): Logger {
  return createLoggerCore(options, {
    getCorrelationId,
    createDefaultTransport: createPinoTransport,
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
