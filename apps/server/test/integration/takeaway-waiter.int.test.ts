import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  AlertListResponse,
  type LoginResponse,
  OrderListResponse,
  OrderView,
  TableOverviewResponse,
} from '@rp/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/database/prisma.service.js';
import { EventBus } from '../../src/events/event-bus.js';
import {
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
 * Takeaway is the waiter's job (ADR-0030, item E): they send it from the waiter app with a
 * takeaway number, the kitchen and the KOT show "TAKEAWAY #12", "ready" goes to the waiter who
 * sent it, and the waiter asks for the bill, which the managers then take payment for.
 */

let database: TestDatabase;
let app: INestApplication;
let prisma: PrismaService;
let kit: AuthKit;
let restaurant: SmallRestaurant;
let manager: LoginResponse;
let waiter: LoginResponse;
let other: LoginResponse;
let kitchen: LoginResponse;

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createTestApp({ databaseUrl: database.url });
  prisma = app.get(PrismaService);
  kit = await createAuthKit(app);
  manager = await signIn(app, kit, 'MANAGER');
  waiter = await signIn(app, kit, 'WAITER');
  // A second waiter, with nothing more than a waiter's grants.
  other = await signInCustom(app, kit, 'WAITER', []);
  kitchen = await signIn(app, kit, 'KITCHEN');
  restaurant = await setUpSmallRestaurant(app, kit, manager);
});

afterAll(async () => {
  await app.close();
  await database.drop();
});

const as = (who: LoginResponse) => authHeaders(kit.deviceId, who.accessToken);

async function sendTakeaway(): Promise<OrderView> {
  const sent = await api(app)
    .post('/api/v1/orders')
    .set(as(waiter))
    .send({
      idempotencyKey: randomUUID(),
      source: 'WAITER_APP',
      orderType: 'TAKEAWAY',
      customerName: 'Meera',
      customerPhone: '9876543210',
      lines: [{ clientLineId: randomUUID(), itemId: restaurant.items.Dal, quantity: 1 }],
    });
  expect(sent.body, JSON.stringify(sent.body)).toMatchObject({ status: 'ACCEPTED' });
  const { orderId } = sent.body as { orderId: string };
  return OrderView.parse((await api(app).get(`/api/v1/orders/${orderId}`).set(as(waiter))).body);
}

async function step(orderItemId: string, event: string) {
  const moved = await api(app)
    .post(`/api/v1/order-items/${orderItemId}/status`)
    .set(as(kitchen))
    .send({ event });
  expect(moved.status, JSON.stringify(moved.body)).toBe(200);
  // Alerts follow from the event, after the answer.
  await app.get(EventBus).drain();
}

const alertsOf = async (who: LoginResponse) =>
  AlertListResponse.parse((await api(app).get('/api/v1/alerts').set(as(who))).body).alerts;

describe('[TBL-008] [WTR-013] takeaway from the waiter app (ADR-0030)', () => {
  it('rings only the waiter who sent it when the food is ready, as TAKEAWAY #n', async () => {
    const order = await sendTakeaway();
    expect(order.takeawayToken).toBeGreaterThan(0);
    const line = order.items[0];
    if (line === undefined) throw new Error('No line');
    await step(line.id, 'START_PREPARING');
    await step(line.id, 'MARK_READY');

    const mine = (await alertsOf(waiter)).filter((alert) => alert.orderId === order.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      type: 'TAKEAWAY_READY',
      tableLabel: null,
      pagerText: `TAKEAWAY #${String(order.takeawayToken)} READY`,
    });
    expect(mine[0]?.payload).toMatchObject({ takeawayToken: order.takeawayToken, items: ['Dal'] });
    // The other waiter did not send it: nothing rings for them.
    expect((await alertsOf(other)).filter((alert) => alert.orderId === order.id)).toEqual([]);

    // Picked up at the pass: the alert has done its job.
    await step(line.id, 'PICK_UP');
    expect((await alertsOf(waiter)).filter((alert) => alert.orderId === order.id)).toEqual([]);
  });

  it('asks for the bill once, which the managers then see and are told about', async () => {
    const order = await sendTakeaway();
    const asked = await api(app).post(`/api/v1/orders/${order.id}/request-bill`).set(as(waiter));
    await app.get(EventBus).drain();
    expect(asked.status, JSON.stringify(asked.body)).toBe(200);
    const first = OrderView.parse(asked.body).billRequestedAt;
    expect(Date.now() - Date.parse(first ?? '')).toBeLessThan(60_000);

    // A second tap is the same request, with no second alert.
    const again = await api(app).post(`/api/v1/orders/${order.id}/request-bill`).set(as(other));
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(OrderView.parse(again.body).billRequestedAt).toBe(first);

    const listed = OrderListResponse.parse(
      (await api(app).get('/api/v1/orders/takeaway').set(as(waiter))).body,
    ).orders.find((open) => open.id === order.id);
    expect(listed?.billRequestedAt).toBe(first);

    const told = (await alertsOf(manager)).filter(
      (alert) => alert.type === 'BILL_REQUEST' && alert.orderId === order.id,
    );
    expect(told).toHaveLength(1);
    expect(told[0]?.payload).toMatchObject({ takeawayToken: order.takeawayToken });
    // The waiter who asked knows already.
    expect(
      (await alertsOf(waiter)).filter(
        (alert) => alert.type === 'BILL_REQUEST' && alert.orderId === order.id,
      ),
    ).toEqual([]);
  });

  it('is only for open takeaway orders, and never for the kitchen', async () => {
    const order = await sendTakeaway();
    const byKitchen = await api(app)
      .post(`/api/v1/orders/${order.id}/request-bill`)
      .set(as(kitchen));
    expect(byKitchen.status).toBe(403);

    const tables = TableOverviewResponse.parse(
      (await api(app).get('/api/v1/tables/overview').set(as(waiter))).body,
    );
    const tableId = tables.tables[0]?.tableId ?? '';
    await api(app).post(`/api/v1/tables/${tableId}/open`).set(as(waiter)).send({ covers: 2 });
    const dineIn = await prisma.order.create({
      data: {
        restaurantId: kit.restaurantId,
        orderNumber: 9_999,
        orderType: 'DINE_IN',
        source: 'WAITER_APP',
        businessDate: new Date(),
      },
    });
    const refused = await api(app).post(`/api/v1/orders/${dineIn.id}/request-bill`).set(as(waiter));
    expect(refused.status).toBe(409);
    expect((refused.body as { code: string }).code).toBe('NOT_A_TAKEAWAY');
  });
});
