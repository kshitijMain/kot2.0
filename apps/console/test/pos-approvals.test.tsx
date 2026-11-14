import type { OrderView, PendingApprovalsResponse } from '@rp/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SERVICE } from './dashboard-fixture.js';
import type { FakeServer } from './fake-server.js';
import { RESTAURANT_ID, STAFF } from './fakes.js';
import { expectNoAxeViolations, renderConsole, server, signsInAs, t } from './harness.js';

const ID = (n: number) => `0199a0e0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const NOW = '2026-09-26T10:00:00.000Z';
const ORDER = ID(8001);
const TIKKA = ID(8101);
const DAL = ID(8102);

const FLOOR = {
  sections: [
    {
      id: ID(8201),
      name: 'Hall',
      displayOrder: 0,
      archivedAt: null,
      updatedAt: NOW,
      tables: [
        {
          id: ID(8301),
          label: 'T4',
          capacity: 4,
          sectionId: ID(8201),
          state: 'FREE' as const,
          displayOrder: 0,
          tabletDeviceIds: [],
          archivedAt: null,
          updatedAt: NOW,
        },
      ],
    },
  ],
};

function line(id: string, name: string, quantity: number, unitPrice: number) {
  return {
    id,
    itemId: ID(Number(id.slice(-4)) + 1000),
    parentOrderItemId: null,
    name,
    variantId: null,
    variantName: null,
    modifiers: [],
    quantity,
    unitPrice,
    lineTotal: unitPrice * quantity,
    stationId: ID(8400),
    state: 'PENDING_APPROVAL' as const,
    instructions: null,
  };
}

const order: OrderView = {
  id: ORDER,
  orderNumber: 31,
  orderType: 'DINE_IN',
  source: 'TABLE_TABLET',
  status: 'OPEN',
  tableSessionId: ID(8500),
  tableId: ID(8301),
  takeawayToken: null,
  customerName: null,
  billRequestedAt: null,
  businessDate: '2026-09-26',
  createdAt: new Date(Date.now() - 3 * 60_000).toISOString(),
  note: null,
  items: [line(TIKKA, 'Paneer Tikka', 2, 28_000), line(DAL, 'Dal Makhani', 1, 24_000)],
  kots: [],
};

const pending = (orders: OrderView[]): PendingApprovalsResponse => ({
  orders: orders.map((entry) => ({
    order: entry,
    tableLabel: 'T4',
    waiterId: STAFF.WAITER.staffId,
  })),
});

function posServer(role: 'WAITER' | 'MANAGER' = 'WAITER'): FakeServer {
  // Waiting until approved or rejected: the dashboard's count reads it too (ADR-0030).
  let waiting = [order];
  return signsInAs(server(), role)
    .on('GET', '/api/v1/floor', () => ({ status: 200, body: FLOOR }))
    .on('GET', '/api/v1/tables/overview', () => ({
      status: 200,
      body: {
        tables: [
          {
            tableId: ID(8301),
            label: 'T4',
            sectionId: ID(8201),
            capacity: 4,
            state: 'FREE',
            session: null,
            activeServiceRequests: 0,
          },
        ],
      },
    }))
    .on('GET', '/api/v1/orders/pending-approval', () => ({
      status: 200,
      body: pending(waiting),
    }))
    .on('POST', `/api/v1/orders/${ORDER}/approve`, () => {
      waiting = [];
      return {
        status: 200,
        body: { ...order, items: order.items.map((item) => ({ ...item, state: 'SENT' })) },
      };
    })
    .on('POST', `/api/v1/orders/${ORDER}/reject`, () => {
      waiting = [];
      return { status: 200, body: { ...order, status: 'CANCELLED' } };
    });
}

const panel = async () =>
  within(await screen.findByRole('region', { name: t('approvals.title', { count: 1 }) }));
const title = 'Table T4 · Order 31';

beforeEach(() => {
  vi.stubGlobal('isSecureContext', true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('[ORD-004] [WTR-004] approving diners’ orders at the POS', () => {
  it('shows the waiting order above the floor and approves it in one press', async () => {
    const fake = posServer();
    const { user, container } = await renderConsole({ fake, path: '/pos', signedIn: 'WAITER' });
    const approvals = await panel();
    expect(approvals.getByText(title)).toBeVisible();
    expect(approvals.getByText('3 min ago · ₹800.00')).toBeVisible();
    expect(approvals.getByText('2 × Paneer Tikka')).toBeVisible();
    await expectNoAxeViolations(container);
    await user.click(approvals.getByRole('button', { name: t('approvals.approveOf', { title }) }));
    expect(await screen.findByText(t('approvals.approved', { number: 31 }))).toBeVisible();
    expect(fake.callsTo('POST', `/api/v1/orders/${ORDER}/approve`)[0]?.body).toEqual({
      changes: [],
      dinerAgreed: false,
    });
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: t('approvals.title', { count: 1 }) })).toBeNull();
    });
  });

  it('changes a quantity once the diner agreed', async () => {
    const fake = posServer();
    const { user } = await renderConsole({ fake, path: '/pos', signedIn: 'WAITER' });
    const approvals = await panel();
    await user.click(approvals.getByRole('button', { name: t('approvals.changeOf', { title }) }));
    const dialog = within(
      await screen.findByRole('dialog', { name: t('approvals.changeOf', { title }) }),
    );
    const tikka = within(
      dialog.getByRole('group', { name: t('approvals.quantityOf', { name: 'Paneer Tikka' }) }),
    );
    await user.click(tikka.getByRole('button', { name: t('pos.item.fewer') }));
    const approve = dialog.getByRole('button', { name: t('approvals.approveChanges') });
    expect(approve).toBeDisabled();
    await user.click(dialog.getByRole('checkbox', { name: t('approvals.dinerAgreed') }));
    await user.click(approve);
    await waitFor(() => {
      expect(fake.callsTo('POST', `/api/v1/orders/${ORDER}/approve`)[0]?.body).toEqual({
        changes: [{ orderItemId: TIKKA, quantity: 1 }],
        dinerAgreed: true,
      });
    });
  });

  it('rejects with a reason', async () => {
    const fake = posServer();
    const { user } = await renderConsole({ fake, path: '/pos', signedIn: 'WAITER' });
    const approvals = await panel();
    await user.click(approvals.getByRole('button', { name: t('approvals.rejectOf', { title }) }));
    const dialog = within(
      await screen.findByRole('dialog', { name: t('approvals.rejectOf', { title }) }),
    );
    await user.type(dialog.getByLabelText(t('approvals.reason')), 'Kitchen closed');
    await user.click(dialog.getByRole('button', { name: t('approvals.rejectConfirm') }));
    expect(await screen.findByText(t('approvals.rejected', { number: 31 }))).toBeVisible();
    expect(fake.callsTo('POST', `/api/v1/orders/${ORDER}/reject`)[0]?.body).toEqual({
      reason: 'Kitchen closed',
    });
  });
});

describe('[ORD-004] [MGR-002] approving on the manager dashboard (P9-10)', () => {
  it('shows the waiting order first on the overview and approves it there', async () => {
    const fake = posServer('MANAGER')
      .on('GET', '/api/v1/order-feed', () => ({ status: 200, body: SERVICE }))
      .on('GET', '/api/v1/alerts', () => ({ status: 200, body: { alerts: [] } }));
    const { user } = await renderConsole({ fake, path: '/manage/overview', signedIn: 'MANAGER' });
    const approvals = await panel();
    expect(approvals.getByText('2 × Paneer Tikka')).toBeVisible();
    await user.click(approvals.getByRole('button', { name: t('approvals.approveOf', { title }) }));
    expect(await screen.findByText(t('approvals.approved', { number: 31 }))).toBeVisible();
  });

  it('counts it beside Modifications, where it is approved, until none waits (ADR-0030)', async () => {
    const fake = posServer('MANAGER');
    const { user, sockets } = await renderConsole({ fake, path: '/manage', signedIn: 'MANAGER' });
    const nav = within(await screen.findByRole('navigation', { name: t('dashboard.navigation') }));
    const modifications = await nav.findByRole('link', {
      name: `${t('dashboard.section.modifications')}, ${t('dashboard.badge', { count: 1 })}`,
    });
    await user.click(modifications);
    expect(
      await screen.findByRole('heading', { name: t('modifications.title') }),
    ).toBeInTheDocument();
    const approvals = await panel();
    await user.click(approvals.getByRole('button', { name: t('approvals.approveOf', { title }) }));
    expect(await screen.findByText(t('modifications.none'))).toBeVisible();
    // The approval reaches every screen as an event: the count goes with it.
    act(() => {
      sockets.sync(0);
      sockets.last.fire('event', {
        sequence: 1,
        event: {
          eventId: '0199a0e0-0000-7000-8000-0000000000e1',
          type: 'OrderApproved',
          version: 1,
          occurredAt: new Date().toISOString(),
          restaurantId: RESTAURANT_ID,
          businessDate: '2026-09-26',
          payload: { orderId: ORDER, approvedBy: STAFF.MANAGER.staffId },
        },
      });
    });
    expect(
      await nav.findByRole('link', { name: t('dashboard.section.modifications') }),
    ).toBeInTheDocument();
  });
});
