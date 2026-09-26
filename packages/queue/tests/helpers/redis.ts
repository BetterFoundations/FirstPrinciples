import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { isDockerAvailable } from './docker-available.js';

/**
 * A real Redis for the integration suite: `REDIS_URL` if set (a local
 * redis-server), otherwise an ephemeral testcontainers Redis when Docker is
 * reachable (GitHub Actions), otherwise the suite is skipped.
 */
export const redisAvailable = (): boolean =>
  process.env.REDIS_URL !== undefined || isDockerAvailable();

let container: StartedRedisContainer | undefined;

export async function startRedis(): Promise<{ host: string; port: number }> {
  const url = process.env.REDIS_URL;
  if (url !== undefined) {
    const parsed = new URL(url);
    return { host: parsed.hostname, port: Number(parsed.port || 6379) };
  }
  container = await new RedisContainer('redis:7-alpine').start();
  return { host: container.getHost(), port: container.getMappedPort(6379) };
}

export async function stopRedis(): Promise<void> {
  await container?.stop();
  container = undefined;
}

let counter = 0;
/** A queue name unique to this run, so tests never see each other's jobs. */
export const uniqueQueue = (label: string): string =>
  `${label}-${process.pid}-${Date.now()}-${++counter}`;
