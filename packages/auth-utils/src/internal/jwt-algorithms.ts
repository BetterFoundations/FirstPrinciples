import type { JWK, KeyInput } from 'jose';

import { AuthConfigurationError } from '../errors.js';

/**
 * HMAC algorithms. One shared secret both signs and verifies.
 */
const SYMMETRIC_ALGORITHMS = ['HS256', 'HS384', 'HS512'] as const;

/**
 * Public-key algorithms. A private key signs, a public key verifies.
 */
const ASYMMETRIC_ALGORITHMS = [
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
] as const;

/**
 * Every JWS algorithm this package will sign or verify with.
 *
 * @remarks
 * `none` is absent by construction, and cannot be added: it is not a
 * signature algorithm, it is the absence of one. Note that the type
 * alone guarantees nothing at runtime — types are erased, and the `alg`
 * in an attacker-supplied token has never been through the compiler.
 * {@link isJwtAlgorithm} is the check that actually holds.
 *
 * @public
 */
export type JwtAlgorithm =
  (typeof SYMMETRIC_ALGORITHMS)[number] | (typeof ASYMMETRIC_ALGORITHMS)[number];

/** Which key shape an algorithm requires. */
export type AlgorithmFamily = 'symmetric' | 'asymmetric';

const FAMILY_BY_ALGORITHM = new Map<string, AlgorithmFamily>([
  ...SYMMETRIC_ALGORITHMS.map((a) => [a, 'symmetric'] as const),
  ...ASYMMETRIC_ALGORITHMS.map((a) => [a, 'asymmetric'] as const),
]);

/**
 * Runtime membership test for {@link JwtAlgorithm}.
 *
 * @remarks
 * This is the check that rejects `alg: none`, `alg: NONE`, `alg: 42`,
 * and `alg: "__proto__"`. A `Map` is used rather than an object literal
 * so a prototype-chain key can never register as a hit.
 *
 * @param value - An untrusted `alg` header value.
 *
 * @public
 */
export function isJwtAlgorithm(value: unknown): value is JwtAlgorithm {
  return typeof value === 'string' && FAMILY_BY_ALGORITHM.has(value);
}

/**
 * The key shape a given algorithm requires.
 *
 * @param algorithm - A validated algorithm name.
 */
export function algorithmFamily(algorithm: JwtAlgorithm): AlgorithmFamily {
  // Non-null: `JwtAlgorithm` is exactly the Map's key set, and every
  // public entry point runs `isJwtAlgorithm` before reaching here.
  return FAMILY_BY_ALGORITHM.get(algorithm) as AlgorithmFamily;
}

/**
 * Minimum HMAC secret length in bytes, per RFC 7518 §3.2: "A key of the
 * same size as the hash output ... MUST be used with this algorithm."
 *
 * @remarks
 * `jose` does not enforce this, so an `HS256` verifier will happily
 * accept a four-byte secret — which is offline-brute-forceable from a
 * single captured token, since the token itself is the oracle.
 */
const MINIMUM_SECRET_BYTES = new Map<JwtAlgorithm, number>([
  ['HS256', 32],
  ['HS384', 48],
  ['HS512', 64],
]);

/**
 * The one field we read off a Node `KeyObject`.
 *
 * @remarks
 * Declared structurally rather than imported from `node:crypto`. The
 * `./jwt` entry point is meant to run on edge runtimes with no Node
 * built-ins, and a type-only import of `node:crypto` still lands in the
 * emitted `.d.ts`, which then fails to resolve for a consumer without
 * `@types/node`. (It also breaks tsup's own dts build, which is how
 * this was found.)
 */
interface SymmetricKeyObject {
  readonly symmetricKeySize?: number;
}

/** What a key can be used for, as far as we can determine it. */
export type KeyRole = 'secret' | 'public' | 'private';

/**
 * A key that carries a `type` discriminant — Node's `KeyObject` and Web
 * Crypto's `CryptoKey` both do, with the same three values.
 */
interface TypedKey {
  readonly type: unknown;
}

function hasKeyType(key: object): key is TypedKey {
  return 'type' in key;
}

/**
 * Classifies a key into the role it can play, without trusting the
 * caller's word for it.
 *
 * @remarks
 * Four shapes reach here, because `jose` accepts all four: a
 * `Uint8Array` (raw HMAC secret), a Node `KeyObject`, a Web Crypto
 * `CryptoKey`, and a plain JWK object. Returns `undefined` for anything
 * unrecognized so the caller can reject rather than guess.
 *
 * @param key - The key as supplied by the caller.
 */
export function classifyKey(key: unknown): KeyRole | undefined {
  if (key instanceof Uint8Array) return 'secret';
  if (typeof key !== 'object' || key === null) return undefined;

  if (hasKeyType(key)) {
    const { type } = key;
    if (type === 'secret' || type === 'public' || type === 'private') return type;
    return undefined;
  }

  // A plain JWK. `oct` is the only symmetric key type; everything else
  // (RSA, EC, OKP, AKP) is asymmetric, and `d` is the private exponent.
  const jwk = key as JWK;
  if (typeof jwk.kty !== 'string') return undefined;
  if (jwk.kty === 'oct') return 'secret';
  return typeof jwk.d === 'string' ? 'private' : 'public';
}

/**
 * Bytes that begin a PEM document.
 *
 * @remarks
 * `2d 2d 2d 2d 2d` — five ASCII hyphens, the opening of `-----BEGIN`.
 */
const PEM_PREFIX = '-----';

/**
 * Rejects a raw secret that is actually a PEM-encoded key.
 *
 * @remarks
 * This is not hypothetical tidiness. It is the exact primitive of the
 * classic algorithm-confusion CVE, reproduced against `jose 6.2.10` in
 * this package's `tests/attacks/algorithm-confusion.test.ts`:
 * `fs.readFileSync('public.pem')` yields a `Buffer`, a `Buffer` is a
 * `Uint8Array`, and `jose` reads a `Uint8Array` as an HMAC secret. Hand
 * that to a verifier and an attacker who has the public key — which is
 * public — can mint tokens by HMAC-ing with its PEM text.
 *
 * The allowlist checks below already make this unreachable. This runs
 * anyway, because a secret whose first five bytes are `-----` is never
 * a deliberate choice, and the resulting error names the real mistake
 * instead of an abstract family mismatch.
 *
 * @param secret - A caller-supplied HMAC secret.
 */
function assertNotPemBytes(secret: Uint8Array): void {
  if (secret.byteLength < PEM_PREFIX.length) return;
  const head = new TextDecoder().decode(secret.subarray(0, PEM_PREFIX.length));
  if (head === PEM_PREFIX) {
    throw new AuthConfigurationError(
      'The HMAC secret looks like a PEM document. Reading a public key file and passing ' +
        'the bytes as a symmetric secret is the algorithm-confusion attack itself — an ' +
        "attacker holding that (public) key can forge tokens. Import it with jose's " +
        '`importSPKI` and configure an asymmetric algorithm instead.',
    );
  }
}

/**
 * A validated, non-empty allowlist that every algorithm in it agrees on
 * a single key family.
 */
export interface ResolvedAllowlist {
  readonly algorithms: ReadonlySet<JwtAlgorithm>;
  readonly family: AlgorithmFamily;
}

/**
 * Validates an algorithm allowlist and pins it to one key family.
 *
 * @remarks
 * Rejecting a *mixed* allowlist is the structural fix for algorithm
 * confusion, and it is worth being precise about why. The attack needs
 * two things to be simultaneously true: the verifier accepts a
 * symmetric algorithm, and it holds a key an attacker also holds. A
 * single verifier that accepts both `RS256` and `HS256` is the only
 * configuration where both can hold at once — and no legitimate
 * deployment needs one, because one verifier has one key. Refusing the
 * combination removes the attack's precondition rather than trying to
 * detect the attack.
 *
 * A deployment that genuinely accepts two algorithms builds two
 * verifiers and tries each. That is more typing, and it is honest about
 * the fact that two algorithms means two keys.
 *
 * @param algorithms - The caller's allowlist, unvalidated.
 * @param label - `'algorithms'` or `'algorithm'`, for the message.
 */
export function resolveAllowlist(algorithms: unknown, label: string): ResolvedAllowlist {
  if (!Array.isArray(algorithms) || algorithms.length === 0) {
    throw new AuthConfigurationError(
      `\`${label}\` must be a non-empty array. There is no safe default: jose allows every ` +
        'algorithm the key supports when no allowlist is given, which for a raw-byte key ' +
        'means every HMAC variant.',
    );
  }

  const resolved = new Set<JwtAlgorithm>();
  let family: AlgorithmFamily | undefined;

  for (const algorithm of algorithms as unknown[]) {
    if (!isJwtAlgorithm(algorithm)) {
      throw new AuthConfigurationError(
        `\`${label}\` contains ${JSON.stringify(algorithm)}, which is not a supported JWS ` +
          'signature algorithm. `none` is not supported and never will be.',
      );
    }
    const thisFamily = algorithmFamily(algorithm);
    if (family !== undefined && family !== thisFamily) {
      throw new AuthConfigurationError(
        `\`${label}\` mixes symmetric and asymmetric algorithms (${[...resolved].join(', ')}` +
          ` and ${algorithm}). One verifier holds one key, and a key that can verify an ` +
          'HMAC is a key that can forge one — this is the algorithm-confusion precondition. ' +
          'Build one verifier per algorithm instead.',
      );
    }
    family = thisFamily;
    resolved.add(algorithm);
  }

  return { algorithms: resolved, family: family as AlgorithmFamily };
}

/**
 * Confirms the supplied key can serve the resolved allowlist in the
 * given direction, and rejects it at construction time otherwise.
 *
 * @param key - The caller's key.
 * @param allowlist - Output of {@link resolveAllowlist}.
 * @param direction - `'sign'` needs a private key or a secret; `'verify'` needs a public key or a secret.
 */
export function assertKeyMatchesAllowlist(
  key: KeyInput,
  allowlist: ResolvedAllowlist,
  direction: 'sign' | 'verify',
): void {
  const role = classifyKey(key);

  if (role === undefined) {
    throw new AuthConfigurationError(
      'Unrecognized key. Pass a Uint8Array secret, a Node KeyObject, a Web Crypto ' +
        'CryptoKey, or a JWK object.',
    );
  }

  if (allowlist.family === 'symmetric') {
    if (role !== 'secret') {
      throw new AuthConfigurationError(
        `An HMAC algorithm was configured but the key is a ${role} key. Verifying an HMAC ` +
          'with a key an attacker can also hold means the attacker can sign.',
      );
    }
    assertSecretStrength(key, allowlist);
    return;
  }

  const required = direction === 'sign' ? 'private' : 'public';
  if (role !== required) {
    throw new AuthConfigurationError(
      role === 'secret'
        ? `An asymmetric algorithm (${[...allowlist.algorithms].join(', ')}) was configured ` +
            'but the key is raw bytes, which jose reads as an HMAC secret. Import the key ' +
            "with jose's `importSPKI` / `importPKCS8` first."
        : `A ${direction === 'sign' ? 'signer' : 'verifier'} needs the ${required} key, ` +
            `but a ${role} key was supplied.`,
    );
  }
}

/**
 * Enforces RFC 7518 §3.2's minimum HMAC secret length.
 *
 * @remarks
 * Only checkable when the secret's length is visible. A `KeyObject` of
 * type `secret` exposes `symmetricKeySize`; a non-extractable
 * `CryptoKey` exposes nothing, and is left to the caller.
 */
function assertSecretStrength(key: KeyInput, allowlist: ResolvedAllowlist): void {
  let bytes: number | undefined;

  if (key instanceof Uint8Array) {
    assertNotPemBytes(key);
    bytes = key.byteLength;
  } else if (typeof key === 'object' && key !== null) {
    const size = (key as SymmetricKeyObject).symmetricKeySize;
    if (typeof size === 'number') bytes = size;
    const jwkValue = (key as JWK).k;
    // A JWK `oct` key carries its material base64url-encoded: 4 chars
    // per 3 bytes, unpadded.
    if (bytes === undefined && typeof jwkValue === 'string') {
      bytes = Math.floor((jwkValue.length * 3) / 4);
    }
  }

  if (bytes === undefined) return;

  for (const algorithm of allowlist.algorithms) {
    const minimum = MINIMUM_SECRET_BYTES.get(algorithm) ?? 32;
    if (bytes < minimum) {
      throw new AuthConfigurationError(
        `${algorithm} requires a secret of at least ${minimum} bytes (RFC 7518 §3.2); ` +
          `${bytes} were supplied. A short HMAC secret is brute-forceable offline from a ` +
          'single captured token. Generate one with `crypto.randomBytes(' +
          `${minimum})\`.`,
      );
    }
  }
}
