import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  KdsTicketsResponse,
  type LoginResponse,
  OrderFeedResponse,
  StaffPerformanceResponse,
  SubmitOrderResponse,
  TableOverviewResponse,
  TableSessionView,
} from '@rp/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/database/prisma.service.js';
import { KotTicketsService } from '../../src/printing/kot-tickets.service.js';
import { renderKotTicket } from '../../src/printing/escpos.js';
import {
  addDevice,
  authHeaders,
  type AuthKit,
  createAuthKit,
  signIn,
  signInCustom,
} from '../helpers/auth-kit.js';
import { setUpSmallRestaurant, type SmallRestaurant } from '../helpers/small-restaurant.js';
import { api, createTestApp } from '../helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js';

/**
 * Who sent a KOT (ADR-0031, item D): the printed KOT, the kitchen display, the order feed and the
 * staff report named the person who opened the table. They now name whoever sent that KOT: the
 * waiter who sent it, or for a diner's order the person who approved it. "Opened by" stays in the
 * table's details.
 */

let database: TestDatabase;
let app: INestApplication;
let prisma: PrismaService;
let kit: AuthKit;
let restaurant: SmallRestaurant;
let manager: LoginResponse;
let opener: LoginResponse;
let sender: LoginResponse;
let tablet: string;
const OPENER = 'Test waiter';
const SENDER = 'Custom 7531';
const MANAGER = 'Test manager';

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createTestApp({ databaseUrl: database.url });
  prisma = app.get(PrismaService);
  kit = await createAuthKit(app, { kitchenLogins: false });
  manager = await signIn(app, kit, 'MANAGER');
  opener = await signIn(app, kit, 'WAITER');
  sender = await signInCustom(app, kit, 'WAITER', []);
  restaurant = await setUpSmallRestaurant(app, kit, manager);
  tablet = await addDevice(app, kit, 'TABLE_TABLET', { tableId: restaurant.tables.T2 ?? '' });
});

afterAll(async () => {
  await app.close();
  await database.drop();
});

const as = (who: LoginResponse) => authHeaders(kit.deviceId, who.accessToken);

async function open(table: string, by: LoginResponse): Promise<string> {
  return TableSessionView.parse(
    (await api(app).post(`/api/v1/tables/${table}/open`).set(as(by)).send({ covers: 2 })).body,
  ).id;
}

async function rendered(kotId: string): Promise<string> {
  const kot = await app.get(KotTicketsService).render(kit.restaurantId, kotId);
  return Buffer.from(renderKotTicket(kot.ticket, 80)).toString('latin1');
}

const kdsTickets = async () =>
  KdsTicketsResponse.parse(
    (
      await api(app)
        .get('/api/v1/kds/tickets')
        .set(authHeaders(await kdsScreen()))
    ).body,
  ).tickets;
let screen: string | undefined;
async function kdsScreen(): Promise<string> {
  screen ??= await addDevice(app, kit, 'KDS');
  return screen;
}

describe('[KDS-003] [RPT-003] the KOT names who sent it (ADR-0031)', () => {
  it('prints and shows the waiter who sent the KOT, not who opened the table', async () => {
    const sessionId = await open(restaurant.tables.T1 ?? '', opener);
    const sent = SubmitOrderResponse.parse(
      (
        await api(app)
          .post('/api/v1/orders')
          .set(as(sender))
          .send({
            idempotencyKey: randomUUID(),
            source: 'WAITER_APP',
            orderType: 'DINE_IN',
            tableSessionId: sessionId,
            lines: [{ clientLineId: randomUUID(), itemId: restaurant.items.Dal, quantity: 1 }],
          })
      ).body,
    );
    if (sent.status !== 'ACCEPTED') throw new Error('refused');
    const kot = await prisma.kot.findFirstOrThrow({ where: { orderId: sent.orderId } });

    const paper = await rendered(kot.id);
    expect(paper).toContain(SENDER);
    expect(paper).not.toContain(OPENER);

    const ticket = (await kdsTickets()).find((entry) => entry.kotId === kot.id);
    expect(ticket?.waiterName).toBe(SENDER);

    const feed = OrderFeedResponse.parse(
      (await api(app).get('/api/v1/order-feed').set(as(manager))).body,
    );
    expect(feed.orders.find((entry) => entry.orderId === sent.orderId)?.waiterName).toBe(SENDER);

    // The table's details still say who opened it.
    const overview = TableOverviewResponse.parse(
      (await api(app).get('/api/v1/tables/overview').set(as(manager))).body,
    );
    expect(
      overview.tables.find((entry) => entry.session?.id === sessionId)?.session?.waiterName,
    ).toBe(OPENER);
  });

  it('names the person who approved a diner’s order', async () => {
    await open(restaurant.tables.T2 ?? '', opener);
    const placed = SubmitOrderResponse.parse(
      (
        await api(app)
          .post('/api/v1/devices/current/orders')
          .set(authHeaders(tablet))
          .send({
            idempotencyKey: randomUUID(),
            lines: [{ clientLineId: randomUUID(), itemId: restaurant.items.Lassi, quantity: 1 }],
          })
      ).body,
    );
    if (placed.status !== 'ACCEPTED') throw new Error('refused');
    const approved = await api(app)
      .post(`/api/v1/orders/${placed.orderId}/approve`)
      .set(as(manager))
      .send({ changes: [], dinerAgreed: false });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const kot = await prisma.kot.findFirstOrThrow({ where: { orderId: placed.orderId } });
    expect(await rendered(kot.id)).toContain(MANAGER);
    expect((await kdsTickets()).find((entry) => entry.kotId === kot.id)?.waiterName).toBe(MANAGER);
  });

  it('counts each person’s KOTs by who sent them in the staff report', async () => {
    const today = (
      await prisma.kot.findFirstOrThrow({ select: { businessDate: true } })
    ).businessDate
      .toISOString()
      .slice(0, 10);
    const report = StaffPerformanceResponse.parse(
      (await api(app).get(`/api/v1/reports/staff?from=${today}&to=${today}`).set(as(manager))).body,
    );
    const kotsOf = (name: string) =>
      report.staff.find((person) => person.name === name)?.kotsSent ?? 0;
    expect(kotsOf(SENDER)).toBe(1);
    expect(kotsOf(MANAGER)).toBe(1);
    expect(kotsOf(OPENER)).toBe(0);
  });
});
