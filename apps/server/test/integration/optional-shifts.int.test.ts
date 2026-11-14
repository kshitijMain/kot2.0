import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  ApiError,
  BillView,
  DayEndPreview,
  DayEndView,
  InvoicePaymentsView,
  InvoiceView,
  type LoginResponse,
  PaymentModesResponse,
  ShiftView,
  SubmitOrderResponse,
  SuspiciousActivityResponse,
} from '@rp/contracts';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';
import { PrismaService } from '../../src/database/prisma.service.js';
import { CashDrawerService } from '../../src/payments/cash-drawer.service.js';
import { authHeaders, type AuthKit, createAuthKit, signIn } from '../helpers/auth-kit.js';
import { setUpSmallRestaurant, type SmallRestaurant } from '../helpers/small-restaurant.js';
import { createTestApp, httpServer } from '../helpers/test-app.js';
import { createTestDatabase, type TestDatabase } from '../helpers/test-database.js';

/**
 * ADR-0029: the cash drawer is an optional add-on. Cash never needs a shift; it goes into the
 * shift of whoever takes it when they have one open; cash in and out and the no-sale opening need
 * the person's own open shift; day end names the shifts still open and does not wait for them.
 */

let database: TestDatabase;
let app: INestApplication;
let prisma: PrismaService;
let kit: AuthKit;
let manager: LoginResponse;
let biller: LoginResponse;
let waiter: LoginResponse;
let restaurant: SmallRestaurant;
let kick: MockInstance<(restaurantId: string) => void>;

beforeAll(async () => {
  database = await createTestDatabase();
  app = await createTestApp({ databaseUrl: database.url });
  prisma = app.get(PrismaService);
  kit = await createAuthKit(app);
  manager = await signIn(app, kit, 'MANAGER');
  biller = await signIn(app, kit, 'BILLER');
  waiter = await signIn(app, kit, 'WAITER');
  restaurant = await setUpSmallRestaurant(app, kit, manager);
  kick = vi.spyOn(app.get(CashDrawerService), 'kickForCash').mockImplementation(() => undefined);
});

beforeEach(() => {
  kick.mockClear();
});

afterAll(async () => {
  await app.close();
  await database.drop();
});

const as = (login: LoginResponse) => authHeaders(kit.deviceId, login.accessToken);
const codeOf = (response: request.Response) => ApiError.parse(response.body).code;
const server = () => request(httpServer(app));

/** A takeaway bill for one Dal, issued and waiting for payment. */
async function bill(by: LoginResponse = manager): Promise<InvoiceView> {
  const order = SubmitOrderResponse.parse(
    (
      await server()
        .post('/api/v1/orders')
        .set(as(by))
        .send({
          idempotencyKey: randomUUID(),
          source: 'POS',
          orderType: 'TAKEAWAY',
          lines: [{ clientLineId: randomUUID(), itemId: restaurant.items.Dal, quantity: 1 }],
        })
    ).body,
  );
  if (order.status !== 'ACCEPTED') throw new Error('The order was refused');
  const open = BillView.parse(
    (await server().post('/api/v1/bills').set(as(by)).send({ orderId: order.orderId })).body,
  );
  return InvoiceView.parse(
    (await server().post(`/api/v1/bills/${open.id}/invoice`).set(as(by)).send({})).body,
  );
}

function pay(invoice: InvoiceView, by: LoginResponse, payments: object[]) {
  return server()
    .post(`/api/v1/invoices/${invoice.id}/payments`)
    .set(as(by))
    .send({ idempotencyKey: randomUUID(), payments });
}

async function payCash(invoice: InvoiceView, by: LoginResponse): Promise<InvoicePaymentsView> {
  const response = await pay(invoice, by, [{ mode: 'CASH', amount: invoice.grandTotal }]);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return InvoicePaymentsView.parse(response.body);
}

async function openShift(by: LoginResponse, openingFloat = 100_000): Promise<ShiftView> {
  const response = await server().post('/api/v1/shifts').set(as(by)).send({ openingFloat });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return ShiftView.parse(response.body);
}

async function current(by: LoginResponse): Promise<ShiftView | null> {
  const response = await server().get('/api/v1/shifts/current').set(as(by));
  return (response.body as { shift: ShiftView | null }).shift;
}

const closeCounted = (shift: ShiftView, by: LoginResponse, countedCash: number) =>
  server().post(`/api/v1/shifts/${shift.id}/close`).set(as(by)).send({ countedCash });
const closeNotCounted = (shift: ShiftView, by: LoginResponse) =>
  server().post(`/api/v1/shifts/${shift.id}/close-not-counted`).set(as(by));

const preview = async () =>
  DayEndPreview.parse((await server().get('/api/v1/day-end').set(as(manager))).body);

async function cashOutside(date: string): Promise<number> {
  const response = await server()
    .get(`/api/v1/reports/payments?from=${date}&to=${date}`)
    .set(as(manager));
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return PaymentModesResponse.parse(response.body).cashOutsideShift;
}

async function suspicious(date: string) {
  const response = await server()
    .get(`/api/v1/reports/suspicious?from=${date}&to=${date}`)
    .set(as(manager));
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return SuspiciousActivityResponse.parse(response.body);
}

describe('[BILL-008] [BILL-013] cash without a shift (ADR-0029)', () => {
  it('takes cash from someone with no shift, linked to none, and still opens the drawer', async () => {
    expect(await current(manager)).toBeNull();
    const view = await payCash(await bill(), manager);
    expect(view.status).toBe('SETTLED');
    expect(view.payments[0]).toMatchObject({ mode: 'CASH', shiftId: null });
    expect(kick).toHaveBeenCalledTimes(1);
  });

  it('puts cash into the shift of whoever takes it, and opens the drawer too', async () => {
    const shift = await openShift(manager);
    const invoice = await bill();
    const view = await payCash(invoice, manager);
    expect(view.payments[0]?.shiftId).toBe(shift.id);
    expect(kick).toHaveBeenCalledTimes(1);
    expect((await current(manager))?.cashPayments).toBe(invoice.grandTotal);
    expect((await current(manager))?.expectedCash).toBe(100_000 + invoice.grandTotal);
  });

  it('never puts cash taken by someone else into another person’s shift', async () => {
    const before = await current(manager);
    expect(await current(biller)).toBeNull();
    const view = await payCash(await bill(biller), biller);
    expect(view.payments[0]?.shiftId).toBeNull();
    expect((await current(manager))?.cashPayments).toBe(before?.cashPayments);
  });

  it('keeps two managers’ cash apart when both take it at the same moment', async () => {
    const mine = await current(manager);
    const theirs = await openShift(biller, 50_000);
    const [first, second] = await Promise.all([bill(manager), bill(biller)]);
    if (mine === null) throw new Error('setup');
    const [paidMine, paidTheirs] = await Promise.all([
      payCash(first, manager),
      payCash(second, biller),
    ]);
    expect(paidMine.payments[0]?.shiftId).toBe(mine.id);
    expect(paidTheirs.payments[0]?.shiftId).toBe(theirs.id);
    expect((await current(manager))?.cashPayments).toBe(mine.cashPayments + first.grandTotal);
    expect((await current(biller))?.cashPayments).toBe(second.grandTotal);
    expect((await current(biller))?.expectedCash).toBe(50_000 + second.grandTotal);
  });

  it('counts only the cash half of a split payment, with a shift and without', async () => {
    const { businessDate } = await preview();
    const outsideBefore = await cashOutside(businessDate);
    const withShift = await bill();
    const expectedBefore = (await current(manager))?.expectedCash ?? 0;
    const split = await pay(withShift, manager, [
      { mode: 'CASH', amount: 10_000 },
      { mode: 'UPI', amount: withShift.grandTotal - 10_000, reference: 'UPI-1' },
    ]);
    expect(split.status, JSON.stringify(split.body)).toBe(200);
    expect((await current(manager))?.expectedCash).toBe(expectedBefore + 10_000);
    expect(await cashOutside(businessDate)).toBe(outsideBefore);

    // The Owner has no shift of their own open.
    const owner = await signIn(app, kit, 'OWNER');
    const without = await bill(owner);
    const paid = await pay(without, owner, [
      { mode: 'CASH', amount: 12_000 },
      { mode: 'UPI', amount: without.grandTotal - 12_000, reference: 'UPI-2' },
    ]);
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(await cashOutside(businessDate)).toBe(outsideBefore + 12_000);
    expect(kick).toHaveBeenCalledTimes(2);
  });

  it('adds nothing for a card or UPI payment with no shift, and does not open the drawer', async () => {
    const owner = await signIn(app, kit, 'OWNER');
    const { businessDate } = await preview();
    const outsideBefore = await cashOutside(businessDate);
    const invoice = await bill(owner);
    const paid = await pay(invoice, owner, [
      { mode: 'CARD', amount: invoice.grandTotal, reference: 'slip-1' },
    ]);
    expect(paid.status).toBe(200);
    expect(await cashOutside(businessDate)).toBe(outsideBefore);
    expect(kick).not.toHaveBeenCalled();
  });
});

describe('[BILL-013] [BILL-016] what still needs the person’s own shift (ADR-0029)', () => {
  const move = (shiftId: string, by: LoginResponse) =>
    server()
      .post(`/api/v1/shifts/${shiftId}/cash-movements`)
      .set(as(by))
      .send({ direction: 'OUT', amount: 5_000, reason: 'Milk delivery' });
  const noSale = (by: LoginResponse) =>
    server().post('/api/v1/cash-drawer/open').set(as(by)).send({ reason: 'Change for a 500 note' });

  it('refuses cash in or out on a shift that is not the person’s own, in plain words', async () => {
    const owner = await signIn(app, kit, 'OWNER');
    const hers = await current(manager);
    if (hers === null) throw new Error('setup');
    // The Owner has no shift: the shift they name is someone else's.
    const refused = await move(hers.id, owner);
    expect([refused.status, codeOf(refused)]).toEqual([409, 'OWN_SHIFT_REQUIRED']);
    expect(ApiError.parse(refused.body).message).toMatch(/your own shift/i);
    expect((await current(manager))?.cashOut).toBe(hers.cashOut);
    // Even someone with a shift of their own cannot write on another's.
    const biller_ = await current(biller);
    expect(biller_).not.toBeNull();
    const across = await move(hers.id, biller);
    expect([across.status, codeOf(across)]).toEqual([409, 'OWN_SHIFT_REQUIRED']);
    expect((await move(hers.id, waiter)).status).toBe(403);
  });

  it('records cash in or out on the person’s own open shift', async () => {
    const hers = await current(manager);
    if (hers === null) throw new Error('setup');
    const done = await move(hers.id, manager);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(ShiftView.parse(done.body).cashOut).toBe(hers.cashOut + 5_000);
  });

  it('refuses the no-sale opening with no shift, without touching the drawer or the audit log', async () => {
    const owner = await signIn(app, kit, 'OWNER');
    const audited = await prisma.auditLog.count({ where: { action: 'CASH_DRAWER_OPENED' } });
    const refused = await noSale(owner);
    expect([refused.status, codeOf(refused)]).toEqual([409, 'OWN_SHIFT_REQUIRED']);
    expect(ApiError.parse(refused.body).message).toMatch(/shift/i);
    expect(await prisma.auditLog.count({ where: { action: 'CASH_DRAWER_OPENED' } })).toBe(audited);
  });

  it('lets the no-sale opening through with a shift (here it stops at the missing printer)', async () => {
    const response = await noSale(manager);
    expect([response.status, codeOf(response)]).toEqual([422, 'NO_BILL_PRINTER']);
  });
});

describe('[BILL-013] [AUD-006] shifts still open at day end (ADR-0029)', () => {
  it('names each open shift with what its drawer should hold, and does not block on it', async () => {
    const hers = await current(manager);
    const his = await current(biller);
    const view = await preview();
    expect(view.openShifts).toEqual([
      {
        shiftId: hers?.id,
        staffId: kit.staff.MANAGER,
        staffName: 'Test manager',
        expectedCash: hers?.expectedCash,
      },
      {
        shiftId: his?.id,
        staffId: kit.staff.BILLER,
        staffName: 'Test biller',
        expectedCash: his?.expectedCash,
      },
    ]);
    expect(view.blockers).not.toHaveProperty('openShifts');
  });

  it('lets a manager count and close another person’s shift, showing the difference', async () => {
    const his = await current(biller);
    if (his === null) throw new Error('setup');
    expect((await closeCounted(his, waiter, 1_000)).status).toBe(403);
    const closed = await closeCounted(his, manager, his.expectedCash - 30_000);
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(ShiftView.parse(closed.body)).toMatchObject({
      status: 'CLOSED',
      notCounted: false,
      variance: -30_000,
    });
    expect(
      await prisma.auditLog.findFirstOrThrow({
        where: { action: 'SHIFT_CLOSED', entityId: his.id },
      }),
    ).toMatchObject({ actorId: kit.staff.MANAGER });
    expect((await preview()).openShifts.map((shift) => shift.shiftId)).not.toContain(his.id);
  });

  it('closes a shift as not counted: audited, flagged, no difference, and only once', async () => {
    const shift = await openShift(biller, 70_000);
    const { businessDate } = await preview();
    expect((await closeNotCounted(shift, waiter)).status).toBe(403);
    const owner = await signIn(app, kit, 'OWNER');
    const closed = await closeNotCounted(shift, owner);
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(ShiftView.parse(closed.body)).toMatchObject({
      status: 'CLOSED',
      notCounted: true,
      countedCash: null,
      variance: null,
      expectedCash: 70_000,
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'SHIFT_CLOSED_NOT_COUNTED', entityId: shift.id },
    });
    expect(audit).toMatchObject({ actorId: kit.staff.OWNER, reason: 'Not counted' });
    expect(audit.after).toMatchObject({ status: 'CLOSED', expectedCash: 70_000 });

    const flag = (await suspicious(businessDate)).flags.find(
      (entry) => entry.kind === 'SHIFT_NOT_COUNTED',
    );
    expect(flag).toMatchObject({
      by: { id: kit.staff.BILLER },
      alsoBy: [expect.objectContaining({ id: kit.staff.OWNER })],
      amount: 70_000,
    });

    const again = await closeNotCounted(shift, owner);
    expect([again.status, codeOf(again)]).toEqual([409, 'SHIFT_CLOSED']);
  });

  it('still flags a cash difference at close, and never flags cash taken without a shift', async () => {
    const { businessDate } = await preview();
    const report = await suspicious(businessDate);
    const kinds = report.flags.map((entry) => entry.kind);
    expect(kinds).toContain('CASH_VARIANCE');
    expect(kinds).toContain('SHIFT_NOT_COUNTED');
    expect(await cashOutside(businessDate)).toBeGreaterThan(0);
    expect(report.flags.filter((entry) => entry.reason?.includes('outside'))).toEqual([]);
  });

  it('closes the day with a shift still open, which runs on and is listed the next day', async () => {
    const hers = await current(manager);
    if (hers === null) throw new Error('setup');
    const before = await preview();
    expect(before.report.cash.outsideShift).toBeGreaterThan(0);
    const outside = await cashOutside(before.businessDate);
    expect(outside).toBe(before.report.cash.outsideShift);

    const closed = await server()
      .post('/api/v1/day-end')
      .set(as(manager))
      .send({ businessDate: before.businessDate });
    expect(closed.status, JSON.stringify(closed.body)).toBe(201);
    const day = DayEndView.parse(closed.body);
    expect(day.report.cash.outsideShift).toBe(outside);
    expect(day.report.shifts.find((shift) => shift.shiftId === hers.id)).toMatchObject({
      countedCash: null,
      notCounted: false,
    });
    expect(day.report.shifts.filter((shift) => shift.notCounted)).toHaveLength(1);

    expect((await current(manager))?.id).toBe(hers.id);
    const next = await preview();
    expect(next.businessDate > before.businessDate).toBe(true);
    expect(next.openShifts.map((shift) => shift.shiftId)).toEqual([hers.id]);

    // The closed date now reads from its summary, and says the same.
    expect(await cashOutside(before.businessDate)).toBe(outside);
  });

  it('[BILL-013] leaves older records alone: a kept report without the new figures still reads', async () => {
    const row = await prisma.dayEnd.findFirstOrThrow({ where: { restaurantId: kit.restaurantId } });
    const stored = row.report as {
      cash: Record<string, number>;
      shifts: Record<string, unknown>[];
    };
    const { outsideShift: _gone, ...cash } = stored.cash;
    const old = {
      ...(row.report as object),
      cash,
      shifts: stored.shifts.map(({ notCounted: _dropped, ...shift }) => shift),
    };
    await prisma.$executeRaw`UPDATE day_ends SET report = ${JSON.stringify(old)}::jsonb WHERE id = ${row.id}::uuid`;
    const date = row.businessDate.toISOString().slice(0, 10);
    const view = await server().get(`/api/v1/day-ends/${date}`).set(as(manager));
    expect(view.status, JSON.stringify(view.body)).toBe(200);
    const parsed = DayEndView.parse(view.body);
    expect(parsed.report.cash.outsideShift).toBe(0);
    expect(parsed.report.shifts.every((shift) => !shift.notCounted)).toBe(true);
  });
});
