import { base64url } from 'jose';

import { JwtVerificationError } from '../errors.js';
import { isJwtAlgorithm, type JwtAlgorithm, type ResolvedAllowlist } from './jwt-algorithms.js';

/**
 * Header parameters that tell a verifier where to fetch a key.
 *
 * @remarks
 * Each is a legitimate JOSE parameter and each is a key-substitution
 * attack when honoured on an unverified token: `jwk` embeds a key in
 * the token, `jku`/`x5u` point at a URL the verifier would fetch, and
 * `x5c` embeds a certificate chain. A verifier that resolves any of
 * them lets the token choose the key that validates it.
 *
 * `jose` does not resolve these on its own — verified in
 * `tests/attacks/header-injection.test.ts`, where an embedded `jwk` is
 * ignored and the signature check fails against the configured key. We
 * reject outright rather than rely on being ignored: a token carrying
 * one is an attack in progress, and `signature_invalid` would be a
 * misleading thing to log about it.
 */
const KEY_RESOLUTION_HEADERS = ['jwk', 'jku', 'x5u', 'x5c', 'x5t', 'x5t#S256'] as const;

/**
 * The subset of the protected header this package reads.
 *
 * @public
 */
export interface JwtHeader {
  /** The signature algorithm. Always on the verifier's allowlist by the time a caller sees this. */
  readonly alg: JwtAlgorithm;
  /** The `typ` header, if the token carried one. */
  readonly typ?: string;
  /** The key id, if the token carried one. Informational — never used to select a key. */
  readonly kid?: string;
}

const SEGMENT_COUNT = 3;

/**
 * Parses and vets a compact JWS's protected header *before* any
 * signature check runs.
 *
 * @remarks
 * Reading an unverified header is safe; *acting* on one is not. The
 * distinction is the whole of JWT security. This function only ever
 * compares the header against configuration the caller fixed at
 * construction time — it never lets a header value select a key,
 * an algorithm, or a validation rule.
 *
 * `jose` re-checks the algorithm independently a moment later. That
 * redundancy is intentional: the allowlist is this package's central
 * promise, and a promise that holds only because a dependency happens
 * to implement it is not a promise. It also means the rejection carries
 * a `JwtFailureReason` rather than whichever error type jose raises,
 * including the `TypeError` (not a `JOSEError`) that a key/algorithm
 * mismatch produces.
 *
 * @param token - The untrusted compact JWS.
 * @param allowlist - The verifier's resolved allowlist.
 * @param expectedTyp - If set, the `typ` the header must carry.
 *
 * @throws {@link JwtVerificationError} — caught and converted to a `Result` by the caller.
 */
export function inspectProtectedHeader(
  token: string,
  allowlist: ResolvedAllowlist,
  expectedTyp: string | undefined,
): JwtHeader {
  if (typeof token !== 'string' || token.length === 0) {
    throw new JwtVerificationError('malformed', 'Token is not a non-empty string.');
  }

  const segments = token.split('.');
  if (segments.length !== SEGMENT_COUNT) {
    throw new JwtVerificationError(
      'malformed',
      `Expected a 3-segment compact JWS, got ${segments.length} segments. A 5-segment ` +
        'token is JWE, which this package does not verify.',
    );
  }

  const [encodedHeader, , signature] = segments;

  // An `alg: none` token is exactly this: a valid header, a payload,
  // and nothing after the final dot. The algorithm check below rejects
  // it too; this catches the shape even for an alg that *is* on the
  // allowlist but arrived unsigned.
  if (signature === undefined || signature.length === 0) {
    throw new JwtVerificationError(
      'algorithm_not_allowed',
      'Token has an empty signature segment — it is unsigned.',
    );
  }
  if (encodedHeader === undefined || encodedHeader.length === 0) {
    throw new JwtVerificationError('malformed', 'Token has an empty header segment.');
  }

  const header = decodeHeader(encodedHeader);

  const { alg } = header;
  if (!isJwtAlgorithm(alg)) {
    throw new JwtVerificationError(
      'algorithm_not_allowed',
      `Header \`alg\` is ${JSON.stringify(alg)}, which is not a supported signature algorithm.`,
    );
  }
  if (!allowlist.algorithms.has(alg)) {
    throw new JwtVerificationError(
      'algorithm_not_allowed',
      `Header \`alg\` is ${alg}; this verifier accepts only ` +
        `${[...allowlist.algorithms].join(', ')}.`,
    );
  }

  for (const parameter of KEY_RESOLUTION_HEADERS) {
    if (Object.hasOwn(header, parameter)) {
      throw new JwtVerificationError(
        'untrusted_header',
        `Header carries \`${parameter}\`, which would let the token nominate its own ` +
          'verification key. This verifier only ever uses the key it was constructed with.',
      );
    }
  }

  if (Object.hasOwn(header, 'crit')) {
    throw new JwtVerificationError(
      'untrusted_header',
      'Header carries `crit`. RFC 7515 §4.1.11 requires a verifier to reject any extension ' +
        'it does not understand, and this verifier understands none.',
    );
  }

  const typ = typeof header.typ === 'string' ? header.typ : undefined;
  if (expectedTyp !== undefined && typ !== expectedTyp) {
    throw new JwtVerificationError(
      'type_mismatch',
      `Header \`typ\` is ${JSON.stringify(typ)}; this verifier requires ` +
        `${JSON.stringify(expectedTyp)}.`,
    );
  }

  const kid = typeof header.kid === 'string' ? header.kid : undefined;
  return {
    alg,
    ...(typ === undefined ? {} : { typ }),
    ...(kid === undefined ? {} : { kid }),
  };
}

/**
 * Base64url-decodes and JSON-parses the protected header.
 *
 * @remarks
 * Everything here is attacker-controlled, so every failure mode is an
 * expected one. A `__proto__` key in the JSON is harmless: `JSON.parse`
 * creates it as an own data property rather than invoking the setter,
 * and the checks above use `Object.hasOwn` so nothing inherited can
 * register as present either.
 */
function decodeHeader(encodedHeader: string): Record<string, unknown> {
  let json: string;
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(base64url.decode(encodedHeader));
  } catch (cause) {
    throw new JwtVerificationError(
      'malformed',
      'Header is not valid base64url-encoded UTF-8.',
      cause,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new JwtVerificationError('malformed', 'Header is not valid JSON.', cause);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new JwtVerificationError('malformed', 'Header is not a JSON object.');
  }

  return parsed as Record<string, unknown>;
}
