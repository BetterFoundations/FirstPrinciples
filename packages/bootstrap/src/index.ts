/**
 * `@firstprinciples/bootstrap` — the start and end of a Node service's life.
 *
 * - {@link requireEnv} / {@link loadEnv}: validate the environment before
 *   anything binds a port, reporting every bad variable at once.
 * - {@link createService}: resources started in order and stopped in
 *   reverse on SIGTERM/SIGINT, inside one deadline.
 * - {@link httpServerResource}: bind on start, drain in-flight requests on stop.
 * - {@link createHealthHandler}: `/healthz` and `/readyz` over pluggable checks.
 *
 * @packageDocumentation
 */

export { envVar, loadEnv, requireEnv } from './env.js';
export type {
  EnvOf,
  EnvSource,
  EnvSpec,
  EnvVar,
  NumberOptions,
  RequireEnvOptions,
  UrlOptions,
} from './env.js';

export { createService } from './service.js';
export type { Service, ServiceOptions, SignalSource } from './service.js';

export { createHealthHandler, httpServerResource, toHealthBody } from './http.js';
export type {
  HealthHandlerOptions,
  HealthSource,
  HttpServerResource,
  HttpServerResourceOptions,
} from './http.js';

export { EnvValidationError, LifecycleError } from './errors.js';
export type { EnvIssue } from './errors.js';

export type {
  CheckKind,
  CheckResult,
  DiagnosticsLogger,
  HealthCheck,
  HealthReport,
  Resource,
  ServiceState,
  ShutdownResult,
} from './types.js';
