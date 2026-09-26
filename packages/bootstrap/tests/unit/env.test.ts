import { describe, expect, it, vi } from 'vitest';
import { isAppError, ValidationError } from '@firstprinciples/core';
import { envVar, EnvValidationError, loadEnv, requireEnv } from '../../src/index.js';
import { recordingLogger } from '../support.js';

describe('envVar built-ins', () => {
  it('string passes any non-empty value through unchanged', () => {
    expect(envVar.string().parse('  spaced  ')).toBe('  spaced  ');
  });

  it.each([
    ['42', 42],
    ['-3.5', -3.5],
    ['+7', 7],
    ['.5', 0.5],
    ['5.', 5],
    ['1e3', 1000],
    ['2.5E-2', 0.025],
    [' 12 ', 12],
  ])('number parses %j', (raw, expected) => {
    expect(envVar.number().parse(raw)).toBe(expected);
  });

  it.each([
    '0x1F',
    '0b101',
    'Infinity',
    '-Infinity',
    'NaN',
    '1_000',
    'abc',
    '1.2.3',
    '   ',
    'e5',
    '1e',
  ])('number rejects %j', (raw) => {
    expect(() => envVar.number().parse(raw)).toThrow('must be a number');
  });

  it('number enforces integer, min and max', () => {
    expect(() => envVar.number({ integer: true }).parse('1.5')).toThrow('must be an integer');
    expect(() => envVar.number({ min: 10 }).parse('9')).toThrow('must be at least 10');
    expect(() => envVar.number({ max: 10 }).parse('11')).toThrow('must be at most 10');
    expect(envVar.number({ min: 10, max: 10, integer: true }).parse('10')).toBe(10);
  });

  it('number rejects a value too large to be finite', () => {
    expect(() => envVar.number().parse('1e999')).toThrow('must be a number');
  });

  it.each([
    ['0', 0],
    ['80', 80],
    ['65535', 65535],
  ])('port accepts %j', (raw, expected) => {
    expect(envVar.port().parse(raw)).toBe(expected);
  });

  it.each(['-1', '65536', '80.5', 'http', ''])('port rejects %j with one message', (raw) => {
    expect(() => envVar.port().parse(raw)).toThrow('must be an integer from 0 to 65535');
  });

  it.each([
    ['true', true],
    ['TRUE', true],
    ['1', true],
    ['yes', true],
    ['On', true],
    ['false', false],
    ['0', false],
    ['no', false],
    [' off ', false],
  ])('boolean parses %j', (raw, expected) => {
    expect(envVar.boolean().parse(raw)).toBe(expected);
  });

  it.each(['2', 'y', 'enabled', 'truthy'])('boolean rejects %j rather than coercing it', (raw) => {
    expect(() => envVar.boolean().parse(raw)).toThrow('must be one of true, false');
  });

  it('url accepts an absolute URL and returns the original string', () => {
    expect(envVar.url().parse('postgres://u:p@db:5432/app')).toBe('postgres://u:p@db:5432/app');
  });

  it('url rejects a relative or malformed value', () => {
    expect(() => envVar.url().parse('/relative')).toThrow('must be an absolute URL');
    expect(() => envVar.url().parse('not a url')).toThrow('must be an absolute URL');
  });

  it('url restricts schemes, with or without the trailing colon', () => {
    const spec = envVar.url({ protocols: ['postgres', 'postgresql:'] });
    expect(spec.parse('postgresql://db/app')).toBe('postgresql://db/app');
    expect(() => spec.parse('mysql://db/app')).toThrow(
      'must use one of these schemes: postgres:, postgresql:',
    );
  });

  it('url scheme matching is case-insensitive', () => {
    expect(envVar.url({ protocols: ['HTTPS'] }).parse('https://example.com')).toBe(
      'https://example.com',
    );
  });

  it('enum accepts only the listed values, case-sensitively', () => {
    const spec = envVar.enum(['debug', 'info']);
    expect(spec.parse('info')).toBe('info');
    expect(() => spec.parse('INFO')).toThrow('must be one of: debug, info');
  });

  it('custom wraps any throwing parser', () => {
    const spec = envVar.custom((raw) => {
      if (!raw.startsWith('sk_')) throw new Error('must start with sk_');
      return raw.slice(3);
    });
    expect(spec.parse('sk_abc')).toBe('abc');
    expect(() => spec.parse('pk_abc')).toThrow('must start with sk_');
  });

  it('optional() and default() return new specs and leave the original unchanged', () => {
    const base = envVar.string();
    const optional = base.optional();
    const defaulted = base.default('x');
    expect(base.isOptional).toBe(false);
    expect(base.hasDefault).toBe(false);
    expect(optional.isOptional).toBe(true);
    expect(defaulted.hasDefault).toBe(true);
    expect(defaulted.defaultValue).toBe('x');
    expect(optional.default('y').isOptional).toBe(true);
    expect(defaulted.optional().defaultValue).toBe('x');
  });
});

describe('loadEnv', () => {
  const spec = {
    PORT: envVar.port().default(3000),
    DATABASE_URL: envVar.url(),
    LOG_LEVEL: envVar.enum(['debug', 'info', 'warn']).default('info'),
    SENTRY_DSN: envVar.string().optional(),
    FEATURE_X: envVar.boolean(),
  };

  it('returns a typed, frozen environment on success', () => {
    const result = loadEnv(spec, {
      DATABASE_URL: 'postgres://db/app',
      FEATURE_X: 'yes',
      PORT: '8080',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      PORT: 8080,
      DATABASE_URL: 'postgres://db/app',
      LOG_LEVEL: 'info',
      SENTRY_DSN: undefined,
      FEATURE_X: true,
    });
    expect(Object.isFrozen(result.value)).toBe(true);
  });

  it('reports EVERY missing and invalid variable at once, in spec order', () => {
    const result = loadEnv(spec, { PORT: 'eighty', LOG_LEVEL: 'verbose' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.issues).toEqual([
      { variable: 'PORT', problem: 'invalid', message: 'must be an integer from 0 to 65535' },
      { variable: 'DATABASE_URL', problem: 'missing', message: 'is required but not set' },
      { variable: 'LOG_LEVEL', problem: 'invalid', message: 'must be one of: debug, info, warn' },
      { variable: 'FEATURE_X', problem: 'missing', message: 'is required but not set' },
    ]);
    expect(result.error.message).toBe(
      'Invalid environment (4 problems) — PORT: must be an integer from 0 to 65535; DATABASE_URL: is required but not set; LOG_LEVEL: must be one of: debug, info, warn; FEATURE_X: is required but not set',
    );
  });

  it('uses the singular for one problem', () => {
    const result = loadEnv({ A: envVar.string() }, {});
    expect(!result.ok && result.error.message).toBe(
      'Invalid environment (1 problem) — A: is required but not set',
    );
  });

  it('treats an empty string as unset: default, then optional, then missing', () => {
    const result = loadEnv(
      { A: envVar.string().default('fallback'), B: envVar.string().optional(), C: envVar.string() },
      { A: '', B: '', C: '' },
    );
    expect(!result.ok && result.error.issues).toEqual([
      { variable: 'C', problem: 'missing', message: 'is required but not set' },
    ]);
    const ok = loadEnv(
      { A: envVar.string().default('fallback'), B: envVar.string().optional() },
      { A: '', B: '' },
    );
    expect(ok.ok && ok.value).toEqual({ A: 'fallback', B: undefined });
  });

  it('does not re-parse a default value', () => {
    const result = loadEnv({ N: envVar.number({ min: 100 }).default(1) }, {});
    expect(result.ok && result.value.N).toBe(1);
  });

  it('returns only the spec keys, never the rest of the environment', () => {
    const result = loadEnv({ A: envVar.string() }, { A: 'a', SECRET: 'shh' });
    expect(result.ok && Object.keys(result.value)).toEqual(['A']);
  });

  it('reads process.env by default', () => {
    vi.stubEnv('FP_BOOTSTRAP_TEST_VAR', 'from-process');
    try {
      const result = loadEnv({ FP_BOOTSTRAP_TEST_VAR: envVar.string() });
      expect(result.ok && result.value.FP_BOOTSTRAP_TEST_VAR).toBe('from-process');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('reports a custom parser that throws a non-Error, or an empty message, generically', () => {
    const result = loadEnv(
      {
        A: envVar.custom(() => {
          throw 'nope';
        }),
        B: envVar.custom(() => {
          throw new Error('');
        }),
      },
      { A: 'x', B: 'y' },
    );
    expect(!result.ok && result.error.issues.map((i) => i.message)).toEqual([
      'is invalid',
      'is invalid',
    ]);
  });
});

describe('EnvValidationError', () => {
  it('is a core ValidationError with a server-side status and the issues in details', () => {
    const error = new EnvValidationError([
      { variable: 'A', problem: 'missing', message: 'is required but not set' },
    ]);
    expect(error).toBeInstanceOf(ValidationError);
    expect(isAppError(error)).toBe(true);
    expect(error.kind).toBe('ValidationError');
    expect(error.name).toBe('EnvValidationError');
    expect(error.code).toBe('ENV_VALIDATION_ERROR');
    expect(error.httpStatus).toBe(500);
    expect(error.details).toEqual({ issues: error.issues });
  });

  it('lets every default be overridden', () => {
    const error = new EnvValidationError([], {
      code: 'X',
      httpStatus: 503,
      details: { custom: true },
    });
    expect([error.code, error.httpStatus, error.details]).toEqual(['X', 503, { custom: true }]);
  });
});

describe('requireEnv', () => {
  it('returns the environment and logs names and defaults — never values', () => {
    const logger = recordingLogger();
    const env = requireEnv(
      { DATABASE_URL: envVar.url(), PORT: envVar.port().default(3000) },
      { source: { DATABASE_URL: 'postgres://user:hunter2@db/app' }, logger, exit: vi.fn() },
    );
    expect(env).toEqual({ DATABASE_URL: 'postgres://user:hunter2@db/app', PORT: 3000 });
    expect(Object.isFrozen(env)).toBe(true);
    expect(logger.lines).toEqual([
      {
        level: 'info',
        msg: 'environment validated',
        fields: { variables: ['DATABASE_URL', 'PORT'], defaulted: ['PORT'] },
      },
    ]);
    expect(JSON.stringify(logger.lines)).not.toContain('hunter2');
  });

  it('logs every issue once and exits with 1', () => {
    const logger = recordingLogger();
    const exit = vi.fn();
    expect(() =>
      requireEnv({ A: envVar.string(), B: envVar.port() }, { source: { B: 'x' }, logger, exit }),
    ).toThrow(EnvValidationError);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(logger.lines).toEqual([
      {
        level: 'error',
        msg: 'environment validation failed',
        fields: { issues: ['A: is required but not set', 'B: must be an integer from 0 to 65535'] },
      },
    ]);
  });

  it('never logs an invalid value, even a secret-shaped one', () => {
    const logger = recordingLogger();
    expect(() =>
      requireEnv(
        { PORT: envVar.port(), DB: envVar.url(), MODE: envVar.boolean() },
        {
          source: { PORT: 'sk_live_SECRET', DB: 'sk_live_SECRET', MODE: 'sk_live_SECRET' },
          logger,
          exit: vi.fn(),
        },
      ),
    ).toThrow();
    expect(JSON.stringify(logger.lines)).not.toContain('SECRET');
  });

  it('defaults to process.exit and a real logger', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(() =>
        requireEnv({ FP_BOOTSTRAP_DEFINITELY_UNSET: envVar.string() }, { source: {} }),
      ).toThrow(EnvValidationError);
      expect(exit).toHaveBeenCalledWith(1);
      expect(requireEnv({ A: envVar.string() }, { source: { A: 'a' } })).toEqual({ A: 'a' });
    } finally {
      exit.mockRestore();
      stdout.mockRestore();
    }
  });
});
