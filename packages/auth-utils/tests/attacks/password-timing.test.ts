import argon2 from 'argon2';
import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword, verifyPasswordDecoy } from '../../src/password.js';

/**
 * ATTACK: learning things by stopwatch.
 *
 * Password verification leaks on two axes, and only one of them is the
 * one everybody names.
 *
 * The famous one is the **digest comparison** — `===` on two hashes
 * short-circuits at the first differing byte. That one is handled inside
 * `argon2.verify`, which ends in `crypto.timingSafeEqual`, and is
 * untestable from out here: the comparison is nanoseconds inside a
 * multi-millisecond derivation, so any "timing test" of it would be
 * measuring noise and passing regardless. What *is* testable is the
 * property that makes it safe, and that is asserted at the bottom of
 * this file.
 *
 * The one that actually leaks in production is **the shape of the
 * control flow around the derivation**. If "no such user" returns in
 * microseconds and "user exists, wrong password" takes 24 ms, an
 * attacker enumerates the whole user table with a stopwatch and never
 * needs to guess a password. Same for a locked account with a sentinel
 * in the hash column, or a row corrupted by a bad migration.
 */

/** Costly enough that the derivation dominates noise, cheap enough to run often. */
const PARAMS = { memoryCost: 8192, timeCost: 2, parallelism: 1 } as const;

const ROUNDS = 9;

/**
 * Times several operations against each other on a machine that is
 * probably busy, and returns the best (lowest) time seen for each.
 *
 * @remarks
 * Two decisions here are what make this test survive CI, and both were
 * arrived at by watching it fail rather than by guessing.
 *
 * **Interleaved, not sequential.** Measuring one operation to completion
 * and then the next gives each its own load window. An earlier version
 * did that and failed under a full parallel workspace build with the
 * *baseline* as the outlier — 34.6 ms against 11.2 ms for what was
 * literally the same operation with a different password. Round-robin
 * means a load spike lands on every operation, not just whichever one
 * was running.
 *
 * **Minimum, not median.** Contention only ever makes a measurement
 * slower; nothing makes it artificially fast. So the minimum across
 * rounds is the cleanest estimate of what an operation actually costs,
 * and it is the standard choice for microbenchmarks on a shared runner.
 * A median still carries whatever the machine was doing for half the
 * samples.
 *
 * Neither weakens what the test catches. An early return does not get
 * slower under load — it stays at microseconds, four orders of
 * magnitude below the floor, which the calibration test below pins down.
 */
async function bestTimings(
  operations: Record<string, () => Promise<unknown>>,
): Promise<Record<string, number>> {
  const names = Object.keys(operations);
  const best: Record<string, number> = {};

  /* eslint-disable security/detect-object-injection --
     every key comes from Object.keys of the caller's own literal, and
     the target is a fresh object; test-local helper. */
  for (const name of names) {
    // One untimed warm-up each: the first call through the native
    // binding pays for lazy initialisation no later call pays.
    await operations[name]?.();
    best[name] = Number.POSITIVE_INFINITY;
  }

  for (let round = 0; round < ROUNDS; round += 1) {
    for (const name of names) {
      const started = process.hrtime.bigint();
      await operations[name]?.();
      const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
      if (elapsed < (best[name] as number)) best[name] = elapsed;
    }
  }
  /* eslint-enable security/detect-object-injection */

  return best;
}

describe('attack: user enumeration by response time', () => {
  it('spends the same work whether the account exists, is broken, or is missing', async () => {
    const realHash = await hashPassword('the-real-password', PARAMS);

    const timings = await bestTimings({
      baseline: () => verifyPassword(realHash, 'the-real-password', PARAMS),
      'wrong password, real account': () => verifyPassword(realHash, 'wrong-password', PARAMS),
      'unparseable hash (corrupted row)': () =>
        verifyPassword('not-a-hash', 'wrong-password', PARAMS),
      'sentinel hash (locked account)': () => verifyPassword('!', 'wrong-password', PARAMS),
      'bcrypt leftover from a migration': () =>
        verifyPassword('$2b$12$abcdefghijklmnopqrstuv', 'wrong-password', PARAMS),
      'no such user at all (decoy)': () => verifyPasswordDecoy('wrong-password', PARAMS),
    });

    const baseline = timings.baseline as number;

    // Sanity check on the measurement itself: if the baseline is not
    // meaningfully above zero, the assertions below prove nothing.
    expect(baseline).toBeGreaterThan(1);

    for (const [label, elapsed] of Object.entries(timings)) {
      if (label === 'baseline') continue;
      const ratio = elapsed / baseline;
      expect(
        ratio,
        `"${label}" took ${elapsed.toFixed(1)}ms against a ${baseline.toFixed(1)}ms baseline ` +
          `(${ratio.toFixed(2)}x). An early return on this path is a user-enumeration oracle.`,
      ).toBeGreaterThan(1 / 3);
      expect(ratio).toBeLessThan(3);
    }
  });

  it('a naive early return would be caught by that band, by four orders of magnitude', async () => {
    // Calibrates the test above: this is what the regression it guards
    // against actually looks like. If this ever stops being far below
    // the 1/3 floor, the band has gone slack and the guard is useless.
    const realHash = await hashPassword('pw', PARAMS);

    const timings = await bestTimings({
      baseline: () => verifyPassword(realHash, 'pw', PARAMS),
      'early return': async () => 'not-a-hash'.startsWith('$argon2') === false,
    });

    expect((timings['early return'] as number) / (timings.baseline as number)).toBeLessThan(0.01);
  });
});

describe('the property that makes the digest comparison safe', () => {
  it('derives the candidate at the stored digest length, so lengths always match', async () => {
    // `crypto.timingSafeEqual` throws a RangeError on buffers of
    // different lengths. `argon2.verify` never hits that because it
    // passes `hashLength: actual.byteLength` — the length is taken from
    // the stored digest, so the two are equal by construction.
    //
    // Testing that directly is not possible from out here, so this
    // tests its observable consequence: a digest of a *non-default*
    // length still verifies correctly rather than throwing, which it
    // could not do if the candidate were derived at a fixed 32 bytes.
    for (const hashLength of [16, 24, 64]) {
      const digest = await argon2.hash('pw', {
        ...PARAMS,
        type: argon2.argon2id,
        hashLength,
      });

      expect(await verifyPassword(digest, 'pw', PARAMS)).toBe(true);
      expect(await verifyPassword(digest, 'wrong', PARAMS)).toBe(false);
    }
  });

  it('returns a boolean, never a truthy object', async () => {
    // Not a timing property, but the same family of mistake: a verify
    // that returned `{ valid, needsRehash }` would make
    // `if (await verifyPassword(...))` pass for every password on
    // earth. It is why `passwordNeedsRehash` is a separate function.
    const hash = await hashPassword('pw', PARAMS);
    expect(await verifyPassword(hash, 'pw', PARAMS)).toBe(true);
    expect(await verifyPassword(hash, 'nope', PARAMS)).toBe(false);
    expect(typeof (await verifyPassword(hash, 'nope', PARAMS))).toBe('boolean');
  });
});
