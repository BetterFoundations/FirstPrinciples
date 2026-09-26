import type { Server } from 'node:http';
import { describe, expectTypeOf, it } from 'vitest';
import type { Result } from '@firstprinciples/core';
import {
  createService,
  envVar,
  httpServerResource,
  loadEnv,
  requireEnv,
  type EnvOf,
  type EnvValidationError,
  type EnvVar,
  type HealthReport,
  type Resource,
  type ShutdownResult,
} from '../../src/index.js';

describe('env inference — no call-site generics needed', () => {
  it('infers each variable from its spec', () => {
    const env = requireEnv({
      PORT: envVar.port().default(3000),
      DATABASE_URL: envVar.url(),
      DEBUG: envVar.boolean().default(false),
      RATE: envVar.number(),
      SENTRY_DSN: envVar.string().optional(),
      LOG_LEVEL: envVar.enum(['debug', 'info', 'warn']).default('info'),
      REGION: envVar.enum(['eu', 'us']).optional(),
      CUSTOM: envVar.custom((raw) => raw.split(',')),
    });
    expectTypeOf(env.PORT).toEqualTypeOf<number>();
    expectTypeOf(env.DATABASE_URL).toEqualTypeOf<string>();
    expectTypeOf(env.DEBUG).toEqualTypeOf<boolean>();
    expectTypeOf(env.RATE).toEqualTypeOf<number>();
    expectTypeOf(env.SENTRY_DSN).toEqualTypeOf<string | undefined>();
    expectTypeOf(env.LOG_LEVEL).toEqualTypeOf<'debug' | 'info' | 'warn'>();
    expectTypeOf(env.REGION).toEqualTypeOf<'eu' | 'us' | undefined>();
    expectTypeOf(env.CUSTOM).toEqualTypeOf<string[]>();
  });

  it('makes the environment read-only', () => {
    const env = requireEnv({ A: envVar.string() });
    // @ts-expect-error — readonly
    env.A = 'changed';
  });

  it('rejects a default of the wrong type', () => {
    // @ts-expect-error — port() is a number
    envVar.port().default('3000');
    // @ts-expect-error — not one of the enum values
    envVar.enum(['a', 'b']).default('c');
  });

  it('rejects an empty enum', () => {
    // @ts-expect-error — at least one value is required
    envVar.enum([]);
  });

  it('loadEnv returns a core Result', () => {
    const result = loadEnv({ A: envVar.string() });
    expectTypeOf(result).toEqualTypeOf<Result<EnvOf<{ A: EnvVar<string> }>, EnvValidationError>>();
    if (result.ok) expectTypeOf(result.value.A).toEqualTypeOf<string>();
    else expectTypeOf(result.error.issues[0]!.problem).toEqualTypeOf<'missing' | 'invalid'>();
  });
});

describe('service types', () => {
  it('resources and results', () => {
    const service = createService();
    expectTypeOf(service.shutdown()).toEqualTypeOf<Promise<ShutdownResult>>();
    expectTypeOf(service.checkReadiness()).toEqualTypeOf<Promise<HealthReport>>();
    expectTypeOf(httpServerResource({} as Server, { port: 1 })).toMatchTypeOf<Resource>();
    expectTypeOf(httpServerResource({} as Server, { port: 1 }).inFlight).toEqualTypeOf<number>();
    // @ts-expect-error — a resource needs a name
    service.addResource({ start: () => undefined });
    // @ts-expect-error — a check needs a check function
    service.addCheck({ name: 'x' });
  });
});
