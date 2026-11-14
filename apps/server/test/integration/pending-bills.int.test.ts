import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  BillView,
  InvoiceView,
  type LoginResponse,
  PendingBillsResponse,
  SubmitOrderResponse,
} from '@rp/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authHeaders, type AuthKit, createAuthKit, signIn } from '../helpers/auth-kit.js';
import {
  seatAndOrder,
  setUpSmallRestaurant,
  type SmallRestaurant,
} from '../helpers/small-restaurant.js';
import { api, createTestApp } from '../helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js';

/**
 * Pending bills (ADR-0030, item A): every bill a manager still has to print or take payment for,
 * on the dashboard's Bills page, with a live count. A bill asked for but not printed, printed but
 * not paid, and one that needs printing again because dishes were ordered after it was printed.
 */

let database: TestDatabase;
let app: INestApplication;
let kit: AuthKit;
let restaurant: SmallRestaurant;
let manager: LoginResponse;
let waiter: LoginResponse;

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createTestApp({ databaseUrl: database.url });
  kit = await createAuthKit(app);
  manager = await signIn(app, kit, 'MANAGER');
  waiter = await signIn(app, kit, 'WAITER');
  restaurant = await setUpSmallRestaurant(app, kit, manager);
});

afterAll(async () => {
  await app.close();
  await database.drop();
});

const as = (who: LoginResponse) => authHeaders(kit.deviceId, who.accessToken);

async function pending() {
  const listed = await api(app).get('/api/v1/bills/pending').set(as(manager));
  expect(listed.status, JSON.stringify(listed.body)).toBe(200);
  return PendingBillsResponse.parse(listed.body).bills;
}

async function ok(call: Promise<{ status: number; body: unknown }>): Promise<unknown> {
  const answer = await call;
  expect(answer.status, JSON.stringify(answer.body)).toBeLessThan(300);
  return answer.body;
}

async function pay(invoice: InvoiceView) {
  await ok(
    api(app)
      .post(`/api/v1/invoices/${invoice.id}/payments`)
      .set(as(manager))
      .send({
        idempotencyKey: randomUUID(),
        payments: [{ mode: 'CASH', amount: invoice.grandTotal, tendered: invoice.grandTotal }],
      }),
  );
}

describe('[BILL-001] [MGR-001] pending bills on the manager dashboard (ADR-0030)', () => {
  it('follows a table from the bill being asked for to paid', async () => {
    expect(await pending()).toEqual([]);
    const { sessionId } = await seatAndOrder(app, kit, waiter, restaurant.tables.T1 ?? '', [
      [restaurant.items.Dal, 1],
    ]);
    // Seated and eating: nothing to bill yet.
    expect(await pending()).toEqual([]);

    await ok(api(app).post(`/api/v1/table-sessions/${sessionId}/request-bill`).set(as(waiter)));
    const [asked] = await pending();
    expect(asked).toMatchObject({
      kind: 'TABLE',
      tableSessionId: sessionId,
      orderId: null,
      tableLabel: 'T1',
      takeawayToken: null,
      status: 'REQUESTED',
      billId: null,
      invoiceIds: [],
      // Before a bill is open: the dishes so far, as on the Tables page.
      amount: 18_000,
    });
    expect(Date.now() - Date.parse(asked?.since ?? '')).toBeLessThan(60_000);

    // The manager opens it: the amount is now the bill's, with its tax.
    const bill = BillView.parse(
      await ok(api(app).post('/api/v1/bills').set(as(manager)).send({ tableSessionId: sessionId })),
    );
    expect(await pending()).toMatchObject([
      { status: 'REQUESTED', billId: bill.id, amount: bill.grandTotal },
    ]);

    const invoice = InvoiceView.parse(
      await ok(api(app).post(`/api/v1/bills/${bill.id}/invoice`).set(as(manager)).send({})),
    );
    expect(await pending()).toMatchObject([
      { status: 'PRINTED', billId: bill.id, invoiceIds: [invoice.id], amount: invoice.grandTotal },
    ]);

    // A naan after the bill was printed: the bill has to be printed again.
    SubmitOrderResponse.parse(
      await ok(
        api(app)
          .post('/api/v1/orders')
          .set(as(waiter))
          .send({
            idempotencyKey: randomUUID(),
            source: 'WAITER_APP',
            orderType: 'DINE_IN',
            tableSessionId: sessionId,
            lines: [{ clientLineId: randomUUID(), itemId: restaurant.items.Naan, quantity: 1 }],
          }),
      ),
    );
    const [stale] = await pending();
    expect(stale).toMatchObject({ status: 'NEEDS_NEW_BILL', billId: bill.id });
    expect(stale?.amount).toBeGreaterThan(invoice.grandTotal);

    const reprinted = InvoiceView.parse(
      await ok(api(app).post(`/api/v1/bills/${bill.id}/invoice`).set(as(manager)).send({})),
    );
    expect(await pending()).toMatchObject([
      { status: 'PRINTED', amount: reprinted.grandTotal, invoiceIds: [reprinted.id] },
    ]);

    await pay(reprinted);
    expect(await pending()).toEqual([]);
  });

  it('lists a takeaway once its bill is asked for, as its takeaway number, until paid', async () => {
    const sent = SubmitOrderResponse.parse(
      await ok(
        api(app)
          .post('/api/v1/orders')
          .set(as(waiter))
          .send({
            idempotencyKey: randomUUID(),
            source: 'WAITER_APP',
            orderType: 'TAKEAWAY',
            lines: [{ clientLineId: randomUUID(), itemId: restaurant.items.Lassi, quantity: 2 }],
          }),
      ),
    );
    if (sent.status !== 'ACCEPTED') throw new Error('Not accepted');
    // Cooking: nobody has asked for its bill.
    expect(await pending()).toEqual([]);

    await ok(api(app).post(`/api/v1/orders/${sent.orderId}/request-bill`).set(as(waiter)));
    const [asked] = await pending();
    expect(asked).toMatchObject({
      kind: 'TAKEAWAY',
      tableSessionId: null,
      orderId: sent.orderId,
      tableLabel: null,
      status: 'REQUESTED',
      amount: 16_000,
    });
    expect(asked?.takeawayToken).toBeGreaterThan(0);

    const bill = BillView.parse(
      await ok(api(app).post('/api/v1/bills').set(as(manager)).send({ orderId: sent.orderId })),
    );
    const invoice = InvoiceView.parse(
      await ok(api(app).post(`/api/v1/bills/${bill.id}/invoice`).set(as(manager)).send({})),
    );
    expect(await pending()).toMatchObject([{ kind: 'TAKEAWAY', status: 'PRINTED' }]);
    await pay(invoice);
    expect(await pending()).toEqual([]);
  });

  it('counts a bill a manager opened as asked for, by the manager', async () => {
    const { sessionId } = await seatAndOrder(app, kit, waiter, restaurant.tables.T2 ?? '', [
      [restaurant.items.Naan, 2],
    ]);
    expect(await pending()).toEqual([]);
    const bill = BillView.parse(
      await ok(api(app).post('/api/v1/bills').set(as(manager)).send({ tableSessionId: sessionId })),
    );
    const [opened] = await pending();
    expect(opened).toMatchObject({
      tableSessionId: sessionId,
      status: 'REQUESTED',
      billId: bill.id,
      amount: bill.grandTotal,
    });
    expect(Date.now() - Date.parse(opened?.since ?? '')).toBeLessThan(60_000);
    const invoice = InvoiceView.parse(
      await ok(api(app).post(`/api/v1/bills/${bill.id}/invoice`).set(as(manager)).send({})),
    );
    await pay(invoice);
    expect(await pending()).toEqual([]);
  });

  it('is for the people who take payment: a waiter is refused', async () => {
    const refused = await api(app).get('/api/v1/bills/pending').set(as(waiter));
    expect(refused.status).toBe(403);
  });
});
