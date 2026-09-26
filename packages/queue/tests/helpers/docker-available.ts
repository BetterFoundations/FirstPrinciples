import { execFileSync } from 'node:child_process';

/**
 * Whether a Docker daemon is reachable, so the real-Redis testcontainers
 * suite can gate itself with `describe.skipIf` instead of hanging or
 * failing on a machine without Docker — a local dev machine, most
 * obviously. GitHub Actions' `ubuntu-latest` runner has Docker
 * preinstalled, so this always evaluates `true` there.
 *
 * Deliberately synchronous and cheap: this needs to run before Vitest
 * decides which `describe` blocks to include, not inside a test.
 */
export function isDockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
