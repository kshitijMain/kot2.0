import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { LoginResponse } from '@rp/contracts';
import {
  QrMenuResponse,
  QrOrderView,
  QrSubmitOrderResponse,
  QrTableBillResponse,
  QrTableOrdersResponse,
} from '@rp/contracts/relay';
import { startRelay, type TestRelay } from '@rp/relay/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { CredentialHasher } from '../../src/auth/credential-hasher.js';
import { SECRET_STORE, type SecretStore } from '../../src/auth/secret-store.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { type PilotSummary, seedMannat } from '../../src/database/pilot-seed.js';
import { saveRelayCredential } from '../../src/relay/relay-credential.js';
import {
  DEFAULT_RELAY_ORDERS_OPTIONS,
  RELAY_ORDERS_OPTIONS,
  RelayOrdersService,
} from '../../src/relay/relay-orders.service.js';
import {
  DEFAULT_RELAY_SYNC_OPTIONS,
  RELAY_SYNC_OPTIONS,
  RelaySyncService,
} from '../../src/relay/relay-sync.service.js';
import { authHeaders, type AuthKit, createAuthKit, signIn } from '../helpers/auth-kit.js';
import { createTestApp, httpServer } from '../helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js';
import { until } from '../helpers/wait.js';

/**
 * The QR pilot at Mannat (P9-06, ADR-0024), end to end: Mannat set up with its 5 tables and QR
 * codes, the PC on its open line to the relay, and a diner at table 2 ordering with their mobile
 * number. The order reaches the PC by the line alone (polling is an hour away), the manager
 * accepts it, and the kitchen gets a KOT for table 2, with the diner told.
 */

const JWT_SECRET = 'test-only-realtime-secret-0123456789abcdef';

let database: TestDatabase;
let relay: TestRelay;
let app: INestApplication;
let prisma: PrismaService;
let sync: RelaySyncService;
let qr: RelayOrdersService;
let kit: AuthKit;
let manager: LoginResponse;
let mannat: PilotSummary;

const server = () => request(httpServer(app));
const codeOf = (label: string) => mannat.tables.find((table) => table.label === label)?.code ?? '';

beforeAll(async () => {
  database = await createTestDatabase();
  relay = await startRelay({
    adminUrl: inject('pgAdminUrl'),
    runId: inject('pgRunId'),
    realtimeJwtSecret: JWT_SECRET,
  });
  const tenant = await relay.provision('Mannat');
  const later = { firstDelayMs: 3_600_000, retryBaseMs: 50, retryMaxMs: 400 };
  app = await createTestApp({
    databaseUrl: database.url,
    config: { relayUrl: relay.baseUrl },
    overrides: [
      {
        provide: RELAY_SYNC_OPTIONS,
        useValue: { ...DEFAULT_RELAY_SYNC_OPTIONS, ...later, debounceMs: 3_600_000 },
      },
      {
        provide: RELAY_ORDERS_OPTIONS,
        useValue: {
          ...DEFAULT_RELAY_ORDERS_OPTIONS,
          ...later,
          // Polling would take an hour: only the open line can bring an order this quickly.
          pollMs: 3_600_000,
          pollWithRealtimeMs: 3_600_000,
          realtimeDelayMs: 10,
          ringDelayMs: 20,
        },
      },
    ],
  });
  prisma = app.get(PrismaService);
  sync = app.get(RelaySyncService);
  qr = app.get(RelayOrdersService);
  const hasher = app.get(CredentialHasher);
  mannat = await seedMannat(prisma, {
    hashPin: (pin) => hasher.hash(pin),
    upiId: 'mannat.demo@example',
  });
  kit = await createAuthKit(app, { restaurantId: mannat.restaurantId });
  manager = await signIn(app, kit, 'MANAGER');
  await saveRelayCredential(prisma, app.get<SecretStore>(SECRET_STORE), tenant.credential);
  expect((await sync.sync()).lastError).toBeNull();
  await until(() => qr.realtimeSubscribed, 5_000, 'the PC to be on its open line');
});

afterAll(async () => {
  await app.close();
  await relay.stop();
  await database.drop();
});

describe('[P9] the QR pilot at Mannat (ADR-0024)', () => {
  it('sets up Mannat: 5 tables with their own QR codes, the menu, the phone asked for', async () => {
    expect(mannat.tables.map((table) => table.label)).toEqual(['1', '2', '3', '4', '5']);
    expect(new Set(mannat.tables.map((table) => table.code)).size).toBe(5);
    for (const table of mannat.tables) {
      const response = await fetch(`${relay.baseUrl}/qr-menu`, {
        headers: { 'x-rp-table-token': table.code },
      });
      const menu = QrMenuResponse.parse(await response.json());
      // Every code opens the same site and menu, at its own table.
      expect(menu.table.label).toBe(table.label);
      expect(menu.document?.restaurantName).toBe('Mannat');
      expect(menu.document?.phone).toBe('REQUIRED');
    }
  });

  it('[MENU-002] describes every dish in a line, as the diner reads the menu (P9-09)', async () => {
    const response = await fetch(`${relay.baseUrl}/qr-menu`, {
      headers: { 'x-rp-table-token': codeOf('1') },
    });
    const items = QrMenuResponse.parse(await response.json()).document?.menu.items ?? [];
    expect(items.length).toBeGreaterThan(30);
    expect(items.filter((item) => (item.description ?? '') === '')).toEqual([]);
    expect(items.find((item) => item.name === 'Chapati')?.description).toBe(
      'Soft whole-wheat flatbread from the tawa.',
    );
  });

  it('[QR-009] [ORD-003] a diner at table 2 orders; the line brings it, the manager accepts, the kitchen gets a KOT', async () => {
    const menu = QrMenuResponse.parse(
      await (
        await fetch(`${relay.baseUrl}/qr-menu`, { headers: { 'x-rp-table-token': codeOf('2') } })
      ).json(),
    );
    const idOf = (name: string) =>
      menu.document?.menu.items.find((item) => item.name === name)?.id ?? '';
    const started = Date.now();
    const submitted = QrSubmitOrderResponse.parse(
      await (
        await fetch(`${relay.baseUrl}/submit-order`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-rp-table-token': codeOf('2'),
            'x-rp-browser': 'browser-mannat-0000000002',
          },
          body: JSON.stringify({
            idempotencyKey: randomUUID(),
            customerPhone: '+919876543210',
            lines: [
              { clientLineId: randomUUID(), itemId: idOf('Chapati'), quantity: 3, modifiers: [] },
              {
                clientLineId: randomUUID(),
                itemId: idOf('Paneer Butter Masala'),
                quantity: 1,
                modifiers: [],
              },
            ],
          }),
        })
      ).json(),
    );
    if (submitted.status !== 'ACCEPTED') throw new Error(JSON.stringify(submitted));
    const relayOrderId = submitted.order.id;

    // The open line rings the PC: the order waits for approval at table 2 within seconds.
    const order = await until(
      async () =>
        (await prisma.order.findFirst({
          where: { source: 'QR', externalRef: relayOrderId },
          include: { table: true },
        })) ?? undefined,
      3_000,
      'the order to come down the open line',
    );
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(order.table?.label).toBe('2');
    expect(order.customerPhone).toBe('+919876543210');
    // The manager's phone is among those alerted (P9-05).
    const alert = await until(
      async () =>
        (await prisma.alert.findFirst({
          where: { type: 'ORDER_PENDING_APPROVAL', orderId: order.id },
        })) ?? undefined,
      3_000,
      'the approval alert',
    );
    expect(alert.recipientIds).toContain(kit.staff.MANAGER);

    const approved = await server()
      .post(`/api/v1/orders/${order.id}/approve`)
      .set(authHeaders(kit.deviceId, manager.accessToken))
      .send({});
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const kot = await prisma.kot.findFirstOrThrow({
      where: { orderId: order.id },
      include: { lines: true },
    });
    expect(kot.sentById).toBe(kit.staff.MANAGER);
    expect(kot.lines.length).toBeGreaterThan(0);

    // The diner is told it was accepted.
    await until(
      async () => {
        await qr.run();
        const view = QrOrderView.parse(
          await (
            await fetch(`${relay.baseUrl}/order-status?id=${relayOrderId}`, {
              headers: { 'x-rp-table-token': codeOf('2') },
            })
          ).json(),
        );
        return view.status === 'SENT_TO_KITCHEN' ? view : undefined;
      },
      5_000,
      'the diner to see the order accepted',
    );
  });

  it('[QR-011] puts table 2’s printed bill, with the phone on it and UPI, on the diner’s page', async () => {
    const session = await prisma.tableSession.findFirstOrThrow({
      where: { table: { label: '2', restaurantId: mannat.restaurantId }, status: 'OPEN' },
    });
    const bill = await server()
      .post('/api/v1/bills')
      .set(authHeaders(kit.deviceId, manager.accessToken))
      .send({ tableSessionId: session.id });
    expect((bill.body as { customer: { phone: string } }).customer.phone).toBe('+919876543210');
    const invoice = await server()
      .post(`/api/v1/bills/${(bill.body as { id: string }).id}/invoice`)
      .set(authHeaders(kit.deviceId, manager.accessToken))
      .send({});
    expect(invoice.status, JSON.stringify(invoice.body)).toBe(201);
    await sync.sync();
    const seen = QrTableBillResponse.parse(
      await (
        await fetch(`${relay.baseUrl}/table-bill`, { headers: { 'x-rp-table-token': codeOf('2') } })
      ).json(),
    );
    expect(seen.bill?.upi).toEqual({ upiId: 'mannat.demo@example', payeeName: 'Mannat' });
    expect(seen.bill?.invoices[0]?.grandTotal).toBe(
      (invoice.body as { grandTotal: number }).grandTotal,
    );
  });

  it('[QR-007] shows a number its orders at the table on any phone, and an earlier sitting’s never (P9-08)', async () => {
    const mine = () =>
      fetch(`${relay.baseUrl}/table-orders`, {
        headers: { 'x-rp-table-token': codeOf('2'), 'x-rp-diner-phone': '+919876543210' },
      }).then(async (response) => QrTableOrdersResponse.parse(await response.json()));
    // Another phone at table 2, the same number: the order placed earlier is there.
    expect((await mine()).orders).toHaveLength(1);

    // The table pays and closes; the PC tells the relay when the sitting ended.
    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { tableSession: { table: { label: '2', restaurantId: mannat.restaurantId } } },
    });
    const paid = await server()
      .post(`/api/v1/invoices/${invoice.id}/payments`)
      .set(authHeaders(kit.deviceId, manager.accessToken))
      .send({
        idempotencyKey: randomUUID(),
        payments: [{ mode: 'UPI', amount: invoice.grandTotal, reference: 'UPI-PILOT' }],
      });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    await sync.sync();
    const after = await mine();
    expect(after.orders).toEqual([]);
    const closed = await prisma.tableSession.findFirstOrThrow({
      where: { table: { label: '2', restaurantId: mannat.restaurantId }, status: 'CLOSED' },
    });
    expect(after.since).toBe(closed.closedAt?.toISOString());
  });
});
