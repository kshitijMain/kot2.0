import type { INestApplication } from '@nestjs/common';
import { ConnectInfoResponse, type LoginResponse, parseConnectQr } from '@rp/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authHeaders, type AuthKit, createAuthKit, signIn } from '../helpers/auth-kit.js';
import { api, createTestApp } from '../helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js';

/** The Connect QR in Manage → Devices (P9-27): where phones find the restaurant PC. */

let database: TestDatabase;
let app: INestApplication;
let kit: AuthKit;
let manager: LoginResponse;
let waiter: LoginResponse;

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createTestApp({ databaseUrl: database.url });
  kit = await createAuthKit(app);
  manager = await signIn(app, kit, 'MANAGER');
  waiter = await signIn(app, kit, 'WAITER');
});

afterAll(async () => {
  await app.close();
  await database.drop();
});

describe('[AUTH-007] connecting a phone with the Connect QR (P9-27)', () => {
  it('gives a manager the PC’s addresses and a QR code the waiter app reads', async () => {
    const response = await api(app)
      .get('/api/v1/devices/connect-info')
      .set(authHeaders(kit.deviceId, manager.accessToken));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const info = ConnectInfoResponse.parse(response.body);
    const qr = parseConnectQr(info.qrPayload);
    expect(qr).toMatchObject({ v: 1, kind: 'connect' });
    expect(qr?.urls).toEqual(info.urls);
    // Tests do not announce on the network.
    expect(info.announced).toBe(false);
  });

  it('is not for waiters', async () => {
    const response = await api(app)
      .get('/api/v1/devices/connect-info')
      .set(authHeaders(kit.deviceId, waiter.accessToken));
    expect(response.status).toBe(403);
  });
});
