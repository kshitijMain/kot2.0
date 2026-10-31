'use client';

import type { MenuItem, OrderLineRequest } from '@rp/contracts';
import type { QrOrderView } from '@rp/contracts/relay';
import { displayDateTime } from '@rp/domain';
import { Button, Icon, StatusChip } from '@rp/ui-web';
import { useT } from './i18n';
import { ORDER_STEPS, orderStep } from './progress';
import { CardSkeleton } from './Skeletons';
import { QrEmpty } from './States';

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
  loading = false,
  heardAt,
  onAgain,
  onBrowse,
  onRefresh,
}: {
  orders: readonly QrOrderView[];
  items: ReadonlyMap<string, MenuItem>;
  now: number;
  readOnly: boolean;
  /** Still finding this number's orders: a placeholder, not "nothing yet" (P9-11). */
  loading?: boolean;
  /** When the page last heard from the restaurant about these orders. */
  heardAt?: number | undefined;
  onAgain: (lines: readonly OrderLineRequest[]) => void;
  /** Back to the menu, from the empty state. */
  onBrowse?: () => void;
  /** Look again now, rather than at the next tick (P9-13). */
  onRefresh?: () => void;
}) {
  const t = useT();
  const refresh =
    onRefresh === undefined ? null : (
      <div className="qr-orders__refresh">
        {heardAt === undefined ? null : (
          <span className="qr-muted">
            {t('qrSite.orders.updated', displayDateTime(new Date(heardAt)))}
          </span>
        )}
        <Button variant="ghost" startIcon={<Icon name="sync" />} onClick={onRefresh}>
          {t('qrSite.orders.refresh')}
        </Button>
      </div>
    );
  if (orders.length === 0) {
    return (
      <section className="qr-panel" aria-labelledby="qr-orders-title">
        <div className="qr-orders__head">
          <h2 id="qr-orders-title" className="qr-section__title">
            {t('qrSite.orders.title')}
          </h2>
          {refresh}
        </div>
        {loading ? (
          <CardSkeleton label={t('qrSite.orders.loading')} />
        ) : (
          <QrEmpty
            icon="inbox"
            title={t('qrSite.orders.emptyTitle')}
            body={t('qrSite.orders.empty')}
            action={t('qrSite.browse')}
            {...(onBrowse !== undefined && { onAction: onBrowse })}
          />
        )}
      </section>
    );
  }
  return (
    <section className="qr-panel qr-orders" aria-labelledby="qr-orders-title">
      <div className="qr-orders__head">
        <h2 id="qr-orders-title" className="qr-section__title">
          {t('qrSite.orders.title')}
        </h2>
        {refresh}
      </div>
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
              <p role="status" className="qr-order__status" data-tone={tone}>
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
              <Progress step={orderStep(order, status)} />
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

/**
 * Where the order is, as a tracker (P9-09): the steps reached are filled, the next one pulses.
 * Nothing for an order the restaurant did not take.
 */
function Progress({ step }: { step: number | undefined }) {
  const t = useT();
  if (step === undefined) return null;
  return (
    <ol className="qr-progress" aria-label={t('qrSite.progress.label')}>
      {ORDER_STEPS.map((name, index) => (
        <li
          key={name}
          className="qr-progress__step"
          data-state={index <= step ? 'done' : index === step + 1 ? 'next' : 'todo'}
          aria-current={index === step ? 'step' : undefined}
        >
          <span className="qr-progress__dot" aria-hidden="true">
            {index <= step ? <Icon name="check" size="0.625rem" /> : null}
          </span>
          <span className="qr-progress__label">{t(`qrSite.progress.${name}`)}</span>
        </li>
      ))}
    </ol>
  );
}
