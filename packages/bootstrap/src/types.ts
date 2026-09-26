/**
 * The minimal logger surface this package writes its diagnostics to.
 *
 * @remarks
 * Structural on purpose: a `@firstprinciples/logger` `Logger` satisfies it
 * as-is, and so does pino, or a three-method test double.
 *
 * @public
 */
export interface DiagnosticsLogger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/**
 * Where a {@link Service} is in its lifecycle.
 *
 * - `idle` — created, resources being registered, nothing started.
 * - `starting` — resources are being started in registration order.
 * - `running` — every resource started; readiness checks are evaluated.
 * - `stopping` — shutdown began; readiness fails from this moment on.
 * - `stopped` — every resource stopped (or the deadline passed).
 * - `failed` — a resource failed to start; the ones that had started were
 *   stopped again.
 *
 * @public
 */
export type ServiceState = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';

/**
 * Something with a lifetime the service owns: an HTTP server, a database
 * pool, a queue worker.
 *
 * @public
 */
export interface Resource {
  /** Unique within a service. Used in every diagnostic log line. */
  readonly name: string;
  /**
   * Brings the resource up. Resources start one at a time, in registration
   * order, so register what others depend on first — and the HTTP server,
   * which binds the port, last.
   */
  start?(): Promise<void> | void;
  /**
   * Releases the resource. `signal` aborts when the service's shutdown
   * deadline passes: a resource that can cut corners (force-close sockets,
   * drop a batch) should do so then. A stop that ignores it is abandoned at
   * the deadline and reported as pending.
   */
  stop?(signal: AbortSignal): Promise<void> | void;
  /**
   * Lower stops earlier. Resources sharing an order stop in reverse
   * registration order. Default `0`, so by default the last resource
   * started is the first stopped.
   */
  readonly stopOrder?: number;
}

/**
 * Which probe a {@link HealthCheck} contributes to.
 *
 * - `liveness` — "is this process wedged?" Reported by `/healthz`, and by
 *   `/readyz` too, since a wedged process is not ready either.
 * - `readiness` — "can this process take traffic right now?" `/readyz` only.
 *
 * @public
 */
export type CheckKind = 'liveness' | 'readiness';

/**
 * A pluggable health sub-check.
 *
 * @public
 */
export interface HealthCheck {
  /** Unique within a service; the key in {@link HealthReport.checks}. */
  readonly name: string;
  /**
   * Resolve (or return `true`/nothing) to pass. Throw, reject, or return
   * `false` to fail. `signal` aborts when the check's timeout passes.
   */
  check(signal: AbortSignal): Promise<boolean | void> | boolean | void;
  /** Default `'readiness'`. */
  readonly kind?: CheckKind;
  /**
   * A failing critical check fails the probe; a failing non-critical one
   * only downgrades it to `warn` (still HTTP 200). Default `true`.
   */
  readonly critical?: boolean;
  /** Overrides the service's `checkTimeoutMs` for this check. */
  readonly timeoutMs?: number;
}

/**
 * One check's outcome inside a {@link HealthReport}.
 *
 * @public
 */
export interface CheckResult {
  readonly status: 'pass' | 'fail';
  readonly critical: boolean;
  readonly durationMs: number;
  /** Why it failed. Omitted on a pass. */
  readonly error?: string;
}

/**
 * The aggregated answer to one probe.
 *
 * @public
 */
export interface HealthReport {
  /** `fail` if any critical check failed (or the state rules it out), `warn` if only non-critical ones did. */
  readonly status: 'pass' | 'warn' | 'fail';
  /** The service state when the report was produced. */
  readonly state: ServiceState;
  /** Set when the state alone decided the answer, e.g. `'service is stopping'`. */
  readonly reason?: string;
  readonly checks: Readonly<Record<string, CheckResult>>;
}

/**
 * What {@link Service.shutdown} resolves to. Never rejects.
 *
 * @public
 */
export interface ShutdownResult {
  /** `true` only if every resource stopped cleanly inside the deadline. */
  readonly ok: boolean;
  /** What triggered the shutdown: `'SIGTERM'`, `'manual'`, … */
  readonly reason: string;
  readonly durationMs: number;
  /** The deadline passed before every resource finished stopping. */
  readonly timedOut: boolean;
  /** Resources whose `stop` threw. */
  readonly failed: readonly string[];
  /** Resources still stopping (or never reached) when the deadline passed. */
  readonly pending: readonly string[];
}
