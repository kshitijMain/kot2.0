import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { CredentialHasher } from '../../src/auth/credential-hasher.js';
import { RateLimiter } from '../../src/auth/rate-limiter.js';
import { open, seal } from '../../src/auth/secret-box.js';
import { FileSecretStore, type SecretName, type SecretStore } from '../../src/auth/secret-store.js';
import { AccessTokenError, randomToken, sha256Hex, TokenService } from '../../src/auth/tokens.js';

function memoryStore(seed = 1): SecretStore {
  return {
    get: (name: SecretName) => Promise.resolve(Buffer.alloc(32, `${name}-${String(seed)}`)),
  };
}

describe('[SEC-006] secret box', () => {
  const key = Buffer.alloc(32, 7);

  it('round-trips and uses a fresh IV every time', () => {
    const sealed = seal(key, Buffer.from('small-secret'));
    expect(open(key, sealed).toString()).toBe('small-secret');
    expect(seal(key, Buffer.from('small-secret'))).not.toBe(sealed);
  });

  it('rejects a tampered ciphertext or the wrong key', () => {
    const sealed = seal(key, Buffer.from('small-secret'));
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => open(key, parts.join('.'))).toThrow();
    expect(() => open(Buffer.alloc(32, 8), sealed)).toThrow();
    expect(() => open(key, 'v0.a.b.c')).toThrow(/Unrecognised/);
  });
});

describe('[SEC-002] [SEC-006] file secret store', () => {
  it('creates 32 random bytes with owner-only permissions and keeps them', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rp-secrets-'));
    const store = new FileSecretStore(directory, {});
    const [first, second] = await Promise.all([store.get('pin-pepper'), store.get('pin-pepper')]);
    expect(first).toHaveLength(32);
    expect(second.equals(first)).toBe(true);
    const file = join(directory, 'pin-pepper.key');
    expect(readFileSync(file).equals(first)).toBe(true);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    expect((await new FileSecretStore(directory, {}).get('pin-pepper')).equals(first)).toBe(true);
    expect((await store.get('token-signing-key')).equals(first)).toBe(false);
  });

  it('prefers a base64 secret from the environment and rejects short ones', async () => {
    const value = Buffer.alloc(32, 3).toString('base64');
    const directory = mkdtempSync(join(tmpdir(), 'rp-secrets-'));
    const store = new FileSecretStore(directory, { RP_SECRET_TOKEN_SIGNING_KEY: value });
    expect((await store.get('token-signing-key')).equals(Buffer.alloc(32, 3))).toBe(true);
    const short = new FileSecretStore(directory, { RP_SECRET_PIN_PEPPER: 'c2hvcnQ=' });
    await expect(short.get('pin-pepper')).rejects.toThrow(/at least 32 bytes/);
  });
});

describe('[AUTH-002] credential hashing', () => {
  const hasher = new CredentialHasher(memoryStore());

  it('uses Argon2id with the OWASP parameters and never stores the PIN', async () => {
    const encoded = await hasher.hash('4729');
    expect(encoded).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(encoded).not.toContain('4729');
    expect(await hasher.verify(encoded, '4729')).toBe(true);
    expect(await hasher.verify(encoded, '4728')).toBe(false);
  });

  it('depends on the pepper, so a stolen hash alone is useless', async () => {
    const encoded = await hasher.hash('4729');
    expect(await new CredentialHasher(memoryStore(2)).verify(encoded, '4729')).toBe(false);
  });

  it('treats malformed hashes and missing credentials as a mismatch', async () => {
    expect(await hasher.verify('not-a-hash', '4729')).toBe(false);
    expect(await hasher.verifyNothing('4729')).toBe(false);
  });
});

describe('[AUTH-005] access tokens', () => {
  const tokens = new TokenService(memoryStore());
  const claims = {
    staffId: '0199a000-0000-7000-8000-000000000001',
    role: 'MANAGER' as const,
    restaurantId: '0199a000-0000-7000-8000-000000000002',
    deviceId: '0199a000-0000-7000-8000-000000000003',
    sessionId: '0199a000-0000-7000-8000-000000000004',
  };

  it('round-trips the claims and reports the expiry', async () => {
    const now = new Date();
    const { token, expiresAt } = await tokens.signAccessToken(claims, 900, now);
    expect(expiresAt.getTime() - Math.floor(now.getTime() / 1000) * 1000).toBe(900_000);
    expect(await tokens.verifyAccessToken(token)).toEqual(claims);
  });

  it('rejects expired, tampered and foreign tokens', async () => {
    const { token } = await tokens.signAccessToken(claims, 60, new Date(Date.now() - 3_600_000));
    await expect(tokens.verifyAccessToken(token)).rejects.toMatchObject({
      reason: 'TOKEN_EXPIRED',
    });

    const valid = (await tokens.signAccessToken(claims, 60)).token;
    const [header, payload, signature] = valid.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload!, 'base64url').toString()),
        role: 'OWNER',
      }),
    ).toString('base64url');
    await expect(
      tokens.verifyAccessToken(`${header!}.${forgedPayload}.${signature!}`),
    ).rejects.toMatchObject({ reason: 'TOKEN_INVALID' });
    await expect(new TokenService(memoryStore(9)).verifyAccessToken(valid)).rejects.toBeInstanceOf(
      AccessTokenError,
    );
    const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${payload!}.`;
    await expect(tokens.verifyAccessToken(unsigned)).rejects.toMatchObject({
      reason: 'TOKEN_INVALID',
    });
    await expect(tokens.verifyAccessToken('garbage')).rejects.toMatchObject({
      reason: 'TOKEN_INVALID',
    });
  });

  it('rejects a correctly signed token with an unknown role', async () => {
    const key = await memoryStore().get('token-signing-key');
    const token = await new SignJWT({ role: 'ROOT', rid: 'r', did: 'd', sid: 's' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('x')
      .setIssuer('rp-local-server')
      .setAudience('rp-local')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
    await expect(tokens.verifyAccessToken(token)).rejects.toMatchObject({
      reason: 'TOKEN_INVALID',
    });
  });

  it('makes 256-bit random tokens and hex SHA-256 digests', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(randomToken());
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('[SEC-009] rate limiter', () => {
  it('allows the limit within the window, then refuses until attempts age out', () => {
    const limiter = new RateLimiter();
    const t0 = 1_000_000;
    for (let index = 0; index < 3; index += 1) {
      expect(limiter.attempt('device-a', 3, 60_000, t0 + index)).toBe(true);
    }
    expect(limiter.attempt('device-a', 3, 60_000, t0 + 10)).toBe(false);
    expect(limiter.attempt('device-b', 3, 60_000, t0 + 10)).toBe(true);
    expect(limiter.attempt('device-a', 3, 60_000, t0 + 60_001)).toBe(true);
  });
});
