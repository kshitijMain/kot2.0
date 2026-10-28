import type { INestApplication } from '@nestjs/common';
import { REALTIME_MESSAGES, type RealtimeSync } from '@rp/contracts';
import { HOSTILE_VALUES } from '@rp/contracts/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AuthKit, createAuthKit, deviceTokenOf, signIn } from '../helpers/auth-kit.js';
import { RealtimeTestClient } from '../helpers/realtime-client.js';
import { api, appUrl, createTestApp } from '../helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js';

/**
 * QA audit, category A, for the live connection: hostile handshakes, resync requests and unknown
 * messages get a clean refusal or are ignored; the server and the other connections carry on.
 */

let database: TestDatabase;
let app: INestApplication;
let kit: AuthKit;
let url: string;
const clients: RealtimeTestClient[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createTestApp({ databaseUrl: database.url });
  kit = await createAuthKit(app);
  url = appUrl(app);
});

afterAll(async () => {
  for (const client of clients) client.close();
  await app.close();
  await database.drop();
});

/** Sends a resync request and waits for its answer (or none within a second). */
function resync(client: RealtimeTestClient, payload: unknown): Promise<RealtimeSync | 'no answer'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve('no answer');
    }, 1_000);
    client.socket.emit(REALTIME_MESSAGES.resync, payload, (sync: RealtimeSync) => {
      clearTimeout(timer);
      resolve(sync);
    });
  });
}

describe('[SEC-004] [NFR-A03] hostile messages on the live connection (QA category A)', () => {
  it('refuses hostile handshakes cleanly and stays up', async () => {
    for (const [, value] of HOSTILE_VALUES) {
      for (const auth of [
        { deviceToken: value },
        { deviceToken: deviceTokenOf(kit.deviceId), accessToken: value },
        { deviceToken: deviceTokenOf(kit.deviceId), resume: value },
      ]) {
        const failure = await RealtimeTestClient.refused(
          url,
          auth as Record<string, unknown>,
        ).catch((error: unknown) => ({ code: `connected: ${String(error)}` }));
        // A refusal or, for a harmless value in an optional field, a connection: never a hang.
        expect(String(failure.code)).not.toMatch(/Neither refused nor connected/);
      }
    }
    expect((await api(app).get('/api/v1/health')).status).toBe(200);
  });

  it('answers hostile resync requests with a full refresh, ignores unknown messages, and carries on', async () => {
    const manager = await signIn(app, kit, 'MANAGER');
    const client = await RealtimeTestClient.connect(url, {
      deviceToken: deviceTokenOf(kit.deviceId),
      accessToken: manager.accessToken,
    });
    clients.push(client);
    const witness = await RealtimeTestClient.connect(url, {
      deviceToken: deviceTokenOf(kit.deviceId),
    });
    clients.push(witness);
    for (const [, value] of HOSTILE_VALUES) {
      for (const payload of [
        value,
        { lastSequence: value },
        { streamId: value, lastSequence: 1 },
      ]) {
        const answer = await resync(client, payload);
        if (answer !== 'no answer') expect(answer.fullRefresh).toBe(true);
      }
      client.socket.emit('qa-unknown-message', value);
      client.socket.emit(REALTIME_MESSAGES.event, value);
    }
    // Without an acknowledgement a resync is ignored, never an error.
    client.socket.emit(REALTIME_MESSAGES.resync, { lastSequence: 1 });
    client.socket.emit(REALTIME_MESSAGES.resync, 'x'.repeat(200_000), () => undefined);
    expect((await api(app).get('/api/v1/health')).status).toBe(200);
    // The other connection is untouched.
    expect(witness.socket.connected).toBe(true);
    const sync = await resync(witness, { lastSequence: witness.lastSequence });
    expect(sync).not.toBe('no answer');
  });
});
