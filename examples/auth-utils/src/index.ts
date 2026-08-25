/**
 * Runnable example for `@firstprinciples/auth-utils`.
 *
 *   pnpm --filter examples-auth-utils start
 *
 * Walks a real login flow, then tries to break it. The attack section is
 * the point: it runs the same forgeries the package's test suite runs,
 * so you can watch them bounce rather than take the README's word for it.
 */
import { isErr, isOk } from '@firstprinciples/core';
import {
  createJwtSigner,
  createJwtVerifier,
  createLoginRateLimiter,
  createMemoryAttemptStore,
  createMemoryRefreshTokenStore,
  createRefreshTokenService,
  DEFAULT_ARGON2_PARAMS,
  hashPassword,
  passwordNeedsRehash,
  verifyPassword,
  verifyPasswordDecoy,
} from '@firstprinciples/auth-utils';
import { base64url, exportSPKI, generateKeyPair, SignJWT } from 'jose';

const ISSUER = 'https://auth.example.com';
const AUDIENCE = 'https://api.example.com';

function section(title: string): void {
  console.log(`\n${'─'.repeat(64)}\n${title}\n${'─'.repeat(64)}`);
}

// ─────────────────────────────────────────────────────────────────────
section('1. Password hashing');

// Deliberately cheap so the example is snappy. Real deployments use the
// defaults or higher — see the README's parameter table.
const PARAMS = { memoryCost: 4096, timeCost: 1, parallelism: 1 };

console.log('package defaults:', DEFAULT_ARGON2_PARAMS);

const storedHash = await hashPassword('correct horse battery staple', PARAMS);
console.log('stored hash:     ', storedHash);
console.log(
  'right password:  ',
  await verifyPassword(storedHash, 'correct horse battery staple', PARAMS),
);
console.log('wrong password:  ', await verifyPassword(storedHash, 'hunter2', PARAMS));

// A corrupted row returns false instead of throwing an exception into
// your login handler — and still spends a full derivation, so it cannot
// be told apart from a real account by timing.
console.log('corrupted row:   ', await verifyPassword('not-a-hash', 'anything', PARAMS));

// The branch where the user does not exist. Same work, so the response
// time says nothing about whether the account is real.
console.log('no such user:    ', await verifyPasswordDecoy('anything', PARAMS));

// ─────────────────────────────────────────────────────────────────────
section('2. Upgrading parameters without locking anyone out');

const STRONGER = { memoryCost: 16384, timeCost: 2, parallelism: 1 };
console.log('needs rehash at current params? ', passwordNeedsRehash(storedHash, PARAMS));
console.log('needs rehash at stronger params?', passwordNeedsRehash(storedHash, STRONGER));

if (await verifyPassword(storedHash, 'correct horse battery staple', STRONGER)) {
  if (passwordNeedsRehash(storedHash, STRONGER)) {
    const upgraded = await hashPassword('correct horse battery staple', STRONGER);
    console.log('upgraded on login:', upgraded.slice(0, 40) + '…');
  }
}

// ─────────────────────────────────────────────────────────────────────
section('3. Issuing and verifying a token');

const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });

const signer = createJwtSigner({
  algorithm: 'RS256',
  key: privateKey,
  issuer: ISSUER,
  audience: AUDIENCE,
  ttlSeconds: 900,
});

const verifier = createJwtVerifier({
  algorithms: ['RS256'],
  key: publicKey,
  issuer: ISSUER,
  audience: AUDIENCE,
});

const token = await signer.sign({ sub: 'user-42', role: 'admin' });
console.log('token:', token.slice(0, 60) + '…');

const result = await verifier.verify(token);
if (isOk(result)) {
  console.log('verified ->', {
    sub: result.value.claims.sub,
    role: result.value.claims.role,
    alg: result.value.header.alg,
  });
}

// ─────────────────────────────────────────────────────────────────────
section('4. Now try to break it');

async function attack(label: string, forged: string): Promise<void> {
  const attempt = await verifier.verify(forged);
  if (isOk(attempt)) {
    console.log(`  ❗ LANDED   ${label} -> sub=${String(attempt.value.claims.sub)}`);
    process.exitCode = 1;
  } else if (isErr(attempt)) {
    console.log(`  ✔ rejected  ${label.padEnd(42)} ${attempt.error.reason}`);
  }
}

const claims = {
  sub: 'admin',
  iss: ISSUER,
  aud: AUDIENCE,
  exp: Math.floor(Date.now() / 1000) + 3600,
};
const encode = (value: unknown): string =>
  base64url.encode(new TextEncoder().encode(JSON.stringify(value)));

// alg: none — no signature at all.
await attack('alg: none', `${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims)}.`);

// Algorithm confusion: HS256 signed with the public key's PEM text.
const spkiPem = await exportSPKI(publicKey);
await attack(
  'RS256 replayed as HS256',
  await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(spkiPem)),
);

// Expired.
await attack(
  'expired an hour ago',
  await new SignJWT({ ...claims, exp: Math.floor(Date.now() / 1000) - 3600 })
    .setProtectedHeader({ alg: 'RS256' })
    .sign(privateKey),
);

// Not yet valid.
await attack(
  'not valid for another hour (nbf)',
  await new SignJWT({ ...claims, nbf: Math.floor(Date.now() / 1000) + 3600 })
    .setProtectedHeader({ alg: 'RS256' })
    .sign(privateKey),
);

// Wrong issuer.
await attack(
  'issued by someone else',
  await new SignJWT({ ...claims, iss: 'https://evil.example.com' })
    .setProtectedHeader({ alg: 'RS256' })
    .sign(privateKey),
);

// Wrong audience — a valid token for a different service.
await attack(
  'minted for another service (aud)',
  await new SignJWT({ ...claims, aud: 'https://billing.example.com' })
    .setProtectedHeader({ alg: 'RS256' })
    .sign(privateKey),
);

// A token carrying its own verification key.
await attack(
  'carries its own jwk header',
  `${encode({ alg: 'RS256', jwk: { kty: 'RSA', n: 'x', e: 'AQAB' } })}.${encode(claims)}.c2ln`,
);

// ─────────────────────────────────────────────────────────────────────
section('5. Misconfiguration fails at startup, not at request time');

for (const [label, build] of [
  [
    'allowlist mixing RS256 and HS256',
    (): unknown =>
      createJwtVerifier({
        algorithms: ['RS256', 'HS256'],
        key: publicKey,
        issuer: ISSUER,
        audience: AUDIENCE,
      }),
  ],
  [
    'public key PEM passed as an HMAC secret',
    (): unknown =>
      createJwtVerifier({
        algorithms: ['HS256'],
        key: new TextEncoder().encode(spkiPem),
        issuer: ISSUER,
        audience: AUDIENCE,
      }),
  ],
  [
    'an 8-byte HS256 secret',
    (): unknown =>
      createJwtVerifier({
        algorithms: ['HS256'],
        key: new Uint8Array(8),
        issuer: ISSUER,
        audience: AUDIENCE,
      }),
  ],
] as const) {
  try {
    build();
    console.log(`  ❗ ACCEPTED ${label}`);
    process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  ✔ refused   ${label}\n              ${message.slice(0, 96)}…`);
  }
}

// ─────────────────────────────────────────────────────────────────────
section('6. Refresh-token rotation');

const refresh = createRefreshTokenService({
  store: createMemoryRefreshTokenStore(),
  ttlSeconds: 60 * 60 * 24 * 7,
  absoluteTtlSeconds: 60 * 60 * 24 * 30,
});

const session = await refresh.issue({ subject: 'user-42' });
console.log('issued:  ', session.token.slice(0, 34) + '…');

const rotated = await refresh.rotate(session.token);
if (isOk(rotated)) {
  console.log('rotated: ', rotated.value.token.slice(0, 34) + '…');
  console.log('  same family, new token:', rotated.value.familyId === session.familyId);
}

// The old token is dead the instant the new one exists — one write.
const replayed = await refresh.rotate(session.token);
if (isErr(replayed)) {
  console.log('  ✔ replay of the old token ->', replayed.error.reason);
}

// ...and the replay took the whole family with it, including the
// perfectly legitimate token issued a moment ago.
if (isOk(rotated)) {
  const after = await refresh.rotate(rotated.value.token);
  if (isErr(after)) {
    console.log('  ✔ the successor is dead too   ->', after.error.reason);
  } else {
    console.log('  ❗ successor survived family revocation');
    process.exitCode = 1;
  }
}

// ─────────────────────────────────────────────────────────────────────
section('7. Two clients refreshing at the same instant');

const raced = createRefreshTokenService({
  store: createMemoryRefreshTokenStore(),
  ttlSeconds: 3600,
  absoluteTtlSeconds: 86_400,
});
const contested = await raced.issue({ subject: 'user-42' });

const [first, second] = await Promise.all([
  raced.rotate(contested.token),
  raced.rotate(contested.token),
]);

const outcomes = [first, second].map((r) => (isOk(r) ? 'ok' : r.error.reason)).sort();
console.log('  outcomes:', outcomes.join(', '));
if (outcomes.join(',') !== 'ok,reused') {
  console.log('  ❗ expected exactly one success and one detected reuse');
  process.exitCode = 1;
}
console.log('  the server cannot tell a double-submit from a theft, so it assumes theft');

// ─────────────────────────────────────────────────────────────────────
section('8. Login-attempt rate limiting');

const limiter = createLoginRateLimiter({
  store: createMemoryAttemptStore(),
  maxAttempts: 3,
  windowSeconds: 900,
});

// Key on both the account and the caller — see the README on why either
// one alone is a mistake.
const key = 'user-42|198.51.100.9';

for (let attempt = 1; attempt <= 4; attempt += 1) {
  const before = await limiter.check(key);
  if (!before.allowed) {
    console.log(`  attempt ${attempt}: refused before touching the password`);
    continue;
  }
  const decision = await limiter.recordFailure(key);
  console.log(`  attempt ${attempt}: failed, ${decision.remaining} remaining`);
}

await limiter.recordSuccess(key);
console.log('  after a success:', (await limiter.check(key)).remaining, 'remaining');

console.log('');
