import { isEnabled } from './levels.js';
import { redactFields } from './redact.js';
import type { LogEntry, LogFields, Logger, LoggerOptions, LogLevel, Transport } from './types.js';

export interface CoreDeps {
  getCorrelationId(): string | undefined;
  createDefaultTransport(name: string | undefined): Transport;
}

/**
 * Environment-agnostic logger implementation. Node and browser entry points
 * each supply their own {@link CoreDeps} (default transport, correlation
 * source) and share everything else: level filtering, redaction, base-field
 * merging and `child()`.
 */
export function createLoggerCore(options: LoggerOptions, deps: CoreDeps): Logger {
  const level = options.level ?? 'info';
  const base = options.base ?? {};
  const transports = options.transports ?? [deps.createDefaultTransport(options.name)];

  function log(logLevel: LogLevel, msg: string, fields?: LogFields): void {
    if (!isEnabled(logLevel, level)) return;
    const merged = fields ? { ...base, ...fields } : base;
    const entry: LogEntry = {
      level: logLevel,
      msg,
      time: new Date().toISOString(),
      correlationId: deps.getCorrelationId(),
      fields: redactFields(merged, options.redaction),
    };
    for (const transport of transports) transport.write(entry);
  }

  return {
    trace: (msg, fields) => log('trace', msg, fields),
    debug: (msg, fields) => log('debug', msg, fields),
    info: (msg, fields) => log('info', msg, fields),
    warn: (msg, fields) => log('warn', msg, fields),
    error: (msg, fields) => log('error', msg, fields),
    fatal: (msg, fields) => log('fatal', msg, fields),
    child(bindings: LogFields): Logger {
      return createLoggerCore({ ...options, base: { ...base, ...bindings }, transports }, deps);
    },
  };
}
