import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, httpServer } from '../helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js';

let database: TestDatabase;
let app: INestApplication;
let phoneDir: string;

beforeAll(async () => {
  const consoleDir = mkdtempSync(join(tmpdir(), 'rp-console-'));
  writeFileSync(join(consoleDir, 'index.html'), '<!doctype html><title>Console</title>');
  phoneDir = mkdtempSync(join(tmpdir(), 'rp-phone-'));
  mkdirSync(join(phoneDir, '_expo', 'static', 'js', 'web'), { recursive: true });
  writeFileSync(join(phoneDir, 'index.html'), '<!doctype html><title>Parossa Captain</title>');
  writeFileSync(join(phoneDir, '_expo', 'static', 'js', 'web', 'index-3f2a1b.js'), 'void 0');
  writeFileSync(join(phoneDir, 'sw.js'), 'self.addEventListener("install", () => {});');
  writeFileSync(join(phoneDir, 'manifest.webmanifest'), '{"name":"Parossa Captain"}');
  database = await createTestDatabase();
  app = await createTestApp({ databaseUrl: database.url, config: { consoleDir, phoneDir } });
});

afterAll(async () => {
  await app.close();
  await database.drop();
});

const server = () => request(httpServer(app));

describe('[P9-28] [WTR-001] the local server serves the waiter app to phones’ browsers', () => {
  it('serves the app at /phone/, for every route under it, and sends /phone to /phone/', async () => {
    const bare = await server().get('/phone?from=qr').expect(301);
    expect(bare.headers.location).toBe('/phone/?from=qr');
    for (const path of ['/phone/', '/phone/tables', '/phone/?table=abc']) {
      const page = await server().get(path).set('accept', 'text/html').expect(200);
      expect(page.text).toContain('<title>Parossa Captain</title>');
      expect(page.headers['cache-control']).toBe('no-cache');
    }
    // The console keeps / and its routes.
    const console = await server().get('/').set('accept', 'text/html').expect(200);
    expect(console.text).toContain('<title>Console</title>');
    expect((await server().get('/phonebook').set('accept', 'text/html')).text).toContain(
      '<title>Console</title>',
    );
  });

  it('[SEC-017] allows run-time styles and the service worker’s one policy, and nothing else more than the console', async () => {
    const page = await server().get('/phone/').set('accept', 'text/html').expect(200);
    const policy = String(page.headers['content-security-policy']);
    expect(policy).toContain("script-src 'self';");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain("require-trusted-types-for 'script'");
    expect(policy).toContain('trusted-types rp-phone-worker');
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).toContain("frame-ancestors 'none'");
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    expect(page.headers['referrer-policy']).toBe('no-referrer');
    // The console's own policy is unchanged.
    const console = await server().get('/').set('accept', 'text/html').expect(200);
    expect(console.headers['content-security-policy']).toContain("trusted-types 'none'");
    expect(console.headers['content-security-policy']).not.toContain('unsafe-inline');
  });

  it('caches the hashed scripts for good, but never the service worker or the manifest', async () => {
    const script = await server().get('/phone/_expo/static/js/web/index-3f2a1b.js').expect(200);
    expect(script.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const worker = await server().get('/phone/sw.js').expect(200);
    expect(worker.headers['content-type']).toMatch(/javascript/);
    expect(worker.headers['cache-control']).toBe('no-cache');
    const manifest = await server().get('/phone/manifest.webmanifest').expect(200);
    expect(manifest.headers['cache-control']).toBe('no-cache');
  });

  it('answers a missing file, a non-page request or a write with 404, never the app', async () => {
    expect((await server().get('/phone/_expo/missing.js').set('accept', 'text/html')).status).toBe(
      404,
    );
    expect((await server().get('/phone/tables').set('accept', 'application/json')).status).toBe(
      404,
    );
    expect((await server().post('/phone/').set('accept', 'text/html')).status).toBe(404);
    // The API is never under /phone.
    const api = await server().get('/api/v1/health').expect(200);
    expect(api.text).not.toContain('Parossa Captain');
  });

  it('refuses to start when the phone build is missing', async () => {
    await expect(
      createTestApp({ databaseUrl: database.url, config: { phoneDir: join(phoneDir, 'no') } }),
    ).rejects.toThrow(/phone web app build is missing/);
  });
});
