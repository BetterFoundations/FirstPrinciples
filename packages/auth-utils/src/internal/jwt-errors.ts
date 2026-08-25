import { errors as joseErrors } from 'jose';

import { JwtVerificationError, type JwtFailureReason } from '../errors.js';

/**
 * Normalizes anything thrown during verification into a
 * {@link JwtVerificationError}.
 *
 * @remarks
 * Deliberately catches `unknown`, not just `JOSEError`. A key that
 * disagrees with the token's algorithm makes `jose` throw a plain
 * `TypeError` — confirmed in `tests/attacks/algorithm-confusion.test.ts`
 * — and a `catch` narrowed to `JOSEError` would let that escape the
 * request handler as an unhandled 500 rather than a 401. The
 * `verification_failed` fallback exists so an unclassified failure is
 * still a rejection: there is no path through this function that
 * returns success.
 */
export function toVerificationError(cause: unknown): JwtVerificationError {
  if (cause instanceof JwtVerificationError) return cause;

  if (cause instanceof joseErrors.JWTExpired) {
    // `JWTExpired` covers two different rejections, distinguished only
    // by `claim`: `exp` in the past, and — when `maxTokenAge` is set —
    // an `iat` older than that. Reporting the second as `expired` would
    // tell a client to refresh when the token it holds is perfectly
    // unexpired and simply too old to be trusted for this operation.
    return new JwtVerificationError(claimReason(cause.claim), claimMessage(cause.claim), cause);
  }
  if (cause instanceof joseErrors.JOSEAlgNotAllowed) {
    return new JwtVerificationError(
      'algorithm_not_allowed',
      'Token algorithm is not on the allowlist.',
      cause,
    );
  }
  if (cause instanceof joseErrors.JWSSignatureVerificationFailed) {
    return new JwtVerificationError(
      'signature_invalid',
      'Signature did not verify against the configured key.',
      cause,
    );
  }
  if (cause instanceof joseErrors.JWTClaimValidationFailed) {
    return new JwtVerificationError(claimReason(cause.claim), claimMessage(cause.claim), cause);
  }
  if (
    cause instanceof joseErrors.JWTInvalid ||
    cause instanceof joseErrors.JWSInvalid ||
    cause instanceof joseErrors.JOSENotSupported
  ) {
    return new JwtVerificationError('malformed', 'Token is not a verifiable compact JWS.', cause);
  }
  if (cause instanceof TypeError) {
    return new JwtVerificationError(
      'algorithm_not_allowed',
      'The configured key cannot verify this token’s algorithm.',
      cause,
    );
  }
  return new JwtVerificationError('verification_failed', 'Token verification failed.', cause);
}

function claimReason(claim: string): JwtFailureReason {
  switch (claim) {
    case 'nbf':
      return 'not_yet_valid';
    case 'exp':
      return 'expired';
    case 'iat':
      return 'too_old';
    case 'iss':
      return 'issuer_mismatch';
    case 'aud':
      return 'audience_mismatch';
    default:
      return 'claims_invalid';
  }
}

function claimMessage(claim: string): string {
  switch (claim) {
    case 'nbf':
      return 'Token is not valid yet.';
    case 'exp':
      return 'Token has expired.';
    case 'iat':
      return 'Token is older than the maximum permitted age.';
    case 'iss':
      return 'Token issuer does not match.';
    case 'aud':
      return 'Token audience does not match.';
    default:
      return `Claim \`${claim}\` failed validation.`;
  }
}
