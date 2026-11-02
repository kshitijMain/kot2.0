import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { BillView, InvoiceView, type LoginResponse } from '@rp/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../src/database/prisma.service.js';
import { KdsEscalationService } from '../../src/kitchen/kds-escalation.service.js';
import {
  addDevice,
  authHeaders,
  type AuthKit,
  createAuthKit,
  signIn,
} from '../helpers/auth-kit.js';
import {
  DISHES,
  seatAndOrder,
  setUpSmallRestaurant,
  type SmallRestaurant,
} from '../helpers/small-restaurant.js';
import { api, createTestApp } from '../helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js';

/**
 * QA audit, functional gaps found by using the product the way a busy restaurant does: journeys
 * that dead-ended or left money or work stuck. Each was first shown by a failing test here
 * (docs/testing/QA_REPORT.md, QA-022 onwards).
 */

let database: TestDatabase;
let app: INestApplication;
let prisma: PrismaService;
let kit: AuthKit;
let restaurant: SmallRestaurant;
let manager: LoginResponse;
let waiter: LoginResponse;
let biller: LoginResponse;
const tables: string[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createTestApp({ databaseUrl: database.url });
  prisma = app.get(PrismaService);
  kit = await createAuthKit(app);
  manager = await signIn(app, kit, 'MANAGER');
  waiter = await signIn(app, kit, 'WAITER');
  biller = await signIn(app, kit, 'BILLER');
  restaurant = await setUpSmallRestaurant(app, kit, manager);
  const hall = await prisma.section.findFirstOrThrow({ where: { restaurantId: kit.restaurantId } });
  for (let number = 5; number <= 30; number += 1) {
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

/** A fresh table seated and ordered: Dal x1 (₹180 before tax). */
async function seated() {
  const tableId = tables.shift();
  if (tableId === undefined) throw new Error('No tables left');
  const visit = await seatAndOrder(app, kit, waiter, tableId, [[restaurant.items.Dal, 1]]);
  return { ...visit, tableId };
}

async function orderMore(sessionId: string, quantity = 2) {
  const response = await api(app)
    .post('/api/v1/orders')
    .set(as(waiter))
    .send({
      idempotencyKey: randomUUID(),
      source: 'WAITER_APP',
      orderType: 'DINE_IN',
      tableSessionId: sessionId,
      lines: [{ clientLineId: randomUUID(), itemId: restaurant.items.Naan, quantity }],
    });
  expect(response.body, JSON.stringify(response.body)).toMatchObject({ status: 'ACCEPTED' });
}

async function openBill(sessionId: string): Promise<BillView> {
  const response = await api(app)
    .post('/api/v1/bills')
    .set(as(biller))
    .send({ tableSessionId: sessionId });
  expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
  return BillView.parse(response.body);
}

async function printBill(billId: string): Promise<InvoiceView> {
  const response = await api(app).post(`/api/v1/bills/${billId}/invoice`).set(as(biller)).send({});
  expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
  return InvoiceView.parse(response.body);
}

function pay(invoiceId: string, amount: number) {
  return api(app)
    .post(`/api/v1/invoices/${invoiceId}/payments`)
    .set(as(biller))
    .send({ idempotencyKey: randomUUID(), payments: [{ mode: 'UPI', amount }] });
}

const tableState = async (tableId: string) =>
  (await prisma.diningTable.findUniqueOrThrow({ where: { id: tableId } })).state;

describe('[BILL-001] [BILL-010] [BILL-015] dishes ordered after the bill is printed (QA-022)', () => {
  it('shows them as not yet billed, and printing again gives the revised bill, same number', async () => {
    const { sessionId } = await seated();
    const bill = await openBill(sessionId);
    const first = await printBill(bill.id);
    expect(first.grandTotal).toBe(bill.grandTotal);
    await orderMore(sessionId);
    const again = await openBill(sessionId);
    expect(again.id).toBe(bill.id);
    expect(again.unbilledOrderItemIds).toHaveLength(1);
    const revised = await printBill(bill.id);
    expect(revised.id).toBe(first.id);
    expect(revised.invoiceNumber).toBe(first.invoiceNumber);
    expect(revised.subtotal).toBe(DISHES.Dal + 2 * DISHES.Naan);
    expect(revised.grandTotal).toBeGreaterThan(first.grandTotal);
    expect((await openBill(sessionId)).unbilledOrderItemIds).toEqual([]);
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: first.id, action: 'INVOICE_EDITED' },
    });
    expect(audit?.reason).toMatch(/ordered after the bill was printed/);
    expect((await pay(revised.id, revised.grandTotal)).status).toBeLessThan(300);
  });

  it('when the printed amount is paid after more dishes, prints a new bill for just those, then closes', async () => {
    const { sessionId, tableId } = await seated();
    const bill = await openBill(sessionId);
    const first = await printBill(bill.id);
    await orderMore(sessionId);
    // The guest pays what was printed; the table stays open for the dishes ordered since.
    expect((await pay(first.id, first.grandTotal)).status).toBeLessThan(300);
    expect(await tableState(tableId)).toBe('OCCUPIED');
    const view = await openBill(sessionId);
    expect(view.unbilledOrderItemIds).toHaveLength(1);
    const second = await printBill(bill.id);
    expect(second.id).not.toBe(first.id);
    expect(second.invoiceNumber).not.toBe(first.invoiceNumber);
    expect(second.subtotal).toBe(2 * DISHES.Naan);
    const firstNow = InvoiceView.parse(
      (await api(app).get(`/api/v1/invoices/${first.id}`).set(as(biller))).body,
    );
    expect(firstNow).toMatchObject({ status: 'SETTLED', grandTotal: first.grandTotal });
    expect((await pay(second.id, second.grandTotal)).status).toBeLessThan(300);
    const session = await prisma.tableSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.status).toBe('CLOSED');
  });

  it('after part of the first bill is paid, prints a new bill for the new dishes', async () => {
    const { sessionId } = await seated();
    const bill = await openBill(sessionId);
    const first = await printBill(bill.id);
    expect((await pay(first.id, 1_000)).status).toBeLessThan(300);
    await orderMore(sessionId, 1);
    const second = await printBill(bill.id);
    expect(second.id).not.toBe(first.id);
    expect(second.subtotal).toBe(DISHES.Naan);
  });

  it('still refuses to print a printed bill again when nothing new was ordered', async () => {
    const { sessionId } = await seated();
    const bill = await openBill(sessionId);
    await printBill(bill.id);
    const again = await api(app).post(`/api/v1/bills/${bill.id}/invoice`).set(as(biller)).send({});
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: 'BILL_ALREADY_PRINTED' });
  });
});

async function openTable(): Promise<{ sessionId: string; tableId: string }> {
  const tableId = tables.shift();
  if (tableId === undefined) throw new Error('No tables left');
  const response = await api(app)
    .post(`/api/v1/tables/${tableId}/open`)
    .set(as(waiter))
    .send({ covers: 2 });
  expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
  return { sessionId: (response.body as { id: string }).id, tableId };
}

const closeWithoutBill = (sessionId: string) =>
  api(app)
    .post(`/api/v1/table-sessions/${sessionId}/close-without-bill`)
    .set(as(manager))
    .send({ reason: 'Guests left' });

const sessionStatus = async (sessionId: string) =>
  (await prisma.tableSession.findUniqueOrThrow({ where: { id: sessionId } })).status;

describe('[TBL-002] [BILL-015] a table that asked for the bill with nothing to bill (QA-024)', () => {
  it('can be closed without a bill, instead of staying "Bill requested" for good', async () => {
    const { sessionId, tableId } = await openTable();
    const asked = await api(app)
      .post(`/api/v1/table-sessions/${sessionId}/request-bill`)
      .set(as(waiter));
    expect(asked.status).toBeLessThan(300);
    expect(await tableState(tableId)).toBe('BILL_REQUESTED');
    const closed = await closeWithoutBill(sessionId);
    expect(closed.status, JSON.stringify(closed.body)).toBeLessThan(300);
    expect(await sessionStatus(sessionId)).toBe('CLOSED');
  });

  it('still refuses while a dish on it is not billed', async () => {
    const { sessionId } = await seated();
    await api(app).post(`/api/v1/table-sessions/${sessionId}/request-bill`).set(as(waiter));
    const closed = await closeWithoutBill(sessionId);
    expect(closed.status).toBe(409);
    expect(await sessionStatus(sessionId)).toBe('OPEN');
  });

  it('refuses while a printed bill is unpaid, even with every dish cancelled after reopening', async () => {
    const { sessionId } = await seated();
    const bill = await openBill(sessionId);
    const invoice = await printBill(bill.id);
    const reopened = await api(app)
      .post(`/api/v1/invoices/${invoice.id}/reopen`)
      .set(as(manager))
      .send({ reason: 'Wrong table' });
    expect(reopened.status, JSON.stringify(reopened.body)).toBeLessThan(300);
    const line = await prisma.orderItem.findFirstOrThrow({
      where: { order: { tableSessionId: sessionId } },
    });
    const cancelled = await api(app)
      .post(`/api/v1/order-items/${line.id}/cancel`)
      .set(as(manager))
      .send({ reason: 'Wrong table' });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBeLessThan(300);
    const closed = await closeWithoutBill(sessionId);
    expect(closed.status).toBe(409);
    expect(closed.body).toMatchObject({ code: 'UNPAID_BILL' });
  });
});

describe('[ORD-003] [BILL-015] a diner orders after the bill is printed (QA-025)', () => {
  it('keeps the table open when the printed bill is paid, so the order can still be approved and billed', async () => {
    const { sessionId, tableId } = await seated();
    const tablet = await addDevice(app, kit, 'TABLE_TABLET', { tableId });
    const first = await printBill((await openBill(sessionId)).id);
    const ordered = await api(app)
      .post('/api/v1/devices/current/orders')
      .set(authHeaders(tablet))
      .send({
        idempotencyKey: randomUUID(),
        lines: [{ clientLineId: randomUUID(), itemId: restaurant.items.Lassi, quantity: 1 }],
      });
    expect(ordered.status, JSON.stringify(ordered.body)).toBeLessThan(300);
    expect((await pay(first.id, first.grandTotal)).status).toBeLessThan(300);
    expect(await sessionStatus(sessionId)).toBe('OPEN');
    const pending = await prisma.order.findFirstOrThrow({
      where: { tableSessionId: sessionId, items: { some: { state: 'PENDING_APPROVAL' } } },
    });
    const approved = await api(app)
      .post(`/api/v1/orders/${pending.id}/approve`)
      .set(as(waiter))
      .send({});
    expect(approved.status, JSON.stringify(approved.body)).toBeLessThan(300);
    const second = await printBill((await openBill(sessionId)).id);
    expect(second.subtotal).toBe(DISHES.Lassi);
    expect((await pay(second.id, second.grandTotal)).status).toBeLessThan(300);
    expect(await sessionStatus(sessionId)).toBe('CLOSED');
  });

  it('when the order is rejected instead, the paid table can be closed', async () => {
    const { sessionId, tableId } = await seated();
    const tablet = await addDevice(app, kit, 'TABLE_TABLET', { tableId });
    const first = await printBill((await openBill(sessionId)).id);
    await api(app)
      .post('/api/v1/devices/current/orders')
      .set(authHeaders(tablet))
      .send({
        idempotencyKey: randomUUID(),
        lines: [{ clientLineId: randomUUID(), itemId: restaurant.items.Lassi, quantity: 1 }],
      });
    expect((await pay(first.id, first.grandTotal)).status).toBeLessThan(300);
    const pending = await prisma.order.findFirstOrThrow({
      where: { tableSessionId: sessionId, items: { some: { state: 'PENDING_APPROVAL' } } },
    });
    const rejected = await api(app)
      .post(`/api/v1/orders/${pending.id}/reject`)
      .set(as(waiter))
      .send({ reason: 'Kitchen closed' });
    expect(rejected.status, JSON.stringify(rejected.body)).toBeLessThan(300);
    const closed = await closeWithoutBill(sessionId);
    expect(closed.status, JSON.stringify(closed.body)).toBeLessThan(300);
    expect(await sessionStatus(sessionId)).toBe('CLOSED');
  });
});

describe('[BILL-007] [BILL-010] a split bill with one part voided (QA-026)', () => {
  it('keeps the table open after the other part is paid, and bills the voided part again', async () => {
    const { sessionId } = await seated();
    await orderMore(sessionId, 1);
    const bill = await openBill(sessionId);
    const split = await api(app)
      .post(`/api/v1/bills/${bill.id}/split`)
      .set(as(biller))
      .send({ mode: 'EQUAL', parts: 2 });
    expect(split.status, JSON.stringify(split.body)).toBeLessThan(300);
    const [partA, partB] = (split.body as { invoices: InvoiceView[] }).invoices;
    if (partA === undefined || partB === undefined) throw new Error('Two parts expected');
    const voided = await api(app)
      .post(`/api/v1/invoices/${partA.id}/void`)
      .set(as(manager))
      .send({ reason: 'Guest paid at the other till' });
    expect(voided.status, JSON.stringify(voided.body)).toBeLessThan(300);
    expect((await pay(partB.id, partB.grandTotal)).status).toBeLessThan(300);
    expect(await sessionStatus(sessionId)).toBe('OPEN');
    const view = await openBill(sessionId);
    expect(view.voidedPartIds).toEqual([partA.id]);
    const again = await printBill(bill.id);
    expect(again.id).not.toBe(partA.id);
    expect(again.grandTotal).toBe(partA.grandTotal);
    expect(again.subtotal).toBe(partA.subtotal);
    expect((await openBill(sessionId)).voidedPartIds).toEqual([]);
    expect((await pay(again.id, again.grandTotal)).status).toBeLessThan(300);
    expect(await sessionStatus(sessionId)).toBe('CLOSED');
  });
});

describe('[BILL-010] a paid table’s bill voided and printed again after the guests left (QA-028)', () => {
  it('prints the corrected bill without touching the table, even with new guests seated', async () => {
    const { sessionId, tableId } = await seated();
    const bill = await openBill(sessionId);
    const first = await printBill(bill.id);
    expect((await pay(first.id, first.grandTotal)).status).toBeLessThan(300);
    expect(await sessionStatus(sessionId)).toBe('CLOSED');
    // New guests sit at the same table.
    const next = await api(app)
      .post(`/api/v1/tables/${tableId}/open`)
      .set(as(waiter))
      .send({ covers: 2 });
    expect(next.status, JSON.stringify(next.body)).toBeLessThan(300);
    const voided = await api(app)
      .post(`/api/v1/invoices/${first.id}/void`)
      .set(as(manager))
      .send({ reason: 'Wrong GSTIN on the bill' });
    expect(voided.status, JSON.stringify(voided.body)).toBeLessThan(300);
    const corrected = await printBill(bill.id);
    expect(corrected.replacesInvoiceId).toBe(first.id);
    expect(await tableState(tableId)).toBe('OCCUPIED');
  });
});

describe('[KDS-007] [NTF-002] a dish ready at the pass for a table that has paid and left (QA-029)', () => {
  it('raises no "food waiting" alert for it', async () => {
    const { sessionId } = await seated();
    const line = await prisma.orderItem.findFirstOrThrow({
      where: { order: { tableSessionId: sessionId } },
    });
    const first = await printBill((await openBill(sessionId)).id);
    expect((await pay(first.id, first.grandTotal)).status).toBeLessThan(300);
    expect(await sessionStatus(sessionId)).toBe('CLOSED');
    // The dish sat at the pass long enough to be chased, after the guests left.
    await prisma.orderItem.update({
      where: { id: line.id },
      data: { state: 'READY', readyAt: new Date(Date.now() - 60 * 60_000) },
    });
    const kot = await prisma.kotLine.findFirstOrThrow({ where: { orderItemId: line.id } });
    await app.get(KdsEscalationService).sweep(new Date());
    expect(await prisma.alert.count({ where: { dedupeKey: `collect:${kot.kotId}` } })).toBe(0);
  });
});

describe('[TBL-008] [BILL-008] a takeaway once it is paid (QA-032)', () => {
  it('leaves the open takeaway list (its kitchen tickets do not depend on it)', async () => {
    const ordered = await api(app)
      .post('/api/v1/orders')
      .set(as(biller))
      .send({
        idempotencyKey: randomUUID(),
        source: 'POS',
        orderType: 'TAKEAWAY',
        lines: [{ clientLineId: randomUUID(), itemId: restaurant.items.Dal, quantity: 1 }],
      });
    expect(ordered.body, JSON.stringify(ordered.body)).toMatchObject({ status: 'ACCEPTED' });
    const orderId = (ordered.body as { orderId: string }).orderId;
    const listed = async () =>
      (
        (await api(app).get('/api/v1/orders/takeaway').set(as(biller))).body as {
          orders: { id: string }[];
        }
      ).orders.map((order) => order.id);
    expect(await listed()).toContain(orderId);
    const opened = await api(app).post('/api/v1/bills').set(as(biller)).send({ orderId });
    const invoice = await printBill(BillView.parse(opened.body).id);
    expect((await pay(invoice.id, invoice.grandTotal)).status).toBeLessThan(300);
    expect(await listed()).not.toContain(orderId);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('CLOSED');
  });
});

describe('[BILL-013] another manager’s shift left open at day-end (QA-034)', () => {
  it('can be read and closed by a manager, and is refused to a waiter', async () => {
    const opened = await api(app)
      .post('/api/v1/shifts')
      .set(as(biller))
      .send({ openingFloat: 50_000 });
    expect(opened.status, JSON.stringify(opened.body)).toBeLessThan(300);
    const shiftId = (opened.body as { id: string }).id;
    const read = await api(app).get(`/api/v1/shifts/${shiftId}`).set(as(manager));
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body).toMatchObject({ id: shiftId, status: 'OPEN', openingFloat: 50_000 });
    const byWaiter = await api(app).get(`/api/v1/shifts/${shiftId}`).set(as(waiter));
    expect(byWaiter.status).toBe(403);
    const closed = await api(app)
      .post(`/api/v1/shifts/${shiftId}/close`)
      .set(as(manager))
      .send({ countedCash: 50_000 });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
  });
});

describe('[ORD-011] [BILL-010] dishes on a printed bill in the order views (QA-037)', () => {
  it('are marked while the bill is printed, and not while it is reopened for changes', async () => {
    const { sessionId } = await seated();
    const onBill = async () =>
      (
        (await api(app).get(`/api/v1/table-sessions/${sessionId}/orders`).set(as(waiter))).body as {
          orders: { items: { onPrintedBill?: boolean }[] }[];
        }
      ).orders.flatMap((order) => order.items.map((item) => item.onPrintedBill ?? false));
    expect(await onBill()).toEqual([false]);
    const invoice = await printBill((await openBill(sessionId)).id);
    expect(await onBill()).toEqual([true]);
    const reopened = await api(app)
      .post(`/api/v1/invoices/${invoice.id}/reopen`)
      .set(as(manager))
      .send({ reason: 'Guest sent a dish back' });
    expect(reopened.status, JSON.stringify(reopened.body)).toBeLessThan(300);
    expect(await onBill()).toEqual([false]);
  });
});

describe('[KDS-005] recalling a ticket whose dishes were all collected (QA-038)', () => {
  it('is refused with a reason, and the ticket stays among the bumped ones', async () => {
    const { sessionId } = await seated();
    const line = await prisma.orderItem.findFirstOrThrow({
      where: { order: { tableSessionId: sessionId } },
    });
    const kot = await prisma.kotLine.findFirstOrThrow({ where: { orderItemId: line.id } });
    for (const event of ['START_PREPARING', 'MARK_READY']) {
      const step = await api(app)
        .post(`/api/v1/order-items/${line.id}/status`)
        .set(as(manager))
        .send({ event });
      expect(step.status, JSON.stringify(step.body)).toBeLessThan(300);
    }
    const bumped = await api(app).post(`/api/v1/kds/tickets/${kot.kotId}/bump`).set(as(manager));
    expect(bumped.status, JSON.stringify(bumped.body)).toBeLessThan(300);
    const picked = await api(app)
      .post(`/api/v1/order-items/${line.id}/status`)
      .set(as(waiter))
      .send({ event: 'PICK_UP' });
    expect(picked.status, JSON.stringify(picked.body)).toBeLessThan(300);
    const recalled = await api(app)
      .post(`/api/v1/kds/tickets/${kot.kotId}/recall`)
      .set(as(manager));
    expect(recalled.status).toBe(409);
    expect(recalled.body).toMatchObject({ code: 'NOTHING_TO_RECALL' });
    const ticket = await prisma.kot.findUniqueOrThrow({ where: { id: kot.kotId } });
    expect(ticket.bumpedAt).not.toBeNull();
  });
});

describe('[TBL-006] [NTF-002] merging tables with a guest’s request still open (QA-039)', () => {
  it('keeps the request’s alert, now for the table the guests joined', async () => {
    const from = await seated();
    const into = await seated();
    const tablet = await addDevice(app, kit, 'TABLE_TABLET', { tableId: from.tableId });
    const asked = await api(app)
      .post('/api/v1/devices/current/service-requests')
      .set(authHeaders(tablet))
      .send({ type: 'WATER' });
    expect(asked.status, JSON.stringify(asked.body)).toBeLessThan(300);
    const waitForAlert = async (sessionId: string) => {
      for (let tries = 0; tries < 50; tries += 1) {
        const alert = await prisma.alert.findFirst({
          where: { tableSessionId: sessionId, status: 'OPEN' },
        });
        if (alert !== null) return alert;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return null;
    };
    expect(await waitForAlert(from.sessionId)).not.toBeNull();
    const merged = await api(app)
      .post(`/api/v1/table-sessions/${from.sessionId}/merge`)
      .set(as(manager))
      .send({ intoTableSessionId: into.sessionId });
    expect(merged.status, JSON.stringify(merged.body)).toBeLessThan(300);
    // The events are handled after the answer: give the consumer a moment.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const moved = await waitForAlert(into.sessionId);
    expect(moved).not.toBeNull();
    expect(moved?.tableId).toBe(into.tableId);
  });
});

describe('[MENU-006] [NTF-002] an out-of-stock alert about a takeaway (QA-040)', () => {
  it('clears once the takeaway is paid, instead of staying on the waiter’s bell for good', async () => {
    const ordered = await api(app)
      .post('/api/v1/orders')
      .set(as(waiter))
      .send({
        idempotencyKey: randomUUID(),
        source: 'WAITER_APP',
        orderType: 'TAKEAWAY',
        lines: [
          { clientLineId: randomUUID(), itemId: restaurant.items.Naan, quantity: 2 },
          { clientLineId: randomUUID(), itemId: restaurant.items.Lassi, quantity: 1 },
        ],
      });
    expect(ordered.body, JSON.stringify(ordered.body)).toMatchObject({ status: 'ACCEPTED' });
    const orderId = (ordered.body as { orderId: string }).orderId;
    const out = await api(app)
      .put(`/api/v1/menu/items/${restaurant.items.Naan}/availability`)
      .set(as(manager))
      .send({ available: false, stockCount: null });
    expect(out.status, JSON.stringify(out.body)).toBeLessThan(300);
    const openAlerts = () =>
      prisma.alert.count({ where: { orderId, type: 'OUT_OF_STOCK', status: 'OPEN' } });
    for (let tries = 0; tries < 50 && (await openAlerts()) === 0; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(await openAlerts()).toBe(1);
    const opened = await api(app).post('/api/v1/bills').set(as(biller)).send({ orderId });
    const invoice = await printBill(BillView.parse(opened.body).id);
    expect((await pay(invoice.id, invoice.grandTotal)).status).toBeLessThan(300);
    for (let tries = 0; tries < 50 && (await openAlerts()) > 0; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(await openAlerts()).toBe(0);
    // Back on the menu for the other tests.
    await api(app)
      .put(`/api/v1/menu/items/${restaurant.items.Naan}/availability`)
      .set(as(manager))
      .send({ available: true, stockCount: null });
  });
});
