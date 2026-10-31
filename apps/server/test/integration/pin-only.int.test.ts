import { generateKeyPairSync, sign } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  FirstRunStatus,
  PairedDevice,
  PairingCodeResponse,
  pairingProofMessage,
} from '@rp/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DevicesService } from '../../src/devices/devices.service.js';
import { onLocalNetwork } from '../../src/common/network.js';
import { type AuthKit, authenticateDevice, createAuthKit, signIn } from '../helpers/auth-kit.js';
import { createTestApp, httpServer } from '../helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js';

/**
 * PIN-only sign-in for a pilot (P9-14, ADR-0025): with RP_AUTH_PIN_ONLY a browser on the
 * restaurant's network pairs itself with a code the server gives it, no manager involved, and
 * every role, the kitchen included, signs in with its PIN. Without the flag nothing changes.
 */

let database: TestDatabase;
let app: INestApplication;
let kit: AuthKit;
const server = () => request(httpServer(app));

/** What the console does by itself: ask for a code and pair with a new key. */
async function pairItself(): Promise<{ deviceId: string }> {
  const issued = await server().post('/api/v1/devices/pairing-codes/bootstrap');
  expect(issued.status, JSON.stringify(issued.body)).toBe(201);
  const { code } = PairingCodeResponse.parse(issued.body);
  const pair = generateKeyPairSync('ed25519');
  const paired = await server()
    .post('/api/v1/devices/pair')
    .send({
      code,
      algorithm: 'Ed25519',
      publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      proof: sign(null, Buffer.from(pairingProofMessage(code), 'utf8'), pair.privateKey).toString(
        'base64',
      ),
    });
  expect(paired.status, JSON.stringify(paired.body)).toBe(201);
  const device = PairedDevice.parse(paired.body);
  expect(device.type).toBe('POS');
  await authenticateDevice(app, device.deviceId, pair.privateKey);
  return { deviceId: device.deviceId };
}

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createTestApp({ databaseUrl: database.url, config: { authPinOnly: true } });
  // The kitchen setting left off: PIN-only lets the kitchen in by itself.
  kit = await createAuthKit(app, { kitchenLogins: false });
});

afterAll(async () => {
  await app.close();
  await database.drop();
});

describe('[AUTH-007] [AUTH-005] PIN-only sign-in for the pilot (ADR-0025)', () => {
  it('tells the console it is PIN-only', async () => {
    const status = FirstRunStatus.parse((await server().get('/api/v1/first-run')).body);
    expect(status).toMatchObject({ needed: false, pinOnly: true });
  });

  it('lets each browser pair itself, a device already paired or not, and every role sign in with its PIN', async () => {
    for (const role of ['MANAGER', 'WAITER', 'KITCHEN', 'OWNER'] as const) {
      const { deviceId } = await pairItself();
      const login = await signIn(app, kit, role, deviceId);
      expect(login.staff.role).toBe(role);
    }
  });

  it('never from outside the restaurant’s network, and a few times a minute per address', async () => {
    const devices = app.get(DevicesService);
    await expect(devices.createBootstrapCode(false, '203.0.113.7')).rejects.toMatchObject({
      code: 'BOOTSTRAP_CLOSED',
    });
    for (let index = 0; index < 5; index += 1) {
      await expect(devices.createBootstrapCode(false, '192.168.1.77')).resolves.toBeDefined();
    }
    await expect(devices.createBootstrapCode(false, '192.168.1.77')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('knows the restaurant’s network from the internet', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:192.168.29.12', '10.0.0.5', '172.20.1.1']) {
      expect(onLocalNetwork(address)).toBe(true);
    }
    for (const address of ['203.0.113.7', '::ffff:8.8.8.8', '172.32.0.1', '2406:da1a::1', '']) {
      expect(onLocalNetwork(address)).toBe(false);
    }
    expect(onLocalNetwork('fd12:3456::1')).toBe(true);
  });
});

describe('[AUTH-007] without the flag', () => {
  it('keeps pairing as it was: no code for the network, the kitchen in station mode', async () => {
    const own = await createTestDatabase();
    const ownApp = await createTestApp({ databaseUrl: own.url });
    try {
      const ownKit = await createAuthKit(ownApp, { kitchenLogins: false });
      const status = FirstRunStatus.parse(
        (await request(httpServer(ownApp)).get('/api/v1/first-run')).body,
      );
      expect(status.pinOnly).toBe(false);
      await expect(
        ownApp.get(DevicesService).createBootstrapCode(false, '192.168.1.20'),
      ).rejects.toMatchObject({ code: 'BOOTSTRAP_CLOSED' });
      await expect(signIn(ownApp, ownKit, 'KITCHEN')).rejects.toThrow(/KITCHEN_STATION_MODE/);
    } finally {
      await ownApp.close();
      await own.drop();
    }
  });
});
