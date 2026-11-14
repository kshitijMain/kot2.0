import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  KdsTicketsResponse,
  type LoginResponse,
  MenuPublishStatus,
  PrinterView,
  StationView,
  SubmitOrderResponse,
  TableSessionView,
} from '@rp/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/database/prisma.service.js';
import {
  PRINT_QUEUE_OPTIONS,
  PrintQueueService,
  TEST_PRINT_QUEUE_OPTIONS,
} from '../../src/printing/print-queue.service.js';
import {
  addDevice,
  authHeaders,
  type AuthKit,
  createAuthKit,
  signIn,
} from '../helpers/auth-kit.js';
import { FakePrinter } from '../helpers/fake-printer.js';
import { createTestApp, httpServer } from '../helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js';

/**
 * Station routing (ADR-0031, item B): the Business Owner made a Bar station, set "Lime soda" to
 * it in the menu editor, and a waiter's Lime soda still went to the Kitchen. A dish's KOT was
 * routed by the station in the last *published* menu, and the change had not been published. A
 * dish now goes to its station as it stands when the KOT is made, and the menu says plainly when
 * changes are not published yet.
 */

let database: TestDatabase;
let app: INestApplication;
let prisma: PrismaService;
let queue: PrintQueueService;
let kit: AuthKit;
let manager: LoginResponse;
let waiter: LoginResponse;
const kitchenPaper = new FakePrinter();
const barPaper = new FakePrinter();
const ids: Record<string, string> = {};
const id = (name: string) => ids[name] ?? '';

beforeAll(async () => {
  await kitchenPaper.start();
  await barPaper.start();
  database = await createTestDatabase();
  app = await createTestApp({
    databaseUrl: database.url,
    overrides: [
      {
        provide: PRINT_QUEUE_OPTIONS,
        useValue: { ...TEST_PRINT_QUEUE_OPTIONS, retryBaseMs: 0, retryMaxMs: 0 },
      },
    ],
  });
  prisma = app.get(PrismaService);
  queue = app.get(PrintQueueService);
  kit = await createAuthKit(app, { kitchenLogins: false });
  manager = await signIn(app, kit, 'MANAGER');
  waiter = await signIn(app, kit, 'WAITER');
  const base = { restaurantId: kit.restaurantId };

  const printer = async (name: string, port: number) =>
    PrinterView.parse(
      (
        await server()
          .post('/api/v1/printers')
          .set(as(manager))
          .send({ name, connection: 'NETWORK', host: '127.0.0.1', port, paperWidthMm: 80 })
      ).body,
    ).id;
  const station = async (name: string, printerId: string) =>
    StationView.parse(
      (
        await server()
          .post('/api/v1/stations')
          .set(as(manager))
          .send({ name, mode: 'BOTH', printerId })
      ).body,
    ).id;
  ids.kitchen = await station('Kitchen', await printer('Kitchen printer', kitchenPaper.port));
  ids.bar = await station('Bar', await printer('Bar printer', barPaper.port));

  const category = await prisma.category.create({ data: { ...base, name: 'Menu' } });
  const taxGroup = await prisma.taxGroup.create({
    data: {
      ...base,
      name: 'GST 5 %',
      components: { create: [{ ...base, code: 'CGST', rateBp: 500 }] },
    },
  });
  // Lime soda starts in the kitchen, as the Business Owner's had before the Bar existed.
  for (const name of ['Dal', 'Lime soda']) {
    ids[name] = (
      await prisma.item.create({
        data: {
          ...base,
          categoryId: category.id,
          name,
          basePrice: 10_000,
          taxGroupId: taxGroup.id,
          foodType: 'VEG',
          stationId: id('kitchen'),
        },
      })
    ).id;
  }
  expect((await server().post('/api/v1/menu/publish').set(as(manager))).status).toBe(200);
  const hall = await prisma.section.create({ data: { ...base, name: 'Hall' } });
  for (const label of ['T1', 'T2']) {
    ids[label] = (
      await prisma.diningTable.create({ data: { ...base, sectionId: hall.id, label } })
    ).id;
  }
  ids.kitchenScreen = await addDevice(app, kit, 'KDS', { stationId: id('kitchen') });
  ids.barScreen = await addDevice(app, kit, 'KDS', { stationId: id('bar') });
});

afterAll(async () => {
  await app.close();
  await database.drop();
  await kitchenPaper.stop();
  await barPaper.stop();
});

const server = () => request(httpServer(app));
const as = (login: LoginResponse) => authHeaders(kit.deviceId, login.accessToken);

async function send(table: string, dishes: readonly string[]): Promise<string> {
  const session = TableSessionView.parse(
    (
      await server()
        .post(`/api/v1/tables/${id(table)}/open`)
        .set(as(waiter))
        .send({ covers: 2 })
    ).body,
  );
  const sent = await server()
    .post('/api/v1/orders')
    .set(as(waiter))
    .send({
      idempotencyKey: randomUUID(),
      source: 'WAITER_APP',
      orderType: 'DINE_IN',
      tableSessionId: session.id,
      lines: dishes.map((dish) => ({ clientLineId: randomUUID(), itemId: id(dish), quantity: 1 })),
    });
  const accepted = SubmitOrderResponse.parse(sent.body);
  if (accepted.status !== 'ACCEPTED') throw new Error(JSON.stringify(sent.body));
  return accepted.orderId;
}

async function kotsOf(orderId: string) {
  const kots = await prisma.kot.findMany({
    where: { orderId },
    include: { lines: { include: { orderItem: { select: { name: true } } } } },
  });
  return kots.map((kot) => ({
    station: kot.stationId === id('bar') ? 'Bar' : 'Kitchen',
    dishes: kot.lines.map((line) => line.orderItem.name).sort(),
  }));
}

async function status() {
  const answer = await server().get('/api/v1/menu/publish-status').set(as(manager));
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return MenuPublishStatus.parse(answer.body);
}

const ticketsOf = async (screen: string) =>
  KdsTicketsResponse.parse(
    (
      await server()
        .get('/api/v1/kds/tickets')
        .set(authHeaders(id(screen)))
    ).body,
  ).tickets;

describe('[KDS-008] [MENU-012] a dish goes to its station (ADR-0031)', () => {
  it('sends a dish moved to the Bar to the Bar, published or not, and says it is unpublished', async () => {
    expect(await status()).toMatchObject({ unpublished: false, changedItems: [] });
    // The menu editor saves the dish with its new station: a draft change.
    await prisma.item.update({ where: { id: id('Lime soda') }, data: { stationId: id('bar') } });
    expect(await status()).toMatchObject({
      unpublished: true,
      changedItems: ['Lime soda'],
      publishedVersion: 1,
    });

    const orderId = await send('T1', ['Lime soda']);
    expect(await kotsOf(orderId)).toEqual([{ station: 'Bar', dishes: ['Lime soda'] }]);
    expect((await ticketsOf('barScreen')).map((ticket) => ticket.kotNumber)).toHaveLength(1);
    expect(await ticketsOf('kitchenScreen')).toEqual([]);
    expect(await queue.drain()).toEqual({ printed: 1, failed: 0 });
    expect(barPaper.jobs).toHaveLength(1);
    expect(barPaper.jobs[0]).toContain('Lime soda');
    expect(kitchenPaper.jobs).toHaveLength(0);

    expect((await server().post('/api/v1/menu/publish').set(as(manager))).status).toBe(200);
    expect(await status()).toMatchObject({ unpublished: false, publishedVersion: 2 });
  });

  it('makes one KOT per station for a mixed order, each on its own screen and printer', async () => {
    const orderId = await send('T2', ['Dal', 'Lime soda']);
    expect((await kotsOf(orderId)).sort((a, b) => a.station.localeCompare(b.station))).toEqual([
      { station: 'Bar', dishes: ['Lime soda'] },
      { station: 'Kitchen', dishes: ['Dal'] },
    ]);
    const kitchen = await ticketsOf('kitchenScreen');
    const bar = await ticketsOf('barScreen');
    expect(kitchen.flatMap((ticket) => ticket.lines.map((line) => line.name))).toEqual(['Dal']);
    expect(bar.flatMap((ticket) => ticket.lines.map((line) => line.name))).toContain('Lime soda');
    expect(bar.flatMap((ticket) => ticket.lines.map((line) => line.name))).not.toContain('Dal');

    const before = { kitchen: kitchenPaper.jobs.length, bar: barPaper.jobs.length };
    expect(await queue.drain()).toEqual({ printed: 2, failed: 0 });
    expect(kitchenPaper.jobs.slice(before.kitchen)).toHaveLength(1);
    expect(kitchenPaper.jobs.at(-1)).toContain('Dal');
    expect(kitchenPaper.jobs.at(-1)).not.toContain('Lime soda');
    expect(barPaper.jobs.slice(before.bar)).toHaveLength(1);
    expect(barPaper.jobs.at(-1)).toContain('Lime soda');
    expect(barPaper.jobs.at(-1)).not.toContain('Dal');
  });
});
