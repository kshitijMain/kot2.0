import { act, screen, waitFor, within } from '@testing-library/react';
import { IDS, MENU } from '@rp/ordering/testing';
import { describe, expect, it } from 'vitest';
import { availabilityRows } from '../src/stock/availability-view.js';
import { RESTAURANT_ID } from './fakes.js';
import { expectNoAxeViolations, renderConsole, server, signsInAs, t } from './harness.js';
import { board } from './kds-fixture.js';

const PATH = '/manage/availability';
interface Body {
  available: boolean;
  stockCount: number | null;
}

/** A server that keeps each dish's availability as the screen sets it. */
function stockServer(role: 'MANAGER' | 'KITCHEN' = 'MANAGER') {
  let menu = MENU;
  const fake = signsInAs(server(), role).on('GET', '/api/v1/menu', () => ({
    status: 200,
    body: menu,
  }));
  for (const item of MENU.items) {
    fake.on('PUT', `/api/v1/menu/items/${item.id}/availability`, (call) => {
      const body = call.body as Body;
      menu = {
        ...menu,
        items: menu.items.map((entry) => (entry.id === item.id ? { ...entry, ...body } : entry)),
      };
      return { status: 200, body: { itemId: item.id, ...body } };
    });
  }
  return fake;
}

const DAL = 'Dal Makhani';
const JAMUN = 'Gulab Jamun';
const grid = () => screen.findByRole('list', { name: t('stock.title') });
const cardOf = async (name: string) =>
  (await within(await grid()).findByRole('heading', { name })).closest('li') as HTMLElement;
const switchOf = (card: HTMLElement, name: string) =>
  within(card).getByRole('switch', { name: t('stock.availableOf', { name }) });

describe('[MENU-006] which dishes the screen shows (ADR-0031)', () => {
  it('filters by search, category and whether they are available', () => {
    const all = availabilityRows(MENU, { search: '', categoryId: null, status: 'ALL' });
    expect(all.find((row) => row.item.id === IDS.jamun)?.inStock).toBe(false);
    expect(all.find((row) => row.item.id === IDS.dal)?.inStock).toBe(true);
    expect(
      availabilityRows(MENU, { search: 'dal', categoryId: null, status: 'ALL' }).map(
        (row) => row.item.id,
      ),
    ).toEqual([IDS.dal]);
    expect(
      availabilityRows(MENU, { search: '', categoryId: null, status: 'OUT' }).map(
        (row) => row.item.id,
      ),
    ).toEqual([IDS.jamun]);
    expect(
      availabilityRows(MENU, { search: '', categoryId: IDS.starters, status: 'AVAILABLE' }).map(
        (row) => row.item.id,
      ),
    ).toEqual([IDS.tikka]);
  });
});

describe('[MENU-006] the Menu availability page (ADR-0031)', () => {
  it('shows a card per dish with one switch, and greys the ones out of stock', async () => {
    const { container } = await renderConsole({
      fake: stockServer(),
      path: PATH,
      signedIn: 'MANAGER',
    });
    expect(await screen.findByText(t('stock.intro'))).toBeVisible();
    const jamun = await cardOf(JAMUN);
    expect(jamun).toHaveAttribute('data-out', 'true');
    // The badge and the switch both say it in words.
    expect(within(jamun).getAllByText(t('stock.outBadge'))).toHaveLength(2);
    expect(switchOf(jamun, JAMUN)).toHaveAttribute('aria-checked', 'false');
    const dal = await cardOf(DAL);
    expect(dal).not.toHaveAttribute('data-out');
    expect(switchOf(dal, DAL)).toHaveAttribute('aria-checked', 'true');
    expect(within(dal).getByText('Main Course')).toBeVisible();
    await expectNoAxeViolations(container);
  });

  it('switches a dish out of stock at once, and Undo brings it back', async () => {
    const fake = stockServer();
    const { user } = await renderConsole({ fake, path: PATH, signedIn: 'MANAGER' });
    await user.click(switchOf(await cardOf(DAL), DAL));
    const put = `/api/v1/menu/items/${IDS.dal}/availability`;
    await waitFor(() => {
      expect(fake.callsTo('PUT', put)[0]?.body).toEqual({ available: false, stockCount: null });
    });
    // No dialog: a short note with Undo.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText(t('stock.markedOut', { name: DAL }))).toBeVisible();
    await waitFor(async () => {
      expect(switchOf(await cardOf(DAL), DAL)).toHaveAttribute('aria-checked', 'false');
    });
    await user.click(screen.getByRole('button', { name: t('stock.undo') }));
    await waitFor(() => {
      expect(fake.callsTo('PUT', put)[1]?.body).toEqual({ available: true, stockCount: null });
    });
    await waitFor(async () => {
      expect(switchOf(await cardOf(DAL), DAL)).toHaveAttribute('aria-checked', 'true');
    });
  });

  it('counts portions on the card: + and −, and Clear stops counting', async () => {
    const fake = stockServer();
    const { user } = await renderConsole({ fake, path: PATH, signedIn: 'MANAGER' });
    const dal = await cardOf(DAL);
    const portions = within(dal).getByRole('group', { name: t('stock.portionsOf', { name: DAL }) });
    expect(within(portions).getByText(t('stock.notCounted'))).toBeVisible();
    const more = within(portions).getByRole('button', { name: t('stock.more', { name: DAL }) });
    await user.click(more);
    await user.click(more);
    await user.click(more);
    const put = `/api/v1/menu/items/${IDS.dal}/availability`;
    // The presses are saved together, once the cook stops pressing.
    await waitFor(() => {
      expect(fake.callsTo('PUT', put)).toHaveLength(1);
    });
    expect(fake.callsTo('PUT', put)[0]?.body).toEqual({ available: true, stockCount: 3 });
    expect(await within(portions).findByText('3')).toBeVisible();
    await user.click(
      within(portions).getByRole('button', { name: t('stock.fewer', { name: DAL }) }),
    );
    await waitFor(() => {
      expect(fake.callsTo('PUT', put)[1]?.body).toEqual({ available: true, stockCount: 2 });
    });
    await user.click(
      within(portions).getByRole('button', { name: t('stock.clearOf', { name: DAL }) }),
    );
    await waitFor(() => {
      expect(fake.callsTo('PUT', put)[2]?.body).toEqual({ available: true, stockCount: null });
    });
  });

  it('filters by category and status, and marks a whole category available', async () => {
    const fake = stockServer();
    const { user } = await renderConsole({ fake, path: PATH, signedIn: 'MANAGER' });
    await grid();
    await user.click(screen.getByRole('button', { name: t('stock.filter.OUT') }));
    expect(
      within(await grid())
        .getAllByRole('heading')
        .map((heading) => heading.textContent),
    ).toEqual([JAMUN]);
    await user.click(screen.getByRole('button', { name: t('stock.filter.ALL') }));
    // No bulk action until a category is chosen.
    expect(screen.queryByRole('button', { name: /^Mark all in/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Main Course' }));
    expect(screen.getByRole('button', { name: 'Main Course' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(
      screen.getByRole('button', { name: t('stock.allAvailable', { category: 'Main Course' }) }),
    );
    await waitFor(() => {
      // Back in stock with no count left would sell out again at once: the count stops.
      expect(fake.callsTo('PUT', `/api/v1/menu/items/${IDS.jamun}/availability`)[0]?.body).toEqual({
        available: true,
        stockCount: null,
      });
    });
    // Only the dishes that were out.
    expect(fake.callsTo('PUT', `/api/v1/menu/items/${IDS.dal}/availability`)).toHaveLength(0);
    expect(
      await screen.findByText(t('stock.allMarked', { count: 1, category: 'Main Course' })),
    ).toBeVisible();
  });

  it('follows changes made on another screen at once', async () => {
    const fake = stockServer();
    const { sockets } = await renderConsole({ fake, path: PATH, signedIn: 'MANAGER' });
    const list = await grid();
    const reads = fake.callsTo('GET', '/api/v1/menu').length;
    act(() => {
      sockets.sync(0);
      sockets.last.fire('event', {
        sequence: 1,
        event: {
          eventId: '0199a0e0-0000-7000-8000-0000000000f2',
          type: 'ItemAvailabilityChanged',
          version: 1,
          occurredAt: '2026-09-26T08:40:00.000Z',
          restaurantId: RESTAURANT_ID,
          businessDate: '2026-09-26',
          payload: { itemId: IDS.dal, available: false, stockCount: null },
        },
      });
    });
    await waitFor(() => {
      expect(fake.callsTo('GET', '/api/v1/menu').length).toBeGreaterThan(reads);
    });
    expect(list).toBeVisible();
  });

  it('is a full page on the kitchen display, with the way back to the tickets', async () => {
    const fake = stockServer('KITCHEN').on('GET', '/api/v1/kds/tickets', () => ({
      status: 200,
      body: board([]),
    }));
    const { user } = await renderConsole({ fake, path: '/kds', signedIn: 'KITCHEN' });
    await user.click(await screen.findByRole('button', { name: t('stock.open') }));
    expect(await grid()).toBeVisible();
    // A page, not a side panel over the tickets.
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: t('stock.backToTickets') }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Kitchen' })).toBeVisible();
  });

  it('is not linked for a waiter', async () => {
    await renderConsole({
      fake: signsInAs(server(), 'WAITER'),
      path: '/manage',
      signedIn: 'WAITER',
    });
    expect(screen.queryByRole('link', { name: t('dashboard.section.availability') })).toBeNull();
  });
});
