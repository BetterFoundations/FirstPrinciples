/**
 * The fields of a PHC-format argon2 digest that this package needs.
 *
 * @remarks
 * Read-only, and deliberately partial. We never *construct* a PHC
 * string — `argon2.hash` does that — so there is no round-trip to get
 * wrong. We only need to answer two questions about a stored hash:
 * which argon2 variant produced it, and with what cost parameters.
 */
export interface ParsedPhc {
  /** `argon2id`, `argon2i`, `argon2d`, or whatever else was in the string. */
  readonly id: string;
  /** Memory cost in KiB (`m`), or `undefined` if absent or unparseable. */
  readonly memoryCost: number | undefined;
  /** Time cost / iterations (`t`). */
  readonly timeCost: number | undefined;
  /** Lanes (`p`). */
  readonly parallelism: number | undefined;
  /** Algorithm version (`v`), normally 19 (0x13). */
  readonly version: number | undefined;
}

/**
 * Parses the identifier and cost parameters out of a PHC-format string.
 *
 * @remarks
 * `argon2` uses `@phc/format` internally and that parser **throws** on
 * anything malformed — verified against `argon2@0.45.1`:
 * `deserialize('garbage')` raises a TypeError reading
 * "pchstr must contain a $ as first char". Every caller here is
 * handling a value that came out of a database, so "throws on a
 * corrupted row" is not an acceptable contract. This parser returns
 * `undefined` instead, and is total.
 *
 * It intentionally does not decode the salt or digest. Those are only
 * needed to *re-derive* a hash, which is `argon2.verify`'s job, and
 * hand-rolling that decode would be inventing risk for no gain.
 *
 * @param digest - An untrusted stored hash.
 *
 * @returns The parsed fields, or `undefined` if this is not a PHC string.
 */
export function parsePhc(digest: unknown): ParsedPhc | undefined {
  if (typeof digest !== 'string' || digest.length === 0 || digest[0] !== '$') return undefined;

  // $<id>[$v=<version>][$<params>][$<salt>[$<hash>]]
  const fields = digest.split('$');
  // A leading '$' means fields[0] is always ''.
  const id = fields[1];
  if (id === undefined || id.length === 0) return undefined;

  let version: number | undefined;
  let memoryCost: number | undefined;
  let timeCost: number | undefined;
  let parallelism: number | undefined;

  for (const field of fields.slice(2)) {
    if (field.startsWith('v=')) {
      version = toInteger(field.slice(2));
      continue;
    }
    // The parameter field is the one containing '='-delimited pairs.
    // argon2 serializes it as `m=<n>,p=<n>,t=<n>` — note the order is
    // m,p,t, not the m,t,p that every docs example writes.
    if (!field.includes('=')) continue;
    for (const pair of field.split(',')) {
      const separator = pair.indexOf('=');
      if (separator < 0) continue;
      const name = pair.slice(0, separator);
      const value = toInteger(pair.slice(separator + 1));
      if (name === 'm') memoryCost = value;
      else if (name === 't') timeCost = value;
      else if (name === 'p') parallelism = value;
    }
  }

  return { id, memoryCost, timeCost, parallelism, version };
}

function toInteger(raw: string): number | undefined {
  if (!/^\d{1,10}$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}
