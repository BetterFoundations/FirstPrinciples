import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Bytes of entropy in a refresh token's secret half.
 *
 * @remarks
 * 256 bits. That number is the reason this package hashes refresh
 * tokens with SHA-256 while it hashes passwords with argon2id, and the
 * distinction is worth being explicit about because "use a slow hash
 * for credentials" is otherwise a reasonable thing to over-apply.
 *
 * Argon2's cost exists to make *guessing* expensive, and guessing is
 * only a threat when the input has little entropy — which is exactly
 * what a human-chosen password has. A uniformly random 256-bit value
 * cannot be guessed at any cost, so stretching it buys nothing and
 * would put a ~24 ms derivation on the path of every token refresh.
 * What is needed here is preimage resistance: an attacker who reads the
 * store must not be able to work backwards to a usable token. SHA-256
 * gives that.
 */
const SECRET_BYTES = 32;

/** Bytes of entropy in a family identifier. Not a secret; only needs to not collide. */
const FAMILY_ID_BYTES = 16;

/** Separator between the family id and the secret. Absent from base64url's alphabet. */
const SEPARATOR = '.';

/** A newly generated token, in both the form the client gets and the form the store keeps. */
export interface MintedToken {
  /** The full token string handed to the client. Never stored. */
  readonly token: string;
  /** Base64url SHA-256 of the secret half. This is what gets stored. */
  readonly hash: string;
}

/** A parsed but entirely unverified token. */
export interface ParsedToken {
  readonly familyId: string;
  /** Base64url SHA-256 of the presented secret. */
  readonly presentedHash: string;
}

/** Generates a family identifier. */
export function newFamilyId(): string {
  return randomBytes(FAMILY_ID_BYTES).toString('base64url');
}

/**
 * Mints a token for a given family.
 *
 * @remarks
 * The family id travels in the token so a presented value can be
 * resolved to exactly one store record with no secondary index, which
 * in turn is what lets the family be the unit of compare-and-set. It is
 * not sensitive: it identifies a chain, and knowing it grants nothing
 * without the secret half.
 *
 * @param familyId - The family this token belongs to.
 */
export function mintToken(familyId: string): MintedToken {
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  return { token: `${familyId}${SEPARATOR}${secret}`, hash: hashSecret(secret) };
}

/**
 * Splits a presented token and hashes its secret half.
 *
 * @remarks
 * Returns `undefined` rather than throwing for anything unparseable —
 * every value reaching here came off the wire.
 *
 * @param token - An untrusted token string.
 */
export function parseToken(token: unknown): ParsedToken | undefined {
  if (typeof token !== 'string' || token.length === 0) return undefined;

  const separator = token.indexOf(SEPARATOR);
  if (separator <= 0 || separator === token.length - 1) return undefined;

  const familyId = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  // A second separator means this is not a token this package minted.
  if (secret.includes(SEPARATOR)) return undefined;

  return { familyId, presentedHash: hashSecret(secret) };
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('base64url');
}

/**
 * Compares two token hashes without leaking their contents through
 * timing.
 *
 * @remarks
 * Worth being precise about what this does and does not buy, because
 * the honest answer is smaller than it looks and the reasoning is the
 * part worth keeping.
 *
 * The values compared here are already SHA-256 digests of the presented
 * secret, not the secret itself. So even a fully leaky `===` would leak
 * the *hash* of a valid token, and a hash is not a credential — turning
 * it back into a token an attacker could present is a preimage attack.
 * The comparison is therefore not the load-bearing defence; **hashing
 * before comparing is.**
 *
 * It is still done in constant time. The cost is a few microseconds,
 * the alternative is a standing invitation to re-derive that argument
 * every time the code is read or the storage format changes, and the
 * argument stops holding the moment someone stores something other than
 * a digest.
 *
 * A length mismatch returns `false` instead of throwing, which
 * `timingSafeEqual` would: stored values come from a store this package
 * does not own, and a truncated row must fail a comparison rather than
 * crash a refresh.
 */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.byteLength !== right.byteLength) return false;
  return timingSafeEqual(left, right);
}
