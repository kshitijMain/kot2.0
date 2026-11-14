import { type MenuItem, type MenuSnapshot, type OrderView, photoUrl } from '@rp/contracts';
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  LoadingState,
  MenuItemCard,
  Money,
  QuantityStepper,
  StatusChip,
  TextField,
  useToast,
} from '@rp/ui-web';
import { useState } from 'react';
import { useConsole } from '../app/console-context.js';
import { useT } from '../app/i18n.js';
import { messageOf } from '../app/messages.js';
import { useLive } from '../app/use-live.js';
import { useNow } from '../app/use-now.js';
import {
  addLine,
  type CartLine,
  cartTotal,
  markRejected,
  removeLine,
  requestLines,
  updateLine,
} from '@rp/ordering';
import { useOpenBill } from '../billing/use-open-bill.js';
import { OverrideCancelled, useOverride } from '../billing/override.js';
import { ReasonDialog } from '../billing/ReasonDialog.js';
import { useConsoleState } from '../app/console-context.js';
import { grantOf } from '../app/modes.js';
import { ItemDialog } from './ItemDialog.js';
import { displayState, lineActions } from '@rp/ordering';
import {
  displayPrice,
  channelItems,
  menuCategories,
  menuNote,
  needsOptions,
  visibleItems,
} from '@rp/ordering';

/** Who the order is for: a seated table session, or a takeaway customer (TBL-008). */
export type OrderTarget =
  | { readonly kind: 'table'; readonly sessionId: string; readonly label: string }
  | { readonly kind: 'takeaway' };

const newId = () => crypto.randomUUID();

const affectsMenu = (type: string) =>
  type === 'MenuPublished' || type === 'ItemAvailabilityChanged';
const affectsOrders = (type: string) =>
  /^(Order|KotCreated$|ItemStatusChanged$|TableMoved$|BillSettled$)/.test(type);

/**
 * Order entry on the POS (ORD-001, MENU-012): browse or search the menu, choose options, build the
 * cart with notes, and send it to the kitchen once, however many times the button is pressed or
 * the network retries (ORD-013). What was sent shows each item's live state (ORD-010).
 */
export function OrderEntry({ target, onBack }: { target: OrderTarget; onBack: () => void }) {
  const t = useT();
  const controller = useConsole();
  const toast = useToast();
  const menu = useLive(() => controller.api.getMenu(), affectsMenu);
  const orders = useLive(
    async () =>
      target.kind === 'table'
        ? (await controller.api.listSessionOrders({ params: { sessionId: target.sessionId } }))
            .orders
        : (await controller.api.listTakeawayOrders()).orders,
    affectsOrders,
  );
  const [cart, setCart] = useState<CartLine[]>([]);
  // One key per cart: a retry after a lost answer is recognised by the server (ORD-013).
  const [idempotencyKey, setIdempotencyKey] = useState(newId);
  const [customerName, setCustomerName] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [choosing, setChoosing] = useState<MenuItem | undefined>();

  const changeCart = (next: CartLine[]) => {
    setCart(next);
    setIdempotencyKey(newId());
  };

  const send = async () => {
    setSending(true);
    setNotice(undefined);
    try {
      const result = await controller.api.submitOrder({
        body: {
          idempotencyKey,
          source: 'POS',
          orderType: target.kind === 'table' ? 'DINE_IN' : 'TAKEAWAY',
          ...(target.kind === 'table' && { tableSessionId: target.sessionId }),
          ...(target.kind === 'takeaway' &&
            customerName.trim() !== '' && { customerName: customerName.trim() }),
          lines: requestLines(cart),
        },
      });
      if (result.status === 'PARTIALLY_REJECTED') {
        setCart(markRejected(cart, result.rejectedLines));
        setIdempotencyKey(newId());
        setNotice(t('pos.result.rejected'));
        return;
      }
      let title = t('pos.result.sent', { number: result.orderNumber });
      if (target.kind === 'takeaway') {
        const order = await controller.api.getOrder({ params: { orderId: result.orderId } });
        if (order.takeawayToken !== null) {
          title = t('pos.result.takeaway', {
            token: order.takeawayToken,
            number: result.orderNumber,
          });
        }
      }
      toast.show({ title, tone: 'success' });
      setCart([]);
      setCustomerName('');
      setIdempotencyKey(newId());
      orders.reload();
    } catch (error) {
      // The same key is kept, so sending again cannot create a second order.
      setNotice(t('pos.result.notSent', { message: messageOf(error, t) }));
    } finally {
      setSending(false);
    }
  };

  const title =
    target.kind === 'table' ? t('pos.table.title', { table: target.label }) : t('pos.takeaway');

  return (
    <section className="pos-order" aria-labelledby="pos-order-title">
      <header className="pos-order__header">
        <Button variant="ghost" startIcon={<Icon name="close" />} onClick={onBack}>
          {t('pos.backToTables')}
        </Button>
        <h2 id="pos-order-title" className="pos-floor__heading">
          {title}
        </h2>
        {target.kind === 'table' ? (
          <BillButton sessionId={target.sessionId} label={target.label} />
        ) : null}
      </header>
      <div className="pos-order__body">
        <div className="pos-order__menu">
          {menu.data.status === 'loading' ? <LoadingState title={t('states.loading')} /> : null}
          {menu.data.status === 'error' ? (
            <ErrorState
              title={messageOf(menu.data.error, t)}
              action={<Button onClick={menu.reload}>{t('states.retry')}</Button>}
            />
          ) : null}
          {menu.data.status === 'ready' ? (
            <MenuBrowser
              menu={menu.data.value}
              onChoose={(item, snapshot) => {
                if (needsOptions(snapshot, item)) {
                  setChoosing(item);
                  return;
                }
                changeCart(
                  addLine(
                    cart,
                    {
                      itemId: item.id,
                      name: item.name,
                      summary: '',
                      quantity: 1,
                      selection: {},
                      instructions: '',
                      unitPrice: item.basePrice,
                    },
                    newId,
                  ),
                );
              }}
            />
          ) : null}
        </div>
        <aside className="pos-order__side" aria-label={t('pos.cart.title')}>
          <Cart lines={cart} onChange={changeCart} disabled={sending} />
          {target.kind === 'takeaway' ? (
            <TextField
              label={t('pos.cart.customer')}
              value={customerName}
              maxLength={60}
              onChange={(event) => {
                setCustomerName(event.target.value);
              }}
            />
          ) : null}
          {notice === undefined ? null : (
            <p role="alert" className="console-notice console-notice--danger">
              {notice}
            </p>
          )}
          <Button
            size="lg"
            loading={sending}
            disabled={cart.length === 0}
            onClick={() => {
              void send();
            }}
          >
            {t('pos.cart.send')}
          </Button>
          <SentOrders target={target} data={orders.data} onChanged={orders.reload} />
        </aside>
      </div>
      {choosing !== undefined && menu.data.status === 'ready' ? (
        <ItemDialog
          menu={menu.data.value}
          item={choosing}
          onClose={() => {
            setChoosing(undefined);
          }}
          onAdd={(line) => {
            changeCart(addLine(cart, line, newId));
            setChoosing(undefined);
          }}
        />
      ) : null}
    </section>
  );
}

function MenuBrowser({
  menu,
  onChoose,
}: {
  menu: MenuSnapshot;
  onChoose: (item: MenuItem, menu: MenuSnapshot) => void;
}) {
  const t = useT();
  // MENU-005: a combo shows as unavailable outside its hours.
  const now = useNow(30_000);
  const items = channelItems(menu, 'POS');
  const categories = menuCategories(menu, items);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState<string | undefined>(categories[0]?.id);
  const shown = visibleItems(items, query, categoryId);
  const anyPhoto = items.some((item) => item.photoId !== undefined);

  if (items.length === 0) return <EmptyState title={t('pos.menu.empty')} />;

  return (
    <div className="pos-menu">
      <TextField
        label={t('pos.menu.search')}
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      {query.trim() === '' ? (
        <nav aria-label={t('pos.menu.categories')} className="pos-menu__categories">
          {categories.map((category) => (
            <Button
              key={category.id}
              variant={category.id === categoryId ? 'primary' : 'secondary'}
              aria-pressed={category.id === categoryId}
              onClick={() => {
                setCategoryId(category.id);
              }}
            >
              {category.name}
            </Button>
          ))}
        </nav>
      ) : null}
      {shown.length === 0 ? (
        <EmptyState title={t('pos.menu.noResults', { query: query.trim() })} />
      ) : (
        <div className="pos-menu__items" data-photos={anyPhoto || undefined}>
          {shown.map((item) => (
            <MenuItemCard
              key={item.id}
              name={item.name}
              price={displayPrice(item)}
              foodType={item.foodType}
              foodTypeLabel={t(`pos.menu.foodType.${item.foodType}`)}
              // A menu with no photos at all shows no empty squares (as the QR menu, P9-15).
              {...(anyPhoto && {
                photo: item.photoId === undefined ? null : photoUrl(item.photoId, 160),
              })}
              {...menuNote(menu, item, t, now)}
              onSelect={() => {
                onChoose(item, menu);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Cart({
  lines,
  onChange,
  disabled,
}: {
  lines: readonly CartLine[];
  onChange: (lines: CartLine[]) => void;
  disabled: boolean;
}) {
  const t = useT();
  return (
    <div className="pos-cart">
      <h3 className="pos-cart__title">{t('pos.cart.title')}</h3>
      {lines.length === 0 ? <p className="pos-floor__summary">{t('pos.cart.empty')}</p> : null}
      <ul className="pos-cart__lines">
        {lines.map((line) => (
          <li
            key={line.clientLineId}
            className="pos-cart__line"
            data-error={line.error !== undefined || undefined}
          >
            <div className="pos-cart__line-head">
              <span className="pos-cart__name">{line.name}</span>
              <Money paise={line.unitPrice * line.quantity} />
            </div>
            {line.summary === '' ? null : <span className="pos-cart__summary">{line.summary}</span>}
            <div className="pos-cart__line-controls">
              <QuantityStepper
                value={line.quantity}
                onChange={(quantity) => {
                  onChange(updateLine(lines, line.clientLineId, { quantity }));
                }}
                label={t('pos.item.quantityOf', { name: line.name })}
                decreaseLabel={t('pos.item.fewer')}
                increaseLabel={t('pos.item.more')}
                disabled={disabled}
              />
              <Button
                variant={line.hold === true ? 'primary' : 'secondary'}
                aria-pressed={line.hold === true}
                aria-label={t(line.hold === true ? 'pos.cart.sendNowOf' : 'pos.cart.holdOf', {
                  name: line.name,
                })}
                disabled={disabled}
                onClick={() => {
                  onChange(updateLine(lines, line.clientLineId, { hold: line.hold !== true }));
                }}
              >
                {t(line.hold === true ? 'pos.cart.held' : 'pos.cart.hold')}
              </Button>
              <IconButton
                label={t('pos.cart.remove', { name: line.name })}
                icon={<Icon name="close" />}
                disabled={disabled}
                onClick={() => {
                  onChange(removeLine(lines, line.clientLineId));
                }}
              />
            </div>
            <TextField
              label={t('pos.item.instructions')}
              value={line.instructions}
              maxLength={200}
              disabled={disabled}
              onChange={(event) => {
                onChange(
                  updateLine(lines, line.clientLineId, { instructions: event.target.value }),
                );
              }}
            />
            {line.error === undefined ? null : (
              <p className="console-notice console-notice--danger">{line.error}</p>
            )}
          </li>
        ))}
      </ul>
      {lines.length === 0 ? null : (
        <div className="pos-cart__total">
          <span>{t('pos.cart.total')}</span>
          <Money paise={cartTotal(lines)} size="lg" strong />
        </div>
      )}
    </div>
  );
}

/**
 * The table's bill: opened by whoever prints bills and takes payment; asked for by the others
 * (a waiter), who were refused the bill itself (BRD §4.2, ADR-0030).
 */
function BillButton({ sessionId, label }: { sessionId: string; label: string }) {
  const t = useT();
  const controller = useConsole();
  const toast = useToast();
  const { person } = useConsoleState();
  const { openBill, opening } = useOpenBill();
  const [asking, setAsking] = useState(false);
  if (person === undefined) return null;
  if (grantOf(person, 'BILL_PRINT_AND_PAYMENT') !== 'DENY') {
    return (
      <Button
        variant="secondary"
        loading={opening}
        onClick={() => {
          openBill({ tableSessionId: sessionId });
        }}
      >
        {t('pos.billTable')}
      </Button>
    );
  }
  if (grantOf(person, 'BILL_REQUEST') === 'DENY') return null;
  return (
    <Button
      variant="secondary"
      loading={asking}
      onClick={() => {
        setAsking(true);
        controller.api
          .requestBill({ params: { sessionId } })
          .then(
            () => {
              toast.show({
                title: t('mobile.tables.billRequested', { table: label }),
                tone: 'success',
              });
            },
            (failure: unknown) => {
              toast.show({ title: messageOf(failure, t), tone: 'danger' });
            },
          )
          .finally(() => {
            setAsking(false);
          });
      }}
    >
      {t('mobile.tables.requestBill')}
    </Button>
  );
}

function SentOrders({
  target,
  data,
  onChanged,
}: {
  target: OrderTarget;
  data: ReturnType<typeof useLive<OrderView[]>>['data'];
  onChanged: () => void;
}) {
  const t = useT();
  const controller = useConsole();
  const toast = useToast();
  const { openBill, opening } = useOpenBill();
  const { person } = useConsoleState();
  const { withOverride, dialog } = useOverride();
  const [firing, setFiring] = useState<string | undefined>();
  // ORD-011: a dish comes off a table from the POS too, not only from a waiter phone (QA-033).
  const [ending, setEnding] = useState<
    { readonly item: OrderView['items'][number]; readonly kind: 'cancel' | 'void' } | undefined
  >();
  const [endBusy, setEndBusy] = useState(false);
  const [endError, setEndError] = useState<string | undefined>();
  // KDS-008: a kitchen ticket lost to a jammed or offline printer is printed again (QA-035).
  const [reprinting, setReprinting] = useState<OrderView['kots'][number] | undefined>();
  const reprint = async (reason: string) => {
    if (reprinting === undefined) return;
    setEndBusy(true);
    setEndError(undefined);
    try {
      const result = await controller.api.reprintKot({
        params: { id: reprinting.id },
        body: { printerId: null, reason },
      });
      toast.show(
        result.printed
          ? { title: t('pos.kot.reprinted', { number: reprinting.kotNumber }), tone: 'success' }
          : {
              title: t('pos.kot.reprintFailed', {
                number: reprinting.kotNumber,
                error: result.error ?? '',
              }),
              tone: 'warning',
            },
      );
      setReprinting(undefined);
      onChanged();
    } catch (failure) {
      setEndError(messageOf(failure, t));
    } finally {
      setEndBusy(false);
    }
  };
  const end = async (reason: string) => {
    if (ending === undefined) return;
    const { item, kind } = ending;
    setEndBusy(true);
    setEndError(undefined);
    try {
      if (kind === 'cancel') {
        await controller.api.cancelOrderItem({
          params: { orderItemId: item.id },
          body: { reason },
        });
      } else {
        await withOverride(
          (overrideToken) =>
            controller.api.voidOrderItem({
              params: { orderItemId: item.id },
              body: { reason },
              ...(overrideToken !== undefined && { overrideToken }),
            }),
          { entityType: 'order_item', entityId: item.id },
        );
      }
      toast.show({
        title: t(kind === 'cancel' ? 'pos.sent.cancelled' : 'pos.sent.voided', {
          name: item.name,
        }),
        tone: 'success',
      });
      setEnding(undefined);
      onChanged();
    } catch (failure) {
      if (!(failure instanceof OverrideCancelled)) setEndError(messageOf(failure, t));
    } finally {
      setEndBusy(false);
    }
  };
  // ORD-016: an order's held items go to the kitchen now.
  const fire = async (orderId: string) => {
    setFiring(orderId);
    try {
      await controller.api.fireOrder({ params: { orderId }, body: {} });
      toast.show({ title: t('pos.sent.fired'), tone: 'success' });
      onChanged();
    } catch (failure) {
      toast.show({ title: messageOf(failure, t), tone: 'danger' });
    } finally {
      setFiring(undefined);
    }
  };
  if (data.status !== 'ready') return null;
  const heading = target.kind === 'table' ? t('pos.sent.title') : t('pos.sent.openTakeaway');
  return (
    <section className="pos-sent" aria-label={heading}>
      <h3 className="pos-cart__title">{heading}</h3>
      {data.value.length === 0 ? <p className="pos-floor__summary">{t('pos.sent.none')}</p> : null}
      {data.value.map((order) => (
        <article
          key={order.id}
          className="pos-sent__order"
          aria-label={t('pos.sent.order', { number: order.orderNumber })}
        >
          <h4 className="pos-sent__heading">
            {t('pos.sent.order', { number: order.orderNumber })}
            {order.takeawayToken === null
              ? null
              : ` · ${t('pos.sent.token', { token: order.takeawayToken })}`}
            {order.customerName === null ? null : ` · ${order.customerName}`}
          </h4>
          <ul className="pos-sent__items">
            {order.items
              .filter((item) => item.parentOrderItemId === null)
              .map((item) => (
                <li key={item.id} className="pos-sent__item">
                  <span>
                    {item.quantity} × {item.name}
                    {item.variantName === null ? '' : ` (${item.variantName})`}
                  </span>
                  <StatusChip
                    state={displayState(item, order.items)}
                    label={t(`pos.itemState.${displayState(item, order.items)}`)}
                  />
                  {person === undefined ? null : (
                    <EndButton
                      actions={lineActions(item, person.role, true)}
                      name={item.name}
                      onEnd={(kind) => {
                        setEndError(undefined);
                        setEnding({ item, kind });
                      }}
                    />
                  )}
                </li>
              ))}
          </ul>
          {order.kots
            .filter((kot) => kot.printStatus === 'FAILED' || kot.printStatus === 'PRINTED')
            .map((kot) => (
              <p key={kot.id} className="pos-sent__kot">
                <span>
                  {t('pos.kot.title', { number: kot.kotNumber, station: kot.stationName })}
                </span>
                <span>
                  {t(kot.printStatus === 'FAILED' ? 'pos.kot.failed' : 'pos.kot.printed')}
                </span>
                <Button
                  variant="ghost"
                  aria-label={t('pos.kot.reprintOf', {
                    number: kot.kotNumber,
                    station: kot.stationName,
                  })}
                  onClick={() => {
                    setEndError(undefined);
                    setReprinting(kot);
                  }}
                >
                  {t('pos.kot.reprint')}
                </Button>
              </p>
            ))}
          {order.items.some((item) => item.state === 'HELD' && item.parentOrderItemId === null) ? (
            <Button
              loading={firing === order.id}
              onClick={() => {
                void fire(order.id);
              }}
            >
              {t('pos.sent.fire')}
            </Button>
          ) : null}
          {target.kind === 'takeaway' ? (
            <Button
              variant="secondary"
              loading={opening}
              onClick={() => {
                openBill({ orderId: order.id });
              }}
            >
              {t('pos.billOrder', { number: order.orderNumber })}
            </Button>
          ) : null}
        </article>
      ))}
      {ending === undefined ? null : (
        <ReasonDialog
          title={t(ending.kind === 'cancel' ? 'pos.sent.cancelTitle' : 'pos.sent.voidTitle', {
            name: ending.item.name,
          })}
          description={t(
            ending.kind === 'cancel' ? 'pos.sent.cancelDescription' : 'pos.sent.voidDescription',
          )}
          label={t('pos.sent.reason')}
          confirmLabel={t(ending.kind === 'cancel' ? 'pos.sent.cancel' : 'pos.sent.void')}
          tone="danger"
          busy={endBusy}
          error={endError}
          onConfirm={(reason) => {
            void end(reason);
          }}
          onClose={() => {
            setEnding(undefined);
          }}
        />
      )}
      {reprinting === undefined ? null : (
        <ReasonDialog
          title={t('pos.kot.reprintTitle', {
            number: reprinting.kotNumber,
            station: reprinting.stationName,
          })}
          description={t('pos.kot.reprintDescription')}
          label={t('pos.sent.reason')}
          confirmLabel={t('pos.kot.reprint')}
          busy={endBusy}
          error={endError}
          onConfirm={(reason) => {
            void reprint(reason);
          }}
          onClose={() => {
            setReprinting(undefined);
          }}
        />
      )}
      {dialog}
    </section>
  );
}

/** Cancel (the kitchen has not started) or void (it has) a sent dish, as the person may. */
function EndButton({
  actions,
  name,
  onEnd,
}: {
  actions: ReturnType<typeof lineActions>;
  name: string;
  onEnd: (kind: 'cancel' | 'void') => void;
}) {
  const t = useT();
  if (actions.cancel) {
    return (
      <Button
        variant="ghost"
        aria-label={t('pos.sent.cancelOf', { name })}
        onClick={() => {
          onEnd('cancel');
        }}
      >
        {t('pos.sent.cancel')}
      </Button>
    );
  }
  if (actions.void === null) return null;
  return (
    <Button
      variant="ghost"
      aria-label={t('pos.sent.voidOf', { name })}
      onClick={() => {
        onEnd('void');
      }}
    >
      {t('pos.sent.void')}
    </Button>
  );
}
