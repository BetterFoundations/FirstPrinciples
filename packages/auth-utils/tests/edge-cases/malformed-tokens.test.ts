import { isErr, isOk, UnauthorizedError } from '@firstprinciples/core';
import { describe, expect, it } from 'vitest';

import { JwtVerificationError } from '../../src/errors.js';
import { createJwtSigner, createJwtVerifier } from '../../src/jwt.js';
import { parsePhc } from '../../src/internal/phc.js';

const ISSUER = 'https://issuer.test';
const AUDIENCE = 'https://api.test';
const SECRET = new Uint8Array(32).fill(9);

const verifier = createJwtVerifier({
  algorithms: ['HS256'],
  key: SECRET,
  issuer: ISSUER,
  audience: AUDIENCE,
});

describe('verify never throws, whatever it is handed', () => {
  it.each([
    ['an empty string', ''],
    ['a bare dot', '.'],
    ['two dots', '..'],
    ['one segment', 'abc'],
    ['two segments', 'abc.def'],
    ['four segments', 'a.b.c.d'],
    ['five segments (a JWE)', 'a.b.c.d.e'],
    ['an empty header segment', '.eyJhIjoxfQ.sig'],
    ['non-base64url in the header', '!!!.eyJhIjoxfQ.sig'],
    ['a header that is not JSON', 'bm90LWpzb24.eyJhIjoxfQ.sig'],
    ['a header that decodes to invalid UTF-8', '__8.eyJhIjoxfQ.sig'],
    ['whitespace', '   '],
    ['a very long string', 'a'.repeat(100_000)],
    ['a JSON document', '{"alg":"none"}'],
  ])('returns an Err for %s', async (_label, token) => {
    const result = await verifier.verify(token);

    expect(isOk(result)).toBe(false);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(JwtVerificationError);
      expect(result.error.httpStatus).toBe(401);
      expect(typeof result.error.details.reason).toBe('string');
    }
  });

  it.each([[null], [undefined], [42], [{}], [[]], [Symbol('t')]])(
    'returns an Err for the non-string input %p',
    async (token) => {
      const result = await verifier.verify(token as never);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.error.reason).toBe('malformed');
    },
  );

  it('rejects a token whose payload is not a JSON object', async () => {
    const header = Buffer.from('{"alg":"HS256"}', 'utf8').toString('base64url');
    const payload = Buffer.from('"just-a-string"', 'utf8').toString('base64url');
    const result = await verifier.verify(`${header}.${payload}.c2ln`);

    expect(isErr(result)).toBe(true);
  });

  it('rejects a token with a tampered payload', async () => {
    const signer = createJwtSigner({
      algorithm: 'HS256',
      key: SECRET,
      issuer: ISSUER,
      audience: AUDIENCE,
      ttlSeconds: 300,
    });
    const token = await signer.sign({ sub: 'user-1', role: 'viewer' });
    const [header, , signature] = token.split('.');

    const tampered = Buffer.from(
      JSON.stringify({
        sub: 'user-1',
        role: 'admin',
        iss: ISSUER,
        aud: AUDIENCE,
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
      'utf8',
    ).toString('base64url');

    const result = await verifier.verify(`${header}.${tampered}.${signature}`);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.reason).toBe('signature_invalid');
  });

  it('rejects a token whose signature is truncated by one character', async () => {
    const signer = createJwtSigner({
      algorithm: 'HS256',
      key: SECRET,
      issuer: ISSUER,
      audience: AUDIENCE,
      ttlSeconds: 300,
    });
    const token = await signer.sign({ sub: 'user-1' });

    const result = await verifier.verify(token.slice(0, -1));
    expect(isErr(result)).toBe(true);
  });
});

describe('error shape', () => {
  it('is an UnauthorizedError at runtime, not merely 401-shaped', async () => {
    // A generic handler written against `core` alone must catch this.
    const result = await verifier.verify('nope');
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(UnauthorizedError);
      expect(result.error.kind).toBe('UnauthorizedError');
      expect(result.error.name).toBe('JwtVerificationError');
    }
  });

  it('carries a machine-readable code, reason and 401', async () => {
    const result = await verifier.verify('a.b.c.d.e');

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      const { error } = result;
      expect(error.name).toBe('JwtVerificationError');
      expect(error.code).toBe('JWT_MALFORMED');
      expect(error.httpStatus).toBe(401);
      expect(error.details).toEqual({ reason: 'malformed' });
      expect(error.reason).toBe('malformed');
    }
  });

  it('never puts the token or key material in the message', async () => {
    const secretMarker = 'SUPER-SECRET-MARKER-VALUE';
    const result = await verifier.verify(
      `${Buffer.from(`{"alg":"HS256","kid":"${secretMarker}"}`).toString('base64url')}.e30.${secretMarker}`,
    );

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.message).not.toContain(secretMarker);
  });

  it('serializes without a stack, per core decision 2', async () => {
    const result = await verifier.verify('nope');
    if (isErr(result)) {
      const json = JSON.parse(JSON.stringify(result.error)) as Record<string, unknown>;
      expect(json).not.toHaveProperty('stack');
      expect(json.code).toBe('JWT_MALFORMED');
      // Round-trips back into a real UnauthorizedError rather than a
      // bare AppError, because `kind` names the taxonomy slot.
      expect(json.kind).toBe('UnauthorizedError');
      expect(json.name).toBe('JwtVerificationError');
    }
  });
});

describe('parsePhc', () => {
  it.each([
    ['not a string', 42],
    ['an empty string', ''],
    ['no leading $', 'argon2id$v=19'],
    ['only a $', '$'],
    ['an empty id', '$$v=19'],
  ])('returns undefined for %s', (_label, digest) => {
    expect(parsePhc(digest)).toBeUndefined();
  });

  it('reads m, t, p and v out of a real argon2 digest', () => {
    const parsed = parsePhc('$argon2id$v=19$m=19456,p=1,t=2$c2FsdA$aGFzaA');
    expect(parsed).toEqual({
      id: 'argon2id',
      version: 19,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  });

  it('leaves absent parameters undefined rather than defaulting them', () => {
    const parsed = parsePhc('$argon2id$v=19$m=1024$c2FsdA$aGFzaA');
    expect(parsed?.memoryCost).toBe(1024);
    expect(parsed?.timeCost).toBeUndefined();
    expect(parsed?.parallelism).toBeUndefined();
  });

  it('refuses non-numeric and oversized parameter values', () => {
    const parsed = parsePhc('$argon2id$v=abc$m=99999999999999999999,t=-1,p=1.5$c2FsdA$aGFzaA');
    expect(parsed?.version).toBeUndefined();
    expect(parsed?.memoryCost).toBeUndefined();
    expect(parsed?.timeCost).toBeUndefined();
    expect(parsed?.parallelism).toBeUndefined();
  });

  it('does not confuse a salt segment for a parameter segment', () => {
    // The salt is base64url and can contain no '=' (it is unpadded), so
    // "contains an =" is a sound way to find the parameter field.
    const parsed = parsePhc('$argon2id$v=19$m=1024,t=1,p=1$YWJjZGVmZ2hpamtsbW5vcA$aGFzaA');
    expect(parsed?.memoryCost).toBe(1024);
    expect(parsed?.id).toBe('argon2id');
  });
});
