import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  BillView,
  InvoicePaymentsView,
  InvoiceView,
  type LoginResponse,
  PaymentModesResponse,
  ShiftView,
  SubmitOrderResponse,
} from '@rp/contracts';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../src/database/prisma.service.js';
import {
  authHeaders,
  type AuthKit,
  createAuthKit,
  renewDeviceToken,
  signIn,
} from '../helpers/auth-kit.js';
import { setUpSmallRestaurant, type SmallRestaurant } from '../helpers/small-restaurant.js';
import { createTestApp, httpServer } from '../helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js';

/**
 * ADR-0029: a shift opened before the 04:00 business-day cut-off and closed after it. Its cash
 * comes from both business dates; each payment keeps its own date and none counts as "outside".
 */

let database: TestDatabase;
let app: INestApplication;
let prisma: PrismaService;
let kit: AuthKit;
let restaurant: SmallRestaurant;

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createTestApp({ databaseUrl: database.url });
  prisma = app.get(PrismaService);
  kit = await createAuthKit(app);
  restaurant = await setUpSmallRestaurant(app, kit, await signIn(app, kit, 'MANAGER'));
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await app.close();
  await database.drop();
});

const server = () => request(httpServer(app));

/** The next moment that reads `hour`:30 in India, at least an hour from now. */
function nextIst(hour: number): Date {
  const offset = 5.5 * 3_600_000;
  const local = new Date(Date.now() + offset + 3_600_000);
  const target = new Date(local);
  target.setUTCHours(hour, 30, 0, 0);
  if (target <= local) target.setUTCDate(target.getUTCDate() + 1);
  return new Date(target.getTime() - offset);
}

/** Moves the clock and signs in again, since tokens from before the jump have expired. */
async function at(when: Date): Promise<LoginResponse> {
  vi.setSystemTime(when);
  await renewDeviceToken(app, kit.deviceId);
  return signIn(app, kit, 'MANAGER');
}

async function cashBill(manager: LoginResponse): Promise<InvoicePaymentsView> {
  const as = authHeaders(kit.deviceId, manager.accessToken);
  const order = SubmitOrderResponse.parse(
    (
      await server()
        .post('/api/v1/orders')
        .set(as)
        .send({
          idempotencyKey: randomUUID(),
          source: 'POS',
          orderType: 'TAKEAWAY',
          lines: [{ clientLineId: randomUUID(), itemId: restaurant.items.Dal, quantity: 1 }],
        })
    ).body,
  );
  if (order.status !== 'ACCEPTED') throw new Error('refused');
  const bill = BillView.parse(
    (await server().post('/api/v1/bills').set(as).send({ orderId: order.orderId })).body,
  );
  const invoice = InvoiceView.parse(
    (await server().post(`/api/v1/bills/${bill.id}/invoice`).set(as).send({})).body,
  );
  const paid = await server()
    .post(`/api/v1/invoices/${invoice.id}/payments`)
    .set(as)
    .send({
      idempotencyKey: randomUUID(),
      payments: [{ mode: 'CASH', amount: invoice.grandTotal }],
    });
  expect(paid.status, JSON.stringify(paid.body)).toBe(200);
  return InvoicePaymentsView.parse(paid.body);
}

describe('[BILL-013] a shift across the 04:00 cut-off (ADR-0029)', () => {
  it('counts cash from both business dates, each payment keeping its own date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const before = nextIst(3);
    const after = new Date(before.getTime() + 60 * 60_000);

    const early = await at(before);
    const opened = await server()
      .post('/api/v1/shifts')
      .set(authHeaders(kit.deviceId, early.accessToken))
      .send({ openingFloat: 100_000 });
    expect(opened.status, JSON.stringify(opened.body)).toBe(201);
    const shift = ShiftView.parse(opened.body);
    const first = await cashBill(early);

    const late = await at(after);
    const as = authHeaders(kit.deviceId, late.accessToken);
    const second = await cashBill(late);

    expect(first.payments[0]?.shiftId).toBe(shift.id);
    expect(second.payments[0]?.shiftId).toBe(shift.id);
    const stored = await prisma.payment.findMany({
      where: { shiftId: shift.id },
      orderBy: { createdAt: 'asc' },
      select: { businessDate: true },
    });
    const [dateOne, dateTwo] = stored.map((row) => row.businessDate.toISOString().slice(0, 10));
    expect(dateOne).toBe(shift.businessDate);
    expect(dateTwo).not.toBe(dateOne);

    const closed = ShiftView.parse(
      (
        await server()
          .post(`/api/v1/shifts/${shift.id}/close`)
          .set(as)
          .send({ countedCash: 100_000 + first.grandTotal + second.grandTotal })
      ).body,
    );
    expect(closed).toMatchObject({ status: 'CLOSED', variance: 0 });
    expect(closed.cashPayments).toBe(first.grandTotal + second.grandTotal);
    // The shift stays on the date it was opened.
    expect(closed.businessDate).toBe(shift.businessDate);

    for (const date of [dateOne, dateTwo]) {
      const report = PaymentModesResponse.parse(
        (await server().get(`/api/v1/reports/payments?from=${date}&to=${date}`).set(as)).body,
      );
      expect(report.cashOutsideShift).toBe(0);
    }
  }, 60_000);
});
