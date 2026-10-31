import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RelaySessionResponse } from '@rp/contracts/relay';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { hostConfigFrom } from '../src/host/config.js';
import { type RelayHost, startHost } from '../src/host/host.js';
import { startLine, verifyToken } from '../src/host/line.js';
import { signHs256 } from '../src/jwt.js';
import {
  letExpire,
  openRelayDb,
  type RelayDb,
  type SeededTenant,
  seedTenant,
  submitOrder,
} from './helpers/relay-db.js';

const SECRET = 'a-test-secret-of-at-least-thirty-two-characters';
const API_KEY = 'test-public-key-0001';

let db: RelayDb;
let host: RelayHost;
let base: string;
let photosDir: string;
let mannat: SeededTenant;
let other: SeededTenant;

beforeAll(async () => {
  db = await openRelayDb();
  mannat = await seedTenant(db, 'Mannat');
  other = await seedTenant(db, 'Elsewhere');
  photosDir = await mkdtemp(join(tmpdir(), 'rp-relay-photos-'));
  host = await startHost(
    hostConfigFrom({
      RELAY_DB_URL: db.url,
      RELAY_JOBS_DB_URL: db.url,
      RELAY_PUBLIC_URL: 'http://127.0.0.1:1',
      RELAY_ALLOWED_ORIGINS: 'https://menu.example.in',
      RELAY_JWT_SECRET: SECRET,
      RELAY_REALTIME_API_KEY: API_KEY,
      RELAY_PHOTOS_DIR: photosDir,
      RELAY_PORT: '0',
    }),
  );
  base = `http://127.0.0.1:${String(host.port)}`;
});

afterAll(async () => {
  await host.close();
  await db.close();
  await rm(photosDir, { recursive: true, force: true });
});

/** A restaurant's session token, through the `server` function as its local server gets it. */
async function sessionOf(tenant: SeededTenant): Promise<RelaySessionResponse> {
  const response = await fetch(`${base}/functions/v1/server/session`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tenant.credential}` },
  });
  expect(response.status).toBe(200);
  return RelaySessionResponse.parse(await response.json());
}

interface OpenLine {
  readonly rings: Record<string, unknown>[];
  readonly socket: WebSocket;
  close(): void;
}

/** Opens the restaurant's line and joins its doorbell, as `RelayRealtime` does (P5-03d). */
async function openLine(tenant: SeededTenant): Promise<OpenLine> {
  const session = await sessionOf(tenant);
  const socket = new WebSocket(
    `ws://127.0.0.1:${String(host.port)}/realtime/v1/websocket?apikey=${API_KEY}&vsn=1.0.0`,
  );
  const rings: Record<string, unknown>[] = [];
  const joined = new Promise<void>((resolve, reject) => {
    socket.on('message', (data) => {
      const message = JSON.parse((data as Buffer).toString('utf8')) as {
        event: string;
        payload: Record<string, unknown>;
      };
      if (message.event === 'phx_reply') {
        if ((message.payload as { status: string }).status === 'ok') resolve();
        else reject(new Error(JSON.stringify(message.payload)));
      }
      if (message.event === 'postgres_changes') rings.push(message.payload);
    });
  });
  await new Promise<void>((resolve) =>
    socket.once('open', () => {
      resolve();
    }),
  );
  socket.send(
    JSON.stringify({
      topic: 'realtime:rp-qr-doorbell',
      event: 'phx_join',
      payload: {
        access_token: session.token,
        config: { postgres_changes: session.realtime.changes },
      },
      ref: '1',
      join_ref: '1',
    }),
  );
  await joined;
  return {
    rings,
    socket,
    close: () => {
      socket.close();
    },
  };
}

const until = async (check: () => boolean, ms = 2_000) => {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  return check();
};

describe('the self-hosted relay host (P9-01, ADR-0024)', () => {
  it('[QR-009] rings a restaurant’s open line within a second of a new QR order, and only that restaurant', async () => {
    const mine = await openLine(mannat);
    const theirs = await openLine(other);
    try {
      const health = (await (await fetch(`${base}/healthz`)).json()) as {
        restaurantsOnLine: number;
      };
      expect(health.restaurantsOnLine).toBe(2);

      const started = Date.now();
      const orderId = await submitOrder(db, mannat.id, mannat.tables[0].id);
      expect(await until(() => mine.rings.length === 1)).toBe(true);
      expect(Date.now() - started).toBeLessThan(1_000);
      const data = mine.rings[0]!.data as { table: string; record: Record<string, unknown> };
      expect(data.table).toBe('qr_orders');
      expect(data.record).toMatchObject({ id: orderId, tenant_id: mannat.id });
      // Another restaurant on the same host hears nothing of it (SEC-005).
      await new Promise((r) => setTimeout(r, 150));
      expect(theirs.rings).toEqual([]);
    } finally {
      mine.close();
      theirs.close();
    }
  });

  it('[QR-011] rings the line for a call from the QR page too', async () => {
    const mine = await openLine(mannat);
    try {
      await db.as(
        'relay_diner',
        { tenant_id: mannat.id, table_id: mannat.tables[1].id },
        (client) =>
          client.query(
            `INSERT INTO relay.qr_service_requests (tenant_id, table_id, idempotency_key, browser_id, type)
             VALUES ($1, $2, $3, $4, 'BILL')`,
            [mannat.id, mannat.tables[1].id, randomUUID(), `browser-${randomUUID()}`],
          ),
      );
      expect(await until(() => mine.rings.length === 1)).toBe(true);
      expect((mine.rings[0]!.data as { table: string }).table).toBe('qr_service_requests');
    } finally {
      mine.close();
    }
  });

  it('refuses a line without the public key, and a join with a forged token', async () => {
    const refused = new WebSocket(`ws://127.0.0.1:${String(host.port)}/realtime/v1/websocket`);
    const failed = await new Promise<boolean>((resolve) => {
      refused.once('error', () => {
        resolve(true);
      });
      refused.once('open', () => {
        resolve(false);
      });
    });
    expect(failed).toBe(true);

    const forged = await signHs256(
      { role: 'relay_server', tenant_id: mannat.id, exp: Math.floor(Date.now() / 1000) + 60 },
      'not-the-secret-not-the-secret-not-the-secret',
    );
    expect(verifyToken(forged, SECRET)).toBe('Invalid JWT signature');
    const diner = await signHs256(
      { role: 'relay_diner', tenant_id: mannat.id, exp: Math.floor(Date.now() / 1000) + 60 },
      SECRET,
    );
    expect(verifyToken(diner, SECRET)).toBe('Not a relay server token');
    const expired = await signHs256(
      { role: 'relay_server', tenant_id: mannat.id, exp: Math.floor(Date.now() / 1000) - 1 },
      SECRET,
    );
    expect(verifyToken(expired, SECRET)).toBe('Token has expired');
  });

  it('keeps menu photos on its own disk and serves them as immutable', async () => {
    const photoId = randomUUID();
    const webp = Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'binary');
    const put = await fetch(`${base}/functions/v1/server/photos/${photoId}/480`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${mannat.credential}`, 'content-type': 'image/webp' },
      body: webp,
    });
    expect(put.status).toBe(200);
    const { path } = (await put.json()) as { path: string };
    expect(await readdir(join(photosDir, mannat.id, photoId))).toEqual(['480.webp']);

    const got = await fetch(`${base}/storage/v1/object/public/menu-photos/${path}`);
    expect(got.status).toBe(200);
    expect(got.headers.get('cache-control')).toContain('immutable');
    expect(Buffer.from(await got.arrayBuffer())).toEqual(webp);

    for (const bad of ['../../etc/passwd', `${mannat.id}/x/480.webp`, '%2e%2e%2fsecret']) {
      const refused = await fetch(`${base}/storage/v1/object/public/menu-photos/${bad}`);
      expect(refused.status).toBe(404);
    }
  });

  it('refuses a body larger than any function takes before holding it', async () => {
    // Refused by its announced length; the sender may see the 413 or the connection cut first.
    const outcome = await fetch(`${base}/functions/v1/server/menu`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${mannat.credential}`, 'content-type': 'application/json' },
      body: Buffer.alloc(10 * 1024 * 1024, 32),
    }).then(
      (response) => response.status,
      () => 'cut',
    );
    expect([413, 'cut']).toContain(outcome);
    // The host is still there for everyone else.
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });

  it('[QR-007] marks overdue orders expired with its own job, where there is no pg_cron', async () => {
    const orderId = await submitOrder(db, mannat.id, mannat.tables[0].id);
    await letExpire(db, orderId);
    await host.jobs!.runNow();
    const { rows } = await db.admin.query<{ status: string }>(
      'SELECT status FROM relay.qr_orders WHERE id = $1',
      [orderId],
    );
    expect(rows[0]!.status).toBe('EXPIRED');
  });

  it('answers 404 for anything that is not a function', async () => {
    expect((await fetch(`${base}/functions/v1/nothing`)).status).toBe(404);
    expect((await fetch(`${base}/`)).status).toBe(404);
  });
});

describe('the open line on its own', () => {
  it('drops a line that stops answering pings, so a PC that lost power holds nothing', async () => {
    const line = await startLine({
      databaseUrl: db.url,
      jwtSecret: SECRET,
      apiKey: API_KEY,
      pingMs: 50,
    });
    const { createServer } = await import('node:http');
    const http = createServer();
    http.on('upgrade', (request, socket, head) => {
      line.upgrade(request, socket, head);
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const port = (http.address() as { port: number }).port;
    try {
      const socket = new WebSocket(
        `ws://127.0.0.1:${String(port)}/realtime/v1/websocket?apikey=${API_KEY}`,
        { autoPong: false },
      );
      await new Promise<void>((resolve) =>
        socket.once('open', () => {
          resolve();
        }),
      );
      const closed = new Promise<void>((resolve) =>
        socket.once('close', () => {
          resolve();
        }),
      );
      await closed;
    } finally {
      await line.close();
      http.closeAllConnections();
      await new Promise<void>((resolve) =>
        http.close(() => {
          resolve();
        }),
      );
    }
  });

  it('takes its settings from the environment and says what is wrong', () => {
    expect(() => hostConfigFrom({})).toThrow(/RELAY_DB_URL/);
    expect(() =>
      hostConfigFrom({
        RELAY_DB_URL: 'postgresql://relay_edge@localhost/relay',
        RELAY_PUBLIC_URL: 'https://menu.example.in/',
        RELAY_ALLOWED_ORIGINS: 'https://menu.example.in',
        RELAY_JWT_SECRET: 'short',
      }),
    ).toThrow(/RELAY_JWT_SECRET/);
    const config = hostConfigFrom({
      RELAY_DB_URL: 'postgresql://relay_edge@localhost/relay',
      RELAY_PUBLIC_URL: 'https://menu.example.in/',
      RELAY_ALLOWED_ORIGINS: 'https://menu.example.in/, https://www.example.in',
    });
    expect(config).toMatchObject({
      publicUrl: 'https://menu.example.in',
      allowedOrigins: ['https://menu.example.in', 'https://www.example.in'],
      host: '127.0.0.1',
      port: 8787,
      jwtSecret: undefined,
    });
  });
});
