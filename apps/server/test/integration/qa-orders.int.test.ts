import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { type LoginResponse, TableSessionView } from '@rp/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/database/prisma.service.js';
import { authSettingKey, AuthSettingsService } from '../../src/auth/auth-settings.js';
import {
  addDevice,
  addStaff,
  authHeaders,
  type AuthKit,
  createAuthKit,
  signIn,
} from '../helpers/auth-kit.js';
import { setUpSmallRestaurant, type SmallRestaurant } from '../helpers/small-restaurant.js';
import { api, createTestApp } from '../helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js';

/**
 * QA audit, category B (orders and the menu): loopholes found by the audit, each first shown by a
 * failing test here (docs/testing/QA_REPORT.md).
 */

let database: TestDatabase;
let app: INestApplication;
let prisma: PrismaService;
let kit: AuthKit;
let restaurant: SmallRestaurant;
let manager: LoginResponse;
let waiter: LoginResponse;
const tables: string[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createTestApp({ databaseUrl: database.url });
  prisma = app.get(PrismaService);
  kit = await createAuthKit(app);
  manager = await signIn(app, kit, 'MANAGER');
  waiter = await signIn(app, kit, 'WAITER');
  restaurant = await setUpSmallRestaurant(app, kit, manager);
  const hall = await prisma.section.findFirstOrThrow({ where: { restaurantId: kit.restaurantId } });
  for (let number = 5; number <= 24; number += 1) {
    const table = await prisma.diningTable.create({
      data: { restaurantId: kit.restaurantId, sectionId: hall.id, label: `T${String(number)}` },
    });
    tables.push(table.id);
  }
});

afterAll(async () => {
  await app.close();
  await database.drop();
});

const as = (who: LoginResponse) => authHeaders(kit.deviceId, who.accessToken);

async function seat(who: LoginResponse = waiter): Promise<string> {
  const response = await api(app)
    .post(`/api/v1/tables/${tables.shift()!}/open`)
    .set(as(who))
    .send({ covers: 2 });
  expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
  return TableSessionView.parse(response.body).id;
}

function order(
  sessionId: string,
  line: { itemId: string; quantity?: number; modifiers?: unknown[] },
  who: LoginResponse = waiter,
) {
  return api(app)
    .post('/api/v1/orders')
    .set(as(who))
    .send({
      idempotencyKey: randomUUID(),
      source: 'WAITER_APP',
      orderType: 'DINE_IN',
      tableSessionId: sessionId,
      lines: [{ clientLineId: randomUUID(), quantity: 1, ...line }],
    });
}

async function publish(): Promise<void> {
  const published = await api(app).post('/api/v1/menu/publish').set(as(manager));
  expect(published.status, JSON.stringify(published.body)).toBeLessThan(300);
}

describe('[MENU-004] [ORD-014] an add-on marked not available (QA-015)', () => {
  it('cannot be ordered once the menu is published', async () => {
    const base = { restaurantId: kit.restaurantId };
    const group = await prisma.modifierGroup.create({
      data: { ...base, name: 'Extras', minSelections: 0, maxSelections: 2 },
    });
    const butter = await prisma.modifierOption.create({
      data: { ...base, groupId: group.id, name: 'Butter', priceDelta: 2_000 },
    });
    const cheese = await prisma.modifierOption.create({
      data: { ...base, groupId: group.id, name: 'Cheese', priceDelta: 3_000, available: false },
    });
    await prisma.itemModifierGroup.create({
      data: { ...base, itemId: restaurant.items.Naan, groupId: group.id },
    });
    await publish();
    const sessionId = await seat();
    const fine = await order(sessionId, {
      itemId: restaurant.items.Naan,
      modifiers: [{ groupId: group.id, optionIds: [butter.id] }],
    });
    expect(fine.body, JSON.stringify(fine.body)).toMatchObject({ status: 'ACCEPTED' });
    const sold = await order(sessionId, {
      itemId: restaurant.items.Naan,
      modifiers: [{ groupId: group.id, optionIds: [cheese.id] }],
    });
    expect((sold.body as { status: string }).status, JSON.stringify(sold.body)).not.toBe(
      'ACCEPTED',
    );
    expect(await prisma.orderItemModifier.count({ where: { modifierOptionId: cheese.id } })).toBe(
      0,
    );
  });
});

describe('[ORD-012] [MENU-005] a dish taken off the menu while it is on an order (QA-016)', () => {
  it('can still be cancelled or reduced on that order', async () => {
    const base = { restaurantId: kit.restaurantId };
    const category = await prisma.category.findFirstOrThrow({ where: base });
    const dal = await prisma.item.findUniqueOrThrow({ where: { id: restaurant.items.Dal } });
    const special = await prisma.item.create({
      data: {
        ...base,
        categoryId: category.id,
        name: 'Seasonal special',
        basePrice: 30_000,
        taxGroupId: dal.taxGroupId,
        foodType: 'VEG',
        stationId: dal.stationId,
      },
    });
    await publish();
    const sessionId = await seat();
    const ordered = await order(sessionId, { itemId: special.id, quantity: 3 });
    expect(ordered.body, JSON.stringify(ordered.body)).toMatchObject({ status: 'ACCEPTED' });
    const line = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: (ordered.body as { orderId: string }).orderId },
    });
    const archived = await api(app)
      .post(`/api/v1/menu/items/${special.id}/archive`)
      .set(as(manager))
      .send({ reason: 'Season over' });
    expect(archived.status, JSON.stringify(archived.body)).toBeLessThan(300);
    await publish();

    const reduced = await api(app)
      .patch(`/api/v1/order-items/${line.id}`)
      .set(as(waiter))
      .send({ quantity: 1 });
    expect(reduced.status, JSON.stringify(reduced.body)).toBeLessThan(300);
    const cancelled = await api(app)
      .post(`/api/v1/order-items/${line.id}/cancel`)
      .set(as(waiter))
      .send({ reason: 'Guest left early' });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBeLessThan(300);
  });
});

describe('[KDS-002] [AUTH-005] a kitchen screen showing two stations (QA-017)', () => {
  it('can mark the dishes of both, and of no other station', async () => {
    const base = { restaurantId: kit.restaurantId };
    const kitchen = await prisma.station.findFirstOrThrow({ where: { ...base, name: 'Kitchen' } });
    const bar = await prisma.station.create({ data: { ...base, name: 'Bar', mode: 'SCREEN' } });
    const tandoor = await prisma.station.create({
      data: { ...base, name: 'Tandoor', mode: 'SCREEN' },
    });
    const dal = await prisma.item.findUniqueOrThrow({ where: { id: restaurant.items.Dal } });
    const dish = (name: string, stationId: string) =>
      prisma.item.create({
        data: {
          ...base,
          categoryId: dal.categoryId,
          name,
          basePrice: 10_000,
          taxGroupId: dal.taxGroupId,
          foodType: 'VEG',
          stationId,
        },
      });
    const mojito = await dish('Virgin mojito', bar.id);
    const tikka = await dish('Paneer tikka', tandoor.id);
    await publish();
    const screen = await addDevice(app, kit, 'KDS', {
      stationId: kitchen.id,
      extraStationIds: [bar.id],
    });
    const sessionId = await seat();
    const lineOf = async (itemId: string) => {
      const ordered = await order(sessionId, { itemId });
      expect(ordered.body, JSON.stringify(ordered.body)).toMatchObject({ status: 'ACCEPTED' });
      return prisma.orderItem.findFirstOrThrow({
        where: { orderId: (ordered.body as { orderId: string }).orderId },
      });
    };
    const drink = await lineOf(mojito.id);
    const starter = await lineOf(tikka.id);
    // Station mode: kitchen staff do not sign in; the screen acts for its stations.
    await prisma.setting.upsert({
      where: {
        restaurantId_key: { ...base, key: authSettingKey('kitchenIndividualLogins') },
      },
      create: { ...base, key: authSettingKey('kitchenIndividualLogins'), value: false },
      update: { value: false },
    });
    app.get(AuthSettingsService).invalidate();
    try {
      const own = await api(app)
        .post(`/api/v1/order-items/${drink.id}/status`)
        .set(authHeaders(screen))
        .send({ event: 'START_PREPARING' });
      expect(own.status, JSON.stringify(own.body)).toBeLessThan(300);
      const other = await api(app)
        .post(`/api/v1/order-items/${starter.id}/status`)
        .set(authHeaders(screen))
        .send({ event: 'START_PREPARING' });
      expect(other.status).toBe(403);
    } finally {
      await prisma.setting.update({
        where: {
          restaurantId_key: { ...base, key: authSettingKey('kitchenIndividualLogins') },
        },
        data: { value: true },
      });
      app.get(AuthSettingsService).invalidate();
    }
  });
});

describe('[ORD-011] [AUTH-010] lowering a dish on another waiter’s table (QA-018)', () => {
  it('counts as a cancel: only on the waiter’s own tables, while more may be added anywhere', async () => {
    const otherWaiterId = await addStaff(app, kit, 'WAITER', '8642');
    const other = await api(app)
      .post('/api/v1/auth/pin-login')
      .set(authHeaders(kit.deviceId))
      .send({ staffId: otherWaiterId, pin: '8642' });
    expect(other.status, JSON.stringify(other.body)).toBe(200);
    const ravi = other.body as LoginResponse;
    const sessionId = await seat(waiter);
    const ordered = await order(sessionId, { itemId: restaurant.items.Dal, quantity: 4 });
    expect(ordered.body, JSON.stringify(ordered.body)).toMatchObject({ status: 'ACCEPTED' });
    const line = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: (ordered.body as { orderId: string }).orderId },
    });
    const lowered = await api(app)
      .patch(`/api/v1/order-items/${line.id}`)
      .set(as(ravi))
      .send({ quantity: 1 });
    expect(lowered.status).toBe(403);
    const raised = await api(app)
      .patch(`/api/v1/order-items/${line.id}`)
      .set(as(ravi))
      .send({ quantity: 5 });
    expect(raised.status, JSON.stringify(raised.body)).toBeLessThan(300);
    const own = await api(app)
      .patch(`/api/v1/order-items/${line.id}`)
      .set(as(waiter))
      .send({ quantity: 2 });
    expect(own.status, JSON.stringify(own.body)).toBeLessThan(300);
  });
});
