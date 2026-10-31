'use client';

import type { MenuItem, OrderLineRequest } from '@rp/contracts';
import type { QrOrderView } from '@rp/contracts/relay';
import { displayDateTime } from '@rp/domain';
import { Button, Icon, StatusChip } from '@rp/ui-web';
import { useT } from './i18n';

/** Where an order is, by the page's own clock too: one nobody picked up in time reads EXPIRED. */
export function shownStatus(order: QrOrderView, now: number): QrOrderView['status'] {
  return order.status === 'SUBMITTED' && Date.parse(order.expiresAt) < now
    ? 'EXPIRED'
    : order.status;
}

/**
 * The diner's orders at this table and where each is (QR-007, P9-04): sending, waiting for the
 * restaurant to accept it, accepted with each dish's state in the kitchen, or the reason it was not
 * taken. Each order, and each dish, can be ordered again: it goes back in the cart to be sent.
 */
export function Orders({
  orders,
  items,
  now,
  readOnly,
  onAgain,
}: {
  orders: readonly QrOrderView[];
  items: ReadonlyMap<string, MenuItem>;
  now: number;
  readOnly: boolean;
  onAgain: (lines: readonly OrderLineRequest[]) => void;
}) {
  const t = useT();
  if (orders.length === 0) {
    return (
      <section className="qr-panel qr-empty-state" aria-labelledby="qr-orders-title">
        <h2 id="qr-orders-title" className="qr-section__title">
          {t('qrSite.orders.title')}
        </h2>
        <p className="qr-muted">{t('qrSite.orders.empty')}</p>
      </section>
    );
  }
  return (
    <section className="qr-panel qr-orders" aria-labelledby="qr-orders-title">
      <h2 id="qr-orders-title" className="qr-section__title">
        {t('qrSite.orders.title')}
      </h2>
      <ul>
        {orders.map((order, index) => {
          const status = shownStatus(order, now);
          const states = new Map(
            (order.detail.items ?? []).map((line) => [line.clientLineId, line.state]),
          );
          const tone =
            status === 'SENT_TO_KITCHEN'
              ? 'success'
              : status === 'REJECTED' || status === 'EXPIRED'
                ? 'danger'
                : 'info';
          return (
            <li key={order.id} className="qr-order" data-tone={tone}>
              <div className="qr-order__head">
                <p className="qr-order__number">
                  {t('qrSite.orders.number', { number: orders.length - index })}
                </p>
                <p className="qr-muted">
                  {t('qrSite.orders.placed', displayDateTime(new Date(order.submittedAt)))}
                </p>
              </div>
              <p role="status" className={`qr-order__status qr-order__status--${tone}`}>
                <Icon
                  name={
                    status === 'SENT_TO_KITCHEN'
                      ? 'check'
                      : tone === 'danger'
                        ? 'xCircle'
                        : status === 'RECEIVED'
                          ? 'clock'
                          : 'send'
                  }
                />
                <span>{t(`qrSite.orders.${status}`)}</span>
              </p>
              {status === 'REJECTED' && order.detail.rejectionReason !== undefined ? (
                <p className="qr-order__reason">
                  {t('qrSite.orders.reason', { reason: order.detail.rejectionReason })}
                </p>
              ) : null}
              <ul className="qr-order__lines">
                {order.lines.map((line) => {
                  const state = states.get(line.clientLineId);
                  const name = items.get(line.itemId)?.name ?? '?';
                  return (
                    <li key={line.clientLineId}>
                      <span className="qr-order__line">
                        {t('qrSite.orders.line', { quantity: line.quantity, name })}
                      </span>
                      {state === undefined ? null : (
                        <StatusChip state={state} label={t(`qrSite.orders.itemState.${state}`)} />
                      )}
                      <button
                        type="button"
                        className="qr-again-one"
                        disabled={readOnly}
                        aria-label={t('qrSite.orders.againOne', { name })}
                        onClick={() => {
                          onAgain([{ ...line, quantity: 1 }]);
                        }}
                      >
                        <Icon name="plus" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <Button
                variant="secondary"
                fullWidth
                disabled={readOnly}
                startIcon={<Icon name="sync" />}
                onClick={() => {
                  onAgain(order.lines);
                }}
              >
                {t('qrSite.orders.again')}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
