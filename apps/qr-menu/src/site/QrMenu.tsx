'use client';

import type { MenuItem, OrderLineRequest, RecommendationSource } from '@rp/contracts';
import type { QrMenuDocument, QrMenuResponse, QrOrderView } from '@rp/contracts/relay';
import { formatRupees, indianMobile, type Recommendation, unitPriceOf } from '@rp/domain';
import {
  addLine,
  type CartLine,
  cartTotal,
  channelItems,
  displayPrice,
  filterMenu,
  markRejected,
  menuCategories,
  needsOptions,
  type NewCartLine,
  QR_MENU_REFRESH_MS,
  QR_ORDER_POLL_MS,
  qrBestSellers,
  requestAgainLine,
  qrOrderSettled,
  qrSuggestions,
  removeLine,
  requestLines,
  searchMenu,
  selectable,
  type TabletFilter,
  menuNote,
  updateLine,
} from '@rp/ordering';
import { Badge, Button, Icon, ThemeRoot } from '@rp/ui-web';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { BillTab } from './BillTab';
import { CartSheet } from './CartSheet';
import { I18nProvider, useT } from './i18n';
import { DishPhoto } from './DishPhoto';
import { ItemSheet } from './ItemSheet';
import { Orders, shownStatus } from './Orders';
import { PhoneGate } from './PhoneGate';
import { useServiceRequests } from './requests';
import { sourceOf, Suggestions } from './Suggestions';
import { fetchMenu, fetchOrder, RelayCallError, submitOrder } from './relay';
import { browserId, newUuid, tableValue } from './storage';

type LoadedMenu = QrMenuResponse & { document: QrMenuDocument };

const FILTERS: readonly TabletFilter[] = ['veg', 'jain', 'spicy', 'bestseller'];
/** How many suggestions a row shows (REC-005). */
const SUGGESTIONS = 4;
const NO_LINES: readonly CartLine[] = [];
const NO_ORDERS: readonly string[] = [];
const TABS = ['menu', 'orders', 'bill'] as const;
type Tab = (typeof TABS)[number];
/** How long the "accepted" banner stays (P9-04). */
const ACCEPTED_BANNER_MS = 8_000;

/**
 * The QR menu page (P5-05, P9-04; QR-002, QR-004 to QR-008, QR-011): a welcome that asks for the
 * diner's mobile number, then three tabs: the menu with search, filters, dishes and the cart; My
 * orders with where each is and "Order again"; and the Bill, paid by UPI once it is printed. The
 * table comes from the code alone. Read-only with a banner while the restaurant is not heard from.
 */
export function QrMenu(props: {
  token: string;
  relayUrl: string;
  initial: LoadedMenu;
  /** The first view was shared with an earlier visitor: ask the relay for itself at once. */
  refreshAtOnce?: boolean;
}) {
  return (
    <ThemeRoot theme="light" accent={props.initial.document.accentColor} className="qr-root">
      <I18nProvider>
        <MenuPage {...props} />
      </I18nProvider>
    </ThemeRoot>
  );
}

function MenuPage({
  token,
  relayUrl,
  initial,
  refreshAtOnce = false,
}: {
  token: string;
  relayUrl: string;
  initial: LoadedMenu;
  refreshAtOnce?: boolean;
}) {
  const t = useT();
  // What was just added, for screen readers; the cart bar shows it to everyone else. (A toast
  // would cover the cart bar on a phone.)
  const [announced, setAnnounced] = useState('');
  const [menu, setMenu] = useState<LoadedMenu>(initial);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ReadonlySet<TabletFilter>>(new Set());
  const [open, setOpen] = useState<
    { readonly item: MenuItem; readonly recommendation?: RecommendationSource } | undefined
  >();
  const [cartOpen, setCartOpen] = useState(false);
  // The cart and this table's orders survive a reload (kept in this browser only).
  const cart = useMemo(
    () =>
      tableValue<readonly CartLine[]>(
        token,
        'cart',
        (value) => (Array.isArray(value) ? (value as CartLine[]) : undefined),
        NO_LINES,
      ),
    [token],
  );
  const sent = useMemo(
    () =>
      tableValue<readonly string[]>(
        token,
        'orders',
        (value) =>
          Array.isArray(value)
            ? value.filter((id): id is string => typeof id === 'string')
            : undefined,
        NO_ORDERS,
      ),
    [token],
  );
  const lines = useSyncExternalStore(cart.subscribe, cart.get, () => cart.empty);
  const orderIds = useSyncExternalStore(sent.subscribe, sent.get, () => sent.empty);
  const [note, setNote] = useState('');
  const [name, setName] = useState('');
  // P9-02: asked once at this table and kept in this browser, so a second order needs nothing.
  const phoneStore = useMemo(
    () =>
      tableValue<string>(
        token,
        'phone',
        (value) => (typeof value === 'string' ? value : undefined),
        '',
      ),
    [token],
  );
  const phone = useSyncExternalStore(phoneStore.subscribe, phoneStore.get, () => phoneStore.empty);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const pendingKey = useRef<string | undefined>(undefined);
  const [orders, setOrders] = useState<ReadonlyMap<string, QrOrderView>>(new Map());
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<Tab>('menu');
  const [skippedPhone, setSkippedPhone] = useState(false);
  const [changingPhone, setChangingPhone] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const statuses = useRef(new Map<string, QrOrderView['status']>());
  const requests = useServiceRequests(token, relayUrl);

  const document = menu.document;
  const items = useMemo(() => channelItems(document.menu, 'QR'), [document]);
  // MENU-005: combo hours by the restaurant's clock.
  const menuAt = useMemo(
    () => ({ ...document.menu, timeZone: document.menu.timeZone ?? document.timeZone }),
    [document],
  );
  const photos = useMemo(
    () => new Map(document.photos.map((photo) => [photo.photoId, photo])),
    [document],
  );
  const photoOf = (item: MenuItem) =>
    item.photoId === undefined ? undefined : photos.get(item.photoId);
  const byId = useMemo(
    () => new Map(document.menu.items.map((item) => [item.id, item])),
    [document],
  );
  const bestSellers = useMemo(() => qrBestSellers(document, new Date(now)), [document, now]);
  const shown = useMemo(
    () => filterMenu(searchMenu(items, query), filters, bestSellers),
    [items, query, filters, bestSellers],
  );
  // By menu section; a search's results stay in one list, best match first.
  const sections = useMemo(
    () =>
      query.trim() !== ''
        ? [{ id: 'results', name: t('qrSite.search'), items: shown, heading: false }]
        : menuCategories(document.menu, shown).map((category) => ({
            id: category.id,
            name: category.name,
            items: shown.filter((item) => item.categoryId === category.id),
            heading: true,
          })),
    [document, shown, query, t],
  );

  const changeLines = useCallback(
    (next: readonly CartLine[]) => {
      cart.set(next.length === 0 ? NO_LINES : next);
      // A changed order is a new order: it gets a new key when sent.
      pendingKey.current = undefined;
      setMessage(undefined);
    },
    [cart],
  );

  // QR-008, NFR-P05: the menu, availability and the restaurant's presence, kept fresh, and asked
  // for at once when the diner comes back to the page (the phone's screen was off).
  const firstRefresh = useRef(refreshAtOnce);
  useEffect(() => {
    const refresh = () => {
      // The page's clock moves with the menu (combo hours, best sellers by time of day).
      setNow(Date.now());
      fetchMenu(relayUrl, token, menu.version).then(
        (fresh) => {
          setMenu((current) => ({
            ...fresh,
            document: fresh.document ?? current.document,
          }));
        },
        () => undefined,
      );
    };
    const page = globalThis.document;
    const back = () => {
      if (page.visibilityState === 'visible') refresh();
    };
    // A first view shared with an earlier visitor may be a few seconds old (RELAY-D4).
    if (firstRefresh.current) {
      firstRefresh.current = false;
      refresh();
    }
    const timer = setInterval(refresh, QR_MENU_REFRESH_MS);
    page.addEventListener('visibilitychange', back);
    return () => {
      clearInterval(timer);
      page.removeEventListener('visibilitychange', back);
    };
  }, [relayUrl, token, menu.version]);

  // QR-007: each order on its way, until it is settled.
  const unsettled = orderIds.filter((id) => {
    const order = orders.get(id);
    return order === undefined || !qrOrderSettled(order);
  });
  const unsettledKey = unsettled.join(',');
  useEffect(() => {
    if (unsettledKey === '') return;
    let stopped = false;
    const poll = () => {
      setNow(Date.now());
      for (const id of unsettledKey.split(',')) {
        fetchOrder(relayUrl, token, id).then(
          (order) => {
            if (stopped) return;
            setOrders((current) => new Map([...current, [id, order]]));
            // P9-04: "Your order is accepted", once, when the restaurant accepts it.
            const before = statuses.current.get(id);
            statuses.current.set(id, order.status);
            if (
              order.status === 'SENT_TO_KITCHEN' &&
              (before === 'SUBMITTED' || before === 'RECEIVED')
            ) {
              setAccepted(true);
              // Not every browser can (iPhones cannot); where it can, a short buzz.
              if ('vibrate' in navigator) navigator.vibrate(200);
            }
          },
          () => undefined,
        );
      }
    };
    poll();
    const timer = setInterval(poll, QR_ORDER_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [relayUrl, token, unsettledKey]);

  const add = (line: NewCartLine) => {
    changeLines(addLine(lines, line, newUuid));
    setOpen(undefined);
    setAnnounced(t('qrSite.added', { name: line.name }));
  };

  const quickAdd = (item: MenuItem, recommendation?: RecommendationSource) => {
    const def = selectable(document.menu, item);
    add({
      itemId: item.id,
      name: item.name,
      summary: '',
      quantity: 1,
      selection: {},
      instructions: '',
      unitPrice: unitPriceOf(def, {}),
      ...(recommendation !== undefined && { recommendation }),
    });
  };

  /** A suggestion pressed: added at once, or its options asked for first. */
  const pick = (item: MenuItem, suggestion: Recommendation) => {
    const recommendation = sourceOf(suggestion);
    if (needsOptions(document.menu, item)) setOpen({ item, recommendation });
    else quickAdd(item, recommendation);
  };

  const phoneAsk = document.phone ?? 'OFF';
  const send = () => {
    const mobile = phone.trim() === '' ? undefined : indianMobile(phone);
    if (
      (phoneAsk === 'REQUIRED' && mobile === undefined) ||
      (phoneAsk === 'OPTIONAL' && phone.trim() !== '' && mobile === undefined)
    ) {
      // Back to the welcome step for a number; the cart stays as it is.
      setCartOpen(false);
      setChangingPhone(true);
      return;
    }
    setSending(true);
    setMessage(undefined);
    pendingKey.current ??= newUuid();
    const trimmedNote = note.trim();
    const trimmedName = name.trim();
    submitOrder(relayUrl, token, browserId(), {
      idempotencyKey: pendingKey.current,
      lines: requestLines(lines),
      ...(trimmedNote !== '' && { orderNote: trimmedNote }),
      ...(trimmedName !== '' && { customerName: trimmedName }),
      ...(phoneAsk !== 'OFF' && mobile !== undefined && { customerPhone: mobile }),
    }).then(
      (answer) => {
        setSending(false);
        if (answer.status === 'REJECTED') {
          changeLines(markRejected(lines, answer.rejectedLines));
          setMessage(t('qrSite.cart.rejected'));
          void fetchMenu(relayUrl, token).then(
            (fresh) => {
              if (fresh.document !== null) setMenu({ ...fresh, document: fresh.document });
            },
            () => undefined,
          );
          return;
        }
        sent.set([answer.order.id, ...orderIds.filter((id) => id !== answer.order.id)]);
        statuses.current.set(answer.order.id, answer.order.status);
        setOrders((current) => new Map([...current, [answer.order.id, answer.order]]));
        changeLines([]);
        setNote('');
        setCartOpen(false);
        setTab('orders');
      },
      (failure: unknown) => {
        setSending(false);
        if (failure instanceof RelayCallError && failure.code === 'RATE_LIMITED') {
          const seconds = Number(failure.details.retryAfterSeconds ?? 60);
          setMessage(t('qrSite.errors.rateLimited', { seconds }));
        } else if (failure instanceof RelayCallError && failure.code === 'RESTAURANT_OFFLINE') {
          setMenu((current) => ({ ...current, readOnly: true }));
          setMessage(t('qrSite.errors.offline'));
        } else if (failure instanceof RelayCallError && failure.code === 'PHONE_REQUIRED') {
          setMessage(t('qrSite.errors.phoneRequired'));
        } else if (failure instanceof RelayCallError && failure.code === 'NETWORK') {
          // The same key is sent again, so a retry never orders twice (ORD-013).
          setMessage(t('qrSite.errors.network'));
        } else {
          setMessage(t('qrSite.errors.generic'));
        }
      },
    );
  };

  /** "Order again": the lines back in the cart as they were, those the menu can still serve. */
  const orderAgain = (again: readonly OrderLineRequest[]) => {
    let next: readonly CartLine[] = lines;
    let added = 0;
    for (const line of again) {
      const back = requestAgainLine(document.menu, line, 'QR', Date.now());
      if (back === undefined) continue;
      next = addLine(next, back, newUuid);
      added += back.quantity;
    }
    changeLines(next);
    setAnnounced(
      added === 0
        ? t('qrSite.orders.againNone')
        : t('qrSite.orders.againAdded', { count: added }) +
            (added < again.reduce((total, line) => total + line.quantity, 0)
              ? ` ${t('qrSite.orders.againSome')}`
              : ''),
    );
    if (added > 0) {
      setTab('menu');
      setCartOpen(true);
    }
  };

  useEffect(() => {
    if (!accepted) return;
    const timer = setTimeout(() => {
      setAccepted(false);
    }, ACCEPTED_BANNER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [accepted]);

  const count = lines.reduce((total, line) => total + line.quantity, 0);
  const shownOrders = orderIds.flatMap((id) => {
    const order = orders.get(id);
    return order === undefined ? [] : [order];
  });
  // REC-005: nothing already ordered here (unless it may be had again), the veg filter honoured.
  const { suggestions } = qrSuggestions(document, {
    ordered: [
      ...lines.map((line) => line.itemId),
      ...shownOrders.flatMap((order) => order.lines.map((line) => line.itemId)),
    ],
    vegOnly: filters.has('veg'),
    now: new Date(now),
    limit: SUGGESTIONS,
  });
  const needsChoice = (item: MenuItem) => needsOptions(document.menu, item);

  const activeOrders = shownOrders.filter((order) => {
    const status = shownStatus(order, now);
    return status === 'SUBMITTED' || status === 'RECEIVED';
  }).length;

  // P9-02, P9-04: the welcome asks for the number before anything is ordered.
  if (phoneAsk !== 'OFF' && ((phone === '' && !skippedPhone) || changingPhone)) {
    return (
      <PhoneGate
        restaurant={document.restaurantName}
        table={menu.table.label}
        ask={phoneAsk}
        initial={phone}
        onDone={(value) => {
          phoneStore.set(value);
          pendingKey.current = undefined;
          setChangingPhone(false);
        }}
        onSkip={() => {
          setSkippedPhone(true);
          setChangingPhone(false);
        }}
      />
    );
  }

  return (
    <div className="qr-page" data-tab={tab}>
      <header className="qr-header">
        <div className="qr-header__text">
          <h1 className="qr-header__name">{document.restaurantName}</h1>
          <p className="qr-header__table">
            <Icon name="users" />
            <span>{t('qrSite.table', { label: menu.table.label })}</span>
          </p>
        </div>
        {document.serviceRequests ? (
          <button
            type="button"
            className="qr-header__call"
            disabled={menu.readOnly || requests.busy !== undefined}
            onClick={() => {
              requests.ask('WAITER');
            }}
          >
            <Icon name="bell" />
            <span>{t('qrSite.help.WAITER')}</span>
          </button>
        ) : null}
      </header>
      {menu.readOnly ? (
        <p role="status" className="qr-notice qr-notice--warning qr-banner">
          {t('qrSite.readOnly')}
        </p>
      ) : null}
      {requests.latest('WAITER') === undefined ? null : (
        <p role="status" className="qr-help__status qr-call-status">
          {t('qrSite.help.line', {
            what: t('qrSite.help.WAITER'),
            status: t(`qrSite.help.status.${requests.latest('WAITER')?.status ?? 'SUBMITTED'}`, {
              reason: requests.latest('WAITER')?.rejectionReason ?? '',
            }),
          })}
        </p>
      )}
      {accepted ? (
        <p role="alert" className="qr-accepted">
          <Icon name="check" />
          <span>{t('qrSite.orders.acceptedBanner')}</span>
        </p>
      ) : null}

      <div hidden={tab !== 'menu'}>
        <div className="qr-tools">
          <label className="qr-search">
            <span className="qr-visually-hidden">{t('qrSite.search')}</span>
            <input
              type="search"
              value={query}
              placeholder={t('qrSite.searchHint')}
              aria-label={t('qrSite.search')}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          </label>
          <fieldset className="qr-filters">
            <legend className="qr-visually-hidden">{t('qrSite.filters.legend')}</legend>
            {FILTERS.filter(
              (filter) => filter !== 'bestseller' || document.recommendations !== undefined,
            ).map((filter) => (
              <label key={filter} className="qr-chip">
                <input
                  type="checkbox"
                  checked={filters.has(filter)}
                  onChange={(event) => {
                    const next = new Set(filters);
                    if (event.target.checked) next.add(filter);
                    else next.delete(filter);
                    setFilters(next);
                  }}
                />
                <span>{t(`qrSite.filters.${filter}`)}</span>
              </label>
            ))}
          </fieldset>
          {sections.length > 1 && query === '' ? (
            <nav className="qr-categories" aria-label={t('qrSite.categories')}>
              {sections.map((section) => (
                <a key={section.id} href={`#c-${section.id}`}>
                  {section.name}
                </a>
              ))}
            </nav>
          ) : null}
        </div>

        <main>
          {query.trim() === '' ? (
            <Suggestions
              title={count === 0 ? t('reco.row.menu') : t('reco.row.cart')}
              suggestions={suggestions}
              items={byId}
              readOnly={menu.readOnly}
              needsChoice={needsChoice}
              onPick={pick}
            />
          ) : null}
          {shown.length === 0 ? <p className="qr-muted qr-empty">{t('qrSite.noMatch')}</p> : null}
          {sections.map((section) => (
            <section
              key={section.id}
              id={`c-${section.id}`}
              className="qr-section"
              aria-label={section.name}
            >
              {section.heading ? <h2 className="qr-section__title">{section.name}</h2> : null}
              <ul className="qr-dishes">
                {section.items.map((item) => (
                  <DishRow
                    key={item.id}
                    item={item}
                    unavailable={menuNote(menuAt, item, t, now).unavailable}
                    photo={
                      <DishPhoto
                        photo={photoOf(item)}
                        base={menu.photoBase}
                        sizes="4.5rem"
                        className="qr-dish__photo"
                      />
                    }
                    needsChoice={needsOptions(document.menu, item)}
                    readOnly={menu.readOnly}
                    onChoose={() => {
                      setOpen({ item });
                    }}
                    onAdd={() => {
                      quickAdd(item);
                    }}
                  />
                ))}
              </ul>
            </section>
          ))}
        </main>
      </div>

      {tab === 'orders' ? (
        <Orders
          orders={shownOrders}
          items={byId}
          now={now}
          readOnly={menu.readOnly}
          onAgain={orderAgain}
        />
      ) : null}
      {
        <div hidden={tab !== 'bill'}>
          <BillTab
            token={token}
            relayUrl={relayUrl}
            document={document}
            orders={shownOrders}
            requests={requests}
            readOnly={menu.readOnly}
            active={tab === 'bill'}
            now={now}
          />
        </div>
      }

      <p role="status" aria-live="polite" className="qr-visually-hidden">
        {announced}
      </p>
      {count === 0 || tab === 'bill' ? null : (
        <div className="qr-cart-bar">
          <Button
            fullWidth
            size="lg"
            onClick={() => {
              setCartOpen(true);
            }}
          >
            {t('qrSite.cart.open', { count, total: formatRupees(cartTotal(lines)) })}
          </Button>
        </div>
      )}

      <nav className="qr-tabbar" aria-label={t('qrSite.tabs.label')}>
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            className="qr-tabbar__tab"
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => {
              setTab(id);
              setNow(Date.now());
              globalThis.scrollTo({ top: 0 });
            }}
          >
            <Icon name={id === 'menu' ? 'handPlatter' : id === 'orders' ? 'inbox' : 'receipt'} />
            <span>{t(`qrSite.tabs.${id}`)}</span>
            {id === 'orders' && activeOrders > 0 ? (
              <Badge tone="info">{String(activeOrders)}</Badge>
            ) : null}
          </button>
        ))}
      </nav>

      {open === undefined ? null : (
        <ItemSheet
          menu={document.menu}
          item={open.item}
          photo={
            <DishPhoto
              photo={photoOf(open.item)}
              base={menu.photoBase}
              sizes="(min-width: 40rem) 36rem, 100vw"
              className="qr-sheet__photo"
              placeholder={false}
            />
          }
          recommendation={open.recommendation}
          instructionMaxLength={document.instructionMaxLength}
          onClose={() => {
            setOpen(undefined);
          }}
          onAdd={add}
        />
      )}
      {cartOpen ? (
        <CartSheet
          lines={lines}
          menu={document.menu}
          priceMode={document.priceMode}
          note={note}
          name={name}
          phone={phone}
          phoneAsk={phoneAsk}
          onChangePhone={() => {
            setCartOpen(false);
            setChangingPhone(true);
          }}
          readOnly={menu.readOnly}
          sending={sending}
          message={message}
          onQuantity={(id, quantity) => {
            changeLines(updateLine(lines, id, { quantity }));
          }}
          onRemove={(id) => {
            changeLines(removeLine(lines, id));
          }}
          onNote={setNote}
          onName={setName}
          onSend={send}
          onClose={() => {
            setCartOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function DishRow({
  item,
  unavailable,
  photo,
  needsChoice,
  readOnly,
  onChoose,
  onAdd,
}: {
  item: MenuItem;
  /** Why it cannot be ordered now (sold out, off, or a combo outside its hours). */
  unavailable: string | undefined;
  /** Its photo, when the restaurant has one at the relay. */
  photo: ReactNode;
  needsChoice: boolean;
  readOnly: boolean;
  onChoose: () => void;
  onAdd: () => void;
}) {
  const t = useT();
  const foodType =
    item.foodType === 'VEG'
      ? t('qrSite.veg')
      : item.foodType === 'EGG'
        ? t('qrSite.egg')
        : t('qrSite.nonVeg');
  return (
    <li className="qr-dish" data-unavailable={unavailable === undefined ? undefined : true}>
      {photo}
      <div className="qr-dish__what">
        <p className="qr-dish__name">
          <span className="rp-food-mark" data-food={item.foodType} title={foodType} />
          <span>{item.name}</span>
          <span className="qr-visually-hidden">{foodType}</span>
        </p>
        {item.description === undefined ? null : (
          <p className="qr-dish__description">{item.description}</p>
        )}
        <p className="qr-dish__facts">
          <span className="qr-dish__price">{formatRupees(displayPrice(item))}</span>
          {item.spiceLevel > 0 ? (
            <span className="qr-muted">{t('qrSite.spice', { level: item.spiceLevel })}</span>
          ) : null}
        </p>
      </div>
      <div className="qr-dish__action">
        {unavailable !== undefined ? (
          <span className="qr-dish__unavailable">{unavailable}</span>
        ) : needsChoice ? (
          <Button
            variant="secondary"
            disabled={readOnly}
            aria-label={t('qrSite.chooseOf', { name: item.name })}
            onClick={onChoose}
          >
            {t('qrSite.choose')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            disabled={readOnly}
            aria-label={t('qrSite.addOf', { name: item.name })}
            onClick={onAdd}
          >
            {t('qrSite.add')}
          </Button>
        )}
      </div>
    </li>
  );
}
