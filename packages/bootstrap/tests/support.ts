import type { DiagnosticsLogger } from '../src/index.js';

export interface LogLine {
  readonly level: 'info' | 'warn' | 'error';
  readonly msg: string;
  readonly fields: Record<string, unknown> | undefined;
}

/** A logger that records every call, for asserting on diagnostics. */
export function recordingLogger(): DiagnosticsLogger & {
  readonly lines: LogLine[];
  messages(): string[];
} {
  const lines: LogLine[] = [];
  const record =
    (level: LogLine['level']) =>
    (msg: string, fields?: Record<string, unknown>): void => {
      lines.push({ level, msg, fields });
    };
  return {
    lines,
    messages: () => lines.map((line) => line.msg),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
  };
}

/** A promise plus the functions that settle it. */
export function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
