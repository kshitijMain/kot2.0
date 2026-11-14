import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  type LoginResponse,
  PrinterView,
  PrintQueueResponse,
  StationView,
  SubmitOrderResponse,
  TableSessionView,
} from '@rp/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/database/prisma.service.js';
import {
  DEFAULT_PRINT_QUEUE_OPTIONS,
  PRINT_QUEUE_OPTIONS,
} from '../../src/printing/print-queue.service.js';
import { authHeaders, type AuthKit, createAuthKit, signIn } from '../helpers/auth-kit.js';
import { FakePrinter } from '../helpers/fake-printer.js';
import { createTestApp, httpServer } from '../helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js';
import { until } from '../helpers/wait.js';

/**
 * A printer that comes back (ADR-0031, item H): the Business Owner switched the printer off, sent
 * an order, switched it on again, and the ticket never came out. A failed printer waited ever
 * longer between tries (2, 4, 8, 16, 32 s, up to a minute), and nothing noticed it was back. The
 * queue now checks an offline printer on every pass without printing on it, and prints as soon as
 * it answers: in order, each ticket once.
 */

let database: TestDatabase;
let app: INestApplication;
let prisma: PrismaService;
let kit: AuthKit;
let manager: LoginResponse;
let waiter: LoginResponse;
const paper = new FakePrinter();
const ids: Record<string, string> = {};
const id = (name: string) => ids[name] ?? '';

beforeAll(async () => {
  await paper.start();
  database = await createTestDatabase();
  app = await createTestApp({
    databaseUrl: database.url,
    // The queue runs by itself, as in the restaurant, with the restaurant's waits between tries.
    overrides: [
      {
        provide: PRINT_QUEUE_OPTIONS,
        useValue: { ...DEFAULT_PRINT_QUEUE_OPTIONS, intervalMs: 500 },
      },
    ],
  });
  prisma = app.get(PrismaService);
  kit = await createAuthKit(app);
  manager = await signIn(app, kit, 'MANAGER');
  waiter = await signIn(app, kit, 'WAITER');
  const base = { restaurantId: kit.restaurantId };
  ids.printer = PrinterView.parse(
    (
      await server().post('/api/v1/printers').set(as(manager)).send({
        name: 'Kitchen printer',
        connection: 'NETWORK',
        host: '127.0.0.1',
        port: paper.port,
        paperWidthMm: 80,
      })
    ).body,
  ).id;
  ids.station = StationView.parse(
    (
      await server()
        .post('/api/v1/stations')
        .set(as(manager))
        .send({ name: 'Kitchen', mode: 'PRINT', printerId: id('printer') })
    ).body,
  ).id;
  const category = await prisma.category.create({ data: { ...base, name: 'Menu' } });
  const taxGroup = await prisma.taxGroup.create({
    data: {
      ...base,
      name: 'GST',
      components: { create: [{ ...base, code: 'CGST', rateBp: 250 }] },
    },
  });
  ids.dal = (
    await prisma.item.create({
      data: {
        ...base,
        categoryId: category.id,
        name: 'Dal',
        basePrice: 10_000,
        taxGroupId: taxGroup.id,
        foodType: 'VEG',
        stationId: id('station'),
      },
    })
  ).id;
  expect((await server().post('/api/v1/menu/publish').set(as(manager))).status).toBe(200);
  const hall = await prisma.section.create({ data: { ...base, name: 'Hall' } });
  ids.table = (
    await prisma.diningTable.create({ data: { ...base, sectionId: hall.id, label: 'T1' } })
  ).id;
  ids.session = TableSessionView.parse(
    (
      await server()
        .post(`/api/v1/tables/${id('table')}/open`)
        .set(as(waiter))
        .send({ covers: 2 })
    ).body,
  ).id;
});

afterAll(async () => {
  await app.close();
  await database.drop();
  await paper.stop();
});

const server = () => request(httpServer(app));
const as = (login: LoginResponse) => authHeaders(kit.deviceId, login.accessToken);

async function send(note: string): Promise<number> {
  const sent = SubmitOrderResponse.parse(
    (
      await server()
        .post('/api/v1/orders')
        .set(as(waiter))
        .send({
          idempotencyKey: randomUUID(),
          source: 'WAITER_APP',
          orderType: 'DINE_IN',
          tableSessionId: id('session'),
          lines: [
            { clientLineId: randomUUID(), itemId: id('dal'), quantity: 1, instructions: note },
          ],
        })
    ).body,
  );
  if (sent.status !== 'ACCEPTED') throw new Error('refused');
  return (await prisma.kot.findFirstOrThrow({ where: { orderId: sent.orderId } })).kotNumber;
}

const queue = async () =>
  PrintQueueResponse.parse(
    (await server().get('/api/v1/print-queue').set(as(manager))).body,
  ).printers.find((entry) => entry.printerId === id('printer'));

describe('[KDS-008] [NFR-P02] a printer that comes back prints what waited (ADR-0031)', () => {
  it('prints the waiting tickets within seconds of coming back, in order, once each', async () => {
    await paper.stop();
    const first = await send('First');
    const second = await send('Second');
    // Long enough off for the old waits to reach 16 s between tries.
    await until(
      async () => ((await queue())?.online === false ? true : undefined),
      10_000,
      'the printer to show offline',
    );
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    const offline = await queue();
    expect(offline?.queued).toBe(2);
    // The waiting tickets are listed, oldest first.
    expect(offline?.jobs.map((job) => job.label)).toEqual([
      `KOT ${String(first)} · T1`,
      `KOT ${String(second)} · T1`,
    ]);

    await paper.start();
    const back = Date.now();
    await until(
      () => Promise.resolve(paper.jobs.length >= 2 ? true : undefined),
      10_000,
      'both tickets',
    );
    expect(Date.now() - back).toBeLessThan(10_000);
    expect(paper.jobs[0]).toContain('! First');
    expect(paper.jobs[1]).toContain('! Second');
    // Once each: a few more passes print nothing again.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(paper.jobs).toHaveLength(2);
    expect(await queue()).toMatchObject({ online: true, queued: 0, jobs: [] });
  }, 60_000);

  it('tries again at once when a manager asks', async () => {
    await paper.stop();
    await send('Third');
    await until(
      async () => ((await queue())?.online === false ? true : undefined),
      10_000,
      'the printer to show offline',
    );
    const printed = paper.jobs.length;
    await paper.start();
    const retried = await server()
      .post(`/api/v1/printers/${id('printer')}/retry`)
      .set(as(manager));
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    await until(
      () => Promise.resolve(paper.jobs.length > printed ? true : undefined),
      3_000,
      'the ticket after Retry now',
    );
    expect(
      (
        await server()
          .post(`/api/v1/printers/${id('printer')}/retry`)
          .set(as(waiter))
      ).status,
    ).toBe(403);
  }, 30_000);
});
