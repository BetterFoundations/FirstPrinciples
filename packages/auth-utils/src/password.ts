import argon2 from 'argon2';

import { AuthConfigurationError, PasswordHashError } from './errors.js';
import { parsePhc } from './internal/phc.js';

/**
 * Argon2id cost parameters.
 *
 * @public
 */
export interface Argon2Params {
  /** Memory cost in KiB. */
  readonly memoryCost: number;
  /** Iterations over the memory block. */
  readonly timeCost: number;
  /** Lanes the derivation is split across. */
  readonly parallelism: number;
}

/**
 * The default argon2id cost parameters: **19 MiB, 2 iterations, 1 lane.**
 *
 * @remarks
 * These numbers are chosen, not copied. The reasoning, in the order it
 * actually decides things:
 *
 * **Memory is the only parameter that buys asymmetric defence.** An
 * attacker cracking stolen hashes wins by running many guesses at once.
 * What limits how many is memory — capacity and bandwidth — because
 * that is the resource a GPU or ASIC cannot multiply cheaply the way it
 * multiplies arithmetic units. Raising `timeCost` costs the attacker and
 * the defender the same multiple, with no asymmetry; raising
 * `memoryCost` costs the attacker per *parallel* guess. So: buy memory
 * first, and raise `timeCost` only to reach a latency target memory
 * alone cannot.
 *
 * **`parallelism` buys the defender nothing against an attacker.** Lanes
 * split one derivation across cores. An attacker parallelises across
 * *guesses* regardless of the defender's lane count, so total work per
 * guess is unchanged — `p` moves wall-clock time, not cost. Measured on
 * an Apple M2, `m=65536 t=3` takes 120 ms at `p=1` and 34–64 ms at
 * `p=4`, for identical attacker cost. `p=1` is therefore the right
 * default: it makes latency predictable (the `p=4` figures varied by
 * 2x run to run under threadpool contention) and keeps one login on
 * one of libuv's four default threadpool slots instead of four.
 *
 * **The binding constraint is memory under concurrency, not latency.**
 * Measured on the same machine, `m=19456 t=2 p=1` costs about 24 ms —
 * far inside any interactive budget. Latency is not what stops us going
 * higher; concurrent logins are. Each in-flight hash holds `memoryCost`
 * KiB resident, so 19 MiB supports ~100 concurrent logins in 1.9 GiB
 * while 64 MiB needs 6.4 GiB for the same.
 *
 * **Which is why the default is the floor and not the measured
 * optimum.** The two failure modes are not symmetric. Setting
 * `memoryCost` too low degrades continuously — cracking gets cheaper in
 * proportion. Setting it too high fails discontinuously: the process
 * cannot allocate during a login burst and the service is *down*, for
 * everyone, including the users whose passwords were never at risk. A
 * library default has to survive the worst deployment it lands in — a
 * 512 MiB container, a serverless function with a 128 MiB floor — not
 * the best one. 19456/2/1 is the OWASP Password Storage Cheat Sheet's
 * argon2id minimum and it fits everywhere.
 *
 * **So raise it deliberately, on your own hardware.** If you know your
 * memory ceiling and your peak concurrent logins, `m=65536 t=3 p=1`
 * (RFC 9106's second recommended configuration, and `argon2`'s own
 * default) is a better number and costs ~120 ms. Measure, then set it,
 * then use {@link passwordNeedsRehash} to migrate existing users on
 * their next login — which is why that function exists.
 *
 * Salt length (16 bytes) and digest length (32 bytes) are `argon2`'s
 * defaults and RFC 9106's recommendations; this package does not change
 * them.
 *
 * @public
 */
export const DEFAULT_ARGON2_PARAMS: Argon2Params = Object.freeze({
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});

/**
 * Largest password this package will hash, in UTF-8 bytes.
 *
 * @remarks
 * Argon2 has no input-length limit of its own — unlike bcrypt, it does
 * not silently truncate, which is the usual reason for a cap. This cap
 * exists for a different reason: an unbounded password field is a free
 * amplification factor for anyone posting login requests, on top of the
 * `memoryCost` they already cost you. 1 KiB comfortably holds any
 * passphrase a human will type and any pre-hashed value a caller might
 * pass through.
 *
 * @public
 */
export const MAX_PASSWORD_BYTES = 1024;

const ARGON2ID = 'argon2id';

/**
 * A fixed salt used only by {@link verifyPasswordDecoy}.
 *
 * @remarks
 * Not a secret and not security-relevant — its only job is to give the
 * decoy derivation a salt so it costs the same as a real one. It is
 * fixed rather than random so the decoy path allocates nothing extra.
 */
const DECOY_SALT = Buffer.alloc(16, 0x5a);

function resolveParams(params: Partial<Argon2Params> | undefined): Argon2Params {
  const resolved = { ...DEFAULT_ARGON2_PARAMS, ...params };
  for (const [name, value] of Object.entries(resolved)) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      throw new AuthConfigurationError(`\`${name}\` must be a positive integer.`);
    }
  }
  return resolved;
}

function assertHashablePassword(password: unknown): Buffer {
  if (typeof password !== 'string') {
    throw new AuthConfigurationError('`password` must be a string.');
  }
  if (password.length === 0) {
    // Not a policy opinion — minimum length is the application's call.
    // This catches the specific bug where an undefined field coerces to
    // '', which would otherwise hash and verify cleanly and hand
    // everyone with the same bug a working credential.
    throw new AuthConfigurationError(
      '`password` is empty. This is almost always a missing field rather than a chosen ' +
        'password; enforce your own minimum length before calling.',
    );
  }
  const bytes = Buffer.from(password, 'utf8');
  if (bytes.byteLength > MAX_PASSWORD_BYTES) {
    throw new AuthConfigurationError(
      `\`password\` is ${bytes.byteLength} bytes, above the ${MAX_PASSWORD_BYTES}-byte cap.`,
    );
  }
  return bytes;
}

/**
 * Hashes a password with argon2id.
 *
 * @remarks
 * The input is hashed as UTF-8 exactly as given. It is **not** Unicode-
 * normalised, so two visually identical passwords in different normal
 * forms produce different hashes. That is deliberate and matches the
 * rest of this ecosystem — `core`'s parsers never rewrite their input
 * either. Normalising here would silently change what a user's password
 * *is*, and any deployment that later stopped normalising would lock
 * out everyone who typed a composed character. Normalise at your input
 * boundary if you want it, consistently, on both registration and
 * login.
 *
 * @param password - The plaintext password.
 * @param params - Cost parameters. Defaults to {@link DEFAULT_ARGON2_PARAMS}.
 *
 * @returns The PHC-format digest, safe to store as-is: it carries the salt,
 * the variant and the parameters, so verification needs nothing else.
 *
 * @throws {@link AuthConfigurationError} for an empty, over-long, or non-string password.
 * @throws {@link PasswordHashError} if the derivation itself fails.
 *
 * @public
 */
export async function hashPassword(
  password: string,
  params?: Partial<Argon2Params>,
): Promise<string> {
  const bytes = assertHashablePassword(password);
  const resolved = resolveParams(params);
  try {
    return await argon2.hash(bytes, { ...resolved, type: argon2.argon2id });
  } catch (cause) {
    throw new PasswordHashError('argon2id hashing failed.', cause);
  }
}

/**
 * Checks a password against a stored hash.
 *
 * @remarks
 * **Constant-time, on two separate axes.**
 *
 * The digest comparison is constant-time because `argon2.verify` ends
 * in `crypto.timingSafeEqual` — read directly in `argon2@0.45.1`'s
 * `argon2.cjs`, not assumed — and because it derives the candidate at
 * `hashLength: actual.byteLength`, the two buffers always match in
 * length, so `timingSafeEqual` cannot throw its own length error.
 *
 * The second axis is the one that actually leaks in production, and
 * this function closes it: **an unusable stored hash still costs a full
 * derivation.** A corrupted row, a bcrypt hash left over from a
 * migration, or a sentinel value written for a locked account would
 * otherwise return `false` in microseconds while a real account takes
 * ~24 ms — a timing oracle that tells an attacker which accounts exist
 * and which are locked, without a single successful login. See
 * {@link verifyPasswordDecoy} for the same problem one layer up, where
 * the user does not exist at all.
 *
 * **Never throws for a bad stored hash.** `argon2.verify` does: against
 * `argon2@0.45.1`, verifying the string "garbage" raises a TypeError
 * reading "pchstr must contain a $ as first char", and a
 * structurally-valid-but-nonsense argon2id string raises
 * "Output pointer is NULL" out of the native binding. An exception
 * escaping a login handler because one row is malformed is a worse
 * outcome than a failed login.
 *
 * **Verifies any argon2 variant, on purpose.** A stored `$argon2i$`
 * digest from a previous library still verifies, so migrating in does
 * not lock anyone out. {@link passwordNeedsRehash} is what tells you to
 * upgrade it — and it reports the variant, which `argon2.needsRehash`
 * does not.
 *
 * @param storedHash - The PHC digest from your database. Untrusted.
 * @param password - The plaintext candidate.
 * @param params - Cost parameters for the equalising derivation on the
 * unusable-hash path **only**. A usable digest carries its own
 * parameters and this is ignored. Pass the parameters your real hashes
 * use: if they are not the defaults and this is left unset, the
 * unusable-hash path costs a visibly different amount and the timing
 * oracle described above reopens.
 *
 * @returns `true` only if the password derives the stored digest.
 *
 * @public
 */
export async function verifyPassword(
  storedHash: unknown,
  password: string,
  params?: Partial<Argon2Params>,
): Promise<boolean> {
  const bytes = assertHashablePassword(password);
  const parsed = parsePhc(storedHash);

  if (parsed === undefined || !parsed.id.startsWith('argon2')) {
    await burnEquivalentWork(bytes, resolveParams(params));
    return false;
  }

  try {
    return await argon2.verify(storedHash as string, bytes);
  } catch {
    // Reached when the digest parses as PHC but the binding still
    // cannot use it — a truncated salt, an impossible `m`. Not a
    // password failure, but not a reason to 500 either. This path is
    // not time-equalised: getting here means the binding already spent
    // most of a derivation before failing, and the parameters that
    // would equalise it are the unusable ones in the digest.
    return false;
  }
}

/**
 * Spends a real derivation and returns `false`.
 *
 * @remarks
 * For the branch where **there is no user to verify against**. That
 * branch is the loudest timing oracle in any login endpoint: returning
 * early costs microseconds where a real account costs ~24 ms, so an
 * attacker enumerates your entire user table by stopwatch, without ever
 * guessing a password correctly.
 *
 * This does the same work a real verify does — one argon2id derivation
 * at the same parameters — rather than comparing against a canned decoy
 * digest, which would be the same cost with an extra constant to keep
 * in sync.
 *
 * ```ts
 * const user = await users.findByEmail(email);
 * const valid = user
 *   ? await verifyPassword(user.passwordHash, password)
 *   : await verifyPasswordDecoy(password);
 * if (!valid) return unauthorized();
 * ```
 *
 * Pass the same `params` your stored hashes use, or the two branches
 * cost visibly different amounts and the oracle reopens.
 *
 * @param password - The submitted password. Hashed and discarded.
 * @param params - Must match the parameters your real hashes use.
 *
 * @returns Always `false`.
 *
 * @public
 */
export async function verifyPasswordDecoy(
  password: string,
  params?: Partial<Argon2Params>,
): Promise<false> {
  const bytes = assertHashablePassword(password);
  await burnEquivalentWork(bytes, resolveParams(params));
  return false;
}

async function burnEquivalentWork(
  password: Buffer,
  params: Argon2Params = DEFAULT_ARGON2_PARAMS,
): Promise<void> {
  try {
    await argon2.hash(password, {
      ...params,
      type: argon2.argon2id,
      salt: DECOY_SALT,
      raw: true,
    });
  } catch {
    // A decoy derivation that fails must not change the caller's
    // outcome — the caller is already on a failure path.
  }
}

/**
 * Whether a stored hash should be re-derived at current parameters.
 *
 * @remarks
 * Synchronous, and takes no password, because rehash-need is a property
 * of the stored digest alone. That also makes it usable as an audit over
 * a whole table, not just inside a login handler.
 *
 * Returns `true` when the digest is not argon2id, when any cost
 * parameter is below the target, or when the digest is unreadable. The
 * variant check is the one `argon2.needsRehash` misses: against
 * `argon2@0.45.1` it reports `false` for an `$argon2d$` digest whose
 * `m`/`t`/`p` happen to match, so the natural rehash-on-login upgrade
 * path would never migrate a wrong-variant hash off the data-dependent
 * variant it is sitting on.
 *
 * The comparison is "below target", not "different from target".
 * Lowering your parameters should not force every user's hash to be
 * re-derived weaker on next login.
 *
 * ```ts
 * if (await verifyPassword(user.passwordHash, password)) {
 *   if (passwordNeedsRehash(user.passwordHash)) {
 *     await users.setPasswordHash(user.id, await hashPassword(password));
 *   }
 * }
 * ```
 *
 * @param storedHash - The PHC digest from your database. Untrusted.
 * @param params - The parameters you hash with now. Defaults to {@link DEFAULT_ARGON2_PARAMS}.
 *
 * @public
 */
export function passwordNeedsRehash(storedHash: unknown, params?: Partial<Argon2Params>): boolean {
  const target = resolveParams(params);
  const parsed = parsePhc(storedHash);

  if (parsed === undefined) return true;
  if (parsed.id !== ARGON2ID) return true;
  if (parsed.version === undefined || parsed.version < 0x13) return true;
  if (parsed.memoryCost === undefined || parsed.memoryCost < target.memoryCost) return true;
  if (parsed.timeCost === undefined || parsed.timeCost < target.timeCost) return true;
  if (parsed.parallelism === undefined || parsed.parallelism < target.parallelism) return true;

  return false;
}
