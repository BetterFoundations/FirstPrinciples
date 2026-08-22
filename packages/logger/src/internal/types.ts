/** Severity, ordered low to high. Matches pino's level names on Node. */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/** Arbitrary structured data attached to a log call. */
export type LogFields = Record<string, unknown>;

/** A single log call, fully assembled: redacted fields, resolved level/time/correlation. */
export interface LogEntry {
  readonly level: LogLevel;
  readonly msg: string;
  readonly time: string;
  readonly correlationId: string | undefined;
  readonly fields: LogFields;
}

/**
 * A pluggable log sink. `write` receives an already-redacted {@link LogEntry} —
 * a transport never sees raw field values, so redaction survives even a
 * transport that does its own serialization.
 */
export interface Transport {
  readonly name: string;
  write(entry: LogEntry): void;
}

export interface RedactionOptions {
  /**
   * Case-insensitive substrings matched against object keys (after stripping
   * non-alphanumerics), in addition to the built-in list. A key match redacts
   * the whole value at that key without inspecting it further.
   */
  readonly keyFragments?: readonly string[];
  /** Additional value-shape patterns, checked against every string leaf in addition to the built-ins. */
  readonly patterns?: readonly RegExp[];
  /** Replaces a redacted value. Default `'[REDACTED]'`. */
  readonly replacement?: string;
  /** Recursion guard for pathological nesting. Default `20`. */
  readonly maxDepth?: number;
}

export interface LoggerOptions {
  /** Calls below this level are dropped before redaction/formatting. Default `'info'`. */
  readonly level?: LogLevel;
  /** Logger name, attached to every entry. */
  readonly name?: string;
  /** Static fields merged into every entry from this logger (and its children). */
  readonly base?: LogFields;
  /** `false` disables redaction entirely. Omit for the default (built-in keys + patterns). */
  readonly redaction?: RedactionOptions | false;
  /** Replaces the default transport. Omit to use the environment's default (pino on Node, console in the browser). */
  readonly transports?: readonly Transport[];
}

export interface Logger {
  /**
   * Logs `msg` at this method's level, with `fields` merged onto the
   * logger's base fields and redacted before any transport sees them. A
   * no-op if this level is below the logger's configured `level`.
   */
  trace(msg: string, fields?: LogFields): void;
  /** @see {@link Logger.trace} */
  debug(msg: string, fields?: LogFields): void;
  /** @see {@link Logger.trace} */
  info(msg: string, fields?: LogFields): void;
  /** @see {@link Logger.trace} */
  warn(msg: string, fields?: LogFields): void;
  /** @see {@link Logger.trace} */
  error(msg: string, fields?: LogFields): void;
  /** @see {@link Logger.trace} */
  fatal(msg: string, fields?: LogFields): void;
  /** A new logger with `bindings` merged into (and overriding) this logger's base fields. Shares transports, level and redaction config. */
  child(bindings: LogFields): Logger;
}
