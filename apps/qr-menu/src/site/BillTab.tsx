'use client';

import type { QrBillInvoice, QrMenuDocument, QrOrderView, QrTableBill } from '@rp/contracts/relay';
import { formatRupees, unitPriceOf, type UpiApp, upiPayLink } from '@rp/domain';
import { type CartLine, estimateCart, selectable } from '@rp/ordering';
import { Button, Icon, QrCode } from '@rp/ui-web';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { HelpButtons } from './HelpButtons';
import { CardSkeleton } from './Skeletons';
import { QrEmpty } from './States';
import { useT } from './i18n';
import { shownStatus } from './Orders';
import { fetchTableBill } from './relay';
import type { ServiceRequests } from './requests';

/** How often the Bill tab asks for the printed bill while it is open or the bill was asked for. */
const BILL_POLL_MS = 5_000;
/** Otherwise, now and then, so a bill printed meanwhile is there when the tab opens. */
const BILL_IDLE_POLL_MS = 30_000;
const GONE = new Set(['REJECTED', 'CANCELLED', 'VOIDED']);
/** iPhones open only each app's own link; Android opens `upi://` in any UPI app. */
const APPS: readonly Exclude<UpiApp, 'ANY'>[] = ['GPAY', 'PHONEPE', 'PAYTM'];

const subscribeNothing = () => () => undefined;
const isApple = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

/**
 * What the diner has ordered here so far, priced from the menu (an estimate: the restaurant
 * prints the bill, ORD-014). Orders not taken and dishes not served are left out.
 */
export function orderedSoFar(
  document: QrMenuDocument,
  orders: readonly QrOrderView[],
  now: number,
) {
  const lines: CartLine[] = [];
  for (const order of orders) {
    const status = shownStatus(order, now);
    if (status === 'REJECTED' || status === 'EXPIRED') continue;
    const states = new Map((order.detail.items ?? []).map((line) => [line.clientLineId, line]));
    for (const line of order.lines) {
      const told = states.get(line.clientLineId);
      if (told !== undefined && GONE.has(told.state)) continue;
      const item = document.menu.items.find((candidate) => candidate.id === line.itemId);
      if (item === undefined) continue;
      const selection = {
        ...(line.variantId !== undefined && { variantId: line.variantId }),
        modifiers: line.modifiers,
      };
      lines.push({
        clientLineId: line.clientLineId,
        itemId: item.id,
        name: item.name,
        summary: '',
        // The restaurant's number when it changed the diner's (ORD-004, P9-24).
        quantity: told?.quantity ?? line.quantity,
        selection,
        instructions: '',
        unitPrice: unitPriceOf(selectable(document.menu, item), selection),
      });
    }
  }
  return { lines, estimate: estimateCart(lines, document.menu, document.priceMode) };
}

/**
 * The Bill tab (P9-03, P9-04): before the bill, what was ordered so far and "Ask for the bill";
 * once the restaurant prints it, the bill as printed with Pay by UPI (the amount filled in), a QR
 * code to pay from another phone, and "I have paid" for the staff to check and settle.
 */
export function BillTab({
  token,
  relayUrl,
  document,
  orders,
  requests,
  readOnly,
  active,
  now,
  onBrowse,
}: {
  token: string;
  relayUrl: string;
  document: QrMenuDocument;
  orders: readonly QrOrderView[];
  requests: ServiceRequests;
  readOnly: boolean;
  active: boolean;
  now: number;
  /** Back to the menu, from the empty state. */
  onBrowse?: () => void;
}) {
  const t = useT();
  const [bill, setBill] = useState<QrTableBill | null | undefined>();
  // A bill seen here that has since gone was settled and its sitting closed.
  const [hadBill, setHadBill] = useState(false);
  // The first look at the bill came back, either way: until then a placeholder (P9-11).
  const [looked, setLooked] = useState(false);
  const asked = requests.open('BILL') || requests.open('PAID');
  const often = active || asked;

  useEffect(() => {
    let stopped = false;
    const load = () => {
      fetchTableBill(relayUrl, token).then(
        ({ bill: fresh }) => {
          if (stopped) return;
          setLooked(true);
          setBill(fresh);
          if (fresh !== null) setHadBill(true);
        },
        () => {
          // Not reached: say what was ordered, and look again at the next tick.
          if (!stopped) setLooked(true);
        },
      );
    };
    load();
    const timer = setInterval(load, often ? BILL_POLL_MS : BILL_IDLE_POLL_MS);
    const page = globalThis.document;
    const back = () => {
      if (page.visibilityState === 'visible') load();
    };
    page.addEventListener('visibilitychange', back);
    return () => {
      stopped = true;
      clearInterval(timer);
      page.removeEventListener('visibilitychange', back);
    };
  }, [relayUrl, token, often]);

  const soFar = useMemo(() => orderedSoFar(document, orders, now), [document, orders, now]);

  if (bill === null || bill === undefined) {
    return (
      <section className="qr-panel" aria-labelledby="qr-bill-title">
        <h2 id="qr-bill-title" className="qr-section__title">
          {t('qrSite.bill.title')}
        </h2>
        {hadBill ? (
          <p role="status" className="qr-paid-banner">
            <Icon name="check" />
            <span>{t('qrSite.bill.closed', { restaurant: document.restaurantName })}</span>
          </p>
        ) : null}
        {!looked && soFar.lines.length === 0 ? (
          // The first look at the bill has not come back yet (P9-11).
          <CardSkeleton label={t('qrSite.bill.loading')} />
        ) : soFar.lines.length === 0 ? (
          hadBill ? null : (
            <QrEmpty
              icon="receipt"
              title={t('qrSite.bill.nothingTitle')}
              body={t('qrSite.bill.nothing')}
              action={t('qrSite.browse')}
              {...(onBrowse !== undefined && { onAction: onBrowse })}
            />
          )
        ) : (
          <div className="qr-invoice">
            <p className="qr-invoice__number">{t('qrSite.bill.soFar')}</p>
            <ul className="qr-bill__lines" aria-label={t('qrSite.bill.soFar')}>
              {soFar.lines.map((line) => (
                <li key={line.clientLineId}>
                  <span>
                    {t('qrSite.orders.line', { quantity: line.quantity, name: line.name })}
                  </span>
                  <span>{formatRupees(line.unitPrice * line.quantity)}</span>
                </li>
              ))}
            </ul>
            {/* The dishes and the taxes the total adds, as the cart shows them (P9-23): the total
                had jumped from ₹550 to ₹577.50 with nothing to say why. */}
            <dl className="qr-totals">
              <div>
                <dt>{t('qrSite.cart.subtotal')}</dt>
                <dd>{formatRupees(soFar.estimate.subtotal)}</dd>
              </div>
              {soFar.estimate.tax === 0 ? null : (
                <div>
                  <dt>{t('qrSite.cart.tax')}</dt>
                  <dd>{formatRupees(soFar.estimate.tax)}</dd>
                </div>
              )}
              <div className="qr-totals__total">
                <dt>{t('qrSite.bill.estimate')}</dt>
                <dd>{formatRupees(soFar.estimate.total)}</dd>
              </div>
            </dl>
            <p className="qr-muted">{t('qrSite.bill.estimateNote')}</p>
          </div>
        )}
        {soFar.lines.length === 0 ? null : (
          <>
            <p className="qr-muted">{t('qrSite.bill.waiting')}</p>
            <HelpButtons
              types={['BILL']}
              requests={requests}
              readOnly={readOnly}
              variant="accent"
            />
          </>
        )}
      </section>
    );
  }

  return (
    <section className="qr-panel" aria-labelledby="qr-bill-title">
      <h2 id="qr-bill-title" className="qr-section__title">
        {t('qrSite.bill.title')}
      </h2>
      {bill.invoices.map((invoice) => (
        <Invoice
          key={invoice.invoiceNumber}
          invoice={invoice}
          bill={bill}
          restaurant={document.restaurantName}
        />
      ))}
      {bill.invoices.some((invoice) => invoice.status === 'ISSUED') ? (
        <div className="qr-paid-ask">
          <p className="qr-muted">{t('qrSite.bill.paidNote')}</p>
          <HelpButtons
            types={['PAID']}
            requests={requests}
            readOnly={readOnly}
            variant="secondary"
          />
        </div>
      ) : null}
    </section>
  );
}

function Invoice({
  invoice,
  bill,
  restaurant,
}: {
  invoice: QrBillInvoice;
  bill: QrTableBill;
  restaurant: string;
}) {
  const t = useT();
  const apple = useSyncExternalStore(subscribeNothing, isApple, () => false);
  const [copied, setCopied] = useState(false);
  const upi = bill.upi;
  const payment =
    upi === null || invoice.grandTotal <= 0
      ? undefined
      : {
          upiId: upi.upiId,
          payeeName: upi.payeeName,
          amountPaise: invoice.grandTotal,
          note: t('qrSite.bill.payNote', { restaurant, number: invoice.invoiceNumber }),
        };
  return (
    <article
      className="qr-invoice"
      aria-label={t('qrSite.bill.invoice', { number: invoice.invoiceNumber })}
    >
      <header className="qr-invoice__head">
        <p className="qr-invoice__number">
          {t('qrSite.bill.invoice', { number: invoice.invoiceNumber })}
        </p>
        {invoice.status === 'SETTLED' ? (
          <span className="qr-invoice__paid">{t('qrSite.bill.settled')}</span>
        ) : null}
      </header>
      <ul className="qr-bill__lines">
        {invoice.lines.map((line, index) => (
          <li key={`${line.description}-${String(index)}`}>
            <span>
              {t('qrSite.orders.line', { quantity: line.quantity, name: line.description })}
            </span>
            <span>{formatRupees(line.amount)}</span>
          </li>
        ))}
      </ul>
      <dl className="qr-totals">
        <div>
          <dt>{t('qrSite.bill.subtotal')}</dt>
          <dd>{formatRupees(invoice.subtotal)}</dd>
        </div>
        {invoice.discountTotal > 0 ? (
          <div>
            <dt>{t('qrSite.bill.discount')}</dt>
            <dd>−{formatRupees(invoice.discountTotal)}</dd>
          </div>
        ) : null}
        {invoice.serviceCharge > 0 ? (
          <div>
            <dt>{t('qrSite.bill.serviceCharge')}</dt>
            <dd>{formatRupees(invoice.serviceCharge)}</dd>
          </div>
        ) : null}
        {invoice.taxLines.map((tax) => (
          <div key={tax.label}>
            <dt>{tax.label}</dt>
            <dd>{formatRupees(tax.amount)}</dd>
          </div>
        ))}
        {invoice.roundOff === 0 ? null : (
          <div>
            <dt>{t('qrSite.bill.roundOff')}</dt>
            <dd>
              {invoice.roundOff < 0 ? '−' : ''}
              {formatRupees(Math.abs(invoice.roundOff))}
            </dd>
          </div>
        )}
        <div className="qr-totals__total">
          <dt>{t('qrSite.bill.total')}</dt>
          <dd>{formatRupees(invoice.grandTotal)}</dd>
        </div>
      </dl>
      {invoice.status === 'SETTLED' ? null : payment === undefined || upi === null ? (
        <p className="qr-muted">{t('qrSite.bill.noUpi')}</p>
      ) : (
        <div className="qr-pay">
          <a className="qr-pay__button" href={upiPayLink(payment)}>
            <Icon name="receipt" />
            <span>{t('qrSite.bill.pay', { amount: formatRupees(invoice.grandTotal) })}</span>
          </a>
          <p className="qr-pay__apps">
            <span className="qr-muted">
              {t(apple ? 'qrSite.bill.openApple' : 'qrSite.bill.openIn')}
            </span>
            {APPS.map((app) => (
              <a key={app} className="qr-pay__app" href={upiPayLink(payment, app)}>
                {t(`qrSite.bill.apps.${app}`)}
              </a>
            ))}
          </p>
          <div className="qr-pay__qr">
            <QrCode
              value={upiPayLink(payment)}
              label={t('qrSite.bill.qrLabel', { amount: formatRupees(invoice.grandTotal) })}
              size={176}
            />
            <p className="qr-muted">{t('qrSite.bill.scan')}</p>
          </div>
          <p className="qr-pay__upi">
            <span>{t('qrSite.bill.upiId', { upiId: upi.upiId })}</span>
            <Button
              variant="ghost"
              onClick={() => {
                // No clipboard outside https (a test on the restaurant's Wi-Fi): the ID is shown.
                const { clipboard } = navigator as { clipboard?: Clipboard };
                void clipboard?.writeText(upi.upiId).then(() => {
                  setCopied(true);
                });
              }}
            >
              {copied ? t('qrSite.bill.copied') : t('qrSite.bill.copy')}
            </Button>
          </p>
        </div>
      )}
    </article>
  );
}
