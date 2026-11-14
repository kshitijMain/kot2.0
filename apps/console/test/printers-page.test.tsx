import type { PrintQueuePrinter } from '@rp/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeServer } from './fake-server.js';
import { expectNoAxeViolations, renderConsole, server, signsInAs, t } from './harness.js';
import { BAR_PRINTER, KITCHEN_PRINTER, printers, printerView } from './printing-fixture.js';

/** The dashboard's Printers page (ADR-0031, item H): status, waiting tickets, Retry now. */

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const KITCHEN: PrintQueuePrinter = {
  printerId: KITCHEN_PRINTER,
  name: 'Kitchen printer',
  online: false,
  offlineSince: minutesAgo(4),
  lastError: 'The printer at 192.168.1.50:9100 refused the connection.',
  redirectToId: null,
  queued: 2,
  jobs: [
    {
      id: '0199a0e0-0000-7000-8000-0000000000d1',
      kind: 'KOT',
      label: 'KOT 14 · T3',
      stationName: 'Kitchen',
      createdAt: minutesAgo(4),
      attempts: 3,
    },
    {
      id: '0199a0e0-0000-7000-8000-0000000000d2',
      kind: 'KOT',
      label: 'KOT 15 · Takeaway #12',
      stationName: 'Kitchen',
      createdAt: minutesAgo(2),
      attempts: 2,
    },
  ],
};

const BAR: PrintQueuePrinter = {
  printerId: BAR_PRINTER,
  name: 'Bar printer',
  online: true,
  offlineSince: null,
  lastError: null,
  redirectToId: null,
  queued: 0,
  jobs: [],
};

function printersServer(queue: PrintQueuePrinter[] = [KITCHEN, BAR]): FakeServer {
  return signsInAs(server(), 'MANAGER')
    .on('GET', '/api/v1/print-queue', () => ({ status: 200, body: { printers: queue } }))
    .on('GET', '/api/v1/printers', () => ({ status: 200, body: { printers: printers() } }));
}

const card = async (name: string) =>
  (await screen.findByRole('heading', { level: 3, name })).closest('article')!;

beforeEach(() => {
  vi.stubGlobal('isSecureContext', true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('[KDS-008] the Printers page (ADR-0031)', () => {
  it('shows each printer’s state and what waits for it, oldest first', async () => {
    const { container } = await renderConsole({
      fake: printersServer(),
      signedIn: 'MANAGER',
      path: '/manage/printers',
    });
    const kitchen = within(await card('Kitchen printer'));
    expect(kitchen.getByText(t('printersPage.offline'))).toBeVisible();
    expect(kitchen.getByText(KITCHEN.lastError ?? '')).toBeVisible();
    const waiting = kitchen.getByRole('list', { name: t('printersPage.waiting', { count: 2 }) });
    expect(
      within(waiting)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining('KOT 14 · T3'),
      expect.stringContaining('KOT 15 · Takeaway #12'),
    ]);
    expect(within(await card('Bar printer')).getByText(t('printersPage.online'))).toBeVisible();
    // The count beside Printers: tickets waiting on a printer that is down.
    expect(
      screen.getByRole('link', {
        name: `${t('dashboard.section.printers')}, ${t('dashboard.badge', { count: 2 })}`,
      }),
    ).toBeVisible();
    await expectNoAxeViolations(container);
  });

  it('tries again at once on Retry now, and says when the printer is back', async () => {
    const fake = printersServer().on('POST', `/api/v1/printers/${KITCHEN_PRINTER}/retry`, () => ({
      status: 200,
      body: { ...KITCHEN, online: true, offlineSince: null, lastError: null, queued: 0, jobs: [] },
    }));
    const { user } = await renderConsole({ fake, signedIn: 'MANAGER', path: '/manage/printers' });
    const kitchen = within(await card('Kitchen printer'));
    await user.click(kitchen.getByRole('button', { name: t('printersPage.retry') }));
    expect(
      await screen.findByText(t('printersPage.retried.online', { name: 'Kitchen printer' })),
    ).toBeVisible();
    expect(fake.callsTo('POST', `/api/v1/printers/${KITCHEN_PRINTER}/retry`)).toHaveLength(1);
  });

  it('sends a broken printer’s tickets to another one, with a reason', async () => {
    const fake = printersServer().on(
      'POST',
      `/api/v1/printers/${KITCHEN_PRINTER}/redirect`,
      () => ({ status: 200, body: printerView({ redirectToId: BAR_PRINTER }) }),
    );
    const { user } = await renderConsole({ fake, signedIn: 'MANAGER', path: '/manage/printers' });
    const kitchen = within(await card('Kitchen printer'));
    await user.click(kitchen.getByRole('button', { name: t('printersPage.elsewhere') }));
    const dialog = within(
      await screen.findByRole('dialog', {
        name: t('printersPage.elsewhereTitle', { name: 'Kitchen printer' }),
      }),
    );
    await user.selectOptions(dialog.getByLabelText(t('printersPage.to')), BAR_PRINTER);
    await user.type(dialog.getByLabelText(t('printersPage.reason')), 'Paper jam');
    await user.click(dialog.getByRole('button', { name: t('printersPage.send') }));
    await waitFor(() => {
      expect(fake.callsTo('POST', `/api/v1/printers/${KITCHEN_PRINTER}/redirect`)[0]?.body).toEqual(
        { toPrinterId: BAR_PRINTER, reason: 'Paper jam' },
      );
    });
  });

  it('says when nothing waits and every printer is working', async () => {
    await renderConsole({
      fake: printersServer([
        { ...KITCHEN, online: true, offlineSince: null, lastError: null, queued: 0, jobs: [] },
      ]),
      signedIn: 'MANAGER',
      path: '/manage/printers',
    });
    expect(await screen.findByText(t('printersPage.nothingWaits'))).toBeVisible();
    expect(screen.getByRole('link', { name: t('dashboard.section.printers') })).toBeVisible();
  });
});
