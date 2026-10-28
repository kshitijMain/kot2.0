import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { BillView, InvoiceView, type LoginResponse } from '@rp/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/database/prisma.service.js';
import { authHeaders, type AuthKit, createAuthKit, signIn } from '../helpers/auth-kit.js';
import {
  DISHES,
  seatAndOrder,
  setUpSmallRestaurant,
  type SmallRestaurant,
} from '../helpers/small-restaurant.js';
import { api, createTestApp } from '../helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js';

/**
 * QA audit, category B (money and records): loopholes found by the audit, each first shown by a
 * failing test here (docs/testing/QA_REPORT.md).
 */

let database: TestDatabase;
let app: INestApplication;
let prisma: PrismaService;
let kit: AuthKit;
let restaurant: SmallRestaurant;
let manager: LoginResponse;
let waiter: LoginResponse;
let cashier: LoginResponse;

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createTestApp({ databaseUrl: database.url });
  prisma = app.get(PrismaService);
  kit = await createAuthKit(app);
  manager = await signIn(app, kit, 'MANAGER');
  waiter = await signIn(app, kit, 'WAITER');
  cashier = await signIn(app, kit, 'CASHIER');
  restaurant = await setUpSmallRestaurant(app, kit, manager);
  // A fresh table for each case.
  const hall = await prisma.section.findFirstOrThrow({ where: { restaurantId: kit.restaurantId } });
  for (let number = 5; number <= 44; number += 1) {
    const table = await prisma.diningTable.create({
      data: { restaurantId: kit.restaurantId, sectionId: hall.id, label: `T${String(number)}` },
    });
    tables.push(table.id);
  }
});

const tables: string[] = [];

afterAll(async () => {
  await app.close();
  await database.drop();
});

const as = (who: LoginResponse) => authHeaders(kit.deviceId, who.accessToken);

/** A fresh table seated and ordered (Dal x1, Naan x1: ₹220 before tax). */
async function orderedTable() {
  const tableId = tables.shift()!;
  const visit = await seatAndOrder(app, kit, waiter, tableId, [
    [restaurant.items.Dal, 1],
    [restaurant.items.Naan, 1],
  ]);
  const items = await prisma.orderItem.findMany({ where: { orderId: visit.orderId } });
  const dal = items.find((item) => item.itemId === restaurant.items.Dal);
  if (dal === undefined) throw new Error('The dal line is missing');
  return { ...visit, dalLineId: dal.id };
}

async function openBill(sessionId: string): Promise<BillView> {
  const response = await api(app)
    .post('/api/v1/bills')
    .set(as(cashier))
    .send({ tableSessionId: sessionId });
  expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
  return BillView.parse(response.body);
}

async function issue(billId: string): Promise<InvoiceView> {
  const response = await api(app).post(`/api/v1/bills/${billId}/invoice`).set(as(cashier)).send({});
  expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
  return InvoiceView.parse(response.body);
}

function pay(invoiceId: string, amount: number) {
  return api(app)
    .post(`/api/v1/invoices/${invoiceId}/payments`)
    .set(as(cashier))
    .send({
      idempotencyKey: randomUUID(),
      payments: [{ mode: 'UPI', amount, reference: 'UPI-QA' }],
    });
}

describe('[BILL-005] a flat discount (QA-001)', () => {
  it('takes its amount off the bill', async () => {
    const { sessionId } = await orderedTable();
    const bill = await openBill(sessionId);
    expect(bill.subtotal).toBe(DISHES.Dal + DISHES.Naan);
    const discounted = await api(app)
      .post(`/api/v1/bills/${bill.id}/discounts`)
      .set(as(manager))
      .send({ kind: 'FLAT', amount: 5_000, reason: 'Regular guest' });
    expect(discounted.status, JSON.stringify(discounted.body)).toBeLessThan(300);
    const after = BillView.parse(discounted.body);
    expect(after.discountTotal).toBe(5_000);
    expect(after.discounts.map((discount) => discount.amount)).toEqual([5_000]);
    expect(after.grandTotal).toBeLessThan(bill.grandTotal);
  });
});

describe('[ORD-012] [BILL-010] items on a printed bill (QA-002)', () => {
  it('refuses to change, cancel or void a line once its bill is printed, unless reopened', async () => {
    const { sessionId, dalLineId } = await orderedTable();
    const bill = await openBill(sessionId);
    const invoice = await issue(bill.id);
    const more = await api(app)
      .patch(`/api/v1/order-items/${dalLineId}`)
      .set(as(waiter))
      .send({ quantity: 9 });
    expect(more.status).toBe(409);
    expect(more.body).toMatchObject({ code: 'ITEM_ON_PRINTED_BILL' });
    const cancelled = await api(app)
      .post(`/api/v1/order-items/${dalLineId}/cancel`)
      .set(as(cashier))
      .send({ reason: 'Guest changed mind' });
    expect(cancelled.status).toBe(409);
    expect(cancelled.body).toMatchObject({ code: 'ITEM_ON_PRINTED_BILL' });
    const line = await prisma.orderItem.findUniqueOrThrow({ where: { id: dalLineId } });
    expect(line.quantity).toBe(1);
    expect(line.state).toBe('SENT');

    // The approved way: reopen the bill, change it, print it again.
    const reopened = await api(app)
      .post(`/api/v1/invoices/${invoice.id}/reopen`)
      .set(as(manager))
      .send({ reason: 'Guest sent the dal back' });
    expect(reopened.status, JSON.stringify(reopened.body)).toBeLessThan(300);
    const edited = await api(app)
      .post(`/api/v1/order-items/${dalLineId}/cancel`)
      .set(as(cashier))
      .send({ reason: 'Guest sent it back' });
    expect(edited.status, JSON.stringify(edited.body)).toBeLessThan(300);
  });

  it('refuses a change after the bill is paid and the table closed', async () => {
    const { sessionId, dalLineId } = await orderedTable();
    const invoice = await issue((await openBill(sessionId)).id);
    expect((await pay(invoice.id, invoice.grandTotal)).status).toBeLessThan(300);
    const more = await api(app)
      .patch(`/api/v1/order-items/${dalLineId}`)
      .set(as(cashier))
      .send({ quantity: 5 });
    expect(more.status).toBe(409);
    const line = await prisma.orderItem.findUniqueOrThrow({ where: { id: dalLineId } });
    expect(line.quantity).toBe(1);
  });
});

describe('[BILL-010] [BILL-008] payments and a reopened bill (QA-005)', () => {
  it('refuses a payment while the bill is reopened for changes', async () => {
    const { sessionId } = await orderedTable();
    const invoice = await issue((await openBill(sessionId)).id);
    const reopened = await api(app)
      .post(`/api/v1/invoices/${invoice.id}/reopen`)
      .set(as(manager))
      .send({ reason: 'Wrong dish' });
    expect(reopened.status, JSON.stringify(reopened.body)).toBeLessThan(300);
    const paid = await pay(invoice.id, invoice.grandTotal);
    expect(paid.status).toBe(409);
    expect(paid.body).toMatchObject({ code: 'INVOICE_BEING_EDITED' });
    expect(await prisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
  });

  it('refuses to reopen a bill that is partly paid (decision 84)', async () => {
    const { sessionId } = await orderedTable();
    const invoice = await issue((await openBill(sessionId)).id);
    expect((await pay(invoice.id, 1_000)).status).toBeLessThan(300);
    const reopened = await api(app)
      .post(`/api/v1/invoices/${invoice.id}/reopen`)
      .set(as(manager))
      .send({ reason: 'Wrong dish' });
    expect(reopened.status).toBe(409);
    expect(reopened.body).toMatchObject({ code: 'INVOICE_PART_PAID' });
  });
});

describe('[NFR-A03] [BILL-008] a payment and a void of the same bill at once (QA-006)', () => {
  it('never deadlocks: one wins, the other gets a clean refusal', async () => {
    const invoices = [];
    for (let round = 0; round < 6; round += 1) {
      const { sessionId } = await orderedTable();
      invoices.push(await issue((await openBill(sessionId)).id));
    }
    const answers = await Promise.all(
      invoices.flatMap((invoice) => [
        pay(invoice.id, invoice.grandTotal),
        api(app)
          .post(`/api/v1/invoices/${invoice.id}/void`)
          .set(as(manager))
          .send({ reason: 'Printed on the wrong table' }),
      ]),
    );
    const failures = answers.filter((answer) => answer.status >= 500);
    expect(failures.map((answer) => JSON.stringify(answer.body))).toEqual([]);
  });
});

describe('[BILL-013] day-end and a payment at the same moment (QA-010)', () => {
  it('waits for the day-end, and the payment then belongs to the next day', async () => {
    const { sessionId } = await orderedTable();
    const invoice = await issue((await openBill(sessionId)).id);
    const day = (await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } }))
      .businessDate;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => {
      locked = resolve;
    });
    // A day-end in progress: it holds the day-end lock while it totals the day.
    const dayEnd = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`day-end:${kit.restaurantId}`}, 0))`;
        locked();
        await gate;
        await tx.businessDay.upsert({
          where: {
            restaurantId_businessDate: { restaurantId: kit.restaurantId, businessDate: day },
          },
          create: { restaurantId: kit.restaurantId, businessDate: day, status: 'CLOSED' },
          update: { status: 'CLOSED' },
        });
      },
      { timeout: 20_000 },
    );
    await holding;
    let answered = false;
    const payment = pay(invoice.id, invoice.grandTotal).then((response) => {
      answered = true;
      return response;
    });
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(answered).toBe(false);
    release();
    await dayEnd;
    const paid = await payment;
    expect(paid.status, JSON.stringify(paid.body)).toBeLessThan(300);
    const recorded = await prisma.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    expect(recorded.businessDate.getTime()).toBeGreaterThan(day.getTime());
  });
});

describe('[BILL-001] two cashiers open the same bill at once (QA-012)', () => {
  it('gives both the one bill, never an error', async () => {
    const sessions = [];
    for (let round = 0; round < 5; round += 1) sessions.push((await orderedTable()).sessionId);
    const answers = await Promise.all(
      sessions.flatMap((sessionId) =>
        [cashier, manager].map((who) =>
          api(app).post('/api/v1/bills').set(as(who)).send({ tableSessionId: sessionId }),
        ),
      ),
    );
    expect(
      answers.filter((answer) => answer.status >= 300).map((answer): unknown => answer.body),
    ).toEqual([]);
    for (let index = 0; index < answers.length; index += 2) {
      const first = answers[index]?.body as { id?: string } | undefined;
      const second = answers[index + 1]?.body as { id?: string } | undefined;
      expect(first?.id).toBe(second?.id);
    }
  });
});

describe('[BILL-013] cash taken while the cashier’s shift is being closed (QA-013)', () => {
  it('is refused rather than put into the closed shift', async () => {
    const opened = await api(app).post('/api/v1/shifts').set(as(cashier)).send({ openingFloat: 0 });
    expect(opened.status, JSON.stringify(opened.body)).toBeLessThan(300);
    const shiftId = (opened.body as { id: string }).id;
    const { sessionId } = await orderedTable();
    const invoice = await issue((await openBill(sessionId)).id);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => {
      locked = resolve;
    });
    // A shift close in progress: it holds the shift while it counts the cash.
    const closing = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 AS locked FROM shifts WHERE id = ${shiftId}::uuid FOR UPDATE`;
        locked();
        await gate;
        await tx.shift.update({
          where: { id: shiftId },
          data: { status: 'CLOSED', closedAt: new Date() },
        });
      },
      { timeout: 20_000 },
    );
    await holding;
    const payment = api(app)
      .post(`/api/v1/invoices/${invoice.id}/payments`)
      .set(as(cashier))
      .send({
        idempotencyKey: randomUUID(),
        payments: [{ mode: 'CASH', amount: invoice.grandTotal, tendered: invoice.grandTotal }],
      })
      // Sent now, while the close holds the shift (a request goes out when it is awaited).
      .then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 500));
    release();
    await closing;
    const paid = await payment;
    expect(paid.status, JSON.stringify(paid.body)).toBe(409);
    expect(paid.body).toMatchObject({ code: 'NO_OPEN_SHIFT' });
    expect(await prisma.payment.count({ where: { shiftId } })).toBe(0);
  });
});
