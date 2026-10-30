import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  ApiError,
  LoginResponse,
  OrderView,
  SubmitOrderResponse,
  TableSessionView,
} from '@rp/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/database/prisma.service.js';
import {
  addDevice,
  addStaff,
  authHeaders,
  type AuthKit,
  createAuthKit,
  signIn,
} from '../helpers/auth-kit.js';
import { createTestApp, httpServer } from '../helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js';
import { until } from '../helpers/wait.js';

/**
 * ADR-0023, Part 2: a dish marked out of stock. The server refuses it in new orders, held dishes
 * fired and diners' orders approved; its units the kitchen has not started are cancelled at no
 * charge, and the person who sent each ticket gets one OUT_OF_STOCK alert per line; started and
 * ready units are not touched; a diner's order still waiting loses the line.
 */

let database: TestDatabase;
let app: INestApplication;
let prisma: PrismaService;
let kit: AuthKit;
let waiter: LoginResponse;
/** A second waiter, who sends a KOT on the table the first one opened. */
let waiter2: LoginResponse;
let kitchen: LoginResponse;
let manager: LoginResponse;
let tablet: string;
const ids: Record<string, string> = {};
const id = (name: string) => ids[name] ?? '';

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createTestApp({ databaseUrl: database.url });
  prisma = app.get(PrismaService);
  kit = await createAuthKit(app);
  waiter = await signIn(app, kit, 'WAITER');
  const second = await addStaff(app, kit, 'WAITER', '4545');
  waiter2 = await signInAs(second, '4545');
  ids.waiter2 = second;
  kitchen = await signIn(app, kit, 'KITCHEN');
  manager = await signIn(app, kit, 'MANAGER');
  const base = { restaurantId: kit.restaurantId };
  const category = await prisma.category.create({ data: { ...base, name: 'Menu' } });
  ids.kitchen = (
    await prisma.station.create({ data: { ...base, name: 'Kitchen', mode: 'SCREEN' } })
  ).id;
  const tax = await prisma.taxGroup.create({ data: { ...base, name: 'Nil' } });
  for (const [name, price] of [
    ['Dal', 18_000],
    ['Roti', 3_000],
    ['Naan', 4_000],
    ['Thali', 30_000],
  ] as const) {
    ids[name] = (
      await prisma.item.create({
        data: {
          ...base,
          categoryId: category.id,
          name,
          basePrice: price,
          taxGroupId: tax.id,
          foodType: 'VEG',
          stationId: id('kitchen'),
          channels: ['POS', 'WAITER_APP', 'TABLE_TABLET', 'QR'],
        },
      })
    ).id;
  }
  await prisma.combo.create({
    data: {
      ...base,
      itemId: id('Thali'),
      components: {
        create: [
          { ...base, kind: 'FIXED', itemId: id('Dal'), quantity: 1, displayOrder: 1 },
          { ...base, kind: 'FIXED', itemId: id('Roti'), quantity: 2, displayOrder: 2 },
        ],
      },
    },
  });
  expect((await server().post('/api/v1/menu/publish').set(as(manager))).status).toBe(200);
  const hall = await prisma.section.create({ data: { ...base, name: 'Hall' } });
  for (const label of ['T1', 'T2', 'T3']) {
    ids[label] = (
      await prisma.diningTable.create({ data: { ...base, sectionId: hall.id, label } })
    ).id;
  }
  tablet = await addDevice(app, kit, 'TABLE_TABLET', { tableId: id('T3') });
});

afterAll(async () => {
  await app.close();
  await database.drop();
});

async function signInAs(staffId: string, pin: string): Promise<LoginResponse> {
  const response = await server()
    .post('/api/v1/auth/pin-login')
    .set(authHeaders(kit.deviceId))
    .send({ staffId, pin });
  return LoginResponse.parse(response.body);
}

const as = (login: LoginResponse) => authHeaders(kit.deviceId, login.accessToken);
const codeOf = (response: request.Response) => ApiError.parse(response.body).code;
const server = () => request(httpServer(app));

async function open(table: string, login: LoginResponse): Promise<string> {
  const response = await server()
    .post(`/api/v1/tables/${id(table)}/open`)
    .set(as(login))
    .send({ covers: 2 });
  return TableSessionView.parse(response.body).id;
}

function submit(login: LoginResponse, sessionId: string, lines: object[], hold = false) {
  return server()
    .post('/api/v1/orders')
    .set(as(login))
    .send({
      idempotencyKey: randomUUID(),
      source: 'WAITER_APP',
      orderType: 'DINE_IN',
      tableSessionId: sessionId,
      lines: lines.map((line) => ({
        clientLineId: randomUUID(),
        quantity: 1,
        ...(hold && { hold: true }),
        ...line,
      })),
    });
}

async function order(login: LoginResponse, sessionId: string, lines: object[]) {
  const response = await submit(login, sessionId, lines);
  const result = SubmitOrderResponse.parse(response.body);
  if (result.status !== 'ACCEPTED') throw new Error(JSON.stringify(response.body));
  return OrderView.parse(
    (await server().get(`/api/v1/orders/${result.orderId}`).set(as(manager))).body,
  );
}

const markOut = (itemId: string, login = kitchen) =>
  server()
    .put(`/api/v1/menu/items/${itemId}/availability`)
    .set(as(login))
    .send({ available: false, stockCount: null });
const markIn = (itemId: string) =>
  server()
    .put(`/api/v1/menu/items/${itemId}/availability`)
    .set(as(manager))
    .send({ available: true, stockCount: null });

const stateOf = async (orderItemId: string) =>
  (await prisma.orderItem.findUniqueOrThrow({ where: { id: orderItemId } })).state;

const outOfStockAlerts = (orderId: string) =>
  prisma.alert.findMany({
    where: { type: 'OUT_OF_STOCK', orderId },
    orderBy: { createdAt: 'asc' },
  });

describe('[MENU-006] [ORD-011] marking a dish out of stock (ADR-0023)', () => {
  it('cancels only unstarted units at no charge, per line, and alerts each sender', async () => {
    const t1 = await open('T1', waiter);
    // Waiter 1 opens T1 and sends Dal x2 and Naan; Waiter 2 sends another Dal.
    const first = await order(waiter, t1, [
      { itemId: id('Dal'), quantity: 2 },
      { itemId: id('Naan') },
    ]);
    const second = await order(waiter2, t1, [{ itemId: id('Dal') }]);
    const started = await order(waiter, t1, [{ itemId: id('Dal') }]);
    const startedDal = started.items[0]?.id ?? '';
    expect(
      (
        await server()
          .post(`/api/v1/order-items/${startedDal}/status`)
          .set(as(kitchen))
          .send({ event: 'START_PREPARING' })
      ).status,
    ).toBe(200);

    expect((await markOut(id('Dal'))).status).toBe(200);
    const firstDal = first.items.find((line) => line.itemId === id('Dal'))?.id ?? '';
    const naan = first.items.find((line) => line.itemId === id('Naan'))?.id ?? '';
    const secondDal = second.items[0]?.id ?? '';
    await until(async () => (await stateOf(secondDal)) === 'CANCELLED', 5_000, 'the cancel');
    expect(await stateOf(firstDal)).toBe('CANCELLED');
    expect(await stateOf(naan)).toBe('SENT');
    expect(await stateOf(startedDal)).toBe('PREPARING');
    const cancelled = await prisma.orderItem.findUniqueOrThrow({ where: { id: firstDal } });
    expect(cancelled.endReason).toBe('Out of stock');

    // One alert per line, to whoever sent its ticket, with the table, dish and quantity.
    // Nobody's pager or phone is connected here, so the managers hear at once too (NTF-007).
    const [toWaiter] = await outOfStockAlerts(first.id);
    expect(toWaiter?.recipientIds).toContain(kit.staff.WAITER);
    expect(toWaiter?.recipientIds).not.toContain(id('waiter2'));
    expect(toWaiter).toMatchObject({
      pagerText: 'T1 OUT OF STOCK',
      payload: { item: 'Dal', quantity: 2, cancelled: true },
    });
    const [toWaiter2] = await outOfStockAlerts(second.id);
    expect(toWaiter2?.recipientIds).toContain(id('waiter2'));
    expect(toWaiter2?.recipientIds).not.toContain(kit.staff.WAITER);
    expect(await outOfStockAlerts(started.id)).toEqual([]);

    // The kitchen hears a CANCELLED slip; the bill does not charge the cancelled units.
    const kinds = await prisma.kot.findMany({
      where: { orderId: first.id },
      select: { kind: true },
    });
    expect(kinds.map((kot) => kot.kind).sort()).toEqual(['CANCELLED', 'NEW']);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'ORDER_ITEM_CANCELLED', entityId: firstDal },
    });
    expect(audit).toMatchObject({ actorId: kit.staff.KITCHEN, reason: 'Out of stock' });
    await markIn(id('Dal'));
  });

  it('refuses the dish in new orders and when firing held dishes, whatever the app sends', async () => {
    const t2 = await open('T2', waiter);
    const held = await submit(waiter, t2, [{ itemId: id('Roti') }], true);
    const heldOrder = SubmitOrderResponse.parse(held.body);
    expect(heldOrder.status).toBe('ACCEPTED');
    await markOut(id('Roti'));
    const refused = SubmitOrderResponse.parse(
      (await submit(waiter, t2, [{ itemId: id('Roti') }])).body,
    );
    expect(refused).toMatchObject({
      status: 'PARTIALLY_REJECTED',
      rejectedLines: [expect.objectContaining({ code: 'OUT_OF_STOCK' })],
    });
    // A combo with the dish as a part is out of stock too.
    const combo = SubmitOrderResponse.parse(
      (await submit(waiter, t2, [{ itemId: id('Thali') }])).body,
    );
    expect(combo.status).toBe('PARTIALLY_REJECTED');
    if (heldOrder.status !== 'ACCEPTED') throw new Error('held');
    const fired = await server()
      .post(`/api/v1/orders/${heldOrder.orderId}/fire`)
      .set(as(waiter))
      .send({});
    expect([fired.status, codeOf(fired)]).toEqual([409, 'OUT_OF_STOCK']);
    await markIn(id('Roti'));
  });

  it('cancels a whole combo whose parts have not started', async () => {
    const t2 = (
      await prisma.tableSession.findFirstOrThrow({
        where: { tableId: id('T2'), status: 'OPEN' },
      })
    ).id;
    const thali = await order(waiter, t2, [{ itemId: id('Thali') }]);
    await markOut(id('Roti'));
    const line = thali.items.find((item) => item.parentOrderItemId === null)?.id ?? '';
    await until(async () => (await stateOf(line)) === 'CANCELLED', 5_000, 'the combo cancelled');
    const parts = await prisma.orderItem.findMany({ where: { parentOrderItemId: line } });
    expect(parts.map((part) => part.state)).toEqual(['CANCELLED', 'CANCELLED']);
    expect((await outOfStockAlerts(thali.id))[0]?.recipientIds).toContain(kit.staff.WAITER);
    await markIn(id('Roti'));
  });

  it('takes the dish off a diner’s order still waiting, and alerts the waiters on duty', async () => {
    await open('T3', waiter);
    const placed = await server()
      .post('/api/v1/devices/current/orders')
      .set(authHeaders(tablet))
      .send({
        idempotencyKey: randomUUID(),
        lines: [{ clientLineId: randomUUID(), itemId: id('Naan'), quantity: 2 }],
      });
    expect(placed.status, JSON.stringify(placed.body)).toBeLessThan(300);
    const waiting = await prisma.orderItem.findFirstOrThrow({
      where: { itemId: id('Naan'), state: 'PENDING_APPROVAL' },
    });
    await markOut(id('Naan'), manager);
    await until(async () => (await stateOf(waiting.id)) === 'REJECTED', 5_000, 'the line rejected');
    const [alert] = await outOfStockAlerts(waiting.orderId);
    // Nobody sent it yet: every waiter on duty hears it (D-17).
    expect(alert?.recipientIds).toEqual(expect.arrayContaining([kit.staff.WAITER]));
    expect(alert?.payload).toMatchObject({ item: 'Naan', quantity: 2, cancelled: true });
    // Nothing is left to approve, so its approval alert is cleared.
    await until(
      async () =>
        (await prisma.alert.count({
          where: { orderId: waiting.orderId, type: 'ORDER_PENDING_APPROVAL', status: 'OPEN' },
        })) === 0,
      5_000,
      'the approval alert cleared',
    );
  });

  it('refuses a person without the stock grant', async () => {
    expect((await markOut(id('Dal'), waiter)).status).toBe(403);
  });
});
