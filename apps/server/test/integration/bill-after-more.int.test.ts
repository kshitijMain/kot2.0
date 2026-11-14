import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  ApiError,
  BillView,
  InvoiceRegisterResponse,
  InvoiceView,
  type LoginResponse,
  PendingBillsResponse,
  TableOverviewResponse,
} from '@rp/contracts';
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
 * A bill after more dishes (ADR-0031, item G): a waiter adds a naan to a table whose bill is
 * printed and unpaid. The table needs a new bill; the old one cannot be paid; the next Print
 * cancels it (kept in the GST register as cancelled, with the reason, audited) and issues a new
 * invoice with the next number, every dish and the new total.
 */

let database: TestDatabase;
let app: INestApplication;
let prisma: PrismaService;
let kit: AuthKit;
let restaurant: SmallRestaurant;
let manager: LoginResponse;
let waiter: LoginResponse;

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createTestApp({ databaseUrl: database.url });
  prisma = app.get(PrismaService);
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

async function ok<T>(
  call: Promise<{ status: number; body: unknown }>,
  parse: (body: unknown) => T,
) {
  const answer = await call;
  expect(answer.status, JSON.stringify(answer.body)).toBeLessThan(300);
  return parse(answer.body);
}

describe('[BILL-010] [BILL-003] a bill printed before more dishes were ordered (ADR-0031)', () => {
  it('cancels the outdated invoice and prints a new one with every dish, numbered next', async () => {
    const { sessionId } = await seatAndOrder(app, kit, waiter, restaurant.tables.T1 ?? '', [
      [restaurant.items.Dal, 1],
    ]);
    const bill = await ok(
      api(app).post('/api/v1/bills').set(as(manager)).send({ tableSessionId: sessionId }),
      (body) => BillView.parse(body),
    );
    const first = await ok(
      api(app).post(`/api/v1/bills/${bill.id}/invoice`).set(as(manager)).send({}),
      (body) => InvoiceView.parse(body),
    );
    expect(first.grandTotal).toBe(18_900);

    // The waiter adds a naan: the table needs a new bill.
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
      (body) => body,
    );
    const overview = await ok(api(app).get('/api/v1/tables/overview').set(as(waiter)), (body) =>
      TableOverviewResponse.parse(body),
    );
    expect(overview.tables.find((table) => table.session?.id === sessionId)?.session).toMatchObject(
      { billOutdated: true },
    );
    const pending = await ok(api(app).get('/api/v1/bills/pending').set(as(manager)), (body) =>
      PendingBillsResponse.parse(body),
    );
    expect(pending.bills).toMatchObject([{ tableSessionId: sessionId, status: 'NEEDS_NEW_BILL' }]);

    // The old bill cannot be paid: it is missing the naan.
    const refused = await api(app)
      .post(`/api/v1/invoices/${first.id}/payments`)
      .set(as(manager))
      .send({
        idempotencyKey: randomUUID(),
        payments: [{ mode: 'UPI', amount: first.grandTotal, reference: 'UPI-1' }],
      });
    expect(refused.status).toBe(409);
    expect(ApiError.parse(refused.body).code).toBe('BILL_OUTDATED');

    // The waiter asks for the bill again; the manager prints it.
    await ok(
      api(app).post(`/api/v1/table-sessions/${sessionId}/request-bill`).set(as(waiter)),
      (body) => body,
    );
    const again = await ok(
      api(app).post('/api/v1/bills').set(as(manager)).send({ tableSessionId: sessionId }),
      (body) => BillView.parse(body),
    );
    expect(again.id).toBe(bill.id);
    const second = await ok(
      api(app).post(`/api/v1/bills/${bill.id}/invoice`).set(as(manager)).send({}),
      (body) => InvoiceView.parse(body),
    );
    expect(second.id).not.toBe(first.id);
    expect(second.invoiceNumber).not.toBe(first.invoiceNumber);
    expect(second.invoiceNumber.endsWith('000002')).toBe(true);
    expect(second.replacesInvoiceId).toBe(first.id);
    expect(second.lines.map((line) => line.description).sort()).toEqual(['Dal', 'Naan']);
    // 5 % GST on both dishes, all on the new bill.
    const taxable = DISHES.Dal + DISHES.Naan;
    expect(second.subtotal).toBe(taxable);
    expect(second.taxTotal).toBe(Math.round(taxable * 0.05));
    expect(second.grandTotal).toBe(taxable + Math.round(taxable * 0.05));

    const old = await prisma.invoice.findUniqueOrThrow({ where: { id: first.id } });
    expect(old).toMatchObject({
      status: 'VOIDED',
      voidReason: 'Items added after the bill was printed',
    });
    const voided = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'INVOICE_VOIDED', entityId: first.id },
    });
    expect(voided.reason).toBe('Items added after the bill was printed');
    expect(voided.actorId).toBe(manager.staff.id);

    // The GST register keeps the cancelled invoice, and names it in the new one.
    const today = old.invoiceDate.toISOString().slice(0, 10);
    const register = await ok(
      api(app).get(`/api/v1/reports/invoice-register?from=${today}&to=${today}`).set(as(manager)),
      (body) => InvoiceRegisterResponse.parse(body),
    );
    expect(register.invoices.find((entry) => entry.invoiceId === first.id)).toMatchObject({
      status: 'VOIDED',
      voidReason: 'Items added after the bill was printed',
    });
    expect(register.invoices.find((entry) => entry.invoiceId === second.id)).toMatchObject({
      status: 'ISSUED',
      replacesInvoiceNumber: first.invoiceNumber,
    });

    // The new bill is the one that is paid; the table is then free.
    await ok(
      api(app)
        .post(`/api/v1/invoices/${second.id}/payments`)
        .set(as(manager))
        .send({
          idempotencyKey: randomUUID(),
          payments: [{ mode: 'UPI', amount: second.grandTotal, reference: 'UPI-2' }],
        }),
      (body) => body,
    );
    const table = await prisma.diningTable.findUniqueOrThrow({
      where: { id: restaurant.tables.T1 ?? '' },
    });
    expect(table.state).toBe('FREE');
  });
});
