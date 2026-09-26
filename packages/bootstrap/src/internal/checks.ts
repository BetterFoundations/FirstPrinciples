import type { CheckResult, HealthCheck, HealthReport, ServiceState } from '../types.js';

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message;
  if (typeof error === 'string' && error !== '') return error;
  return 'check failed';
}

async function runOne(check: HealthCheck, defaultTimeoutMs: number): Promise<CheckResult> {
  const critical = check.critical !== false;
  const timeoutMs = check.timeoutMs ?? defaultTimeoutMs;
  const controller = new AbortController();
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new Error(`timed out after ${timeoutMs}ms`));
      resolve('timeout');
    }, timeoutMs);
  });

  try {
    // Wrapped so a check that throws synchronously is caught the same way
    // as one that rejects.
    const outcome = await Promise.race([
      Promise.resolve().then(() => check.check(controller.signal)),
      timedOut,
    ]);
    const durationMs = Date.now() - startedAt;
    if (outcome === 'timeout') {
      return { status: 'fail', critical, durationMs, error: `timed out after ${timeoutMs}ms` };
    }
    if (outcome === false) {
      return { status: 'fail', critical, durationMs, error: 'check returned false' };
    }
    return { status: 'pass', critical, durationMs };
  } catch (error) {
    return {
      status: 'fail',
      critical,
      durationMs: Date.now() - startedAt,
      error: messageOf(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs `checks` concurrently and folds them into one report: any critical
 * failure fails it, a non-critical failure only downgrades it to `warn`.
 * A hanging check is cut off at its timeout, so a probe always answers.
 */
export async function runChecks(
  checks: readonly HealthCheck[],
  defaultTimeoutMs: number,
  state: ServiceState,
): Promise<HealthReport> {
  const pairs = await Promise.all(
    checks.map(async (check) => [check.name, await runOne(check, defaultTimeoutMs)] as const),
  );
  let status: HealthReport['status'] = 'pass';
  for (const [, result] of pairs) {
    if (result.status !== 'fail') continue;
    if (result.critical) status = 'fail';
    else if (status === 'pass') status = 'warn';
  }
  // fromEntries: a check named `__proto__` becomes a key, not a prototype.
  return { status, state, checks: Object.fromEntries(pairs) };
}
