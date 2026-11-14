import type { PendingBill, TableOverviewResponse } from '@rp/contracts';
import { MENU } from '@rp/ordering/testing';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { B, billView, paymentsView } from './billing-fixture.js';
import { FLOOR, OVERVIEW, T1, T2 } from './dashboard-fixture.js';
import type { FakeServer } from './fake-server.js';
import { RESTAURANT_ID, STAFF } from './fakes.js';
import { expectNoAxeViolations, renderConsole, server, signsInAs, t } from './harness.js';

/**
 * The manager dashboard after testing round 1 (ADR-0030, item A): managers and the Owner work
 * from it alone. Bills (pending and history), Modifications, Alerts, Take order, the live
 * Tables and the rest, with live counts beside Bills, Modifications and Alerts.
 */

const uuid = (n: number) => `0199a0e0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const T1_SESSION = uuid(941);
const TAKEAWAY_ORDER = uuid(960);
const INVOICE_2 = uuid(961);

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const pendingBill = (overrides: Partial<PendingBill>): PendingBill => ({
  kind: 'TABLE',
  tableSessionId: T1_SESSION,
  orderId: null,
  tableLabel: 'T1',
  takeawayToken: null,
  status: 'REQUESTED',
  amount: 45_000,
  since: minutesAgo(12),
  billId: null,
  invoiceIds: [],
  ...overrides,
});

const PENDING: PendingBill[] = [
  pendingBill({}),
  pendingBill({
    tableSessionId: uuid(943),
    tableLabel: 'T3',
    status: 'PRINTED',
    amount: 70_400,
    since: minutesAgo(5),
    billId: B.bill,
    invoiceIds: [B.invoice],
  }),
  pendingBill({
    kind: 'TAKEAWAY',
    tableSessionId: null,
    orderId: TAKEAWAY_ORDER,
    tableLabel: null,
    takeawayToken: 12,
    status: 'NEEDS_NEW_BILL',
    amount: 32_000,
    since: minutesAgo(2),
    billId: uuid(962),
    invoiceIds: [INVOICE_2],
  }),
];

function managerServer(bills: PendingBill[] = PENDING): FakeServer {
  return signsInAs(server(), 'MANAGER')
    .on('GET', '/api/v1/floor', () => ({ status: 200, body: FLOOR }))
    .on('GET', '/api/v1/tables/overview', () => ({ status: 200, body: OVERVIEW }))
    .on('GET', '/api/v1/bills/pending', () => ({ status: 200, body: { bills } }));
}

const nav = () => within(screen.getByRole('navigation', { name: t('dashboard.navigation') }));
const linkNames = () =>
  nav()
    .getAllByRole('link')
    .map((link) => link.getAttribute('aria-label') ?? link.textContent);

beforeEach(() => {
  vi.stubGlobal('isSecureContext', true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('[MGR-001] the manager’s dashboard (ADR-0030)', () => {
  it('lists the day-to-day pages in order, with the count of pending bills', async () => {
    const { container } = await renderConsole({
      fake: managerServer(),
      signedIn: 'MANAGER',
      path: '/manage',
    });
    await screen.findByRole('heading', { name: t('bills.title') });
    await waitFor(() => {
      expect(linkNames()[0]).toBe(
        `${t('dashboard.section.bills')}, ${t('dashboard.badge', { count: 3 })}`,
      );
    });
    expect(linkNames().slice(1, 15)).toEqual(
      [
        'modifications',
        'alerts',
        'takeOrder',
        'tables',
        'menu',
        'availability',
        'staff',
        'reports',
        'cancelledKots',
        'restaurant',
        'setup',
        'devices',
        'qrCodes',
        'cashDrawer',
      ].map((section) => t(`dashboard.section.${section}` as 'dashboard.section.bills')),
    );
    // The rest, under More; the POS and the kitchen display are not among them.
    expect(nav().getByText(t('dashboard.more'))).toBeVisible();
    expect(screen.queryByRole('navigation', { name: t('modes.navigation') })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it.each([
    ['/pos', 'modes.pos'],
    ['/kds', 'modes.kds'],
  ] as const)('keeps managers out of %s and back on the dashboard', async (path, mode) => {
    const { user } = await renderConsole({ fake: managerServer(), signedIn: 'MANAGER', path });
    expect(await screen.findByText(t('modes.notAllowed', { mode: t(mode) }))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('modes.manage') }));
    expect(await screen.findByRole('heading', { name: t('bills.title') })).toBeInTheDocument();
  });
});

describe('[BILL-001] [BILL-008] pending bills (ADR-0030)', () => {
  it('lists each bill with where, how much, how long and where it stands', async () => {
    const { container } = await renderConsole({
      fake: managerServer(),
      signedIn: 'MANAGER',
      path: '/manage/bills',
    });
    const table = within(await screen.findByRole('table', { name: t('bills.list') }));
    const rows = table.getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual([
      'Table T1',
      'Table T3',
      'Takeaway #12',
    ]);
    const [requested, printed, stale] = rows;
    if (requested === undefined || printed === undefined || stale === undefined) {
      throw new Error('Missing rows');
    }
    expect(requested).toHaveTextContent('₹450.00');
    expect(requested).toHaveTextContent(t('alerts.age', { minutes: 12 }));
    expect(requested).toHaveTextContent(t('bills.status.REQUESTED'));
    expect(printed).toHaveTextContent(t('bills.status.PRINTED'));
    expect(stale).toHaveTextContent(t('bills.status.NEEDS_NEW_BILL'));
    // A printed bill is paid in one press; the others are opened first.
    expect(within(printed).getByRole('button', { name: t('bills.pay') })).toBeVisible();
    expect(within(requested).queryByRole('button', { name: t('bills.pay') })).toBeNull();
    expect(within(stale).queryByRole('button', { name: t('bills.pay') })).toBeNull();
    expect(screen.getByRole('link', { name: t('bills.pending') })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expectNoAxeViolations(container);
  });

  it('opens a requested bill, to print, discount, split or cancel it', async () => {
    const fake = managerServer()
      .on('POST', '/api/v1/bills', () => ({ status: 200, body: billView() }))
      .on('GET', `/api/v1/bills/${B.bill}`, () => ({ status: 200, body: billView() }));
    const { user } = await renderConsole({ fake, signedIn: 'MANAGER', path: '/manage/bills' });
    await user.click(await screen.findByRole('button', { name: `${t('bills.open')}: Table T1` }));
    expect(
      await screen.findByRole('heading', {
        name: t('billing.billFor', { target: t('pos.table.title', { table: 'T4' }) }),
      }),
    ).toBeInTheDocument();
    expect(fake.callsTo('POST', '/api/v1/bills')[0]?.body).toEqual({ tableSessionId: T1_SESSION });
    // Back goes to the pending bills, not to a POS.
    await user.click(screen.getByRole('button', { name: t('bills.back') }));
    expect(await screen.findByRole('table', { name: t('bills.list') })).toBeInTheDocument();
  });

  it('takes payment for a printed bill', async () => {
    const fake = managerServer()
      .on('GET', `/api/v1/invoices/${B.invoice}/payments`, () => ({
        status: 200,
        body: paymentsView(),
      }))
      .on('GET', `/api/v1/bills/${B.bill}`, () => ({
        status: 200,
        body: billView({ status: 'INVOICED' }),
      }));
    const { user } = await renderConsole({ fake, signedIn: 'MANAGER', path: '/manage/bills' });
    await user.click(await screen.findByRole('button', { name: t('bills.pay') }));
    expect(await screen.findByLabelText(t('payment.amount'))).toHaveValue('704.00');
  });

  it('keeps the list and its count live: a bill paid elsewhere leaves both', async () => {
    let bills = PENDING;
    const fake = signsInAs(server(), 'MANAGER').on('GET', '/api/v1/bills/pending', () => ({
      status: 200,
      body: { bills },
    }));
    const { sockets } = await renderConsole({ fake, signedIn: 'MANAGER', path: '/manage/bills' });
    const table = await screen.findByRole('table', { name: t('bills.list') });
    await waitFor(() => {
      expect(linkNames()[0]).toContain(t('dashboard.badge', { count: 3 }));
    });
    bills = PENDING.slice(0, 2);
    act(() => {
      sockets.sync(0);
      sockets.last.fire('event', {
        sequence: 1,
        event: {
          eventId: uuid(990),
          type: 'BillSettled',
          version: 1,
          occurredAt: new Date().toISOString(),
          restaurantId: RESTAURANT_ID,
          businessDate: '2026-09-26',
          payload: { invoiceId: INVOICE_2, grandTotal: 32_000 },
        },
      });
    });
    await waitFor(() => {
      expect(within(table).queryByText('Takeaway #12')).toBeNull();
    });
    await waitFor(() => {
      expect(linkNames()[0]).toContain(t('dashboard.badge', { count: 2 }));
    });
  });

  it('says when nothing waits, and has the bills already printed under History', async () => {
    const fake = managerServer([]).on('GET', '/api/v1/restaurant', () => ({
      status: 500,
      body: { code: 'BROKEN', message: 'Broken' },
    }));
    const { user } = await renderConsole({ fake, signedIn: 'MANAGER', path: '/manage/bills' });
    expect(await screen.findByText(t('bills.none'))).toBeVisible();
    expect(linkNames()[0]).toBe(t('dashboard.section.bills'));
    await user.click(screen.getByRole('link', { name: t('bills.history') }));
    // History is the Reports' bill history, over a range of dates.
    expect(await screen.findByText(t('reportsPage.loadFailed'))).toBeVisible();
    expect(screen.getByRole('link', { name: t('bills.history') })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe('[TBL-007] the live Tables (ADR-0030)', () => {
  it('shows the open tables, read-only, and opens a table’s bill', async () => {
    let refuse = true;
    const fake = managerServer()
      .on('POST', '/api/v1/bills', () =>
        refuse
          ? {
              status: 409,
              body: { code: 'NOTHING_TO_BILL', message: 'Nothing on this table to bill yet.' },
            }
          : { status: 200, body: billView() },
      )
      .on('GET', `/api/v1/bills/${B.bill}`, () => ({ status: 200, body: billView() }));
    const { user, container } = await renderConsole({
      fake,
      signedIn: 'MANAGER',
      path: '/manage/tables',
    });
    const table = within(await screen.findByRole('table', { name: t('tablesPage.list') }));
    expect(screen.getByText(t('tablesPage.summary', { open: 2, total: 3 }))).toBeVisible();
    const rows = table.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('T1');
    expect(rows[0]).toHaveTextContent('3');
    expect(rows[0]).toHaveTextContent('30 min');
    expect(rows[0]).toHaveTextContent('Ravi');
    expect(rows[0]).toHaveTextContent('₹450.00');
    // Opening the bill is the one thing to do here.
    expect(table.getAllByRole('button')).toHaveLength(2);
    await expectNoAxeViolations(container);

    const open = table.getByRole('button', { name: t('tablesPage.openBillFor', { table: 'T1' }) });
    await user.click(open);
    expect(await screen.findByText('Nothing on this table to bill yet.')).toBeInTheDocument();
    refuse = false;
    await user.click(open);
    expect(
      await screen.findByRole('heading', {
        name: t('billing.billFor', { target: t('pos.table.title', { table: 'T4' }) }),
      }),
    ).toBeInTheDocument();
    expect(fake.callsTo('POST', '/api/v1/bills')[1]?.body).toEqual({ tableSessionId: T1_SESSION });
  });
});

describe('[ORD-001] [TBL-003] Take order, dine-in only (ADR-0030)', () => {
  const orderServer = (overview: TableOverviewResponse = OVERVIEW) =>
    signsInAs(server(), 'MANAGER')
      .on('GET', '/api/v1/floor', () => ({ status: 200, body: FLOOR }))
      .on('GET', '/api/v1/tables/overview', () => ({ status: 200, body: overview }))
      .on('GET', '/api/v1/menu', () => ({ status: 200, body: MENU }))
      .on('GET', `/api/v1/table-sessions/${T1_SESSION}/orders`, () => ({
        status: 200,
        body: { orders: [] },
      }))
      .on('GET', `/api/v1/table-sessions/${uuid(942)}/orders`, () => ({
        status: 200,
        body: { orders: [] },
      }));

  it('takes an occupied table’s order, and has no takeaway', async () => {
    const { user, container } = await renderConsole({
      fake: orderServer(),
      signedIn: 'MANAGER',
      path: '/manage/take-order',
    });
    const hall = within(await screen.findByRole('region', { name: 'Hall' }));
    expect(screen.queryByRole('button', { name: t('pos.takeaway') })).toBeNull();
    await expectNoAxeViolations(container);
    await user.click(hall.getByRole('button', { name: /^T1, Occupied/ }));
    expect(
      await screen.findByRole('heading', { name: t('pos.table.title', { table: 'T1' }) }),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Main Course' }));
    expect(await screen.findByRole('button', { name: /^Dal Makhani/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('pos.backToTables') }));
    expect(await screen.findByRole('heading', { name: t('takeOrder.title') })).toBeVisible();
  });

  it('opens a free table for its guests, asking first when they are more than its seats', async () => {
    const fake = orderServer().on('POST', `/api/v1/tables/${T2}/open`, () => ({
      status: 201,
      body: {
        id: uuid(942),
        tableId: T2,
        tableLabel: 'T2',
        state: 'OCCUPIED',
        status: 'OPEN',
        covers: 6,
        waiterId: STAFF.MANAGER.staffId,
        waiterName: 'Meera',
        businessDate: '2026-09-26',
        openedAt: new Date().toISOString(),
        closedAt: null,
        closeReason: null,
      },
    }));
    const { user } = await renderConsole({
      fake,
      signedIn: 'MANAGER',
      path: '/manage/take-order',
    });
    const hall = within(await screen.findByRole('region', { name: 'Hall' }));
    await user.click(hall.getByRole('button', { name: /^T2, Free/ }));
    const dialog = within(
      await screen.findByRole('dialog', { name: t('pos.open.title', { table: 'T2' }) }),
    );
    await user.click(
      within(dialog.getByRole('group', { name: t('pos.open.howMany') })).getByRole('button', {
        name: t('pos.open.guestsCount', { count: 6 }),
      }),
    );
    expect(
      await dialog.findByText(t('pos.open.overCapacity', { table: 'T2', seats: 4, guests: 6 })),
    ).toBeVisible();
    expect(fake.callsTo('POST', `/api/v1/tables/${T2}/open`)).toHaveLength(0);
    await user.click(dialog.getByRole('button', { name: t('pos.open.anyway') }));
    expect(
      await screen.findByRole('heading', { name: t('pos.table.title', { table: 'T2' }) }),
    ).toBeInTheDocument();
    expect(fake.callsTo('POST', `/api/v1/tables/${T2}/open`)[0]?.body).toEqual({ covers: 6 });
  });

  it('is not for tables that wait to be cleaned', async () => {
    const dirty = {
      ...OVERVIEW,
      tables: OVERVIEW.tables.map((entry) =>
        entry.tableId === T2 ? { ...entry, state: 'NEEDS_CLEANING' as const } : entry,
      ),
    };
    const { user } = await renderConsole({
      fake: orderServer(dirty),
      signedIn: 'MANAGER',
      path: '/manage/take-order',
    });
    const hall = within(await screen.findByRole('region', { name: 'Hall' }));
    await user.click(hall.getByRole('button', { name: /^T2,/ }));
    expect(await screen.findByText(t('takeOrder.notReady', { table: 'T2' }))).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(T1).not.toBe(T2);
  });
});
