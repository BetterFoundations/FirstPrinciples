import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import {
  createService,
  envVar,
  EnvValidationError,
  httpServerResource,
  requireEnv,
} from '../../src/index.js';
import { recordingLogger } from '../support.js';

describe('fail fast before the port binds', () => {
  it('an invalid environment exits before any resource starts or any port is bound', () => {
    const server = createServer();
    const listen = vi.spyOn(server, 'listen');
    const exit = vi.fn();
    const logger = recordingLogger();

    // The shape of a real entry point: validate, then build, then start.
    const main = () => {
      const env = requireEnv(
        { PORT: envVar.port(), DATABASE_URL: envVar.url(), JWT_SECRET: envVar.string() },
        { source: { PORT: '99999' }, logger, exit },
      );
      const service = createService({ logger, signals: false });
      service.addResource(httpServerResource(server, { port: env.PORT }));
      return service.start();
    };

    expect(main).toThrow(EnvValidationError);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(listen).not.toHaveBeenCalled();
    expect(server.listening).toBe(false);
    // All three problems in the one log line, so one deploy fixes them all.
    expect(logger.lines).toHaveLength(1);
    expect(logger.lines[0]?.fields?.issues).toEqual([
      'PORT: must be an integer from 0 to 65535',
      'DATABASE_URL: is required but not set',
      'JWT_SECRET: is required but not set',
    ]);
  });

  it('a valid environment goes on to bind the port', async () => {
    const server = createServer();
    const logger = recordingLogger();
    const env = requireEnv(
      { PORT: envVar.port() },
      { source: { PORT: '0' }, logger, exit: vi.fn() },
    );
    const service = createService({ logger, signals: false });
    service.addResource(httpServerResource(server, { port: env.PORT, host: '127.0.0.1' }));
    await service.start();
    expect(server.listening).toBe(true);
    await service.shutdown();
    expect(server.listening).toBe(false);
  });
});
