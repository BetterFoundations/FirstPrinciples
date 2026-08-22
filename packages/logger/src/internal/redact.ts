import type { LogFields, RedactionOptions } from './types.js';

/**
 * Case-insensitive substrings (matched against a key with non-alphanumerics
 * stripped) that mark a field as sensitive regardless of its value. Substring
 * matching on purpose: it catches `dbPassword`, `x-api-key`, `refreshToken`,
 * `Authorization-Header` etc. without enumerating every real-world variant.
 */
const DEFAULT_KEY_FRAGMENTS = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'apikey',
  'authorization',
  'cookie',
  'ssn',
  'socialsecurity',
  'creditcard',
  'cardnumber',
  'cvv',
  'cvc',
  'privatekey',
] as const;

/**
 * Value-shape patterns checked against every string leaf, regardless of key
 * name — a secret can show up under a field nobody thought to name
 * defensively. Deliberately unanchored: a pattern matching anywhere in the
 * string redacts the whole value, trading a wider false-positive surface for
 * never partially-leaking a secret embedded in a longer string.
 */
const DEFAULT_PATTERNS: readonly RegExp[] = [
  /eyJ[\w-]+\.[\w-]+\.[\w-]+/, // JWT (header.payload.signature, all base64url)
  /[^\s@]+@[^\s@]+\.[^\s@]+/, // email
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b/, // Stripe-style keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, // GitHub tokens
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bAIza[0-9A-Za-z_-]{35}\b/, // Google API key
  /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/, // Slack tokens
  /\bBearer\s+\S+/i, // bearer auth header value
];

const DEFAULT_REPLACEMENT = '[REDACTED]';
const DEFAULT_MAX_DEPTH = 20;

interface ResolvedOptions {
  readonly keyFragments: readonly string[];
  readonly patterns: readonly RegExp[];
  readonly replacement: string;
  readonly maxDepth: number;
}

export function resolveRedactionOptions(
  options: RedactionOptions | false | undefined,
): ResolvedOptions | null {
  if (options === false) return null;
  return {
    keyFragments: [...DEFAULT_KEY_FRAGMENTS, ...(options?.keyFragments ?? [])],
    patterns: [...DEFAULT_PATTERNS, ...(options?.patterns ?? [])],
    replacement: options?.replacement ?? DEFAULT_REPLACEMENT,
    maxDepth: options?.maxDepth ?? DEFAULT_MAX_DEPTH,
  };
}

function isSensitiveKey(key: string, fragments: readonly string[]): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return fragments.some((fragment) => normalized.includes(fragment));
}

function isSecretShaped(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

/**
 * Redacts a single value, recursing into plain objects and arrays.
 *
 * `ancestors` tracks only the current path from the root (added before
 * recursing into a container's children, removed after) rather than every
 * object seen anywhere in the tree — so a `[Circular]` marker means a real
 * cycle, not just the same object legitimately referenced from two branches.
 */
function redactValue(
  value: unknown,
  opts: ResolvedOptions,
  ancestors: Set<object>,
  depth: number,
): unknown {
  if (depth > opts.maxDepth) return '[MaxDepthExceeded]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'function') return '[Function]';
  if (typeof value === 'symbol') return '[Symbol]';
  if (typeof value === 'string')
    return isSecretShaped(value, opts.patterns) ? opts.replacement : value;
  if (typeof value !== 'object') return value; // number, boolean

  const obj = value as object;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return value.toString();
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (value instanceof Map) return `[Map(${value.size})]`;
  if (value instanceof Set) return `[Set(${value.size})]`;

  if (ancestors.has(obj)) return '[Circular]';

  if (Array.isArray(value)) {
    ancestors.add(obj);
    const result = value.map((item) => redactValue(item, opts, ancestors, depth + 1));
    ancestors.delete(obj);
    return result;
  }

  ancestors.add(obj);
  // Object.create(null): `key` comes from the *input* object's own keys, so a
  // log field literally named `__proto__` (plausible if `value` is untrusted
  // JSON, e.g. logged request data) must not trigger the prototype setter
  // that a `{}`-literal accumulator would have.
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    // The rule can't see that `result`'s null prototype (above) already
    // neutralizes the one risk this pattern normally flags.
    // eslint-disable-next-line security/detect-object-injection
    result[key] = isSensitiveKey(key, opts.keyFragments)
      ? opts.replacement
      : redactValue(val, opts, ancestors, depth + 1);
  }
  ancestors.delete(obj);
  return result;
}

/** Returns a redacted copy of `fields`. `fields` itself is never mutated. */
export function redactFields(
  fields: LogFields,
  options: RedactionOptions | false | undefined,
): LogFields {
  const resolved = resolveRedactionOptions(options);
  if (resolved === null) return fields;
  return redactValue(fields, resolved, new Set(), 0) as LogFields;
}
