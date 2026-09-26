import { createLogger } from '@firstprinciples/logger';
import { err, ok, type Result } from '@firstprinciples/core';
import { EnvValidationError, type EnvIssue } from './errors.js';
import type { DiagnosticsLogger } from './types.js';

/**
 * How to read and validate one environment variable. Build one with
 * {@link envVar}, then refine it with {@link EnvVar.optional} or
 * {@link EnvVar.default}.
 *
 * @public
 */
export interface EnvVar<T> {
  /** Turns the raw, non-empty string into `T`. Throws to reject it. */
  readonly parse: (raw: string) => T;
  /** Unset (or empty) resolves to `undefined` instead of an issue. */
  readonly isOptional: boolean;
  /** Unset (or empty) resolves to {@link EnvVar.defaultValue} instead of an issue. */
  readonly hasDefault: boolean;
  readonly defaultValue: T | undefined;
  /** The same variable, but allowed to be unset: resolves to `undefined`. */
  optional(): EnvVar<T | undefined>;
  /** The same variable, falling back to `value` when unset. `value` is not re-parsed. */
  default(value: T): EnvVar<T>;
}

/**
 * A record of variable name → {@link EnvVar}.
 *
 * @public
 */
export type EnvSpec = Readonly<Record<string, EnvVar<unknown>>>;

/**
 * The validated, typed environment a spec describes.
 *
 * @public
 */
export type EnvOf<S extends EnvSpec> = {
  readonly [K in keyof S]: S[K] extends EnvVar<infer T> ? T : never;
};

/**
 * Where variables are read from. `process.env`, or a plain object in tests.
 *
 * @public
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

function makeVar<T>(
  parse: (raw: string) => T,
  flags: { isOptional: boolean; hasDefault: boolean; defaultValue: T | undefined },
): EnvVar<T> {
  return {
    parse,
    ...flags,
    optional: () =>
      makeVar<T | undefined>(parse, {
        isOptional: true,
        hasDefault: flags.hasDefault,
        defaultValue: flags.defaultValue,
      }),
    default: (value: T) =>
      makeVar(parse, { isOptional: flags.isOptional, hasDefault: true, defaultValue: value }),
  };
}

function required<T>(parse: (raw: string) => T): EnvVar<T> {
  return makeVar(parse, { isOptional: false, hasDefault: false, defaultValue: undefined });
}

// A strict decimal literal. `Number()` alone would accept `0x1F`, `0b1`,
// `Infinity`, and a whitespace-only string (as 0). Every quantifier here is
// separated by a required literal (`.` or `e`), so no digit run can be
// split two ways — linear time on any input, not just valid ones. The
// plugin's heuristic flags any quantifier nested in an optional group;
// `tests/edge-cases/env-adversarial.test.ts` times a pathological input.
// eslint-disable-next-line security/detect-unsafe-regex -- linear, see above
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

const TRUE_WORDS = new Set(['true', '1', 'yes', 'on']);
const FALSE_WORDS = new Set(['false', '0', 'no', 'off']);

/** Options for {@link envVar}.number. */
export interface NumberOptions {
  readonly min?: number;
  readonly max?: number;
  /** Reject fractional values. */
  readonly integer?: boolean;
}

/** Options for {@link envVar}.url. */
export interface UrlOptions {
  /** Allowed schemes, with or without the trailing colon: `['postgres', 'postgresql']`. */
  readonly protocols?: readonly string[];
}

function parseNumber(raw: string, options: NumberOptions): number {
  const value = Number(raw);
  if (!DECIMAL.test(raw.trim()) || !Number.isFinite(value)) {
    throw new Error('must be a number');
  }
  if (options.integer === true && !Number.isInteger(value)) {
    throw new Error('must be an integer');
  }
  if (options.min !== undefined && value < options.min) {
    throw new Error(`must be at least ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new Error(`must be at most ${options.max}`);
  }
  return value;
}

/**
 * Built-in {@link EnvVar} factories. Every built-in rejects without echoing
 * the rejected value back — an env value is as likely to be a secret as not.
 *
 * @example
 * ```ts
 * const spec = {
 *   PORT: envVar.port().default(3000),
 *   DATABASE_URL: envVar.url({ protocols: ['postgres', 'postgresql'] }),
 *   LOG_LEVEL: envVar.enum(['debug', 'info', 'warn']).default('info'),
 *   SENTRY_DSN: envVar.string().optional(),
 * };
 * ```
 *
 * @public
 */
export const envVar = {
  /** Any non-empty string, unchanged. */
  string: (): EnvVar<string> => required((raw) => raw),

  /** A finite decimal number, optionally bounded or integer-only. */
  number: (options: NumberOptions = {}): EnvVar<number> =>
    required((raw) => parseNumber(raw, options)),

  /** An integer from 0 to 65535. 0 is allowed: it asks the OS for a free port. */
  port: (): EnvVar<number> =>
    required((raw) => {
      try {
        return parseNumber(raw, { integer: true, min: 0, max: 65535 });
      } catch {
        throw new Error('must be an integer from 0 to 65535');
      }
    }),

  /** `true`/`false`, `1`/`0`, `yes`/`no`, `on`/`off`, case-insensitively. Anything else is rejected, not coerced. */
  boolean: (): EnvVar<boolean> =>
    required((raw) => {
      const word = raw.trim().toLowerCase();
      if (TRUE_WORDS.has(word)) return true;
      if (FALSE_WORDS.has(word)) return false;
      throw new Error('must be one of true, false, 1, 0, yes, no, on, off');
    }),

  /** An absolute URL, returned as the original string. */
  url: (options: UrlOptions = {}): EnvVar<string> =>
    required((raw) => {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        throw new Error('must be an absolute URL');
      }
      const allowed = options.protocols?.map((p) => (p.endsWith(':') ? p : `${p}:`).toLowerCase());
      if (allowed !== undefined && !allowed.includes(url.protocol)) {
        throw new Error(`must use one of these schemes: ${allowed.join(', ')}`);
      }
      return raw;
    }),

  /** One of a fixed set of strings, narrowed to their union. */
  enum: <const V extends readonly [string, ...string[]]>(values: V): EnvVar<V[number]> =>
    required((raw) => {
      if (!(values as readonly string[]).includes(raw)) {
        throw new Error(`must be one of: ${values.join(', ')}`);
      }
      return raw as V[number];
    }),

  /**
   * Bring your own parser — a Zod/Valibot `parse`, or anything that throws
   * on bad input. Its error message is reported verbatim, so make sure it
   * does not include the value if the value could be a secret.
   */
  custom: <T>(parse: (raw: string) => T): EnvVar<T> => required(parse),
} as const;

function describeFailure(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message;
  return 'is invalid';
}

/** Own-property read, so a variable name like `constructor` never resolves to something inherited. */
function readRaw(source: EnvSource, variable: string): string | undefined {
  // eslint-disable-next-line security/detect-object-injection -- guarded by the own-property check
  return Object.prototype.hasOwnProperty.call(source, variable) ? source[variable] : undefined;
}

interface Evaluation {
  readonly entries: readonly [string, unknown][];
  readonly issues: readonly EnvIssue[];
  readonly defaulted: readonly string[];
}

function evaluate(spec: EnvSpec, source: EnvSource): Evaluation {
  const issues: EnvIssue[] = [];
  const entries: [string, unknown][] = [];
  const defaulted: string[] = [];

  for (const [variable, definition] of Object.entries(spec)) {
    const raw = readRaw(source, variable);

    if (raw === undefined || raw === '') {
      if (definition.hasDefault) {
        entries.push([variable, definition.defaultValue]);
        defaulted.push(variable);
      } else if (definition.isOptional) {
        entries.push([variable, undefined]);
      } else {
        issues.push({ variable, problem: 'missing', message: 'is required but not set' });
      }
      continue;
    }

    try {
      entries.push([variable, definition.parse(raw)]);
    } catch (error) {
      issues.push({ variable, problem: 'invalid', message: describeFailure(error) });
    }
  }
  return { entries, issues, defaulted };
}

/**
 * Reads and validates every variable in `spec` from `source`, collecting
 * **all** issues rather than stopping at the first.
 *
 * @remarks
 * An empty string counts as unset — `DATABASE_URL=` in a `.env` file is
 * almost always a mistake, not a deliberate empty value. Only the spec's
 * own keys are read; the returned object has exactly those keys and is
 * frozen. Never throws.
 *
 * @param spec - What to read. See {@link envVar}.
 * @param source - Defaults to `process.env`.
 *
 * @public
 */
export function loadEnv<S extends EnvSpec>(
  spec: S,
  source: EnvSource = process.env,
): Result<EnvOf<S>, EnvValidationError> {
  const { entries, issues } = evaluate(spec, source);
  if (issues.length > 0) return err(new EnvValidationError(issues));
  // fromEntries defines own data properties, so a `__proto__` key in the
  // spec lands as a key, never as the object's prototype.
  return ok(Object.freeze(Object.fromEntries(entries)) as EnvOf<S>);
}

/**
 * Options for {@link requireEnv}.
 *
 * @public
 */
export interface RequireEnvOptions {
  /** Defaults to `process.env`. */
  readonly source?: EnvSource;
  /** Where the outcome is logged. Defaults to a `@firstprinciples/logger` logger named `bootstrap`. */
  readonly logger?: DiagnosticsLogger;
  /** Called with `1` on failure. Defaults to `process.exit`. */
  readonly exit?: (code: number) => void;
}

/**
 * {@link loadEnv}, for the top of a service's entry point: on failure, logs
 * every issue in one line and exits with code 1 — before anything has
 * bound a port or opened a connection.
 *
 * @remarks
 * On success, logs the variable names (never the values) and which of them
 * fell back to a default. If a test replaces `exit` with one that returns,
 * the {@link EnvValidationError} is thrown instead of returning a
 * half-valid environment.
 *
 * @public
 */
export function requireEnv<S extends EnvSpec>(spec: S, options: RequireEnvOptions = {}): EnvOf<S> {
  const logger = options.logger ?? createLogger({ name: 'bootstrap' });
  const { entries, issues, defaulted } = evaluate(spec, options.source ?? process.env);

  if (issues.length > 0) {
    const error = new EnvValidationError(issues);
    logger.error('environment validation failed', {
      issues: issues.map((issue) => `${issue.variable}: ${issue.message}`),
    });
    (options.exit ?? ((code: number) => process.exit(code)))(1);
    throw error;
  }

  logger.info('environment validated', { variables: Object.keys(spec), defaulted });
  return Object.freeze(Object.fromEntries(entries)) as EnvOf<S>;
}
