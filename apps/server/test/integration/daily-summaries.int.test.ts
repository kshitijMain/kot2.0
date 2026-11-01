import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  ApiError,
  BillHistoryInvoiceResponse,
  BillHistoryResponse,
  BillView,
  DayEndPreview,
  DayEndView,
  InvoiceView,
  ItemSalesResponse,
  type LoginResponse,
  PaymentModesResponse,
  SalesSummaryResponse,
  ShiftView,
  SplitBillResponse,
  SubmitOrderResponse,
  TableSessionView,
} from '@rp/contracts';
import { addDays } from '@rp/domain';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isoDateOf } from '../../src/common/business-dates.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { DailySummariesService } from '../../src/reports/daily-summaries.service.js';
import { authHeaders, type AuthKit, createAuthKit, signIn } from '../helpers/auth-kit.js';
import { createTestApp, httpServer } from '../helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js';

let database: TestDatabase;
let app: INestApplication;
let prisma: PrismaService;
let summaries: DailySummariesService;
let kit: AuthKit;
let manager: LoginResponse;
let cashier: LoginResponse;
let waiter: LoginResponse;
const ids: Record<string, string> = {};
const id = (name: string) => ids[name] ?? '';
/** Three business dates: the first two closed, the third still open. */
let dayA: string;
let dayB: string;
let dayC: string;
const closed: Record<string, DayEndView> = {};
/** T3's bill, issued on day B and carried forward unpaid. */
let carried: InvoiceView;

const as = (login: LoginResponse) => authHeaders(kit.deviceId, login.accessToken);
const server = () => request(httpServer(app));
const codeOf = (response: { body: unknown }) => ApiError.parse(response.body).code;
const line = (name: string, quantity = 1) => ({
  clientLineId: randomUUID(),
  itemId: id(name),
  quantity,
});

async function order(body: object, login = waiter): Promise<void> {
  const response = await server()
    .post('/api/v1/orders')
    .set(as(login))
    .send({ idempotencyKey: randomUUID(), ...body });
  expect(SubmitOrderResponse.parse(response.body).status, JSON.stringify(response.body)).toBe(
    'ACCEPTED',
  );
}

async function bill(target: object): Promise<BillView> {
  const response = await server().post('/api/v1/bills').set(as(cashier)).send(target);
  return BillView.parse(response.body);
}

async function issue(billId: string): Promise<InvoiceView> {
  const response = await server().post(`/api/v1/bills/${billId}/invoice`).set(as(cashier)).send({});
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return InvoiceView.parse(response.body);
}

async function pay(invoice: InvoiceView, payment: object): Promise<void> {
  const response = await server()
    .post(`/api/v1/invoices/${invoice.id}/payments`)
    .set(as(cashier))
    .send({ idempotencyKey: randomUUID(), payments: [{ amount: invoice.grandTotal, ...payment }] });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
}

async function openTable(label: string): Promise<string> {
  const response = await server()
    .post(`/api/v1/tables/${id(label)}/open`)
    .set(as(waiter))
    .send({ covers: 2 });
  return TableSessionView.parse(response.body).id;
}

/**
 * A day of trade: a table with a phone number on its bill (paid by cash, with a discount when
 * asked), a table split three ways (UPI), and a takeaway billed, voided and billed again (paid by
 * a named other mode).
 */
async function trade(tables: [string, string], discount: boolean): Promise<void> {
  const first = await openTable(tables[0]);
  await order({
    source: 'WAITER_APP',
    orderType: 'DINE_IN',
    tableSessionId: first,
    lines: [line('Paneer Tikka', 2), line('Water')],
  });
  const firstBill = await bill({ tableSessionId: first });
  await server()
    .put(`/api/v1/bills/${firstBill.id}/customer`)
    .set(as(cashier))
    .send({ name: null, phone: '98765 43210', phoneConsent: true, gstin: null })
    .expect(200);
  if (discount) {
    await server()
      .post(`/api/v1/bills/${firstBill.id}/discounts`)
      .set(as(manager))
      .send({ kind: 'PERCENT', rateBp: 1_000, reason: 'Regular guest' })
      .expect(200);
  }
  await pay(await issue(firstBill.id), { mode: 'CASH', tendered: 100_000 });

  const second = await openTable(tables[1]);
  await order({
    source: 'WAITER_APP',
    orderType: 'DINE_IN',
    tableSessionId: second,
    lines: [line('Lassi', 3)],
  });
  const parts = SplitBillResponse.parse(
    (
      await server()
        .post(`/api/v1/bills/${(await bill({ tableSessionId: second })).id}/split`)
        .set(as(cashier))
        .send({ mode: 'EQUAL', parts: 3 })
    ).body,
  ).invoices;
  for (const part of parts) await pay(part, { mode: 'UPI' });

  await order({ source: 'POS', orderType: 'TAKEAWAY', lines: [line('Lassi')] }, cashier);
  const takeaway = await prisma.order.findFirstOrThrow({
    where: { orderType: 'TAKEAWAY' },
    orderBy: { createdAt: 'desc' },
  });
  const takeawayBill = await bill({ orderId: takeaway.id });
  const wrong = await issue(takeawayBill.id);
  await server()
    .post(`/api/v1/invoices/${wrong.id}/void`)
    .set(as(manager))
    .send({ reason: 'Wrong item' })
    .expect(200);
  await pay(await issue(takeawayBill.id), { mode: 'OTHER', otherModeName: 'Other' });
}

async function openShift(): Promise<ShiftView> {
  return ShiftView.parse(
    (await server().post('/api/v1/shifts').set(as(cashier)).send({ openingFloat: 100_000 })).body,
  );
}

async function closeDay(businessDate: string, shift: ShiftView): Promise<void> {
  await server()
    .post(`/api/v1/shifts/${shift.id}/close`)
    .set(as(cashier))
    .send({ countedCash: 150_000 })
    .expect(200);
  const response = await server()
    .post('/api/v1/day-end')
    .set(as(manager))
    .send({ businessDate, carryForwardTables: true });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  closed[businessDate] = DayEndView.parse(response.body);
}

interface Reports {
  sales: SalesSummaryResponse;
  items: ItemSalesResponse;
  payments: PaymentModesResponse;
}

async function reports(from: string, to: string): Promise<Reports> {
  const get = async (path: string) => {
    const response = await server()
      .get(`/api/v1/reports/${path}`)
      .query({ from, to })
      .set(as(manager));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as unknown;
  };
  return {
    sales: SalesSummaryResponse.parse(await get('sales')),
    items: ItemSalesResponse.parse(await get('items')),
    payments: PaymentModesResponse.parse(await get('payments')),
  };
}

/** The same reports with every summary set aside: read from the live tables alone. */
async function liveReports(from: string, to: string): Promise<Reports> {
  await prisma.$executeRaw`UPDATE daily_summaries SET stale = true`;
  try {
    expect((await summaries.split(kit.restaurantId, { from, to })).summed).toEqual([]);
    return await reports(from, to);
  } finally {
    await summaries.refresh(kit.restaurantId);
  }
}

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createTestApp({ databaseUrl: database.url });
  prisma = app.get(PrismaService);
  summaries = app.get(DailySummariesService);
  kit = await createAuthKit(app);
  manager = await signIn(app, kit, 'MANAGER');
  cashier = await signIn(app, kit, 'BILLER');
  waiter = await signIn(app, kit, 'WAITER');
  const base = { restaurantId: kit.restaurantId };
  await prisma.invoiceSeries.create({
    data: { ...base, name: 'Main', prefix: 'INV', isDefault: true },
  });
  const station = await prisma.station.create({
    data: { ...base, name: 'Kitchen', mode: 'SCREEN' },
  });
  const group = async (name: string, rateBp: number, sacCode: string) =>
    (
      await prisma.taxGroup.create({
        data: {
          ...base,
          name,
          sacCode,
          components: {
            create: [
              { ...base, code: 'CGST', rateBp },
              { ...base, code: 'SGST', rateBp },
            ],
          },
        },
      })
    ).id;
  const gst5 = await group('GST 5 %', 250, '996331');
  const gst18 = await group('GST 18 %', 900, '996332');
  ids.starters = (await prisma.category.create({ data: { ...base, name: 'Starters' } })).id;
  ids.drinks = (await prisma.category.create({ data: { ...base, name: 'Drinks' } })).id;
  for (const [name, price, taxGroupId, category] of [
    ['Paneer Tikka', 28_000, gst5, 'starters'],
    ['Lassi', 8_000, gst5, 'drinks'],
    ['Water', 2_000, gst18, 'drinks'],
  ] as const) {
    ids[name] = (
      await prisma.item.create({
        data: {
          ...base,
          categoryId: id(category),
          name,
          basePrice: price,
          taxGroupId,
          foodType: 'VEG',
          stationId: station.id,
        },
      })
    ).id;
  }
  expect((await server().post('/api/v1/menu/publish').set(as(manager))).status).toBe(200);
  const hall = await prisma.section.create({ data: { ...base, name: 'Hall' } });
  for (const label of ['A1', 'A2', 'B1', 'B2', 'B3', 'C1', 'C2']) {
    ids[label] = (
      await prisma.diningTable.create({ data: { ...base, sectionId: hall.id, label } })
    ).id;
  }

  dayA = DayEndPreview.parse(
    (await server().get('/api/v1/day-end').set(as(manager))).body,
  ).businessDate;
  dayB = addDays(dayA, 1);
  dayC = addDays(dayA, 2);

  // Day A: a plain day, closed.
  let shift = await openShift();
  await trade(['A1', 'A2'], false);
  await closeDay(dayA, shift);

  // Day B: with a discount, and table B3 billed but unpaid, carried forward.
  shift = await openShift();
  await trade(['B1', 'B2'], true);
  const b3 = await openTable('B3');
  await order({
    source: 'WAITER_APP',
    orderType: 'DINE_IN',
    tableSessionId: b3,
    lines: [line('Paneer Tikka')],
  });
  carried = await issue((await bill({ tableSessionId: b3 })).id);
  await closeDay(dayB, shift);

  // Day C, still open: more trade.
  await openShift();
  await trade(['C1', 'C2'], false);
}, 120_000);

afterAll(async () => {
  await app.close();
  await database.drop();
});

describe('[RPT-001] [RPT-002] [RPT-005] [DATA-012] daily summaries written at day-end', () => {
  it('sums each closed date when day-end closes it, and only those', async () => {
    const rows = await prisma.dailySummary.findMany({ orderBy: { businessDate: 'asc' } });
    expect(rows.map((row) => [isoDateOf(row.businessDate), row.stale])).toEqual([
      [dayA, false],
      [dayB, false],
    ]);
    expect(await summaries.split(kit.restaurantId, { from: dayA, to: dayC })).toEqual({
      summed: [dayA, dayB],
      live: [dayC],
    });
  });

  it('keeps the figures of the Z-report for each closed date', async () => {
    const { sales } = await reports(dayA, dayB);
    for (const date of [dayA, dayB]) {
      const day = sales.byDay.find((row) => row.businessDate === date);
      expect(day?.netSales, date).toBe(closed[date]?.report.netSales);
      expect(day?.invoices, date).toBe(closed[date]?.report.invoices.count);
    }
    const hours = await prisma.dailySalesHour.findMany({
      where: { businessDate: new Date(`${dayA}T00:00:00Z`) },
    });
    expect(hours.reduce((total, hour) => total + Number(hour.netSales), 0)).toBe(94_800);
    const payments = await prisma.dailyPaymentMode.findMany({
      where: { businessDate: new Date(`${dayA}T00:00:00Z`) },
      orderBy: [{ mode: 'asc' }],
    });
    expect(
      payments.map((row) => [row.mode, row.modeLabel, row.payments, Number(row.amount)]),
    ).toEqual([
      ['CASH', null, 1, 61_200],
      ['UPI', null, 3, 25_200],
      ['OTHER', 'Other', 1, 8_400],
    ]);
  });

  it('keeps who took the orders and who billed', async () => {
    const staff = await prisma.dailyStaffSales.findMany({
      where: { businessDate: new Date(`${dayA}T00:00:00Z`) },
    });
    expect(staff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ staffId: kit.staff.WAITER, ordersCreated: 2 }),
        expect.objectContaining({
          staffId: kit.staff.BILLER,
          ordersCreated: 1,
          invoicesIssued: 5,
          billed: 94_800n,
        }),
      ]),
    );
  });
});

describe('[RPT-001] [RPT-002] [RPT-005] [RPT-018] reports from summaries and live data', () => {
  it('gives the same figures from the summaries as from the live tables', async () => {
    const merged = await reports(dayA, dayC);
    expect(merged.sales.byDay.map((day) => day.businessDate)).toEqual([dayA, dayB, dayC]);
    expect(merged.sales.totals.invoices).toBe(16);
    expect(merged.items.items.map((item) => item.name)).toEqual(['Paneer Tikka', 'Lassi', 'Water']);
    expect(merged.payments.modes.map((mode) => mode.mode)).toEqual(['CASH', 'UPI', 'OTHER']);
    expect(await liveReports(dayA, dayC)).toEqual(merged);
    // A range of closed dates only, and the open date alone, agree too.
    expect(await reports(dayA, dayB)).toEqual(await liveReports(dayA, dayB));
    expect(await reports(dayC, dayC)).toEqual(await liveReports(dayC, dayC));
  });

  it('reads a closed date from its summary, not from the invoices', async () => {
    const before = await reports(dayA, dayA);
    await prisma.$executeRaw`UPDATE daily_sales_hours SET net_sales = net_sales + 1
      WHERE business_date = ${dayA}::date`;
    const after = await reports(dayA, dayA);
    expect(after.sales.totals.netSales).toBe(before.sales.totals.netSales + 1);
    await prisma.$executeRaw`UPDATE daily_summaries SET stale = true WHERE business_date = ${dayA}::date`;
    expect(await reports(dayA, dayA)).toEqual(before);
    expect(await summaries.refresh(kit.restaurantId)).toBe(1);
    expect(await reports(dayA, dayA)).toEqual(before);
  });

  it('marks a closed date stale when a change reaches it, and sums it again', async () => {
    // The bill carried forward from day B is edited on day C: it keeps its number and date.
    await server()
      .post(`/api/v1/invoices/${carried.id}/reopen`)
      .set(as(manager))
      .send({ reason: 'Guest added a lassi' })
      .expect(200);
    const session = await prisma.invoice.findUniqueOrThrow({ where: { id: carried.id } });
    await order({
      source: 'WAITER_APP',
      orderType: 'DINE_IN',
      tableSessionId: session.tableSessionId,
      lines: [line('Lassi')],
    });
    const edited = await issue(session.billId ?? '');
    expect(edited).toMatchObject({ id: carried.id, businessDate: dayB, version: 2 });
    const summary = await prisma.dailySummary.findFirstOrThrow({
      where: { businessDate: new Date(`${dayB}T00:00:00Z`) },
    });
    expect(summary.stale).toBe(true);

    const meanwhile = await reports(dayA, dayC);
    const dayBSales = meanwhile.sales.byDay.find((day) => day.businessDate === dayB);
    expect(dayBSales?.netSales).toBe(
      (closed[dayB]?.report.netSales ?? 0) + edited.grandTotal - carried.grandTotal,
    );
    expect(await summaries.refresh(kit.restaurantId)).toBe(1);
    expect((await summaries.split(kit.restaurantId, { from: dayB, to: dayB })).summed).toEqual([
      dayB,
    ]);
    expect(await reports(dayA, dayC)).toEqual(meanwhile);
    expect(await liveReports(dayA, dayC)).toEqual(meanwhile);
  });

  it('leaves a summary as it is when an old bill is only paid', async () => {
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: carried.id } });
    await pay({ ...carried, grandTotal: invoice.grandTotal }, { mode: 'UPI' });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: carried.id } })).status).toBe(
      'SETTLED',
    );
    const summary = await prisma.dailySummary.findFirstOrThrow({
      where: { businessDate: new Date(`${dayB}T00:00:00Z`) },
    });
    expect(summary.stale).toBe(false);
    expect(await reports(dayA, dayC)).toEqual(await liveReports(dayA, dayC));
  });
});

describe('[DATA-012] backfill of closed dates', () => {
  it('sums the closed dates that have no summary, once', async () => {
    const before = await reports(dayA, dayC);
    for (const table of [
      'daily_sales_hours',
      'daily_item_sales',
      'daily_payment_modes',
      'daily_staff_sales',
      'daily_summaries',
    ]) {
      await prisma.$executeRawUnsafe(`DELETE FROM ${table}`);
    }
    expect(await summaries.refreshAll()).toBe(2);
    expect(await summaries.refreshAll()).toBe(0);
    expect(await prisma.dailySummary.count({ where: { stale: false } })).toBe(2);
    expect(await reports(dayA, dayC)).toEqual(before);
  });
});

describe('[RPT-006] [DATA-012] bill history', () => {
  const history = (query: Record<string, string | number>, login = manager) =>
    server().get('/api/v1/reports/bills').query(query).set(as(login));

  it('lists the bills of a date range newest first, with table or token and how they were paid', async () => {
    const response = await history({ from: dayA, to: dayA });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const page = BillHistoryResponse.parse(response.body);
    expect(page.nextCursor).toBeNull();
    expect(page.invoices).toHaveLength(6);
    const times = page.invoices.map((invoice) => invoice.issuedAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(page.invoices.filter((invoice) => invoice.status === 'VOIDED')).toHaveLength(1);
    expect(page.invoices.find((invoice) => invoice.tableLabel === 'A1')).toMatchObject({
      grandTotal: 61_200,
      status: 'SETTLED',
      takeawayToken: null,
      payments: [{ mode: 'CASH', label: null }],
    });
    const takeaway = page.invoices.find(
      (invoice) => invoice.tableLabel === null && invoice.status === 'SETTLED',
    );
    expect(takeaway?.takeawayToken).toBeGreaterThan(0);
    expect(takeaway?.payments).toEqual([{ mode: 'OTHER', label: 'Other' }]);
  });

  it('pages 50 at a time with a cursor, every bill once', async () => {
    const all = await prisma.invoice.count();
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: Record<string, string | number> = { limit: 4 };
      if (cursor !== null) query.cursor = cursor;
      const page = BillHistoryResponse.parse((await history(query)).body);
      expect(page.invoices.length).toBeLessThanOrEqual(4);
      seen.push(...page.invoices.map((invoice) => invoice.invoiceId));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 20);
    expect(new Set(seen).size).toBe(all);
    expect(seen).toHaveLength(all);
    const first = BillHistoryResponse.parse((await history({})).body);
    expect(first.invoices.map((invoice) => invoice.invoiceId)).toEqual(seen);
    expect(first.invoices[0]?.businessDate).toBe(dayC);
  });

  it('finds a bill by its number, or only its running number', async () => {
    const wanted = await prisma.invoice.findFirstOrThrow({ where: { id: carried.id } });
    const byNumber = BillHistoryResponse.parse(
      (await history({ number: wanted.invoiceNumber })).body,
    );
    expect(byNumber.invoices.map((invoice) => invoice.invoiceId)).toEqual([wanted.id]);
    const bySequence = BillHistoryResponse.parse(
      (await history({ number: String(wanted.sequence) })).body,
    );
    expect(bySequence.invoices.map((invoice) => invoice.invoiceId)).toContain(wanted.id);
    expect(BillHistoryResponse.parse((await history({ number: 'NOPE-1' })).body).invoices).toEqual(
      [],
    );
  });

  it('finds a guest’s bills by phone, however the number is typed, within dates', async () => {
    const all = BillHistoryResponse.parse((await history({ phone: '+91-98765-43210' })).body);
    expect(all.invoices.map((invoice) => invoice.tableLabel)).toEqual(['C1', 'B1', 'A1']);
    const typed = BillHistoryResponse.parse((await history({ phone: '9876543210' })).body);
    expect(typed.invoices).toEqual(all.invoices);
    const dayOnly = BillHistoryResponse.parse(
      (await history({ phone: '98765 43210', from: dayB, to: dayB })).body,
    );
    expect(dayOnly.invoices.map((invoice) => invoice.tableLabel)).toEqual(['B1']);
    expect(
      BillHistoryResponse.parse((await history({ phone: '99999 00000' })).body).invoices,
    ).toEqual([]);
  });

  it('opens a bill as printed, to print again', async () => {
    const response = await server().get(`/api/v1/reports/bills/${carried.id}`).set(as(manager));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const opened = BillHistoryInvoiceResponse.parse(response.body);
    expect(opened.invoice).toMatchObject({ id: carried.id, invoiceNumber: carried.invoiceNumber });
    expect(opened.printed.join('\n')).toContain(carried.invoiceNumber);
    const missing = await server().get(`/api/v1/reports/bills/${randomUUID()}`).set(as(manager));
    expect([missing.status, codeOf(missing)]).toEqual([404, 'INVOICE_NOT_FOUND']);
  });

  it('is for those who see reports, and refuses a made-up page or backwards dates', async () => {
    const refused = await history({}, waiter);
    expect([refused.status, codeOf(refused)]).toEqual([403, 'FORBIDDEN']);
    const opened = await server().get(`/api/v1/reports/bills/${carried.id}`).set(as(waiter));
    expect(opened.status).toBe(403);
    const cursor = await history({ cursor: 'bm90LWEtY3Vyc29y' });
    expect([cursor.status, codeOf(cursor)]).toEqual([400, 'VALIDATION_FAILED']);
    expect((await history({ from: dayB, to: dayA })).status).toBe(400);
  });
});
