import type { BillHistoryEntry, BillHistoryResponse } from '@rp/contracts';
import { businessDateOf } from '@rp/domain';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoiceView } from './billing-fixture.js';
import type { FakeServer } from './fake-server.js';
import { expectNoAxeViolations, renderConsole, server, signsInAs, t } from './harness.js';
import { profileView } from './restaurant-fixture.js';

const TODAY = businessDateOf(new Date(), { cutoff: '04:00', timeZone: 'Asia/Kolkata' });

const idOf = (n: number) => `0199a0e0-0000-7000-8000-${String(n).padStart(12, '0')}`;

function entry(n: number, overrides: Partial<BillHistoryEntry> = {}): BillHistoryEntry {
  return {
    invoiceId: idOf(n),
    invoiceNumber: `INV/26-27/${String(n).padStart(6, '0')}`,
    businessDate: TODAY,
    issuedAt: '2026-10-31T14:30:00.000Z',
    tableLabel: 'T4',
    takeawayToken: null,
    grandTotal: 10_500,
    status: 'SETTLED',
    payments: [{ mode: 'CASH', label: null }],
    ...overrides,
  };
}

/** 50 bills, then a page of 3 more. */
function firstPage(): BillHistoryResponse {
  return {
    invoices: [
      entry(60, {
        tableLabel: null,
        takeawayToken: 12,
        payments: [{ mode: 'OTHER', label: 'Swiggy' }],
      }),
      entry(59, { status: 'VOIDED', payments: [] }),
      ...Array.from({ length: 48 }, (_, index) => entry(58 - index)),
    ],
    nextCursor: 'cursor-1',
  };
}

function historyServer(): FakeServer {
  return signsInAs(server(), 'MANAGER')
    .on('GET', '/api/v1/restaurant', () => ({ status: 200, body: profileView() }))
    .on('GET', '/api/v1/reports/bills', (call) => {
      const query = new URL(`http://x${call.path}`).searchParams;
      if (query.get('cursor') === 'cursor-1') {
        return {
          status: 200,
          body: { invoices: [entry(10), entry(9), entry(8)], nextCursor: null },
        };
      }
      if (query.get('phone') !== null) {
        return { status: 200, body: { invoices: [entry(58)], nextCursor: null } };
      }
      return { status: 200, body: firstPage() };
    })
    .on('GET', `/api/v1/reports/bills/${idOf(58)}`, () => ({
      status: 200,
      body: {
        invoice: invoiceView({ id: idOf(58), invoiceNumber: 'INV/26-27/000058' }),
        printed: ['SPICE ROUTE', 'Invoice INV/26-27/000058', 'Total 105.00'],
      },
    }))
    .on('POST', `/api/v1/invoices/${idOf(58)}/print`, () => ({
      status: 200,
      body: { printed: true, error: null, duplicate: true, printCount: 2 },
    }));
}

beforeEach(() => {
  vi.stubGlobal('isSecureContext', true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('[RPT-006] [DATA-012] past bills', () => {
  it('lists the period’s bills newest first and shows more on request', async () => {
    const fake = historyServer();
    const { container, user } = await renderConsole({
      fake,
      path: '/manage/reports',
      signedIn: 'MANAGER',
    });
    await user.click(await screen.findByRole('link', { name: t('history.link') }));
    const table = within(await screen.findByRole('table', { name: t('history.table') }));
    expect(
      fake.calls.some(
        (call) => call.path === `/api/v1/reports/bills?from=${TODAY}&to=${TODAY}&limit=50`,
      ),
    ).toBe(true);
    expect(table.getByText(t('history.token', { token: 12 }))).toBeVisible();
    expect(table.getByText('Swiggy')).toBeVisible();
    expect(table.getByText(t('reportsPage.invoiceStatus.VOIDED'))).toBeVisible();
    expect(table.getByText(t('history.notPaid'))).toBeVisible();
    expect(screen.getByText(t('history.shown', { count: 50 }))).toBeVisible();
    await expectNoAxeViolations(container);

    await user.click(screen.getByRole('button', { name: t('history.more') }));
    expect(await screen.findByText(t('history.shown', { count: 53 }))).toBeVisible();
    expect(
      fake.callsTo(
        'GET',
        `/api/v1/reports/bills?from=${TODAY}&to=${TODAY}&cursor=cursor-1&limit=50`,
      ),
    ).toHaveLength(1);
    expect(screen.queryByRole('button', { name: t('history.more') })).toBeNull();
  });

  it('finds a guest’s bills by phone across all dates, and opens one to print again', async () => {
    const fake = historyServer();
    const { user } = await renderConsole({
      fake,
      path: `/manage/reports/bills?from=${TODAY}&to=${TODAY}`,
      signedIn: 'MANAGER',
    });
    await screen.findByRole('table', { name: t('history.table') });
    await user.type(screen.getByLabelText(t('history.phone')), '98765 43210');
    await user.click(screen.getByRole('button', { name: t('history.search') }));
    expect(await screen.findByText(t('history.allDates'))).toBeVisible();
    await waitFor(() => {
      expect(fake.callsTo('GET', '/api/v1/reports/bills?phone=98765+43210&limit=50')).toHaveLength(
        1,
      );
    });
    await waitFor(() => {
      expect(screen.getByText(t('history.shown', { count: 1 }))).toBeVisible();
    });

    await user.click(
      screen.getByRole('button', { name: t('history.openFor', { number: 'INV/26-27/000058' }) }),
    );
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/Total 105\.00/)).toBeVisible();
    await user.click(dialog.getByRole('button', { name: t('history.printAgain') }));
    expect(await screen.findByText(t('history.reprinted'))).toBeVisible();
    expect(fake.callsTo('POST', `/api/v1/invoices/${idOf(58)}/print`)).toHaveLength(1);

    const [close] = dialog.getAllByRole('button', { name: t('history.close') });
    expect(close).toBeDefined();
    if (close !== undefined) await user.click(close);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    await user.click(screen.getByRole('button', { name: t('history.clear') }));
    await waitFor(() => {
      expect(screen.queryByText(t('history.allDates'))).toBeNull();
    });
  });
});
