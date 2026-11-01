import type { AlertView, OrderView } from '@rp/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  alertEvent,
  alertView,
  billForManagers,
  diskForOwner,
  escalatedFood,
  kitchenFlag,
  nudgeToRavi,
  waterForRavi,
} from './alerts-fixture.js';
import type { FakeServer } from './fake-server.js';
import { STAFF } from './fakes.js';
import { expectNoAxeViolations, renderConsole, server, signsInAs, t } from './harness.js';

/** A server whose alert list answers each read in turn (the last one again after that). */
function alertsServer(role: keyof typeof STAFF, ...reads: AlertView[][]): FakeServer {
  return signsInAs(server(), role).on(
    'GET',
    '/api/v1/alerts',
    ...reads.map((alerts) => () => ({ status: 200, body: { alerts } })),
  );
}

const group = (name: string) => screen.findByRole('region', { name });
const toasts = () => screen.getByRole('region', { name: t('ui.toast.region') });
const alertsButton = (count: number) =>
  screen.findByRole('button', { name: t('alerts.centre.button', { count }) });
const acknowledgeOf = (title: string) =>
  screen.findByRole('button', { name: t('alerts.acknowledgeOf', { title }) });

beforeEach(() => {
  vi.stubGlobal('isSecureContext', true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('[MGR-008] the alert centre on the manager dashboard', () => {
  it('[KDS-006] shows every open alert in groups, what asks for the manager first', async () => {
    const fake = alertsServer('MANAGER', [
      diskForOwner,
      nudgeToRavi,
      waterForRavi,
      kitchenFlag,
      escalatedFood,
    ]);
    const { container } = await renderConsole({
      fake,
      path: '/manage/alerts',
      signedIn: 'MANAGER',
    });

    const mine = await group(
      t('alerts.centre.groupHeading', { group: t('alerts.centre.groups.mine'), count: 2 }),
    );
    const rows = within(mine).getAllByRole('listitem');
    // Escalated first; the kitchen's flag for the manager (KDS-006) with its KOT and dishes.
    expect(rows[0]).toHaveTextContent('Table 5 · Food ready');
    expect(rows[0]).toHaveTextContent(t('alerts.centre.escalated'));
    expect(rows[0]).toHaveTextContent(t('alerts.reminded', { count: 2 }));
    expect(rows[1]).toHaveTextContent('Table 4 · Food waiting at the pass');
    expect(rows[1]).toHaveTextContent('KOT 12: Dal Makhani');

    const tables = await group(
      t('alerts.centre.groupHeading', { group: t('alerts.centre.groups.tables'), count: 1 }),
    );
    expect(tables).toHaveTextContent('Table 7 · Water requested');
    expect(tables).toHaveTextContent(t('alerts.for', { name: 'Ravi' }));
    const staff = await group(
      t('alerts.centre.groupHeading', { group: t('alerts.centre.groups.staff'), count: 1 }),
    );
    expect(staff).toHaveTextContent('Come to counter');
    expect(staff).toHaveTextContent(t('alerts.from', { name: 'Meera' }));
    const system = await group(
      t('alerts.centre.groupHeading', { group: t('alerts.centre.groups.system'), count: 1 }),
    );
    expect(system).toHaveTextContent(t('alerts.type.DISK_OR_BACKUP'));
    expect(system).toHaveTextContent(t('alerts.for', { name: 'Kunal' }));

    // The header counts what asks for the manager, not everything they look over.
    expect(await alertsButton(2)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('[NTF-004] acknowledges an alert for everyone and takes it off', async () => {
    const fake = alertsServer('MANAGER', [kitchenFlag, waterForRavi], [waterForRavi]).on(
      'POST',
      `/api/v1/alerts/${kitchenFlag.id}/acknowledge`,
      () => ({
        status: 200,
        body: { ...kitchenFlag, status: 'ACKNOWLEDGED', acknowledgedAt: kitchenFlag.createdAt },
      }),
    );
    const { user } = await renderConsole({ fake, path: '/manage/alerts', signedIn: 'MANAGER' });

    await user.click(await acknowledgeOf('Table 4 · Food waiting at the pass'));
    await waitFor(() => {
      expect(screen.queryByText('Table 4 · Food waiting at the pass')).toBeNull();
    });
    expect(fake.callsTo('POST', `/api/v1/alerts/${kitchenFlag.id}/acknowledge`)).toHaveLength(1);
    // A manager may acknowledge a waiter's alert too; it is still there until someone does.
    expect(screen.getByText('Table 7 · Water requested')).toBeInTheDocument();
    expect(await alertsButton(0)).toBeInTheDocument();
  });

  it('[NTF-004] says why an alert was not acknowledged and keeps it', async () => {
    const fake = alertsServer('MANAGER', [kitchenFlag]).on(
      'POST',
      `/api/v1/alerts/${kitchenFlag.id}/acknowledge`,
      () => ({
        status: 404,
        body: { code: 'ALERT_NOT_FOUND', message: 'There is no such alert for you.' },
      }),
    );
    const { user } = await renderConsole({ fake, path: '/manage/alerts', signedIn: 'MANAGER' });

    await user.click(await acknowledgeOf('Table 4 · Food waiting at the pass'));
    expect(
      await screen.findByText(
        t('alerts.acknowledgeFailed', { message: 'There is no such alert for you.' }),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Table 4 · Food waiting at the pass')).toBeInTheDocument();
    expect(await acknowledgeOf('Table 4 · Food waiting at the pass')).toBeEnabled();
  });

  it('says when there is nothing open', async () => {
    await renderConsole({
      fake: signsInAs(server(), 'MANAGER'),
      path: '/manage/alerts',
      signedIn: 'MANAGER',
    });
    expect(await screen.findByText(t('alerts.centre.none'))).toBeInTheDocument();
    expect(await alertsButton(0)).toBeInTheDocument();
  });

  it('offers to try again when the alerts cannot be read', async () => {
    const fake = signsInAs(server(), 'MANAGER').on(
      'GET',
      '/api/v1/alerts',
      () => ({ status: 503, body: { code: 'UNAVAILABLE', message: 'The server is starting.' } }),
      () => ({ status: 200, body: { alerts: [kitchenFlag] } }),
    );
    const { user } = await renderConsole({ fake, path: '/manage/alerts', signedIn: 'MANAGER' });
    expect(await screen.findByText(t('alerts.centre.loadFailed'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('states.retry') }));
    expect(await screen.findByText('Table 4 · Food waiting at the pass')).toBeInTheDocument();
  });
});

describe('[MGR-008] [NTF-006] alerts on the POS, live', () => {
  it('pops up a new alert for the manager at the POS, counts it and opens the alert centre', async () => {
    const fake = alertsServer('MANAGER', [], [billForManagers]);
    const { user, sockets } = await renderConsole({ fake, path: '/pos', signedIn: 'MANAGER' });
    expect(await alertsButton(0)).toBeInTheDocument();

    act(() => {
      sockets.sync(0);
      sockets.last.fire('event', alertEvent(1, 'AlertRaised', billForManagers));
    });
    const toast = await within(toasts()).findByRole('status');
    expect(toast).toHaveTextContent('Table 7 · Bill requested');
    expect(toast).toHaveTextContent('Asked on the table tablet');
    expect(await alertsButton(1)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t('alerts.centre.show') }));
    const sheet = await screen.findByRole('dialog', { name: t('alerts.title') });
    expect(
      within(sheet).getByRole('button', {
        name: t('alerts.acknowledgeOf', { title: 'Table 7 · Bill requested' }),
      }),
    ).toBeInTheDocument();
    // A manager at the POS may nudge waiters (NTF-008); there is no cashier (ADR-0023).
    expect(within(sheet).getByRole('button', { name: t('alerts.nudge.open') })).toBeVisible();
  });

  it('takes an alert’s toast away once the alert is dealt with elsewhere (P9-23)', async () => {
    const food = alertView(31);
    const escalated: AlertView = {
      ...food,
      escalatedAt: food.createdAt,
      escalatedTo: [STAFF.MANAGER.staffId],
      recipientIds: [...food.recipientIds, STAFF.MANAGER.staffId],
    };
    const fake = alertsServer(
      'MANAGER',
      [],
      [escalated],
      [{ ...escalated, status: 'ACKNOWLEDGED' }],
    );
    const { sockets } = await renderConsole({ fake, path: '/pos', signedIn: 'MANAGER' });
    expect(await alertsButton(0)).toBeInTheDocument();
    act(() => {
      sockets.sync(0);
      sockets.last.fire('event', alertEvent(1, 'AlertEscalated', escalated));
    });
    // An escalation stays until dismissed...
    expect(await within(toasts()).findByRole('alert')).toHaveTextContent('Table 5 · Food ready');
    // ...unless someone deals with it meanwhile: then it goes by itself.
    act(() => {
      sockets.last.fire(
        'event',
        alertEvent(2, 'AlertAcknowledged', { ...escalated, status: 'ACKNOWLEDGED' }),
      );
    });
    await waitFor(() => {
      expect(within(toasts()).queryByRole('alert')).toBeNull();
    });
  });

  it('[NTF-005] pops up an escalation to the manager on the POS and keeps it up', async () => {
    const food = alertView(30);
    const escalated: AlertView = {
      ...food,
      escalatedAt: food.createdAt,
      escalatedTo: [STAFF.MANAGER.staffId],
      recipientIds: [...food.recipientIds, STAFF.MANAGER.staffId],
    };
    const fake = alertsServer('MANAGER', [food], [escalated]);
    const { sockets } = await renderConsole({ fake, path: '/pos', signedIn: 'MANAGER' });
    // Ravi's food is Ravi's to take: the manager is not asked, and nothing pops up.
    expect(await alertsButton(0)).toBeInTheDocument();
    expect(within(toasts()).queryByRole('alert')).toBeNull();

    act(() => {
      sockets.sync(0);
      sockets.last.fire('event', alertEvent(1, 'AlertEscalated', escalated));
    });
    const toast = await within(toasts()).findByRole('alert');
    expect(toast).toHaveTextContent('Table 5 · Food ready');
    expect(await alertsButton(1)).toBeInTheDocument();
  });

  it('opens the alert centre from the header on any POS screen', async () => {
    const fake = alertsServer('MANAGER', [billForManagers]);
    const { user } = await renderConsole({ fake, path: '/pos', signedIn: 'MANAGER' });
    await user.click(await alertsButton(1));
    const sheet = await screen.findByRole('dialog', { name: t('alerts.title') });
    expect(within(sheet).getByText('Table 7 · Bill requested')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: t('ui.dialog.close') }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: t('alerts.title') })).toBeNull();
    });
  });

  it('shows no alerts on the kitchen display', async () => {
    await renderConsole({ fake: server('KDS'), path: '/kds' });
    await screen.findByRole('heading', { level: 1, name: t('modes.kds') });
    expect(screen.queryByRole('button', { name: /^Alerts/ })).toBeNull();
  });
});

describe('[ORD-003] [ORD-004] a diner’s order waiting for approval, decided in its alert (P9-10)', () => {
  const ORDER = '0199a0e0-0000-7000-8000-000000009001';
  const approval = alertView(9, {
    type: 'ORDER_PENDING_APPROVAL',
    tableLabel: '2',
    orderId: ORDER,
    pagerText: 'T2 APPROVE',
    payload: { orderNumber: 2, source: 'QR' },
    recipientIds: [STAFF.MANAGER.staffId],
    channels: ['POS', 'DASHBOARD'],
  });
  const decided = (status: OrderView['status']): OrderView => ({
    id: ORDER,
    orderNumber: 2,
    orderType: 'DINE_IN',
    source: 'QR',
    status,
    tableSessionId: null,
    tableId: approval.tableId,
    takeawayToken: null,
    customerName: null,
    businessDate: '2026-09-27',
    createdAt: approval.createdAt,
    note: null,
    items: [],
    kots: [],
  });
  const approvalServer = () =>
    alertsServer('MANAGER', [approval], [])
      .on('POST', `/api/v1/orders/${ORDER}/approve`, () => ({
        status: 200,
        body: decided('OPEN'),
      }))
      .on('POST', `/api/v1/orders/${ORDER}/reject`, () => ({
        status: 200,
        body: decided('CANCELLED'),
      }));
  const button = (label: string) =>
    screen.findByRole('button', { name: new RegExp(`^${label} Table 2`) });

  it('approves it there: acknowledging only silenced it and the diner kept waiting', async () => {
    const fake = approvalServer();
    const { user, container } = await renderConsole({
      fake,
      path: '/manage/alerts',
      signedIn: 'MANAGER',
    });
    const approve = await button(t('approvals.approve'));
    expect(screen.queryByRole('button', { name: /^Acknowledge Table 2/ })).toBeNull();
    await expectNoAxeViolations(container);
    await user.click(approve);
    expect(await screen.findByText(t('approvals.approved', { number: 2 }))).toBeVisible();
    expect(fake.callsTo('POST', `/api/v1/orders/${ORDER}/approve`)[0]?.body).toEqual({
      changes: [],
      dinerAgreed: false,
    });
  });

  it('rejects it there with the reason the diner reads', async () => {
    const fake = approvalServer();
    const { user } = await renderConsole({ fake, path: '/manage/alerts', signedIn: 'MANAGER' });
    await user.click(await button(t('approvals.reject')));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(t('approvals.reason')), 'Kitchen closed');
    await user.click(dialog.getByRole('button', { name: t('approvals.rejectConfirm') }));
    expect(await screen.findByText(t('approvals.rejected', { number: 2 }))).toBeVisible();
    expect(fake.callsTo('POST', `/api/v1/orders/${ORDER}/reject`)[0]?.body).toEqual({
      reason: 'Kitchen closed',
    });
  });
});
