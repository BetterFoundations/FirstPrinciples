import { createLogger } from '@firstprinciples/logger';
import { LifecycleError } from './errors.js';
import { runChecks } from './internal/checks.js';
import type {
  DiagnosticsLogger,
  HealthCheck,
  HealthReport,
  Resource,
  ServiceState,
  ShutdownResult,
} from './types.js';

/**
 * Anything signals can be subscribed to on. `process` in production; an
 * `EventEmitter` in tests.
 *
 * @public
 */
export interface SignalSource {
  on(event: string, listener: (signal: string) => void): unknown;
  off(event: string, listener: (signal: string) => void): unknown;
}

/**
 * Options for {@link createService}.
 *
 * @public
 */
export interface ServiceOptions {
  /** Attached to every diagnostic log line. Default `'service'`. */
  readonly name?: string;
  /** Defaults to a `@firstprinciples/logger` logger named after the service. */
  readonly logger?: DiagnosticsLogger;
  /**
   * The whole shutdown's budget, drain delay included. When it passes,
   * every `stop` signal aborts and unfinished resources are reported as
   * pending. Default 25 000 — under Kubernetes' default 30 s grace period,
   * so this package's own deadline fires before the kubelet's SIGKILL.
   */
  readonly shutdownTimeoutMs?: number;
  /**
   * How long to keep serving after readiness starts failing, before any
   * resource is stopped — time for a load balancer to notice `/readyz` and
   * stop routing here. Default 0.
   */
  readonly drainDelayMs?: number;
  /** Default timeout for each health check. Default 3000. */
  readonly checkTimeoutMs?: number;
  /** Signals that trigger a graceful shutdown. `false` installs no handlers. Default `['SIGTERM', 'SIGINT']`. */
  readonly signals?: readonly string[] | false;
  /** Where signal handlers are installed. Default `process`. */
  readonly signalSource?: SignalSource;
  /**
   * Called with the exit code once a **signal-triggered** shutdown finishes:
   * 0 if it was clean, 1 otherwise. A shutdown started by calling
   * {@link Service.shutdown} never exits. Default `process.exit`.
   */
  readonly exit?: (code: number) => void;
}

/**
 * A Node service's lifecycle: resources started in order, stopped in
 * reverse, with health probes that tell the truth throughout.
 *
 * @public
 */
export interface Service {
  readonly name: string;
  readonly state: ServiceState;
  /** Registers a resource. Only allowed while `idle`. Names must be unique. */
  addResource(resource: Resource): this;
  /** Registers a health check. Only allowed while `idle`. Names must be unique. */
  addCheck(check: HealthCheck): this;
  /**
   * Starts every resource in registration order and installs the signal
   * handlers. If one fails, the ones already started are stopped in
   * reverse, the state becomes `failed`, and the original error is thrown.
   */
  start(): Promise<void>;
  /**
   * Stops the service. Idempotent: every call, and every repeated signal,
   * gets the same promise. Never rejects. Called during `starting`, it waits
   * for startup to settle first.
   */
  shutdown(reason?: string): Promise<ShutdownResult>;
  /** `/healthz`: liveness checks only. Keeps answering honestly while draining. */
  checkLiveness(): Promise<HealthReport>;
  /** `/readyz`: every check, and `fail` in any state but `running`. */
  checkReadiness(): Promise<HealthReport>;
}

function notReadyReason(state: Exclude<ServiceState, 'running'>): string {
  switch (state) {
    case 'idle':
      return 'service has not started';
    case 'starting':
      return 'service is starting';
    case 'stopping':
      return 'service is stopping';
    case 'stopped':
      return 'service has stopped';
    case 'failed':
      return 'service failed to start';
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Creates a {@link Service}. Nothing happens until {@link Service.start}.
 *
 * @example
 * ```ts
 * const env = requireEnv({ PORT: envVar.port().default(3000), DATABASE_URL: envVar.url() });
 * const service = createService({ name: 'api' });
 * service
 *   .addResource({ name: 'db', start: () => db.connect(), stop: () => db.end() })
 *   .addCheck({ name: 'db', check: () => db.ping() })
 *   .addResource(httpServerResource(server, { port: env.PORT }));
 * await service.start();
 * ```
 *
 * @public
 */
export function createService(options: ServiceOptions = {}): Service {
  const name = options.name ?? 'service';
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 25_000;
  const drainDelayMs = options.drainDelayMs ?? 0;
  const checkTimeoutMs = options.checkTimeoutMs ?? 3000;
  const signals = options.signals === false ? [] : (options.signals ?? ['SIGTERM', 'SIGINT']);
  const signalSource: SignalSource = options.signalSource ?? process;
  const exit = options.exit ?? ((code: number) => process.exit(code));

  let loggerInstance = options.logger;
  const log = (): DiagnosticsLogger => (loggerInstance ??= createLogger({ name }));

  const resources: Resource[] = [];
  const checks: HealthCheck[] = [];
  let state: ServiceState = 'idle';
  let startPromise: Promise<void> | undefined;
  let shutdownPromise: Promise<ShutdownResult> | undefined;
  let livenessInFlight: Promise<HealthReport> | undefined;
  let readinessInFlight: Promise<HealthReport> | undefined;

  const assertIdle = (action: string): void => {
    if (state !== 'idle') {
      throw new LifecycleError(`Cannot ${action} once the service is ${state}`, {
        details: { service: name, state },
      });
    }
  };

  const onSignal = (signal: string): void => {
    if (shutdownPromise !== undefined) {
      log().warn('shutdown already in progress, ignoring signal', { service: name, signal });
      return;
    }
    void service.shutdown(signal).then((result) => exit(result.ok ? 0 : 1));
  };

  const installSignals = (): void => {
    for (const signal of signals) signalSource.on(signal, onSignal);
  };
  const removeSignals = (): void => {
    for (const signal of signals) signalSource.off(signal, onSignal);
  };

  /**
   * Stops `list` one at a time in stop order, within one shared deadline.
   * A throwing `stop` is logged and skipped past; the deadline abandons
   * whatever is still running and everything not yet reached.
   */
  const stopAll = async (
    list: readonly Resource[],
    budgetMs: number,
  ): Promise<Omit<ShutdownResult, 'reason' | 'durationMs' | 'ok'>> => {
    const ordered = list
      .map((resource, index) => ({ resource, index }))
      .sort(
        (a, b) => (a.resource.stopOrder ?? 0) - (b.resource.stopOrder ?? 0) || b.index - a.index,
      )
      .map(({ resource }) => resource);

    const controller = new AbortController();
    let expired!: () => void;
    const deadline = new Promise<'deadline'>((resolve) => {
      expired = () => resolve('deadline');
    });
    const onDeadline = (): void => {
      controller.abort(new Error(`shutdown deadline of ${shutdownTimeoutMs}ms passed`));
      expired();
    };
    // A budget the drain delay already used up is expired *now* — a
    // 0 ms timer would only fire after the first stop had run, and the
    // result would claim a clean shutdown that in fact overran.
    if (budgetMs <= 0) onDeadline();
    const timer = setTimeout(onDeadline, Math.max(0, budgetMs));

    const failed: string[] = [];
    const pending: string[] = [];
    try {
      for (const [i, resource] of ordered.entries()) {
        if (controller.signal.aborted) {
          pending.push(...ordered.slice(i).map((r) => r.name));
          break;
        }
        const startedAt = Date.now();
        try {
          const outcome = await Promise.race([
            Promise.resolve().then(() => resource.stop?.(controller.signal)),
            deadline,
          ]);
          if (outcome === 'deadline') {
            pending.push(...ordered.slice(i).map((r) => r.name));
            break;
          }
          log().info('resource stopped', {
            service: name,
            resource: resource.name,
            durationMs: Date.now() - startedAt,
          });
        } catch (error) {
          failed.push(resource.name);
          log().error('resource failed to stop', {
            service: name,
            resource: resource.name,
            error: messageOf(error),
          });
        }
      }
    } finally {
      clearTimeout(timer);
    }

    if (pending.length > 0) {
      log().error('shutdown deadline passed with resources still stopping', {
        service: name,
        pending,
        shutdownTimeoutMs,
      });
    }
    return { timedOut: pending.length > 0, failed, pending };
  };

  const service: Service = {
    get name() {
      return name;
    },
    get state() {
      return state;
    },

    addResource(resource) {
      assertIdle('add a resource');
      if (resources.some((r) => r.name === resource.name)) {
        throw new LifecycleError(`A resource named "${resource.name}" is already registered`, {
          details: { service: name },
        });
      }
      resources.push(resource);
      return this;
    },

    addCheck(check) {
      assertIdle('add a health check');
      if (checks.some((c) => c.name === check.name)) {
        throw new LifecycleError(`A health check named "${check.name}" is already registered`, {
          details: { service: name },
        });
      }
      checks.push(check);
      return this;
    },

    start() {
      // Rejects rather than throwing, so `start().catch(...)` sees it too.
      try {
        assertIdle('start');
      } catch (error) {
        return Promise.reject(error as LifecycleError);
      }
      state = 'starting';
      startPromise = (async () => {
        const startedAt = Date.now();
        log().info('service starting', {
          service: name,
          pid: process.pid,
          node: process.version,
          resources: resources.map((r) => r.name),
          checks: checks.map((c) => c.name),
        });
        installSignals();

        const started: Resource[] = [];
        for (const resource of resources) {
          const resourceStartedAt = Date.now();
          try {
            await resource.start?.();
          } catch (error) {
            log().error('resource failed to start', {
              service: name,
              resource: resource.name,
              error: messageOf(error),
            });
            await stopAll(started, shutdownTimeoutMs);
            state = 'failed';
            removeSignals();
            throw error;
          }
          started.push(resource);
          log().info('resource started', {
            service: name,
            resource: resource.name,
            durationMs: Date.now() - resourceStartedAt,
          });
        }

        state = 'running';
        log().info('service ready', { service: name, startupMs: Date.now() - startedAt });
      })();
      return startPromise;
    },

    shutdown(reason = 'manual') {
      shutdownPromise ??= (async (): Promise<ShutdownResult> => {
        const startedAt = Date.now();
        if (state === 'starting') await startPromise?.catch(() => undefined);

        if (state !== 'running') {
          // Nothing is running: never started, or startup already failed
          // and cleaned up after itself.
          const ok = state !== 'failed';
          if (state === 'idle') state = 'stopped';
          removeSignals();
          return {
            ok,
            reason,
            durationMs: Date.now() - startedAt,
            timedOut: false,
            failed: [],
            pending: [],
          };
        }

        state = 'stopping';
        log().info('shutdown started', { service: name, reason, drainDelayMs, shutdownTimeoutMs });
        const drain = Math.min(drainDelayMs, shutdownTimeoutMs);
        if (drain > 0) await sleep(drain);

        const outcome = await stopAll(resources, shutdownTimeoutMs - (Date.now() - startedAt));
        state = 'stopped';
        removeSignals();

        const result: ShutdownResult = {
          ok: outcome.failed.length === 0 && !outcome.timedOut,
          reason,
          durationMs: Date.now() - startedAt,
          ...outcome,
        };
        log().info('shutdown complete', { service: name, ...result });
        return result;
      })();
      return shutdownPromise;
    },

    checkLiveness() {
      livenessInFlight ??= (async () => {
        if (state === 'failed') {
          return { status: 'fail' as const, state, reason: notReadyReason('failed'), checks: {} };
        }
        return runChecks(
          checks.filter((c) => c.kind === 'liveness'),
          checkTimeoutMs,
          state,
        );
      })().finally(() => {
        livenessInFlight = undefined;
      });
      return livenessInFlight;
    },

    checkReadiness() {
      readinessInFlight ??= (async () => {
        if (state !== 'running') {
          return { status: 'fail' as const, state, reason: notReadyReason(state), checks: {} };
        }
        const report = await runChecks(checks, checkTimeoutMs, state);
        // Shutdown can begin while the checks were running; the answer must
        // reflect that, not the state at the moment the probe arrived.
        const current = state as ServiceState;
        if (current !== 'running') {
          return {
            ...report,
            status: 'fail' as const,
            state: current,
            reason: notReadyReason(current),
          };
        }
        return report;
      })().finally(() => {
        readinessInFlight = undefined;
      });
      return readinessInFlight;
    },
  };

  return service;
}
