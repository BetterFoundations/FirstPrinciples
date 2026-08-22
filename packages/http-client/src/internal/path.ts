import { ValidationError } from '@firstprinciples/core';

/**
 * Strips every trailing `/` from `value`.
 *
 * @remarks
 * Deliberately not a regex (`/\/+$/`). CodeQL correctly flags that pattern
 * as polynomial-time on uncontrolled input: an unanchored-at-start
 * quantifier gets retried at every position the engine backtracks to, each
 * retry scanning to the end — O(n²) on a pathological string, even though
 * there's no *nested* quantifier to make it properly catastrophic. A plain
 * backward scan is O(n) with no backtracking at all.
 */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* '/' */) end -= 1;
  return value.slice(0, end);
}

/** Joins a base URL and a path, collapsing exactly one `/` between them. */
export function joinUrl(baseUrl: string, path: string): string {
  const trimmedBase = stripTrailingSlashes(baseUrl);
  const trimmedPath = path.startsWith('/') ? path : `/${path}`;
  return `${trimmedBase}${trimmedPath}`;
}

const PARAM_SEGMENT = /:([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Interpolates `:name`-style segments in an endpoint path from `params`,
 * percent-encoding each value.
 *
 * @throws A {@link ValidationError} if the path names a parameter that
 * `params` does not supply.
 */
export function interpolatePath(
  path: string,
  params: Record<string, number | string> = {},
): string {
  return path.replace(PARAM_SEGMENT, (match, name: string) => {
    if (!(name in params)) {
      throw new ValidationError(`Missing path parameter "${name}" for endpoint "${path}"`, {
        code: 'MISSING_PATH_PARAM',
        details: { path, param: name },
      });
    }
    // A read, guarded by the `in` check just above — never a write, and
    // never reaching this line for a name `params` doesn't actually have.
    // eslint-disable-next-line security/detect-object-injection
    return encodeURIComponent(params[name] as number | string);
  });
}
