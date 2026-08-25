import { base64url, exportSPKI, generateKeyPair, SignJWT, type CryptoKey } from 'jose';

/**
 * Shared fixtures for the attack suites.
 *
 * Every attack in `tests/attacks/` is written from the attacker's side:
 * it mints a token with `jose`'s own low-level primitives — never with
 * this package's signer — and hands it to a verifier configured the way
 * a real deployment would configure one. A test passes only when the
 * verifier *rejects*, with the specific reason we claim.
 */

export const ISSUER = 'https://issuer.test';
export const AUDIENCE = 'https://api.test';

export interface RsaFixture {
  readonly publicKey: CryptoKey;
  readonly privateKey: CryptoKey;
  /** The public key as a PEM document — public information, by definition. */
  readonly spkiPem: string;
}

export async function rsaFixture(): Promise<RsaFixture> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  return { publicKey, privateKey, spkiPem: await exportSPKI(publicKey) };
}

/** A 32-byte HMAC secret, the RFC 7518 §3.2 minimum for HS256. */
export function hmacSecret(fill = 0x11): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

export function baseClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: 'user-1',
    iss: ISSUER,
    aud: AUDIENCE,
    iat: now,
    exp: now + 300,
    ...overrides,
  };
}

/**
 * Assembles a compact JWS by hand, with no signing step at all.
 *
 * @remarks
 * This is how an `alg: none` token is actually built — there is no
 * library call that produces one, because no library will.
 */
export function forgeUnsigned(
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
  signature = '',
): string {
  const encode = (value: unknown): string =>
    base64url.encode(new TextEncoder().encode(JSON.stringify(value)));
  return `${encode(header)}.${encode(claims)}.${signature}`;
}

/** Signs a token with an arbitrary header and key — the attacker's minting tool. */
export async function forgeSigned(
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
  key: CryptoKey | Uint8Array,
): Promise<string> {
  return new SignJWT(claims).setProtectedHeader(header as never).sign(key as never);
}

/** Returns `claims` without the named registered claim. */
export function omitClaim(claims: Record<string, unknown>, name: string): Record<string, unknown> {
  const copy = { ...claims };
  // Test-only helper; `name` is always a literal at the call site.
  // eslint-disable-next-line security/detect-object-injection
  delete copy[name];
  return copy;
}
