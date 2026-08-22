import { describe, expectTypeOf, it } from 'vitest';
import {
  createLogger,
  type LogFields,
  type Logger,
  type LoggerOptions,
  type LogLevel,
  type RedactionOptions,
  type Transport,
} from '../../src/index.js';

describe('createLogger', () => {
  it('returns a Logger regardless of whether options are passed', () => {
    expectTypeOf(createLogger()).toEqualTypeOf<Logger>();
    expectTypeOf(createLogger({})).toEqualTypeOf<Logger>();
    expectTypeOf(createLogger({ level: 'warn', name: 'svc' })).toEqualTypeOf<Logger>();
  });

  it('accepts every documented option', () => {
    expectTypeOf<LoggerOptions>().toMatchTypeOf<{
      level?: LogLevel;
      name?: string;
      base?: LogFields;
      redaction?: RedactionOptions | false;
      transports?: readonly Transport[];
    }>();
  });

  it('rejects a level outside the fixed union', () => {
    // @ts-expect-error 'verbose' is not a LogLevel
    createLogger({ level: 'verbose' });
  });
});

describe('Logger', () => {
  const logger = createLogger();

  it('every level method takes a message, optional fields, and returns void', () => {
    expectTypeOf(logger.info).toBeCallableWith('msg');
    expectTypeOf(logger.info).toBeCallableWith('msg', { userId: 1 });
    expectTypeOf(logger.info).returns.toEqualTypeOf<void>();
  });

  it('child() takes fields and returns another Logger', () => {
    expectTypeOf(logger.child).toBeCallableWith({ requestId: 'r1' });
    expectTypeOf(logger.child({ requestId: 'r1' })).toEqualTypeOf<Logger>();
  });

  it('rejects a non-string message', () => {
    // @ts-expect-error msg must be a string
    logger.info(42);
  });
});

describe('Transport', () => {
  it('a conforming object is assignable without a cast', () => {
    const transport: Transport = { name: 'noop', write: () => undefined };
    expectTypeOf(transport).toMatchTypeOf<Transport>();
  });
});
