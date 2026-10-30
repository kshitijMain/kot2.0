import { act, screen, waitFor, within } from '@testing-library/react';
import { IDS, MENU } from '@rp/ordering/testing';
import { describe, expect, it } from 'vitest';
import { availabilityRows } from '../src/stock/availability-view.js';
import { RESTAURANT_ID } from './fakes.js';
import { expectNoAxeViolations, renderConsole, server, signsInAs, t } from './harness.js';

const PATH = '/manage/availability';

function stockServer(role: 'MANAGER' | 'KITCHEN' = 'MANAGER') {
  let menu = MENU;
  return signsInAs(server(), role)
    .on('GET', '/api/v1/menu', () => ({ status: 200, body: menu }))
    .on('PUT', `/api/v1/menu/items/${IDS.dal}/availability`, (call) => {
      const body = call.body as { available: boolean; stockCount: number | null };
      menu = {
        ...menu,
        items: menu.items.map((item) => (item.id === IDS.dal ? { ...item, ...body } : item)),
      };
      return { status: 200, body: { itemId: IDS.dal, ...body } };
    });
}

describe('[MENU-006] the Menu availability screen (ADR-0023)', () => {
  it('lists dishes by search and category, with out of stock said in words', () => {
    const all = availabilityRows(MENU, { search: '', categoryId: null });
    expect(all.find((row) => row.item.id === IDS.jamun)?.inStock).toBe(false);
    expect(all.find((row) => row.item.id === IDS.dal)?.inStock).toBe(true);
    expect(
      availabilityRows(MENU, { search: 'dal', categoryId: null }).map((row) => row.item.id),
    ).toEqual([IDS.dal]);
    const other = MENU.categories.find((entry) => entry.id !== MENU.items[0]?.categoryId);
    if (other !== undefined) {
      expect(
        availabilityRows(MENU, { search: '', categoryId: other.id }).every(
          (row) => row.item.categoryId === other.id,
        ),
      ).toBe(true);
    }
  });

  it('marks a dish out of stock with one press and back again, for a manager', async () => {
    const fake = stockServer();
    const { user, container } = await renderConsole({ fake, path: PATH, signedIn: 'MANAGER' });
    const list = await screen.findByRole('list', { name: t('stock.title') });
    await expectNoAxeViolations(container);
    const dal = MENU.items.find((item) => item.id === IDS.dal)?.name ?? '';
    await user.click(
      within(list).getByRole('button', { name: t('stock.markOutOf', { name: dal }) }),
    );
    expect(fake.callsTo('PUT', `/api/v1/menu/items/${IDS.dal}/availability`)[0]?.body).toEqual({
      available: false,
      stockCount: null,
    });
    expect(
      await within(list).findByRole('button', { name: t('stock.markAvailableOf', { name: dal }) }),
    ).toBeVisible();
    await user.click(
      within(list).getByRole('button', { name: t('stock.markAvailableOf', { name: dal }) }),
    );
    expect(fake.callsTo('PUT', `/api/v1/menu/items/${IDS.dal}/availability`)[1]?.body).toEqual({
      available: true,
      stockCount: null,
    });
  });

  it('follows changes made on another screen at once', async () => {
    const fake = stockServer();
    const { sockets } = await renderConsole({ fake, path: PATH, signedIn: 'MANAGER' });
    const list = await screen.findByRole('list', { name: t('stock.title') });
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

  it('is not linked for a waiter', async () => {
    await renderConsole({
      fake: signsInAs(server(), 'WAITER'),
      path: '/manage',
      signedIn: 'WAITER',
    });
    expect(screen.queryByRole('link', { name: t('dashboard.section.availability') })).toBeNull();
  });
});
