import '@testing-library/jest-dom/vitest';
import type { MenuItem, OrderLineRequest } from '@rp/contracts';
import type { QrMenuDocument, QrOrderView, QrTableBill } from '@rp/contracts/relay';
import { en } from '@rp/i18n';
import { IDS, MENU } from '@rp/ordering/testing';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BillTab, orderedSoFar } from '../src/site/BillTab';
import { PhoneGate } from '../src/site/PhoneGate';
import type { ServiceRequests } from '../src/site/requests';
import { DishPhoto } from '../src/site/DishPhoto';
import { I18nProvider } from '../src/site/i18n';
import { Orders } from '../src/site/Orders';
import { orderStep } from '../src/site/progress';
import { browserId, newUuid, tableValue } from '../src/site/storage';
import { throughNgrok } from '../src/site/relay';
import { contentSecurityPolicy, newNonce } from '../src/proxy';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('[QR-013] what the browser may load', () => {
  it('allows this site and the relay only', () => {
    const csp = contentSecurityPolicy('https://abc.supabase.co', newNonce());
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/https:\/\/(?!abc\.supabase\.co)/);
  });

  it('[SEC-017] runs scripts with the request’s nonce only, never inline ones', () => {
    const nonce = newNonce();
    const csp = contentSecurityPolicy('https://abc.supabase.co', nonce);
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}';`);
    expect(csp).not.toContain('strict-dynamic');
    expect(csp).toContain(`style-src 'self' 'nonce-${nonce}'`);
    // Only style attributes (the accent colour) are inline, and they run nothing.
    expect(csp.match(/'unsafe-inline'/g)).toEqual(["'unsafe-inline'"]);
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
    expect(csp).not.toContain('unsafe-eval');
    // A new nonce for each request: 128 random bits in base64, as Next.js reads it.
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(new Set(Array.from({ length: 50 }, newNonce)).size).toBe(50);
  });
});

describe('[MENU-008] [QR-012] a dish’s photo', () => {
  const photo = {
    photoId: IDS.dal,
    sizes: [
      { width: 160, height: 120, path: 'tenant/photo/160.webp' },
      { width: 480, height: 360, path: 'tenant/photo/480.webp' },
    ],
  };
  const base = 'https://abc.supabase.co/storage/v1/object/public/menu-photos';

  it('lets the browser pick the size it needs, lazily, and says nothing to a screen reader', () => {
    const { container } = render(
      <DishPhoto photo={photo} base={base} sizes="4.5rem" className="qr-dish__photo" />,
    );
    const image = container.querySelector('img');
    expect(image).toHaveAttribute('src', `${base}/tenant/photo/160.webp`);
    expect(image).toHaveAttribute(
      'srcset',
      `${base}/tenant/photo/160.webp 160w, ${base}/tenant/photo/480.webp 480w`,
    );
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('width', '160');
  });

  it('shows the shared placeholder without a photo or when the relay keeps none', () => {
    for (const [given, at] of [
      [undefined, base],
      [photo, null],
    ] as const) {
      const { container } = render(
        <DishPhoto photo={given} base={at} sizes="1rem" className="qr-dish__photo" />,
      );
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('.rp-dish-photo.qr-dish__photo')).toHaveAttribute(
        'data-placeholder',
      );
      expect(container.querySelector('.rp-dish-photo__plate')).toHaveAttribute(
        'aria-hidden',
        'true',
      );
    }
  });

  it('shows nothing in the dish sheet without a photo', () => {
    const { container } = render(
      <DishPhoto photo={undefined} base={base} sizes="1rem" className="x" placeholder={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('[QR-006] [QR-013] what the browser keeps', () => {
  it('keeps one anonymous id for the rate limit', () => {
    const id = browserId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(browserId()).toBe(id);
  });

  it('keeps the cart per table, without the whole code, and survives bad data', () => {
    const token = 'AbCdEfGhIjKlMnOpQrStUv';
    const cart = tableValue<readonly string[]>(
      token,
      'cart',
      (value) => (Array.isArray(value) ? (value as string[]) : undefined),
      [],
    );
    cart.set(['a']);
    expect(Object.keys(window.localStorage).join()).not.toContain(token);
    const again = tableValue<readonly string[]>(
      token,
      'cart',
      (value) => (Array.isArray(value) ? (value as string[]) : undefined),
      [],
    );
    expect(again.get()).toEqual(['a']);
    window.localStorage.setItem('rp.qr.cart.v1.AbCdEfGh', '{not json');
    const broken = tableValue<readonly string[]>(token, 'cart', () => undefined, []);
    expect(broken.get()).toEqual([]);
  });
});

describe('[QR-007] where an order is', () => {
  const items = new Map<string, MenuItem>(MENU.items.map((item) => [item.id, item]));
  const order = (overrides: Partial<QrOrderView>): QrOrderView => ({
    id: '0199a0e0-0000-7000-8000-000000000a01',
    status: 'SUBMITTED',
    submittedAt: '2026-10-02T08:00:00.000Z',
    expiresAt: '2026-10-02T08:01:00.000Z',
    lines: [
      {
        clientLineId: '0199a0e0-0000-7000-8000-000000000b01',
        itemId: IDS.dal,
        quantity: 2,
        modifiers: [],
      },
    ],
    orderNote: null,
    customerName: null,
    detail: {},
    ...overrides,
  });
  const again: (readonly OrderLineRequest[])[] = [];
  const onAgain = (lines: readonly OrderLineRequest[]) => {
    again.push(lines);
  };
  const show = (orders: QrOrderView[], now: number) =>
    render(
      <I18nProvider>
        <Orders orders={orders} items={items} now={now} readOnly={false} onAgain={onAgain} />
      </I18nProvider>,
    );

  it('says it is on its way, and says to call a waiter once the pickup time passed', () => {
    const { rerender } = show([order({})], Date.parse('2026-10-02T08:00:30.000Z'));
    expect(screen.getByText(en.qrSite.orders.SUBMITTED)).toBeVisible();
    expect(screen.getByText('2 × Dal Makhani')).toBeVisible();
    rerender(
      <I18nProvider>
        <Orders
          orders={[order({})]}
          items={items}
          now={Date.parse('2026-10-02T08:01:01.000Z')}
          readOnly={false}
          onAgain={onAgain}
        />
      </I18nProvider>,
    );
    expect(screen.getByText(en.qrSite.orders.EXPIRED)).toBeVisible();
  });

  it('shows each dish’s state in the kitchen, and why an order was not taken', () => {
    show(
      [
        order({
          status: 'SENT_TO_KITCHEN',
          detail: {
            items: [{ clientLineId: '0199a0e0-0000-7000-8000-000000000b01', state: 'READY' }],
          },
        }),
        order({
          id: '0199a0e0-0000-7000-8000-000000000a02',
          status: 'REJECTED',
          detail: { rejectionReason: 'The kitchen is closing' },
        }),
      ],
      Date.parse('2026-10-02T08:00:30.000Z'),
    );
    // Every dish is ready: the banner says so, not only that it was accepted (P9-23).
    expect(screen.getByText(en.qrSite.orders.stage.ready)).toBeVisible();
    // The dish's own chip; the tracker above names the step "Ready" too.
    expect(
      screen.getByText(en.qrSite.orders.itemState.READY, { selector: '.rp-status-chip' }),
    ).toBeVisible();
    expect(screen.getByText('Reason: The kitchen is closing')).toBeVisible();
  });

  it('[ORD-004] shows the number the restaurant approved when it changed it (P9-24)', () => {
    show(
      [
        order({
          status: 'SENT_TO_KITCHEN',
          detail: {
            items: [
              { clientLineId: '0199a0e0-0000-7000-8000-000000000b01', state: 'SENT', quantity: 3 },
            ],
          },
        }),
      ],
      Date.parse('2026-10-02T08:00:30.000Z'),
    );
    expect(screen.getByText('3 × Dal Makhani')).toBeVisible();
    expect(screen.getByText('Changed by the restaurant (you asked for 2)')).toBeVisible();
  });

  it('[QR-004] orders a whole order, or one dish, again (P9-04)', () => {
    again.length = 0;
    show([order({ status: 'SENT_TO_KITCHEN' })], Date.parse('2026-10-02T08:00:30.000Z'));
    fireEvent.click(screen.getByRole('button', { name: en.qrSite.orders.again }));
    expect(again.at(-1)?.map((line) => [line.itemId, line.quantity])).toEqual([[IDS.dal, 2]]);
    fireEvent.click(screen.getByRole('button', { name: 'Add Dal Makhani again' }));
    expect(again.at(-1)?.map((line) => [line.itemId, line.quantity])).toEqual([[IDS.dal, 1]]);
  });

  it('[QR-007] tracks an order from sent to served, step by step (P9-09)', () => {
    const line = '0199a0e0-0000-7000-8000-000000000b01';
    const other = '0199a0e0-0000-7000-8000-000000000b02';
    type ItemState = NonNullable<QrOrderView['detail']['items']>[number]['state'];
    const kitchen = (...states: ItemState[]): QrOrderView =>
      order({
        status: 'SENT_TO_KITCHEN',
        detail: {
          items: states.map((state, index) => ({
            clientLineId: index === 0 ? line : other,
            state,
          })),
        },
      });
    expect(orderStep(order({}))).toBe(0);
    expect(orderStep(order({ status: 'RECEIVED' }))).toBe(0);
    expect(orderStep(order({ status: 'SENT_TO_KITCHEN' }))).toBe(1);
    expect(orderStep(kitchen('SENT', 'PREPARING'))).toBe(2);
    // Ready only when every dish still coming is ready; a cancelled dish does not hold it back.
    expect(orderStep(kitchen('READY', 'PREPARING'))).toBe(2);
    expect(orderStep(kitchen('READY', 'CANCELLED'))).toBe(3);
    expect(orderStep(kitchen('SERVED', 'READY'))).toBe(3);
    expect(orderStep(kitchen('SERVED', 'SERVED'))).toBe(4);
    expect(orderStep(order({ status: 'REJECTED' }))).toBeUndefined();
    // An order past its pickup time reads EXPIRED and leaves the tracker.
    expect(orderStep(order({}), 'EXPIRED')).toBeUndefined();

    show([kitchen('READY', 'PREPARING')], Date.parse('2026-10-02T08:00:30.000Z'));
    const tracker = screen.getByRole('list', { name: en.qrSite.progress.label });
    const current = tracker.querySelector('[aria-current="step"]');
    expect(current).toHaveTextContent(en.qrSite.progress.preparing);
    expect(current).toHaveAttribute('data-state', 'done');
    expect(tracker.querySelector('[data-state="next"]')).toHaveTextContent(
      en.qrSite.progress.ready,
    );
  });

  it('shows no tracker for an order that was not taken', () => {
    show(
      [order({ status: 'REJECTED', detail: { rejectionReason: 'Closed' } })],
      Date.parse('2026-10-02T08:00:30.000Z'),
    );
    expect(screen.queryByRole('list', { name: en.qrSite.progress.label })).toBeNull();
  });

  it('says plainly when there is nothing yet, and leads back to the menu (P9-11)', () => {
    const onBrowse = vi.fn();
    render(
      <I18nProvider>
        <Orders
          orders={[]}
          items={items}
          now={Date.now()}
          readOnly={false}
          onAgain={onAgain}
          onBrowse={onBrowse}
        />
      </I18nProvider>,
    );
    expect(screen.getByText(en.qrSite.orders.emptyTitle)).toBeVisible();
    expect(screen.getByText(en.qrSite.orders.empty)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: en.qrSite.browse }));
    expect(onBrowse).toHaveBeenCalledTimes(1);
  });

  it('[QR-007] looks again on Refresh, and says when it last heard (P9-13)', () => {
    const onRefresh = vi.fn();
    render(
      <I18nProvider>
        <Orders
          orders={[order({ status: 'RECEIVED' })]}
          items={items}
          now={Date.parse('2026-10-02T08:00:30.000Z')}
          readOnly={false}
          heardAt={Date.parse('2026-10-02T08:00:30.000Z')}
          onAgain={onAgain}
          onRefresh={onRefresh}
        />
      </I18nProvider>,
    );
    expect(screen.getByText(/^Updated /)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: en.qrSite.orders.refresh }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('[NFR-U04] says it is looking, not "nothing yet", while the orders are looked up (P9-11)', () => {
    render(
      <I18nProvider>
        <Orders
          orders={[]}
          items={items}
          now={Date.now()}
          readOnly={false}
          loading
          onAgain={onAgain}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent(en.qrSite.orders.loading);
    expect(screen.queryByText(en.qrSite.orders.empty)).toBeNull();
  });
});

describe('[BILL-011] the welcome step and the mobile number (P9-02, P9-04)', () => {
  it('takes a 10-digit mobile as +91, refuses anything else, and cannot be skipped when required', () => {
    const done = vi.fn();
    render(
      <I18nProvider>
        <PhoneGate
          restaurant="Mannat"
          table="T3"
          ask="REQUIRED"
          initial=""
          onDone={done}
          onSkip={() => undefined}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Mannat' })).toBeVisible();
    expect(screen.getByText('You’re at table T3')).toBeVisible();
    expect(screen.queryByRole('button', { name: en.qrSite.welcome.skip })).toBeNull();
    const field = screen.getByLabelText(new RegExp(`^${en.qrSite.cart.phone}`));
    fireEvent.change(field, { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: en.qrSite.welcome.start }));
    expect(screen.getByText(en.qrSite.cart.phoneInvalid)).toBeVisible();
    expect(done).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: '98765 43210' } });
    fireEvent.click(screen.getByRole('button', { name: en.qrSite.welcome.start }));
    expect(done).toHaveBeenCalledWith('+919876543210');
  });

  it('can be skipped where the restaurant makes it optional', () => {
    const skip = vi.fn();
    render(
      <I18nProvider>
        <PhoneGate
          restaurant="Mannat"
          table="T3"
          ask="OPTIONAL"
          initial=""
          onDone={() => undefined}
          onSkip={skip}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: en.qrSite.welcome.skip }));
    expect(skip).toHaveBeenCalled();
  });
});

describe('[QR-011] the bill on the diner’s phone and UPI (P9-03, P9-04)', () => {
  const document = {
    restaurantName: 'Mannat',
    timeZone: 'Asia/Kolkata',
    instructionMaxLength: 140,
    priceMode: 'TAX_EXCLUSIVE',
    serviceRequests: true,
    menu: MENU,
    photos: [],
  } satisfies QrMenuDocument;
  const sentOrder = (status: QrOrderView['status']): QrOrderView => ({
    id: '0199a0e0-0000-7000-8000-000000000a09',
    status,
    submittedAt: '2026-10-02T08:00:00.000Z',
    expiresAt: '2099-10-02T08:01:00.000Z',
    lines: [
      {
        clientLineId: '0199a0e0-0000-7000-8000-000000000b09',
        itemId: IDS.dal,
        quantity: 2,
        modifiers: [],
      },
    ],
    orderNote: null,
    customerName: null,
    detail: {},
  });
  const requests = (asked: string[] = []): ServiceRequests => ({
    latest: () => undefined,
    open: () => false,
    ask: (type) => {
      asked.push(type);
    },
    busy: undefined,
    failed: false,
  });
  const printed: QrTableBill = {
    invoices: [
      {
        invoiceNumber: 'INV/26-27/000007',
        issuedAt: '2026-10-02T09:00:00.000Z',
        status: 'ISSUED',
        lines: [{ description: 'Dal Makhani', quantity: 2, amount: 56_000 }],
        subtotal: 56_000,
        discountTotal: 0,
        serviceCharge: 0,
        taxLines: [
          { label: 'CGST 2.5%', amount: 1_400 },
          { label: 'SGST 2.5%', amount: 1_400 },
        ],
        roundOff: 2_400,
        grandTotal: 61_200,
      },
    ],
    upi: { upiId: 'mannat@okhdfcbank', payeeName: 'Mannat' },
  };
  const TOKEN = 't'.repeat(22);
  const answer = (bill: QrTableBill | null) =>
    vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ bill, updatedAt: null }), { status: 200 }));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('estimates what was ordered so far, leaving out orders not taken', () => {
    const { lines } = orderedSoFar(
      document,
      [
        sentOrder('SENT_TO_KITCHEN'),
        { ...sentOrder('REJECTED'), id: '0199a0e0-0000-7000-8000-000000000a10' },
      ],
      Date.now(),
    );
    expect(lines.map((line) => [line.itemId, line.quantity])).toEqual([[IDS.dal, 2]]);
  });

  it('asks for the bill before it is printed', async () => {
    answer(null);
    const asked: string[] = [];
    render(
      <I18nProvider>
        <BillTab
          token={TOKEN}
          relayUrl="https://relay.invalid/functions/v1"
          document={document}
          orders={[sentOrder('SENT_TO_KITCHEN')]}
          requests={requests(asked)}
          readOnly={false}
          active
          now={Date.now()}
        />
      </I18nProvider>,
    );
    expect(await screen.findByText(en.qrSite.bill.estimate)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: en.qrSite.help.BILL }));
    expect(asked).toEqual(['BILL']);
  });

  it('says where a bill request stands, and offers no second press while it is open (P9-23)', async () => {
    answer(null);
    const asked: string[] = [];
    const open: ServiceRequests = {
      ...requests(asked),
      latest: (type) =>
        type === 'BILL'
          ? {
              id: '0199a0e0-0000-7000-8000-000000000c01',
              type: 'BILL',
              status: 'RECEIVED',
              submittedAt: '2026-10-02T08:00:00.000Z',
              expiresAt: '2026-10-02T08:10:00.000Z',
              rejectionReason: null,
            }
          : undefined,
      open: (type) => type === 'BILL',
    };
    render(
      <I18nProvider>
        <BillTab
          token={TOKEN}
          relayUrl="https://relay.invalid/functions/v1"
          document={document}
          orders={[sentOrder('SENT_TO_KITCHEN')]}
          requests={open}
          readOnly={false}
          active
          now={Date.now()}
        />
      </I18nProvider>,
    );
    expect(await screen.findByText(en.qrSite.help.said.BILL.RECEIVED)).toBeVisible();
    expect(screen.queryByRole('button', { name: en.qrSite.help.BILL })).toBeNull();
    // The estimate says what the taxes add to the dishes.
    expect(screen.getByText(en.qrSite.cart.tax)).toBeVisible();
  });

  it('shows the printed bill with Pay by UPI, the amount filled in, and "I have paid"', async () => {
    answer(printed);
    const asked: string[] = [];
    render(
      <I18nProvider>
        <BillTab
          token={TOKEN}
          relayUrl="https://relay.invalid/functions/v1"
          document={document}
          orders={[sentOrder('SENT_TO_KITCHEN')]}
          requests={requests(asked)}
          readOnly={false}
          active
          now={Date.now()}
        />
      </I18nProvider>,
    );
    const pay = await screen.findByRole('link', { name: /Pay ₹612\.00 with UPI/ });
    expect(pay.getAttribute('href')).toBe(
      'upi://pay?pa=mannat%40okhdfcbank&pn=Mannat&am=612.00&cu=INR&tn=Mannat%20bill%20INV%2F26-27%2F000007',
    );
    expect(screen.getByRole('link', { name: 'PhonePe' }).getAttribute('href')).toMatch(
      /^phonepe:\/\/pay\?pa=mannat%40okhdfcbank&pn=Mannat&am=612\.00/,
    );
    expect(screen.getByRole('img', { name: /QR code to pay ₹612\.00/ })).toBeVisible();
    expect(screen.getByText('CGST 2.5%')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: en.qrSite.help.PAID }));
    expect(asked).toEqual(['PAID']);
  });

  it('says thanks once the bill it showed is settled and gone', async () => {
    const fetch = answer(printed);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <I18nProvider>
        <BillTab
          token={TOKEN}
          relayUrl="https://relay.invalid/functions/v1"
          document={document}
          orders={[]}
          requests={requests()}
          readOnly={false}
          active
          now={Date.now()}
        />
      </I18nProvider>,
    );
    await screen.findByText(en.qrSite.bill.total);
    fetch.mockResolvedValue(new Response(JSON.stringify({ bill: null, updatedAt: null })));
    await vi.advanceTimersByTimeAsync(5_500);
    await waitFor(() => {
      expect(
        screen.getByText('Your bill is settled. Thank you for dining at Mannat.'),
      ).toBeVisible();
    });
    vi.useRealTimers();
  });
});

describe('[ORD-013] keys made in the browser', () => {
  it('makes v4 UUIDs on a page that is not secure too (a test over http on the Wi-Fi)', () => {
    const secure = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
    Object.defineProperty(globalThis, 'isSecureContext', { value: false, configurable: true });
    try {
      const keys = Array.from({ length: 50 }, newUuid);
      for (const key of keys) {
        expect(key).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
      }
      expect(new Set(keys).size).toBe(50);
    } finally {
      if (secure === undefined) Reflect.deleteProperty(globalThis, 'isSecureContext');
      else Object.defineProperty(globalThis, 'isSecureContext', secure);
    }
  });
});

describe('[QR-007] a relay behind ngrok (P9-16)', () => {
  it('asks ngrok for the relay, not its warning page, and only there', () => {
    expect(throughNgrok('https://abc.ngrok-free.dev/functions/v1/order-status')).toEqual({
      'ngrok-skip-browser-warning': '1',
    });
    expect(throughNgrok('https://abc.ngrok.app/functions/v1/x')).toHaveProperty(
      'ngrok-skip-browser-warning',
    );
    expect(throughNgrok('https://relay.menu.example.in/functions/v1/x')).toEqual({});
    expect(throughNgrok('http://192.168.1.20:8787/functions/v1/x')).toEqual({});
  });
});
